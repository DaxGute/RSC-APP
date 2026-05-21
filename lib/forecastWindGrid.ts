import { SSF_BBOX } from './constants/ssf';
import {
  PROJECTION_FUTURE_STEPS,
  PROJECTION_STEP_MINUTES,
} from './projectionTimeLabels';
import { supabase } from './supabase';

export type WindGridPoint = {
  forecastTimeUtc: string;
  lat: number;
  lon: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  uMs: number;
  vMs: number;
};

export type ForecastWindGridByTime = {
  byTime: Map<string, WindGridPoint[]>;
  /** Nearest forecast valid time to now (for map arrows). */
  displayTimeUtc: string | null;
  /** Points at `displayTimeUtc`, downsampled for rendering. */
  displayPoints: WindGridPoint[];
  fetchedAt: string | null;
  available: boolean;
  errorMessage?: string;
};

type WindGridRow = {
  forecast_time_utc: string;
  lat: number;
  lon: number;
  wind_speed_mps: number;
  wind_direction_deg: number;
  u_ms?: number;
  v_ms?: number;
  fetched_at: string;
};

/** Open-Meteo wind cache grid (matches pipeline `forecast_wind_grid`). */
export const FORECAST_WIND_GRID_STEPS = 20;
export const EXPECTED_WIND_GRID_CELLS =
  FORECAST_WIND_GRID_STEPS * FORECAST_WIND_GRID_STEPS;

/** PostgREST default page size (see `fetchAirQuality.ts`). */
const POSTGREST_MAX_ROWS_PER_REQUEST = 1000;
const WIND_GRID_PAGE_SIZE = POSTGREST_MAX_ROWS_PER_REQUEST;
const WIND_GRID_FETCH_HARD_MAX = 50_000;

const LOOKBACK_MS = 30 * 60 * 1000;
/** Cover full projection slider (+5h) with margin for nearest-time lookup. */
const LOOKAHEAD_MS =
  PROJECTION_FUTURE_STEPS * PROJECTION_STEP_MINUTES * 60 * 1000 + 30 * 60 * 1000;

/** 1 = full 20×20 arrows on the map. */
export const WIND_ARROW_STRIDE = 1;

const WIND_GRID_COLUMNS =
  'forecast_time_utc, lat, lon, wind_speed_mps, wind_direction_deg, fetched_at';

/** Direction air moves toward (degrees, 0 = north), for map symbol rotation. */
export function windAdvectionAngleDeg(uMs: number, vMs: number): number {
  return (Math.atan2(uMs, vMs) * 180) / Math.PI;
}

/** Open-Meteo: wind_direction_deg is meteorological (direction wind blows FROM). */
export function windComponentsFromMeteorologicalDeg(
  windSpeedMps: number,
  windDirectionFromDeg: number,
): { uMs: number; vMs: number } {
  const rad = (windDirectionFromDeg * Math.PI) / 180;
  return {
    uMs: -windSpeedMps * Math.sin(rad),
    vMs: -windSpeedMps * Math.cos(rad),
  };
}

function rowToPoint(row: WindGridRow): WindGridPoint | null {
  const windSpeedMps = row.wind_speed_mps;
  const windDirectionDeg = row.wind_direction_deg;
  if (
    !Number.isFinite(row.lat) ||
    !Number.isFinite(row.lon) ||
    !Number.isFinite(windSpeedMps) ||
    !Number.isFinite(windDirectionDeg)
  ) {
    return null;
  }

  const hasStoredComponents =
    Number.isFinite(row.u_ms) && Number.isFinite(row.v_ms);
  const { uMs, vMs } = hasStoredComponents
    ? { uMs: row.u_ms as number, vMs: row.v_ms as number }
    : windComponentsFromMeteorologicalDeg(windSpeedMps, windDirectionDeg);
  return {
    forecastTimeUtc: row.forecast_time_utc,
    lat: row.lat,
    lon: row.lon,
    windSpeedMps,
    windDirectionDeg: row.wind_direction_deg,
    uMs,
    vMs,
  };
}

/** Align DB stamps to projection steps so near-duplicate ISO strings share one bucket. */
export function normalizeForecastTimeUtc(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const stepMs = PROJECTION_STEP_MINUTES * 60 * 1000;
  return new Date(Math.round(ms / stepMs) * stepMs).toISOString();
}

