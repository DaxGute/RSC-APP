import type { CurrentKrigingRow } from '../database.types';
import {
  fetchDistinctPipelineTimes,
  fetchSensorReadingsBetweenRecordedTimes,
} from '../fetchAirQuality';
import { fetchForecastWindGridRange, pickForecastTimeUtc } from '../forecastWindGrid';
import { minutesAheadForStep, PROJECTION_FUTURE_STEPS } from '../projectionTimeLabels';
import { recomputeKrigingFromSensors } from '../recomputeKriging';
import { HEATMAP_GRID_STEPS } from '../resolveHeatmapGrid';
import type { SensorPoint } from '../sensorTypes';
import type { ClarityRow, PurpleAirRow } from '../database.types';

import {
  createEmptyPm25Grid,
  pm25ValuesToFlat,
  rowsToPm25Grid2D,
  subtractFlat,
  windSliceToFlatArrays,
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
  windU: Float32Array | null;
  windV: Float32Array | null;
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
};

const analogLibraryCache = new Map<string, HistoricalAnalogLibrary>();

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

function windAtTimeMs(
  windByTime: Map<string, import('../forecastWindGrid').WindGridPoint[]>,
  timeMs: number,
): { u: Float32Array; v: Float32Array } | null {
  const keys = [...windByTime.keys()];
  if (keys.length === 0) return null;
  const iso = pickForecastTimeUtc(keys, timeMs);
  if (!iso) return null;
  return windSliceToFlatArrays(windByTime.get(iso));
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

export type BuildHistoricalAnalogLibraryResult = {
  library: HistoricalAnalogLibrary;
  errorMessage: string | null;
};

export type AnalogLibraryProgressCallback = (progress: number, message: string) => void;

/**
 * Builds 7-day historical analogs with precomputed feature vectors and future PM₂.₅ deltas.
 * `onProgress` reports 0..1 within the library build (fetch → grids → analog matching).
 */
export async function buildHistoricalAnalogLibrary(
  nowMs = Date.now(),
  onProgress?: AnalogLibraryProgressCallback,
): Promise<BuildHistoricalAnalogLibraryResult> {
  const report = (progress: number, message: string) => {
    onProgress?.(Math.max(0, Math.min(1, progress)), message);
  };

  const cacheKey = `analog2-${Math.floor(nowMs / (10 * 60 * 1000))}`;
  const cached = getCachedAnalogLibrary(cacheKey);
  if (cached) {
    report(1, 'Loaded cached history');
    return { library: cached, errorMessage: null };
  }

  report(0.04, 'Loading sensor history…');

  const fromIso = new Date(nowMs - HISTORICAL_HOURS_BACK * 60 * 60 * 1000).toISOString();
  const toIso = new Date(nowMs + minutesAheadForStep(PROJECTION_FUTURE_STEPS)).toISOString();

  const fetchStarted = Date.now();
  const fetchHeartbeat = setInterval(() => {
    const elapsed = Date.now() - fetchStarted;
    const p = 0.04 + Math.min(0.2, (elapsed / 14_000) * 0.2);
    report(p, 'Loading sensor history…');
  }, 180);

  let timesRes: Awaited<ReturnType<typeof fetchDistinctPipelineTimes>>;
  let sensorsRes: Awaited<ReturnType<typeof fetchSensorReadingsBetweenRecordedTimes>>;
  let windRes: Awaited<ReturnType<typeof fetchForecastWindGridRange>>;
  try {
    [timesRes, sensorsRes, windRes] = await Promise.all([
      fetchDistinctPipelineTimes(HISTORICAL_HOURS_BACK),
      fetchSensorReadingsBetweenRecordedTimes(fromIso, toIso),
      fetchForecastWindGridRange(fromIso, toIso),
    ]);
  } finally {
    clearInterval(fetchHeartbeat);
  }

  report(0.26, 'Processing snapshots…');

  if (timesRes.error) {
    return {
      library: emptyLibrary(cacheKey, nowMs),
      errorMessage: timesRes.error.message,
    };
  }

  const grouped = groupSensorsByTime(sensorsRes.purpleAir, sensorsRes.clarity);
  const allTimes = [...new Set([...timesRes.times, ...grouped.keys()])].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  );
  const anchorTimes = subsampleTimes(
    allTimes.filter((t) => {
      const ms = new Date(t).getTime();
      return Number.isFinite(ms) && ms <= nowMs - MIN_SAMPLE_GAP_MS;
    }),
    MIN_SAMPLE_GAP_MS,
    MAX_ANALOG_SAMPLES,
  );

  const timeKeys: string[] = [];
  const timesMsSorted: number[] = [];
  const gridByTime = new Map<string, Float32Array>();

  const gridTimes = allTimes.filter((t) => (grouped.get(t)?.length ?? 0) > 0);
  for (let ti = 0; ti < gridTimes.length; ti += 1) {
    const t = gridTimes[ti];
    const sensors = grouped.get(t);
    if (!sensors || sensors.length === 0) continue;
    const grid = buildPm25GridFromSensors(sensors, t);
    if (!grid) continue;
    const flat = pm25ValuesToFlat(grid.values);
    timeKeys.push(t);
    timesMsSorted.push(new Date(t).getTime());
    gridByTime.set(t, flat);
    if (ti % 2 === 0 || ti === gridTimes.length - 1) {
      const frac = gridTimes.length > 0 ? (ti + 1) / gridTimes.length : 1;
      report(0.26 + frac * 0.36, 'Building PM₂.₅ grids…');
    }
  }

  const windByTime = windRes.available ? windRes.byTime : new Map();

  const samples: HistoricalAnalogSample[] = [];
  const horizonFutureMatchCounts = Array.from({ length: PROJECTION_FUTURE_STEPS }, () => 0);
  let anchorCandidatesConsidered = 0;
  report(0.64, 'Matching historical analogs…');

  for (let ai = 0; ai < anchorTimes.length; ai += 1) {
    const anchorTime = anchorTimes[ai];
    const anchorMs = new Date(anchorTime).getTime();
    const anchorFlat = gridByTime.get(anchorTime);
    if (!anchorFlat) continue;
    anchorCandidatesConsidered += 1;

    const futureDeltaByStep: Float32Array[] = [];
    let complete = true;
    for (let step = 1; step <= PROJECTION_FUTURE_STEPS; step += 1) {
      const targetMs = anchorMs + minutesAheadForStep(step) * 60 * 1000;
      const futureKey = closestTimeKey(timesMsSorted, timeKeys, targetMs);
      const futureFlat = futureKey ? gridByTime.get(futureKey) : null;
      if (!futureFlat) {
        complete = false;
        break;
      }
      horizonFutureMatchCounts[step - 1] += 1;
      futureDeltaByStep.push(subtractFlat(futureFlat, anchorFlat));
    }
    if (!complete || futureDeltaByStep.length !== PROJECTION_FUTURE_STEPS) continue;

    const sensors = grouped.get(anchorTime)!;
    const pm25Grid = buildPm25GridFromSensors(sensors, anchorTime) ?? createEmptyPm25Grid(anchorTime);
    const wind = windAtTimeMs(windByTime, anchorMs);

    samples.push({
      time: anchorTime,
      timeMs: anchorMs,
      features: buildProjectionFeatureVector(pm25Grid, wind?.u ?? null, wind?.v ?? null, anchorMs),
      pm25Flat: anchorFlat,
      windU: wind?.u ?? null,
      windV: wind?.v ?? null,
      futureDeltaByStep,
    });
    if (ai % 2 === 0 || ai === anchorTimes.length - 1) {
      const frac = anchorTimes.length > 0 ? (ai + 1) / anchorTimes.length : 1;
      report(0.64 + frac * 0.32, 'Matching historical analogs…');
    }
  }

  report(0.98, 'Finalizing library…');

  const library: HistoricalAnalogLibrary = {
    samples,
    builtAtMs: nowMs,
    cacheKey,
    deltaCapByStep: computeDeltaCaps(samples),
    horizonFutureMatchCounts,
    anchorCandidatesConsidered,
  };
  setCachedAnalogLibrary(cacheKey, library);

  return {
    library,
    errorMessage: sensorsRes.error?.message ?? windRes.errorMessage ?? null,
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
  };
}
