/**
 * Analog projection quality metrics: top-K match distances, per-step uncertainty,
 * and UI helpers for horizon labels and timestamps.
 */

import { minutesAheadForStep, PROJECTION_FUTURE_STEPS } from '../modelProjectionContent';
import type { HistoricalAnalogLibrary, HistoricalAnalogSample } from './buildHistoricalAnalogLibrary';

/** Minimum library size before leaning on persistence / recent trend. */
export const MIN_USABLE_ANALOG_LIBRARY = 30;

/** Mean top-K feature distance at/above which analog match is considered weak. */
export const MEAN_TOPK_DISTANCE_WEAK = 120;
/** Mean top-K distance at which distance-based uncertainty saturates. */
export const MEAN_TOPK_DISTANCE_HIGH = 280;

/** Upper cap on per-frame uncertainty overlay opacity. */
const MAX_UNCERTAINTY = 0.55;

/** One ranked historical analog used in weighted blending (when enabled). */
export type AnalogMatchLike = {
  sample: HistoricalAnalogSample;
  /** Feature-space distance to the current “now” grid. */
  distance: number;
  /** Normalized blend weight (sums to 1 across top-K). */
  weight: number;
};

/** Compact match row for debug / quality panels. */
export type TopAnalogMatchSummary = {
  time: string;
  distance: number;
  weight: number;
};

/** Aggregate quality signals passed to the projection overlay UI. */
export type AnalogProjectionQuality = {
  librarySampleCount: number;
  topKCount: number;
  meanTopKDistance: number | null;
  bestTopKDistance: number | null;
  topAnalogTimestamps: string[];
  topAnalogMatches: TopAnalogMatchSummary[];
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

/** Arithmetic mean of match distances; null when the match list is empty. */
export function meanTopKDistance(matches: AnalogMatchLike[]): number | null {
  if (matches.length === 0) return null;
  let sum = 0;
  for (const m of matches) sum += m.distance;
  return sum / matches.length;
}

/** How many top-K analogs have a precomputed delta at horizon index `deltaStepIdx`. */
export function countTopKWithDelta(matches: AnalogMatchLike[], deltaStepIdx: number): number {
  let n = 0;
  for (const m of matches) {
    if (m.sample.futureDeltaByStep[deltaStepIdx]) n += 1;
  }
  return n;
}

/**
 * Per-step uncertainty in [0, MAX_UNCERTAINTY]: grows with horizon, weak analogs,
 * sparse deltas, and reliance on live-trend / persistence fallback.
 */
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

/** Assemble `AnalogProjectionQuality` from library state, matches, and per-step overlays. */
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
    topAnalogMatches: params.matches.map((m) => ({
      time: m.sample.time,
      distance: m.distance,
      weight: m.weight,
    })),
    weakFallbackWeight: params.weakFallbackWeight,
    usedWeakFallback,
    horizonTopKValidCounts,
    horizonLibraryValidCounts: params.library.horizonFutureMatchCounts,
    perStepUncertainty: params.perStepUncertainty,
  };
}

/** Locale-aware short date/time for analog match labels. */
export function formatAnalogTimestamp(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Slider label: `Now` or `+{hours}h` from projection step index. */
export function horizonLabelForStepIndex(stepIndex: number): string {
  if (stepIndex <= 0) return 'Now';
  const hours = Math.round(minutesAheadForStep(stepIndex) / 60);
  return `+${hours}h`;
}