export function groupWindGridByTime(rows: WindGridPoint[]): Map<string, WindGridPoint[]> {
  const byTime = new Map<string, WindGridPoint[]>();
  for (const row of rows) {
    const key = normalizeForecastTimeUtc(row.forecastTimeUtc);
    const list = byTime.get(key) ?? [];
    list.push({ ...row, forecastTimeUtc: key });
    byTime.set(key, list);
  }
  return byTime;
}

/** Pick forecast_time_utc closest to `targetMs`. */
export function pickForecastTimeUtc(times: string[], targetMs: number): string | null {
  let best: string | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const iso of times) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = iso;
    }
  }
  return best;
}

export function downsampleWindGridPoints(
  points: WindGridPoint[],
  stride = WIND_ARROW_STRIDE,
): WindGridPoint[] {
  if (stride <= 1 || points.length === 0) return points;
  const lats = [...new Set(points.map((p) => p.lat))].sort((a, b) => a - b);
  const lons = [...new Set(points.map((p) => p.lon))].sort((a, b) => a - b);
  const latKeep = new Set(lats.filter((_, i) => i % stride === 0));
  const lonKeep = new Set(lons.filter((_, i) => i % stride === 0));
  return points.filter((p) => latKeep.has(p.lat) && lonKeep.has(p.lon));
}

function positiveSpacings(sorted: number[]): number[] {
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 1e-7) diffs.push(d);
  }
  return diffs;
}

function latticeStepFromAxis(sorted: number[]): number {
  const diffs = positiveSpacings(sorted);
  if (diffs.length === 0) return 0;
  const min = Math.min(...diffs);
  const max = Math.max(...diffs);
  if (max > min * 1.6) return max;
  if (sorted.length > FORECAST_WIND_GRID_STEPS + 2) {
    return (min * (sorted.length - 1)) / (FORECAST_WIND_GRID_STEPS - 1);
  }
  return min;
}

/**
 * One arrow per 20×20 pipeline cell. Collapses finer lattices and near-duplicate
 * lat/lon rows onto the SSF wind grid spacing.
 */
