import type { CurrentKrigingRow } from '../database.types';
import {
  fetchDistinctPipelineTimes,
  fetchSensorReadingsBetweenRecordedTimes,
} from '../fetchAirQuality';
import { minutesAheadForStep, PROJECTION_FUTURE_STEPS } from '../projectionTimeLabels';
import { recomputeKrigingFromSensors } from '../recomputeKriging';
import { HEATMAP_GRID_STEPS } from '../resolveHeatmapGrid';
import type { SensorPoint } from '../sensorTypes';
import type { ClarityRow, PurpleAirRow } from '../database.types';

import {
  pm25ValuesToFlat,
  rowsToPm25Grid2D,
  subtractFlat,
  type Pm25Grid2D,
} from './gridMath';
import { buildProjectionFeatureVector, type ProjectionFeatureVector } from './projectionFeatures';

export const HISTORICAL_DAYS = 7;
export const HISTORICAL_HOURS_BACK = HISTORICAL_DAYS * 24;
export const MIN_SAMPLE_GAP_MS = 9 * 60 * 1000;
export const FUTURE_MATCH_TOLERANCE_MS = 25 * 60 * 1000;
export const MAX_ANALOG_SAMPLES = 320;

export type HistoricalAnalogSample = {
  time: string;
  timeMs: number;
  features: ProjectionFeatureVector;
  pm25Flat: Float32Array;
  /** futureDeltaByStep[0] = +1h, … [4] = +5h */
  futureDeltaByStep: Float32Array[];
};

export type HistoricalAnalogLibrary = {
  samples: HistoricalAnalogSample[];
  builtAtMs: number;
  cacheKey: string;
  /** Per-step 95th percentile of mean |delta| for clamping. */
  deltaCapByStep: number[];
  /** Future grids matched per horizon (+1h … +5h) across all anchor attempts. */
  horizonFutureMatchCounts: number[];
  anchorCandidatesConsidered: number;
  /** Robust median recent slope from sensors (µg/m³ per hour, last 60–120 min). */
  recentLiveTrendUgPerHour: number;
  /** Number of sensors used in robust live-trend estimation. */
  recentLiveTrendSensorCount: number;
  /** Robust noise estimate (MAD of per-sensor slopes, µg/m³ per hour). */
  recentLiveTrendNoise: number;
};

const analogLibraryCache = new Map<string, HistoricalAnalogLibrary>();

export function analogLibraryCacheKey(nowMs: number): string {
  return `analog3-${Math.floor(nowMs / (10 * 60 * 1000))}`;
}

export function getCachedAnalogLibrary(cacheKey: string): HistoricalAnalogLibrary | undefined {
  return analogLibraryCache.get(cacheKey);
}

export function setCachedAnalogLibrary(cacheKey: string, library: HistoricalAnalogLibrary): void {
  analogLibraryCache.set(cacheKey, library);
  if (analogLibraryCache.size > 4) {
    const oldest = [...analogLibraryCache.entries()].sort((a, b) => a[1].builtAtMs - b[1].builtAtMs)[0];
    if (oldest) analogLibraryCache.delete(oldest[0]);
  }
}

function toSensorPoints(purple: PurpleAirRow[] | null, clarity: ClarityRow[] | null): SensorPoint[] {
  const out: SensorPoint[] = [];
  for (const r of purple ?? []) {
    if (r.pm25 == null || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      sensorIndex: r.sensor_index,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'purple_air',
      time: r.time,
    });
  }
  for (const r of clarity ?? []) {
    if (r.pm25 == null || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      sensorIndex: r.sensor_index,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'clarity',
      time: r.time,
    });
  }
  return out;
}

function groupSensorsByTime(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): Map<string, SensorPoint[]> {
  const grouped = new Map<string, SensorPoint[]>();
  const append = (rows: SensorPoint[]) => {
    for (const row of rows) {
      if (!row.time) continue;
      const existing = grouped.get(row.time);
      if (existing) existing.push(row);
      else grouped.set(row.time, [row]);
    }
  };
  append(toSensorPoints(purple, null));
  append(toSensorPoints(null, clarity));
  return grouped;
}

