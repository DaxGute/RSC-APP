/**
 * Historical climatology-prior scenario projection for the modeling overlay.
 *
 * Frame 0 is the frozen now grid.
 * Frames +1h…+5h apply a conservative blend of:
 * - recent robust live trend (last ~60-120 min), and
 * - hour-of-day historical priors from the analog library.
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
  uncertaintyForAnalogStep,
  type AnalogProjectionQuality,
} from './analogProjectionMetrics';
import {
  rowsToPm25Grid2D,
  pm25Grid2DToRows,
  smoothPm25Grid3x3,
  warpFieldByWind,
  PM25_GRID_SIZE,
  type Pm25Grid2D,
} from './gridMath';

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

const LIVE_WEIGHTS = [0.6, 0.45, 0.3, 0.2, 0.1] as const;
const HISTORY_WEIGHTS = [0.2, 0.3, 0.35, 0.35, 0.35] as const;
const MANY_SAMPLE_ZONE_THRESHOLD = 18;
const MAX_GLOBAL_DELTA_BY_STEP = [4, 6, 7, 8, 8] as const;
const WIND_BLEND = 0.12;
const WIND_MAX_CELLS = 0.6;

type ZoneName = 'west' | 'central' | 'east';

type HourHorizonPrior = {
  median: number;
  p25: number;
  p75: number;
  count: number;
  confidence: number;
  zoneMedian: Record<ZoneName, number>;
};

type ClimatologyPrior = {
  globalByStep: HourHorizonPrior[];
  totalCountByStep: number[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const t = pos - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function mean(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i += 1) sum += arr[i];
  return sum / arr.length;
}

function zoneMeanDelta(flat: Float32Array, zone: ZoneName): number {
  const n = PM25_GRID_SIZE;
  const westMax = Math.floor(n / 3);
  const eastMin = Math.floor((2 * n) / 3);
  let sum = 0;
  let count = 0;
  for (let yi = 0; yi < n; yi += 1) {
    for (let xi = 0; xi < n; xi += 1) {
      const isInZone =
        zone === 'west' ? xi < westMax : zone === 'central' ? xi >= westMax && xi < eastMin : xi >= eastMin;
      if (!isInZone) continue;
      sum += flat[yi * n + xi] ?? 0;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function buildClimatologyPrior(
  samples: HistoricalAnalogSample[],
  anchorHour: number,
): ClimatologyPrior {
  const globalByStep: HourHorizonPrior[] = [];
  const totalCountByStep: number[] = [];
  for (let step = 0; step < PROJECTION_FRAME_COUNT - 1; step += 1) {
    const deltas: number[] = [];
    const zoneWest: number[] = [];
    const zoneCentral: number[] = [];
    const zoneEast: number[] = [];
    let totalCount = 0;
    for (const s of samples) {
      const h = new Date(s.timeMs).getHours();
      if (h !== anchorHour) continue;
      const d = s.futureDeltaByStep[step];
      if (!d) continue;
      totalCount += 1;
      deltas.push(mean(d));
      zoneWest.push(zoneMeanDelta(d, 'west'));
      zoneCentral.push(zoneMeanDelta(d, 'central'));
      zoneEast.push(zoneMeanDelta(d, 'east'));
    }
    const count = deltas.length;
    const confidence = clamp(count / 24, 0, 1);
    globalByStep.push({
      median: quantile(deltas, 0.5),
      p25: quantile(deltas, 0.25),
      p75: quantile(deltas, 0.75),
      count,
      confidence,
      zoneMedian: {
        west: quantile(zoneWest, 0.5),
        central: quantile(zoneCentral, 0.5),
        east: quantile(zoneEast, 0.5),
      },
    });
    totalCountByStep.push(totalCount);
  }
  return { globalByStep, totalCountByStep };
}

function liveTrendConfidence(library: HistoricalAnalogLibrary): number {
  const sensorTerm = clamp(library.recentLiveTrendSensorCount / 6, 0, 1);
  const noiseTerm = 1 - clamp(library.recentLiveTrendNoise / 3.5, 0, 1);
  return clamp(sensorTerm * noiseTerm, 0, 1);
}

function zoneBlendAtX(xi: number): { west: number; central: number; east: number } {
  const n = PM25_GRID_SIZE;
  const t = n <= 1 ? 0 : xi / (n - 1);
  const cCenter = 0.5;
  const cSpan = 0.35;
  const central = clamp(1 - Math.abs(t - cCenter) / cSpan, 0, 1);
  const west = clamp(1 - t * 2, 0, 1) * (1 - central * 0.4);
  const east = clamp((t - 0.5) * 2, 0, 1) * (1 - central * 0.4);
  const sum = west + central + east;
  if (!(sum > 0)) return { west: 1, central: 0, east: 0 };
  return { west: west / sum, central: central / sum, east: east / sum };
}

function applyTinyWindShift(values: number[][], grid: Pm25Grid2D, uMs: number, vMs: number, hours: number): number[][] {
  const shifted = warpFieldByWind(values, grid, uMs, vMs, hours, WIND_MAX_CELLS);
  const out: number[][] = [];
  for (let yi = 0; yi < values.length; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < values[yi].length; xi += 1) {
      const base = values[yi][xi] ?? 0;
      const moved = shifted[yi]?.[xi] ?? base;
      row.push(base * (1 - WIND_BLEND) + moved * WIND_BLEND);
    }
    out.push(row);
  }
  return out;
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
  nowGridRows: CurrentKrigingRow[];
  library: HistoricalAnalogLibrary;
  prior: ClimatologyPrior;
  wind: ForecastWindGridByTime | null;
  debugMode: AnalogProjectionDebugMode;
};

function buildStepFrame(
  stepIndex: number,
  ctx: StepBuildContext,
): ProjectionFrame {
  const {
    nowPm25,
    nowGridRows,
    library,
    prior,
    wind,
    debugMode,
  } = ctx;
  const minutesAhead = minutesAheadForStep(stepIndex);

  if (stepIndex === 0) {
    return {
      stepIndex,
      minutesAhead,
      label: formatStepShortLabel(minutesAhead),
      grid: nowGridRows,
      opacityScale: 1,
      uncertaintyOverlay: 0,
    };
  }

  const stepIdx = stepIndex - 1;
  const priorStep = prior.globalByStep[stepIdx];
  const liveConf = liveTrendConfidence(library);
  const histConf = priorStep?.confidence ?? 0;
  const liveWeight = LIVE_WEIGHTS[stepIdx] * liveConf;
  const historyWeight = HISTORY_WEIGHTS[stepIdx] * histConf;
  const weakFallbackWeight = 1 - clamp(liveWeight + historyWeight, 0, 1);
  const uncertaintyOverlay = uncertaintyForAnalogStep({
    stepIndex,
    meanTopKDistance: null,
    topKCount: priorStep?.count ?? 0,
    validDeltaCount: priorStep?.count ?? 0,
    weakFallbackWeight,
  });

  const liveDelta = clamp(library.recentLiveTrendUgPerHour * (minutesAhead / 60), -6, 6) * liveWeight;
  const globalHistoryDelta = (priorStep?.median ?? 0) * historyWeight;
  const useZones = (priorStep?.count ?? 0) >= MANY_SAMPLE_ZONE_THRESHOLD;

  const values: number[][] = [];
  const cap = MAX_GLOBAL_DELTA_BY_STEP[stepIdx] ?? 8;
  for (let yi = 0; yi < nowPm25.values.length; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < nowPm25.values[yi].length; xi += 1) {
      let histDelta = globalHistoryDelta;
      if (useZones && priorStep) {
        const blend = zoneBlendAtX(xi);
        const zone = blend.west * priorStep.zoneMedian.west +
          blend.central * priorStep.zoneMedian.central +
          blend.east * priorStep.zoneMedian.east;
        histDelta = (globalHistoryDelta * 0.55) + (zone * historyWeight * 0.45);
      }
      const totalDelta = clamp(liveDelta + histDelta, -cap, cap);
      row.push(Math.max(0, (nowPm25.values[yi][xi] ?? 0) + totalDelta));
    }
    values.push(row);
  }

  const hours = minutesAhead / 60;
  const { uMs, vMs } = meanWindForStep(wind, minutesAhead, nowPm25);

  if (debugMode === 'wind-shift-only') {
    const shiftedNow = smoothPm25Grid3x3(applyTinyWindShift(nowPm25.values, nowPm25, uMs, vMs, hours));
    return {
      stepIndex,
      minutesAhead,
      label: formatStepShortLabel(minutesAhead),
      grid: pm25Grid2DToRows({ ...nowPm25, values: shiftedNow }),
      opacityScale: 1,
      uncertaintyOverlay,
    };
  }

  let adjusted = values;
  if (debugMode === 'blend' && wind?.available) {
    adjusted = applyTinyWindShift(adjusted, nowPm25, uMs, vMs, hours);
  }

  adjusted = smoothPm25Grid3x3(adjusted);

  return {
    stepIndex,
    minutesAhead,
    label: formatStepShortLabel(minutesAhead),
    grid: pm25Grid2DToRows({ ...nowPm25, values: adjusted }),
    opacityScale: 1,
    uncertaintyOverlay,
  };
}

function emptyQuality(library: HistoricalAnalogLibrary): AnalogProjectionQuality {
  return buildAnalogProjectionQuality({
    library,
    matches: [],
    weakFallbackWeight: 1,
    perStepUncertainty: Array.from({ length: PROJECTION_FRAME_COUNT }, () => 0),
  });
}

/** Precompute all projection frames (Now … +5h) once per overlay open. */
export function generateAnalogProjectionFrames({
  nowGrid,
  wind,
  library,
  debugMode = 'blend',
  nowMs = Date.now(),
}: GenerateAnalogProjectionFramesInput): GenerateAnalogProjectionFramesResult {
  const nowPm25 = rowsToPm25Grid2D(nowGrid);
  const windOk = wind?.available === true && (wind.byTime.size ?? 0) > 0;

  if (!nowPm25) {
    const quality = emptyQuality(library);
    return { frames: [], analogCount: 0, windAvailable: windOk, quality };
  }

  const anchorHour = new Date(nowMs).getHours();
  const prior = buildClimatologyPrior(library.samples, anchorHour);
  const stepCtx: StepBuildContext = {
    nowPm25,
    nowGridRows: nowGrid,
    library,
    prior,
    wind,
    debugMode,
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
    matches: [],
    weakFallbackWeight: 1 - clamp(liveTrendConfidence(library), 0, 1),
    perStepUncertainty,
  });

  return {
    frames,
    analogCount: prior.totalCountByStep[0] ?? 0,
    windAvailable: windOk,
    quality,
  };
}