export function collapseWindGridForMap(points: WindGridPoint[]): WindGridPoint[] {
  if (points.length === 0) return points;

  const lats = [...new Set(points.map((p) => p.lat))].sort((a, b) => a - b);
  const lons = [...new Set(points.map((p) => p.lon))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return points;

  let latStep = latticeStepFromAxis(lats);
  let lonStep = latticeStepFromAxis(lons);
  const bboxLatStep =
    (SSF_BBOX.nwLat - SSF_BBOX.seLat) / Math.max(1, FORECAST_WIND_GRID_STEPS - 1);
  const bboxLonStep =
    (SSF_BBOX.seLon - SSF_BBOX.nwLon) / Math.max(1, FORECAST_WIND_GRID_STEPS - 1);
  if (!(latStep > 0)) latStep = bboxLatStep;
  if (!(lonStep > 0)) lonStep = bboxLonStep;

  const latMin = lats[0];
  const lonMin = lons[0];
  const byCell = new Map<string, WindGridPoint>();

  for (const p of points) {
    const li = Math.round((p.lat - latMin) / latStep);
    const lj = Math.round((p.lon - lonMin) / lonStep);
    const key = `${li}:${lj}`;
    const snapped: WindGridPoint = {
      ...p,
      lat: latMin + li * latStep,
      lon: lonMin + lj * lonStep,
    };
    if (!byCell.has(key)) byCell.set(key, snapped);
  }

  return [...byCell.values()].sort((a, b) => a.lat - b.lat || a.lon - b.lon);
}

function buildSpatialGrid(points: WindGridPoint[]): {
  latAsc: number[];
  lonAsc: number[];
  u: number[][];
  v: number[][];
} | null {
  if (points.length < 4) return null;
  const byLat = new Map<number, Map<number, { u: number; v: number }>>();
  for (const p of points) {
    let lonMap = byLat.get(p.lat);
    if (!lonMap) {
      lonMap = new Map();
      byLat.set(p.lat, lonMap);
    }
    lonMap.set(p.lon, { u: p.uMs, v: p.vMs });
  }
  const latAsc = [...byLat.keys()].sort((a, b) => a - b);
  const lonAsc = [...(byLat.get(latAsc[0])?.keys() ?? [])].sort((a, b) => a - b);
  if (latAsc.length < 2 || lonAsc.length < 2) return null;

  const u: number[][] = [];
  const v: number[][] = [];
  for (const lat of latAsc) {
    const uRow: number[] = [];
    const vRow: number[] = [];
    const lonMap = byLat.get(lat)!;
    for (const lon of lonAsc) {
      const cell = lonMap.get(lon);
      uRow.push(cell?.u ?? 0);
      vRow.push(cell?.v ?? 0);
    }
    u.push(uRow);
    v.push(vRow);
  }
  return { latAsc, lonAsc, u, v };
}

function sampleBilinear(
  latAsc: number[],
  lonAsc: number[],
  values: number[][],
  lat: number,
  lon: number,
): number {
  const m = latAsc.length;
  const n = lonAsc.length;
  if (m < 2 || n < 2) return values[0]?.[0] ?? 0;
  const latMin = latAsc[0];
  const latMax = latAsc[m - 1];
  const lonMin = lonAsc[0];
  const lonMax = lonAsc[n - 1];
  if (!(latMax > latMin) || !(lonMax > lonMin)) return values[0]?.[0] ?? 0;

  const latT = Math.max(0, Math.min(1, (lat - latMin) / (latMax - latMin)));
  const lonT = Math.max(0, Math.min(1, (lon - lonMin) / (lonMax - lonMin)));
  const y = latT * (m - 1);
  const x = lonT * (n - 1);
  const y0 = Math.floor(y);
  const x0 = Math.floor(x);
  const y1 = Math.min(y0 + 1, m - 1);
  const x1 = Math.min(x0 + 1, n - 1);
  const fy = y - y0;
  const fx = x - x0;

  const v00 = values[y0]?.[x0] ?? 0;
  const v01 = values[y0]?.[x1] ?? 0;
  const v10 = values[y1]?.[x0] ?? 0;
  const v11 = values[y1]?.[x1] ?? 0;
  const top = v00 * (1 - fx) + v01 * fx;
  const bottom = v10 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Bilinear u/v at lat/lon from one forecast-time slice. */
export function windVectorAtLatLon(
  points: WindGridPoint[] | null | undefined,
  lat: number,
  lon: number,
): { uMs: number; vMs: number; windSpeedMps: number } | null {
  if (!points || points.length === 0) return null;
  const grid = buildSpatialGrid(points);
  if (!grid) {
    let best: WindGridPoint | null = null;
    let bestDist2 = Number.POSITIVE_INFINITY;
    for (const p of points) {
      const dLat = lat - p.lat;
      const dLon = lon - p.lon;
      const d2 = dLat * dLat + dLon * dLon;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        best = p;
      }
    }
    if (!best) return null;
    return { uMs: best.uMs, vMs: best.vMs, windSpeedMps: best.windSpeedMps };
  }

  const uMs = sampleBilinear(grid.latAsc, grid.lonAsc, grid.u, lat, lon);
  const vMs = sampleBilinear(grid.latAsc, grid.lonAsc, grid.v, lat, lon);
  const windSpeedMps = Math.hypot(uMs, vMs);
  return { uMs, vMs, windSpeedMps };
}

export function windGridSliceAtMinutes(
  byTime: Map<string, WindGridPoint[]>,
  minutesFromNow: number,
  nowMs = Date.now(),
): WindGridPoint[] | null {
  const times = [...byTime.keys()];
  if (times.length === 0) return null;
  const targetMs = nowMs + minutesFromNow * 60 * 1000;
  const stepMs = PROJECTION_STEP_MINUTES * 60 * 1000;
  const snappedTargetMs = Math.round(targetMs / stepMs) * stepMs;
  const toleranceMs = stepMs / 2;

  let iso: string | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of times) {
    const ms = new Date(candidate).getTime();
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - snappedTargetMs);
    if (diff <= toleranceMs) {
      return collapseWindGridForMap(byTime.get(candidate) ?? []);
    }
    if (diff < bestDiff) {
      bestDiff = diff;
      iso = candidate;
    }
  }

  if (!iso) return null;
  return collapseWindGridForMap(byTime.get(iso) ?? []);
}

