/**
 * Historical-analog PM₂.₅ projection for the modeling overlay.
 *
 * Finds past days with similar pollution patterns, wind, and time-of-day, then blends
 * how those situations evolved over the next 1–5 hours. A single-pass wind shift nudges
 * the predicted change field; no per-cell semi-Lagrangian backtracing.
 */

import type { CurrentKrigingRow } from '../database.types';
import {
  type ForecastWindGridByTime,
  windGridSliceAtMinutes,
  windVectorAtLatLon,
} from '../forecastWindGrid';
import {
  formatStepShortLabel,
  minutesAheadForStep,
  PROJECTION_FRAME_COUNT,
} from '../projectionTimeLabels';

import type { HistoricalAnalogLibrary, HistoricalAnalogSample } from './buildHistoricalAnalogLibrary';
import {
  buildAnalogProjectionQuality,
  computeRecentTrendDelta,
  computeWeakFallbackWeight,
  countTopKWithDelta,
  uncertaintyForAnalogStep,
  type AnalogProjectionQuality,
} from './analogProjectionMetrics';
import {
  addFlatToGrid,
  flatToPm25Values,
  PM25_CELL_COUNT,
  pm25ValuesToFlat,
  rowsToPm25Grid2D,
  pm25Grid2DToRows,
  smoothPm25Grid3x3,
  warpFieldByWind,
  windSliceToFlatArrays,
  type Pm25Grid2D,
} from './gridMath';
import {
  buildProjectionFeatureVector,
  weightedFeatureDistance,
} from './projectionFeatures';

export type { AnalogProjectionQuality } from './analogProjectionMetrics';

export type AnalogProjectionDebugMode = 'analog-only' | 'wind-shift-only' | 'blend';

export type ProjectionFrame = {
  stepIndex: number;
  minutesAhead: number;
  label: string;
  grid: CurrentKrigingRow[];
  opacityScale: number;
  uncertaintyOverlay: number;
};

export type GenerateAnalogProjectionFramesInput = {
  nowGrid: CurrentKrigingRow[];
  wind: ForecastWindGridByTime | null;
  library: HistoricalAnalogLibrary;
  debugMode?: AnalogProjectionDebugMode;
  topK?: number;
  nowMs?: number;
};

export type GenerateAnalogProjectionFramesResult = {
  frames: ProjectionFrame[];
  analogCount: number;
  windAvailable: boolean;
  quality: AnalogProjectionQuality;
};

const DEFAULT_TOP_K = 12;
const RECENCY_HALF_LIFE_DAYS = 10;

type AnalogMatch = {
  sample: HistoricalAnalogSample;
  distance: number;
  weight: number;
};

function clampDeltaFlat(delta: Float32Array, cap: number): Float32Array {
  const out = new Float32Array(delta.length);
  for (let i = 0; i < delta.length; i += 1) {
    out[i] = Math.max(-cap, Math.min(cap, delta[i]));
  }
  return out;
}

function blendDeltaFlat(
  matches: AnalogMatch[],
  deltaStepIdx: number,
): { delta: Float32Array | null; validCount: number } {
  if (matches.length === 0) return { delta: null, validCount: 0 };
  let weightSum = 0;
  let validCount = 0;
  const blended = new Float32Array(PM25_CELL_COUNT);
  for (const { sample, weight } of matches) {
    const d = sample.futureDeltaByStep[deltaStepIdx];
    if (!d) continue;
    validCount += 1;
    weightSum += weight;
    for (let i = 0; i < PM25_CELL_COUNT; i += 1) blended[i] += d[i] * weight;
  }
  if (!(weightSum > 0)) return { delta: null, validCount: 0 };
  for (let i = 0; i < PM25_CELL_COUNT; i += 1) blended[i] /= weightSum;
  return { delta: blended, validCount };
}

