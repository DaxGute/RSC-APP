import type { CurrentKrigingRow } from './database.types';
import { SSF_BBOX } from './constants/ssf';
import {
  type ForecastWindGridByTime,
  windGridSliceAtMinutes,
  windVectorAtLatLon,
} from './forecastWindGrid';
import { pm25AtLatLon, type TrendHistoryGrids } from './projectionTrendHistory';
import { blendWeightsForMinutes } from './projectionBlendWeights';
import {
  formatStepShortLabel,
  minutesAheadForStep,
  PROJECTION_FRAME_COUNT,
  PROJECTION_FUTURE_STEPS,
} from './projectionTimeLabels';

export type ProjectionDebugMode = 'now' | 'wind-only' | 'blend';

export type ProjectionFrame = {
  stepIndex: number;
  minutesAhead: number;
  label: string;
  grid: CurrentKrigingRow[];
  /** Heatmap render strength (kept at 1 — concentration not faded). */
  opacityScale: number;
  /** Uncertainty veil opacity 0..1 for UI overlay. */
  uncertaintyOverlay: number;
};

const DT_SECONDS = 600;
const METERS_PER_DEG_LAT = 111_320;
const RENDER_SMOOTH_STRENGTH = 0.04;

type Grid2D = {
  latAsc: number[];
  lonAsc: number[];
  values: number[][];
  recordedTime: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rowsToGrid(rows: CurrentKrigingRow[]): Grid2D | null {
  const valid = rows.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.pm25),
  );
  if (valid.length === 0) return null;

  const byLat = new Map<number, Map<number, number>>();
  for (const row of valid) {
    let lonMap = byLat.get(row.latitude);
    if (!lonMap) {
      lonMap = new Map<number, number>();
      byLat.set(row.latitude, lonMap);
    }
    lonMap.set(row.longitude, row.pm25 as number);
  }

  const latAsc = Array.from(byLat.keys()).sort((a, b) => a - b);
  const lonAsc = Array.from(byLat.get(latAsc[0])?.keys() ?? []).sort((a, b) => a - b);
  if (latAsc.length < 2 || lonAsc.length < 2) return null;

  const values: number[][] = [];
  for (let yi = 0; yi < latAsc.length; yi += 1) {
    const rowVals: number[] = [];
    const lonMap = byLat.get(latAsc[yi]);
    for (let xi = 0; xi < lonAsc.length; xi += 1) {
      rowVals.push(lonMap?.get(lonAsc[xi]) ?? 0);
    }
    values.push(rowVals);
  }

  return {
    latAsc,
    lonAsc,
    values,
    recordedTime: valid[0]?.time ?? new Date().toISOString(),
  };
}

function gridToRows(grid: Grid2D): CurrentKrigingRow[] {
  const rows: CurrentKrigingRow[] = [];
  for (let yi = 0; yi < grid.latAsc.length; yi += 1) {
    for (let xi = 0; xi < grid.lonAsc.length; xi += 1) {
      const pm25 = grid.values[yi]?.[xi];
      if (pm25 == null || !Number.isFinite(pm25)) continue;
      rows.push({
        latitude: grid.latAsc[yi],
        longitude: grid.lonAsc[xi],
        pm25,
        aqi: null,
        kriging_variance: null,
        time: grid.recordedTime,
      });
    }
  }
  return rows;
}

function sampleBilinear(grid: Grid2D, lat: number, lon: number): number {
  const { latAsc, lonAsc, values } = grid;
  const m = latAsc.length;
  const n = lonAsc.length;
  if (m < 2 || n < 2) return 0;

  const latMin = latAsc[0];
  const latMax = latAsc[m - 1];
  const lonMin = lonAsc[0];
  const lonMax = lonAsc[n - 1];
  if (!(latMax > latMin) || !(lonMax > lonMin)) return values[0]?.[0] ?? 0;

  const latT = clamp((lat - latMin) / (latMax - latMin), 0, 1);
  const lonT = clamp((lon - lonMin) / (lonMax - lonMin), 0, 1);
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

/** One light smoothing pass for contour rendering only. */
function lightSmoothForRender(grid: Grid2D, strength: number): Grid2D {
  const m = grid.latAsc.length;
  const n = grid.lonAsc.length;
  const next: number[][] = [];
  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < n; xi += 1) {
      let sum = grid.values[yi][xi] * (1 - strength);
      let weight = 1 - strength;
      const neighbors = [
        [yi - 1, xi],
        [yi + 1, xi],
        [yi, xi - 1],
        [yi, xi + 1],
      ] as const;
      for (const [ny, nx] of neighbors) {
        if (ny < 0 || ny >= m || nx < 0 || nx >= n) continue;
        sum += grid.values[ny][nx] * strength * 0.25;
        weight += strength * 0.25;
      }
      row.push(sum / weight);
    }
    next.push(row);
  }
  return { ...grid, values: next };
}