function subsampleTimes(timesAsc: string[], minGapMs: number, maxCount: number): string[] {
  const out: string[] = [];
  let lastMs = -Infinity;
  for (const iso of timesAsc) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    if (out.length > 0 && ms - lastMs < minGapMs) continue;
    out.push(iso);
    lastMs = ms;
    if (out.length >= maxCount) break;
  }
  return out;
}

function closestTimeKey(timesMsSorted: number[], timeKeys: string[], targetMs: number): string | null {
  if (timesMsSorted.length === 0) return null;
  let lo = 0;
  let hi = timesMsSorted.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (timesMsSorted[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  const candidates: number[] = [];
  if (lo > 0) candidates.push(lo - 1);
  candidates.push(lo);
  if (lo < timesMsSorted.length - 1) candidates.push(lo + 1);

  let best: string | null = null;
  let bestDiff = FUTURE_MATCH_TOLERANCE_MS + 1;
  for (const idx of candidates) {
    const diff = Math.abs(timesMsSorted[idx] - targetMs);
    if (diff <= FUTURE_MATCH_TOLERANCE_MS && diff < bestDiff) {
      bestDiff = diff;
      best = timeKeys[idx];
    }
  }
  return best;
}

function buildPm25GridFromSensors(sensors: SensorPoint[], time: string): Pm25Grid2D | null {
  if (sensors.length === 0) return null;
  const rows = recomputeKrigingFromSensors(sensors, time, {
    latSteps: HEATMAP_GRID_STEPS,
    lonSteps: HEATMAP_GRID_STEPS,
  });
  return rowsToPm25Grid2D(rows);
}

function computeDeltaCaps(samples: HistoricalAnalogSample[]): number[] {
  const caps: number[] = [];
  for (let step = 0; step < PROJECTION_FUTURE_STEPS; step += 1) {
    const means: number[] = [];
    for (const sample of samples) {
      const delta = sample.futureDeltaByStep[step];
      if (!delta) continue;
      let sum = 0;
      for (let i = 0; i < delta.length; i += 1) sum += Math.abs(delta[i]);
      means.push(sum / delta.length);
    }
    if (means.length === 0) {
      caps.push(25);
      continue;
    }
    means.sort((a, b) => a - b);
    const p95 = means[Math.floor(means.length * 0.95)] ?? means[means.length - 1];
    caps.push(Math.max(8, p95 * 1.35));
  }
  return caps;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  const absDev = values.map((v) => Math.abs(v - med));
  return median(absDev);
}

function robustSlopeUgPerHour(points: Array<{ timeMs: number; pm25: number }>): number | null {
  if (points.length < 3) return null;
  const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const slopes: number[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const dtHours = (sorted[j].timeMs - sorted[i].timeMs) / (60 * 60 * 1000);
      if (!(dtHours > 0)) continue;
      slopes.push((sorted[j].pm25 - sorted[i].pm25) / dtHours);
    }
  }
  if (slopes.length === 0) return null;
  return median(slopes);
}

function computeRecentLiveTrend(
  groupedByTime: Map<string, SensorPoint[]>,
  nowMs: number,
): {
  trendUgPerHour: number;
  sensorCount: number;
  noiseUgPerHour: number;
} {
  const windowStart = nowMs - 120 * 60 * 1000;
  const sensorSeries = new Map<string, Array<{ timeMs: number; pm25: number }>>();

  for (const [iso, sensors] of groupedByTime.entries()) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t) || t < windowStart || t > nowMs) continue;
    for (const s of sensors) {
      if (!Number.isFinite(s.pm25)) continue;
      const key = `${String(s.source)}:${String(s.sensorIndex)}`;
      const arr = sensorSeries.get(key) ?? [];
      arr.push({ timeMs: t, pm25: s.pm25 });
      sensorSeries.set(key, arr);
    }
  }

  const slopes: number[] = [];
  for (const pts of sensorSeries.values()) {
    const slope = robustSlopeUgPerHour(pts);
    if (slope == null) continue;
    slopes.push(slope);
  }
  if (slopes.length === 0) {
    return { trendUgPerHour: 0, sensorCount: 0, noiseUgPerHour: 0 };
  }
  const trend = Math.max(-6, Math.min(6, median(slopes)));
  return {
    trendUgPerHour: trend,
    sensorCount: slopes.length,
    noiseUgPerHour: medianAbsoluteDeviation(slopes),
  };
}