function blendFlatFields(
  primary: Float32Array,
  fallback: Float32Array,
  fallbackWeight: number,
): Float32Array {
  const w = Math.max(0, Math.min(1, fallbackWeight));
  const out = new Float32Array(primary.length);
  for (let i = 0; i < primary.length; i += 1) {
    out[i] = (1 - w) * primary[i] + w * fallback[i];
  }
  return out;
}

function findTopAnalogs(
  library: HistoricalAnalogLibrary,
  queryFeatures: Float32Array,
  nowMs: number,
  topK: number,
): AnalogMatch[] {
  const scored: AnalogMatch[] = [];
  for (const sample of library.samples) {
    const distance = weightedFeatureDistance(queryFeatures, sample.features);
    scored.push({
      sample,
      distance,
      weight: 0,
    });
  }
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, topK);
  let weightSum = 0;
  for (const m of top) {
    const ageDays = (nowMs - m.sample.timeMs) / (24 * 60 * 60 * 1000);
    const recencyFactor = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
    m.weight = (1 / (m.distance * m.distance + 1e-4)) * (0.85 + 0.15 * recencyFactor);
    weightSum += m.weight;
  }
  if (weightSum > 0) {
    for (const m of top) m.weight /= weightSum;
  }
  return top;
}

function meanWindForStep(
  wind: ForecastWindGridByTime | null,
  minutesAhead: number,
  grid: Pm25Grid2D,
): { uMs: number; vMs: number } {
  if (!wind?.available) return { uMs: 0, vMs: 0 };
  const slice = windGridSliceAtMinutes(wind.byTime, minutesAhead);
  const latMid = (grid.latAsc[0] + grid.latAsc[grid.latAsc.length - 1]) / 2;
  const lonMid = (grid.lonAsc[0] + grid.lonAsc[grid.lonAsc.length - 1]) / 2;
  const sample = windVectorAtLatLon(slice, latMid, lonMid);
  return sample ? { uMs: sample.uMs, vMs: sample.vMs } : { uMs: 0, vMs: 0 };
}

type StepBuildContext = {
  nowPm25: Pm25Grid2D;
  matches: AnalogMatch[];
  library: HistoricalAnalogLibrary;
  wind: ForecastWindGridByTime | null;
  debugMode: AnalogProjectionDebugMode;
  weakFallbackWeight: number;
  meanTopKDistance: number | null;
  nowMs: number;
};

function buildStepFrame(
  stepIndex: number,
  ctx: StepBuildContext,
): ProjectionFrame {
  const { nowPm25, matches, library, wind, debugMode, weakFallbackWeight, meanTopKDistance, nowMs } =
    ctx;
  const minutesAhead = minutesAheadForStep(stepIndex);
  const topKCount = matches.length;

  if (stepIndex === 0) {
    return {
      stepIndex,
      minutesAhead,
      label: formatStepShortLabel(minutesAhead),
      grid: pm25Grid2DToRows(nowPm25),
      opacityScale: 1,
      uncertaintyOverlay: 0,
    };
  }

  const deltaStepIdx = stepIndex - 1;
  const validDeltaCount = countTopKWithDelta(matches, deltaStepIdx);
  const uncertaintyOverlay = uncertaintyForAnalogStep({
    stepIndex,
    meanTopKDistance,
    topKCount,
    validDeltaCount,
    weakFallbackWeight,
  });

  const cap = library.deltaCapByStep[deltaStepIdx] ?? 25;
  const { delta: analogDelta } = blendDeltaFlat(matches, deltaStepIdx);
  const trendDelta = computeRecentTrendDelta(library, deltaStepIdx, nowMs);

  let deltaFlat = analogDelta ?? new Float32Array(PM25_CELL_COUNT);
  if (weakFallbackWeight > 0) {
    deltaFlat = blendFlatFields(deltaFlat, trendDelta, weakFallbackWeight);
  }
  deltaFlat = clampDeltaFlat(deltaFlat, cap);

  let deltaGrid = flatToPm25Values(deltaFlat, nowPm25);
  const hours = minutesAhead / 60;
  const { uMs, vMs } = meanWindForStep(wind, minutesAhead, nowPm25);

  if (debugMode === 'wind-shift-only') {
    const values = smoothPm25Grid3x3(warpFieldByWind(nowPm25.values, nowPm25, uMs, vMs, hours));
    return {
      stepIndex,
      minutesAhead,
      label: formatStepShortLabel(minutesAhead),
      grid: pm25Grid2DToRows({ ...nowPm25, values }),
      opacityScale: 1,
      uncertaintyOverlay,
    };
  }

  if (debugMode === 'blend' && wind?.available) {
    deltaGrid = warpFieldByWind(deltaGrid, nowPm25, uMs, vMs, hours);
  }

  let values = addFlatToGrid(nowPm25.values, pm25ValuesToFlat(deltaGrid));
  values = smoothPm25Grid3x3(values);

  return {
    stepIndex,
    minutesAhead,
    label: formatStepShortLabel(minutesAhead),
    grid: pm25Grid2DToRows({ ...nowPm25, values }),
    opacityScale: 1,
    uncertaintyOverlay,
  };
}

