import { minutesAheadForStep, PROJECTION_FUTURE_STEPS } from '../projectionTimeLabels';
import type { HistoricalAnalogLibrary, HistoricalAnalogSample } from './buildHistoricalAnalogLibrary';
import { PM25_CELL_COUNT } from './gridMath';

/** Minimum library size before leaning on persistence / recent trend. */
export const MIN_USABLE_ANALOG_LIBRARY = 30;

/** Mean top-K feature distance at/above which analog match is considered weak. */
export const MEAN_TOPK_DISTANCE_WEAK = 120;
export const MEAN_TOPK_DISTANCE_HIGH = 280;

const RECENT_TREND_HOURS = 48;
const RECENT_TREND_MAX_SAMPLES = 24;
const MAX_WEAK_FALLBACK_WEIGHT = 0.85;
const MAX_UNCERTAINTY = 0.55;

export type AnalogMatchLike = {
  sample: HistoricalAnalogSample;
  distance: number;
  weight: number;
};

export type AnalogProjectionQuality = {
  librarySampleCount: number;
  topKCount: number;
  meanTopKDistance: number | null;
  bestTopKDistance: number | null;
  topAnalogTimestamps: string[];
  weakFallbackWeight: number;
  usedWeakFallback: boolean;
  /** Top-K analogs with a delta for each future step (+1h … +5h). */
  horizonTopKValidCounts: number[];
  /** Library-wide future matches found while building (+1h … +5h). */
  horizonLibraryValidCounts: number[];
  perStepUncertainty: number[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function meanTopKDistance(matches: AnalogMatchLike[]): number | null {
  if (matches.length === 0) return null;
  let sum = 0;
  for (const m of matches) sum += m.distance;
  return sum / matches.length;
}

export function computeWeakFallbackWeight(
  librarySampleCount: number,
  meanDistance: number | null,
): number {
  let w = 0;
  if (librarySampleCount < MIN_USABLE_ANALOG_LIBRARY) {
    w = Math.max(w, (MIN_USABLE_ANALOG_LIBRARY - librarySampleCount) / MIN_USABLE_ANALOG_LIBRARY);
  }
  if (meanDistance != null && meanDistance > MEAN_TOPK_DISTANCE_WEAK) {
    const span = MEAN_TOPK_DISTANCE_HIGH - MEAN_TOPK_DISTANCE_WEAK;
    w = Math.max(
      w,
      clamp((meanDistance - MEAN_TOPK_DISTANCE_WEAK) / span, 0, 1),
    );
  }
  return clamp(w, 0, MAX_WEAK_FALLBACK_WEIGHT);
}

/** Equal-weight mean of recent library deltas for one horizon (smoothed recent trend). */
export function computeRecentTrendDelta(
  library: HistoricalAnalogLibrary,
  deltaStepIdx: number,
  nowMs: number,
): Float32Array {
  const cutoff = nowMs - RECENT_TREND_HOURS * 60 * 60 * 1000;
  const recent = library.samples
    .filter((s) => s.timeMs >= cutoff && s.timeMs < nowMs)
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, RECENT_TREND_MAX_SAMPLES);

  const out = new Float32Array(PM25_CELL_COUNT);
  if (recent.length === 0) return out;

  for (const sample of recent) {
    const delta = sample.futureDeltaByStep[deltaStepIdx];
    if (!delta) continue;
    for (let i = 0; i < PM25_CELL_COUNT; i += 1) out[i] += delta[i];
  }
  for (let i = 0; i < PM25_CELL_COUNT; i += 1) out[i] /= recent.length;
  return out;
}

export function countTopKWithDelta(matches: AnalogMatchLike[], deltaStepIdx: number): number {
  let n = 0;
  for (const m of matches) {
    if (m.sample.futureDeltaByStep[deltaStepIdx]) n += 1;
  }
  return n;
}

export function uncertaintyForAnalogStep(params: {
  stepIndex: number;
  meanTopKDistance: number | null;
  topKCount: number;
  validDeltaCount: number;
  weakFallbackWeight: number;
}): number {
  if (params.stepIndex <= 0) return 0;

  const horizon =
    (params.stepIndex / PROJECTION_FUTURE_STEPS) * 0.22;

  let distanceTerm = 0;
  if (params.meanTopKDistance != null) {
    distanceTerm =
      clamp(
        (params.meanTopKDistance - MEAN_TOPK_DISTANCE_WEAK) /
          (MEAN_TOPK_DISTANCE_HIGH - MEAN_TOPK_DISTANCE_WEAK),
        0,
        1,
      ) * 0.28;
  }

  const validFraction =
    params.topKCount > 0 ? params.validDeltaCount / params.topKCount : 0;
  const sparseTerm = (1 - validFraction) * 0.25;
  const weakTerm = params.weakFallbackWeight * 0.15;

  return clamp(horizon + distanceTerm + sparseTerm + weakTerm, 0, MAX_UNCERTAINTY);
}

export function buildAnalogProjectionQuality(params: {
  library: HistoricalAnalogLibrary;
  matches: AnalogMatchLike[];
  weakFallbackWeight: number;
  perStepUncertainty: number[];
}): AnalogProjectionQuality {
  const meanDist = meanTopKDistance(params.matches);
  const usedWeakFallback = params.weakFallbackWeight > 0.12;

  const horizonTopKValidCounts: number[] = [];
  for (let step = 0; step < PROJECTION_FUTURE_STEPS; step += 1) {
    horizonTopKValidCounts.push(countTopKWithDelta(params.matches, step));
  }

  return {
    librarySampleCount: params.library.samples.length,
    topKCount: params.matches.length,
    meanTopKDistance: meanDist,
    bestTopKDistance: params.matches[0]?.distance ?? null,
    topAnalogTimestamps: params.matches.map((m) => m.sample.time),
    weakFallbackWeight: params.weakFallbackWeight,
    usedWeakFallback,
    horizonTopKValidCounts,
    horizonLibraryValidCounts: params.library.horizonFutureMatchCounts,
    perStepUncertainty: params.perStepUncertainty,
  };
}

export function formatAnalogTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function horizonLabelForStepIndex(stepIndex: number): string {
  if (stepIndex <= 0) return 'Now';
  const hours = Math.round(minutesAheadForStep(stepIndex) / 60);
  return `+${hours}h`;
}