type AnchorPlan = {
  anchorTime: string;
  anchorMs: number;
  futureKeys: string[];
};

export type BuildHistoricalAnalogLibraryResult = {
  library: HistoricalAnalogLibrary;
  errorMessage: string | null;
  fromCache: boolean;
};

export type AnalogLibraryProgressCallback = (progress: number, message: string) => void;

/**
 * Builds 7-day historical analogs with precomputed PM₂.₅ feature vectors and future deltas.
 * `onProgress` reports 0..1 within the library build (fetch → grids → samples).
 */
export async function buildHistoricalAnalogLibrary(
  nowMs = Date.now(),
  onProgress?: AnalogLibraryProgressCallback,
): Promise<BuildHistoricalAnalogLibraryResult> {
  const report = (progress: number, message: string) => {
    onProgress?.(Math.max(0, Math.min(1, progress)), message);
  };

  const cacheKey = analogLibraryCacheKey(nowMs);
  const cached = getCachedAnalogLibrary(cacheKey);
  if (cached) {
    report(1, 'Using cached analog library…');
    return { library: cached, errorMessage: null, fromCache: true };
  }

  report(0.05, 'Loading recent sensor history…');

  const fromIso = new Date(nowMs - HISTORICAL_HOURS_BACK * 60 * 60 * 1000).toISOString();
  const toIso = new Date(nowMs + minutesAheadForStep(PROJECTION_FUTURE_STEPS)).toISOString();

  const [timesRes, sensorsRes] = await Promise.all([
    fetchDistinctPipelineTimes(HISTORICAL_HOURS_BACK),
    fetchSensorReadingsBetweenRecordedTimes(fromIso, toIso),
  ]);

  report(0.5, 'Loading recent sensor history…');

  if (timesRes.error) {
    return {
      library: emptyLibrary(cacheKey, nowMs),
      errorMessage: timesRes.error.message,
      fromCache: false,
    };
  }

  const grouped = groupSensorsByTime(sensorsRes.purpleAir, sensorsRes.clarity);
  const recentLiveTrend = computeRecentLiveTrend(grouped, nowMs);
  const allTimes = [...new Set([...timesRes.times, ...grouped.keys()])].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );

  const sensorTimesAsc = allTimes.filter((t) => (grouped.get(t)?.length ?? 0) > 0);
  const timeKeys: string[] = [];
  const timesMsSorted: number[] = [];
  for (const t of sensorTimesAsc) {
    timeKeys.push(t);
    timesMsSorted.push(new Date(t).getTime());
  }

  const anchorTimes = subsampleTimes(
    allTimes.filter((t) => {
      const ms = new Date(t).getTime();
      return Number.isFinite(ms) && ms <= nowMs - MIN_SAMPLE_GAP_MS;
    }),
    MIN_SAMPLE_GAP_MS,
    MAX_ANALOG_SAMPLES,
  );

  report(0.55, 'Building analog library…');

  const neededTimes = new Set<string>();
  const anchorPlans: AnchorPlan[] = [];
  const horizonFutureMatchCounts = Array.from({ length: PROJECTION_FUTURE_STEPS }, () => 0);
  let anchorCandidatesConsidered = 0;

  for (const anchorTime of anchorTimes) {
    const anchorMs = new Date(anchorTime).getTime();
    if (!(grouped.get(anchorTime)?.length ?? 0)) continue;
    anchorCandidatesConsidered += 1;

    const futureKeys: string[] = [];
    let complete = true;
    for (let step = 1; step <= PROJECTION_FUTURE_STEPS; step += 1) {
      const targetMs = anchorMs + minutesAheadForStep(step) * 60 * 1000;
      const futureKey = closestTimeKey(timesMsSorted, timeKeys, targetMs);
      if (!futureKey) {
        complete = false;
        break;
      }
      futureKeys.push(futureKey);
    }
    if (!complete || futureKeys.length !== PROJECTION_FUTURE_STEPS) continue;

    for (let step = 0; step < PROJECTION_FUTURE_STEPS; step += 1) {
      horizonFutureMatchCounts[step] += 1;
    }
    neededTimes.add(anchorTime);
    for (const fk of futureKeys) neededTimes.add(fk);
    anchorPlans.push({ anchorTime, anchorMs, futureKeys });
  }

  const neededList = [...neededTimes];
  const gridByTime = new Map<string, Pm25Grid2D>();

  for (let ti = 0; ti < neededList.length; ti += 1) {
    const t = neededList[ti];
    const sensors = grouped.get(t);
    if (!sensors || sensors.length === 0) continue;
    const grid = buildPm25GridFromSensors(sensors, t);
    if (!grid) continue;
    gridByTime.set(t, grid);
    if (ti % 3 === 0 || ti === neededList.length - 1) {
      const frac = neededList.length > 0 ? (ti + 1) / neededList.length : 1;
      report(0.55 + frac * 0.4, 'Building analog library…');
    }
  }

  const samples: HistoricalAnalogSample[] = [];

  for (let ai = 0; ai < anchorPlans.length; ai += 1) {
    const { anchorTime, anchorMs, futureKeys } = anchorPlans[ai];
    const anchorGrid = gridByTime.get(anchorTime);
    if (!anchorGrid) continue;
    const anchorFlat = pm25ValuesToFlat(anchorGrid.values);

    const futureDeltaByStep: Float32Array[] = [];
    for (const futureKey of futureKeys) {
      const futureGrid = gridByTime.get(futureKey);
      if (!futureGrid) {
        futureDeltaByStep.length = 0;
        break;
      }
      futureDeltaByStep.push(subtractFlat(pm25ValuesToFlat(futureGrid.values), anchorFlat));
    }
    if (futureDeltaByStep.length !== PROJECTION_FUTURE_STEPS) continue;

    samples.push({
      time: anchorTime,
      timeMs: anchorMs,
      features: buildProjectionFeatureVector(anchorGrid, anchorMs),
      pm25Flat: anchorFlat,
      futureDeltaByStep,
    });
  }

  report(0.98, 'Building analog library…');

  const library: HistoricalAnalogLibrary = {
    samples,
    builtAtMs: nowMs,
    cacheKey,
    deltaCapByStep: computeDeltaCaps(samples),
    horizonFutureMatchCounts,
    anchorCandidatesConsidered,
    recentLiveTrendUgPerHour: recentLiveTrend.trendUgPerHour,
    recentLiveTrendSensorCount: recentLiveTrend.sensorCount,
    recentLiveTrendNoise: recentLiveTrend.noiseUgPerHour,
  };
  setCachedAnalogLibrary(cacheKey, library);

  return {
    library,
    errorMessage: sensorsRes.error?.message ?? null,
    fromCache: false,
  };
}

function emptyLibrary(cacheKey: string, nowMs: number): HistoricalAnalogLibrary {
  return {
    samples: [],
    builtAtMs: nowMs,
    cacheKey,
    deltaCapByStep: [25, 25, 25, 25, 25],
    horizonFutureMatchCounts: Array.from({ length: PROJECTION_FUTURE_STEPS }, () => 0),
    anchorCandidatesConsidered: 0,
    recentLiveTrendUgPerHour: 0,
    recentLiveTrendSensorCount: 0,
    recentLiveTrendNoise: 0,
  };
}