function emptyQuality(library: HistoricalAnalogLibrary): AnalogProjectionQuality {
  return buildAnalogProjectionQuality({
    library,
    matches: [],
    weakFallbackWeight: computeWeakFallbackWeight(library.samples.length, null),
    perStepUncertainty: Array.from({ length: PROJECTION_FRAME_COUNT }, () => 0),
  });
}

/** Precompute all projection frames (Now … +5h) once per overlay open. */
export function generateAnalogProjectionFrames({
  nowGrid,
  wind,
  library,
  debugMode = 'blend',
  topK = DEFAULT_TOP_K,
  nowMs = Date.now(),
}: GenerateAnalogProjectionFramesInput): GenerateAnalogProjectionFramesResult {
  const nowPm25 = rowsToPm25Grid2D(nowGrid);
  const windOk = wind?.available === true && (wind.byTime.size ?? 0) > 0;

  if (!nowPm25) {
    const quality = emptyQuality(library);
    return { frames: [], analogCount: 0, windAvailable: windOk, quality };
  }

  const windSlice = windOk ? windGridSliceAtMinutes(wind!.byTime, 0) : null;
  const windFlat = windSliceToFlatArrays(windSlice);
  const queryFeatures = buildProjectionFeatureVector(
    nowPm25,
    windFlat?.u ?? null,
    windFlat?.v ?? null,
    nowMs,
  );

  const matches =
    library.samples.length > 0
      ? findTopAnalogs(library, queryFeatures, nowMs, topK)
      : [];

  const meanTopKDistance =
    matches.length > 0
      ? matches.reduce((s, m) => s + m.distance, 0) / matches.length
      : null;
  const weakFallbackWeight = computeWeakFallbackWeight(
    library.samples.length,
    meanTopKDistance,
  );

  const useMatches =
    debugMode === 'analog-only' || debugMode === 'blend' ? matches : [];
  const stepCtx: StepBuildContext = {
    nowPm25,
    matches: useMatches,
    library,
    wind,
    debugMode,
    weakFallbackWeight,
    meanTopKDistance,
    nowMs,
  };

  const frames: ProjectionFrame[] = [];
  const perStepUncertainty: number[] = [];

  for (let step = 0; step < PROJECTION_FRAME_COUNT; step += 1) {
    const frame = buildStepFrame(step, stepCtx);
    frames.push(frame);
    perStepUncertainty.push(frame.uncertaintyOverlay);
  }

  const quality = buildAnalogProjectionQuality({
    library,
    matches,
    weakFallbackWeight,
    perStepUncertainty,
  });

  return {
    frames,
    analogCount: matches.length,
    windAvailable: windOk,
    quality,
  };
}