async function fetchForecastWindGridRowsPaginated(
  fromIso: string,
  toIso: string,
): Promise<{ rows: WindGridRow[]; errorMessage: string | null }> {
  const rows: WindGridRow[] = [];
  let offset = 0;

  while (rows.length < WIND_GRID_FETCH_HARD_MAX) {
    const end = offset + WIND_GRID_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('forecast_wind_grid')
      .select(WIND_GRID_COLUMNS)
      .gte('forecast_time_utc', fromIso)
      .lte('forecast_time_utc', toIso)
      .order('forecast_time_utc', { ascending: true })
      .order('lat', { ascending: true })
      .order('lon', { ascending: true })
      .range(offset, end);

    if (error) {
      return { rows: [], errorMessage: error.message };
    }

    const batch = (data ?? []) as WindGridRow[];
    if (batch.length === 0) break;
    for (const row of batch) {
      rows.push(row);
      if (rows.length >= WIND_GRID_FETCH_HARD_MAX) break;
    }
    if (rows.length >= WIND_GRID_FETCH_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < WIND_GRID_PAGE_SIZE) break;
  }

  return { rows, errorMessage: null };
}

export function buildWindGridCaption(
  grid: ForecastWindGridByTime,
  centerLat: number,
  centerLon: number,
  minutesFromNow = 0,
): string {
  const base = 'Wind: Open-Meteo 10 m grid (forecast_wind_grid)';
  if (!grid.available) return `${base} · unavailable`;

  const slice = windGridSliceAtMinutes(grid.byTime, minutesFromNow);
  const sample = windVectorAtLatLon(slice, centerLat, centerLon);
  if (!sample) return base;

  const dir = windAdvectionAngleDeg(sample.uMs, sample.vMs);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((dir % 360) + 360) % 360) / 45) % 8;
  const fetched =
    grid.fetchedAt != null
      ? ` · fetched ${Math.max(0, Math.round((Date.now() - new Date(grid.fetchedAt).getTime()) / 60000))} min ago`
      : '';
  return `${base}${fetched} · ${sample.windSpeedMps.toFixed(1)} m/s toward ${dirs[idx]}`;
}

function buildForecastWindGridFromRows(
  rows: WindGridRow[],
  displayTargetMs: number,
  errorMessage: string | null,
): ForecastWindGridByTime {
  if (errorMessage) {
    return {
      byTime: new Map(),
      displayTimeUtc: null,
      displayPoints: [],
      fetchedAt: null,
      available: false,
      errorMessage,
    };
  }

  const points: WindGridPoint[] = [];
  let latestFetchedAt: string | null = null;
  for (const row of rows) {
    const p = rowToPoint(row);
    if (p) points.push(p);
    if (row.fetched_at) {
      if (
        latestFetchedAt == null ||
        new Date(row.fetched_at).getTime() > new Date(latestFetchedAt).getTime()
      ) {
        latestFetchedAt = row.fetched_at;
      }
    }
  }

  const byTime = groupWindGridByTime(points);
  const displayTimeUtc = pickForecastTimeUtc([...byTime.keys()], displayTargetMs);
  const displaySlice = displayTimeUtc ? (byTime.get(displayTimeUtc) ?? []) : [];
  const displayPoints = downsampleWindGridPoints(displaySlice, WIND_ARROW_STRIDE);

  return {
    byTime,
    displayTimeUtc,
    displayPoints,
    fetchedAt: latestFetchedAt,
    available: byTime.size > 0,
  };
}

/** Fetch wind grids for an arbitrary UTC window (used for historical analog library). */
export async function fetchForecastWindGridRange(
  fromIso: string,
  toIso: string,
  displayTargetMs = Date.now(),
): Promise<ForecastWindGridByTime> {
  try {
    const { rows, errorMessage } = await fetchForecastWindGridRowsPaginated(fromIso, toIso);
    return buildForecastWindGridFromRows(rows, displayTargetMs, errorMessage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      byTime: new Map(),
      displayTimeUtc: null,
      displayPoints: [],
      fetchedAt: null,
      available: false,
      errorMessage: msg,
    };
  }
}

export async function fetchForecastWindGrid(): Promise<ForecastWindGridByTime> {
  const nowMs = Date.now();
  const fromIso = new Date(nowMs - LOOKBACK_MS).toISOString();
  const toIso = new Date(nowMs + LOOKAHEAD_MS).toISOString();
  return fetchForecastWindGridRange(fromIso, toIso, nowMs);
}