function trendRateUgPerMin(
  lat: number,
  lon: number,
  currentPm: number,
  history: TrendHistoryGrids | null,
): number {
  if (!history) return 0;
  const rates: number[] = [];
  const pairs: Array<[CurrentKrigingRow[] | null, number]> = [
    [history.grid10mAgo, 10],
    [history.grid20mAgo, 20],
    [history.grid30mAgo, 30],
  ];
  for (const [grid, minutes] of pairs) {
    const past = pm25AtLatLon(grid, lat, lon);
    if (past == null || !Number.isFinite(past)) continue;
    rates.push((currentPm - past) / minutes);
  }
  if (rates.length === 0) return 0;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function trendAdjustedPm25(
  currentPm: number,
  trendRate: number,
  minutesAhead: number,
): number {
  if (minutesAhead <= 0) return currentPm;
  const ramp = Math.min(1, minutesAhead / 60);
  const delta = trendRate * minutesAhead * ramp;
  const cap = Math.max(8, Math.abs(currentPm) * 0.35);
  return Math.max(0, currentPm + clamp(delta, -cap, cap));
}

function integratedWindOffsetDeg(
  byTime: ForecastWindGridByTime['byTime'],
  lat: number,
  lon: number,
  minutesAhead: number,
): { dLatDeg: number; dLonDeg: number } {
  const centerLat = (SSF_BBOX.nwLat + SSF_BBOX.seLat) / 2;
  const mPerDegLon = METERS_PER_DEG_LAT * Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));

  let dLatDeg = 0;
  let dLonDeg = 0;
  const steps = Math.max(1, Math.floor(minutesAhead / 10));
  for (let s = 1; s <= steps; s += 1) {
    const minutes = Math.min(s * 10, minutesAhead);
    const slice = windGridSliceAtMinutes(byTime, minutes);
    const sample = windVectorAtLatLon(slice, lat, lon);
    if (!sample) continue;
    dLatDeg += (sample.vMs * DT_SECONDS) / METERS_PER_DEG_LAT;
    dLonDeg += (sample.uMs * DT_SECONDS) / mPerDegLon;
  }
  return { dLatDeg, dLonDeg };
}

function windShiftedPm25(
  nowGrid: Grid2D,
  lat: number,
  lon: number,
  byTime: ForecastWindGridByTime['byTime'],
  minutesAhead: number,
): number {
  if (minutesAhead <= 0) return sampleBilinear(nowGrid, lat, lon);
  const { dLatDeg, dLonDeg } = integratedWindOffsetDeg(byTime, lat, lon, minutesAhead);
  return sampleBilinear(nowGrid, lat - dLatDeg, lon - dLonDeg);
}

function uncertaintyForStep(stepIndex: number): number {
  const t = stepIndex / PROJECTION_FUTURE_STEPS;
  return t * 0.42;
}

function buildProjectedGrid(
  nowGrid: Grid2D,
  minutesAhead: number,
  wind: ForecastWindGridByTime | null,
  history: TrendHistoryGrids | null,
  debugMode: ProjectionDebugMode,
): Grid2D {
  const m = nowGrid.latAsc.length;
  const n = nowGrid.lonAsc.length;
  const values: number[][] = [];
  const windOk = wind?.available === true && (wind.byTime.size ?? 0) > 0;
  const weights = blendWeightsForMinutes(minutesAhead);

  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    const lat = nowGrid.latAsc[yi];
    for (let xi = 0; xi < n; xi += 1) {
      const lon = nowGrid.lonAsc[xi];
      const currentPm = sampleBilinear(nowGrid, lat, lon);
      const rate = trendRateUgPerMin(lat, lon, currentPm, history);
      const trendPm =
        history && (history.grid10mAgo || history.grid20mAgo || history.grid30mAgo)
          ? trendAdjustedPm25(currentPm, rate, minutesAhead)
          : currentPm;
      const windPm = windOk
        ? windShiftedPm25(nowGrid, lat, lon, wind!.byTime, minutesAhead)
        : currentPm;

      let pm: number;
      if (debugMode === 'now') {
        pm = currentPm;
      } else if (debugMode === 'wind-only') {
        pm = windPm;
      } else {
        pm =
          weights.current * currentPm + weights.trend * trendPm + weights.wind * windPm;
      }
      row.push(pm);
    }
    values.push(row);
  }

  let out: Grid2D = { ...nowGrid, values };
  if (minutesAhead > 0 && debugMode === 'blend') {
    out = lightSmoothForRender(out, RENDER_SMOOTH_STRENGTH);
  }
  return out;
}

export type GenerateWindAdjustedFramesResult = {
  frames: ProjectionFrame[];
  windAvailable: boolean;
};

/** Build one projection step from the Now grid (not chained from prior steps). */
export function generateProjectionFrameAtStep(
  currentGrid: CurrentKrigingRow[],
  stepIndex: number,
  wind: ForecastWindGridByTime | null,
  trendHistory?: TrendHistoryGrids | null,
  debugMode: ProjectionDebugMode = 'blend',
): ProjectionFrame | null {
  const nowGrid2d = rowsToGrid(currentGrid);
  if (!nowGrid2d) return null;

  const step = clamp(stepIndex, 0, PROJECTION_FRAME_COUNT - 1);
  const minutesAhead = minutesAheadForStep(step);
  const projected =
    step === 0 || debugMode === 'now'
      ? nowGrid2d
      : buildProjectedGrid(nowGrid2d, minutesAhead, wind, trendHistory ?? null, debugMode);

  return {
    stepIndex: step,
    minutesAhead,
    label: formatStepShortLabel(minutesAhead),
    grid: step === 0 ? currentGrid : gridToRows(projected),
    opacityScale: 1,
    uncertaintyOverlay: uncertaintyForStep(step),
  };
}

/**
 * Persistence + weak wind + gradual trend model.
 * Each frame is built from the Now grid (not chained from the previous frame).
 */
export function generateWindAdjustedFrames(
  currentGrid: CurrentKrigingRow[],
  wind: ForecastWindGridByTime | null,
  trendHistory?: TrendHistoryGrids | null,
  debugMode: ProjectionDebugMode = 'blend',
): GenerateWindAdjustedFramesResult {
  const windOk = wind?.available === true && (wind.byTime.size ?? 0) > 0;
  const frames: ProjectionFrame[] = [];

  for (let step = 0; step < PROJECTION_FRAME_COUNT; step += 1) {
    const frame = generateProjectionFrameAtStep(
      currentGrid,
      step,
      wind,
      trendHistory,
      debugMode,
    );
    if (frame) frames.push(frame);
  }

  return { frames, windAvailable: windOk };
}
