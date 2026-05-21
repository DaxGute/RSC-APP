/**
 * Legacy semi-Lagrangian wind backtrace projector (slow on 40×40 grids).
 * Production modeling uses `lib/modeling/generateAnalogProjectionFrames.ts`.
 */
import type { CurrentKrigingRow } from './database.types';
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
/** e-folding time for weak PM₂.₅ decay (minutes). ~2% loss at +10m, ~6% at +30m. */
const DECAY_TAU_MINUTES = 480;
/** Background relaxation begins after this horizon (minutes). */
const RELAX_START_MINUTES = 30;
const MAX_RELAX_WEIGHT = 0.28;
const MAX_UNCERTAINTY = 0.55;
/** Displacement (m) at which displacement-driven uncertainty saturates. */
const DISP_UNCERTAINTY_SCALE_M = 6000;

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

function isInsideGrid(grid: Grid2D, lat: number, lon: number): boolean {
  const latMin = grid.latAsc[0];
  const latMax = grid.latAsc[grid.latAsc.length - 1];
  const lonMin = grid.lonAsc[0];
  const lonMax = grid.lonAsc[grid.lonAsc.length - 1];
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

type BacktraceResult = {
  sourceLat: number;
  sourceLon: number;
  displacementM: number;
  outOfBounds: boolean;
};

/**
 * Semi-Lagrangian backtrace: walk backward through each 10-minute wind slice,
 * updating position with wind at the trace point (not a single bulk offset).
 */
function semiLagrangianBacktrace(
  byTime: ForecastWindGridByTime['byTime'],
  grid: Grid2D,
  lat: number,
  lon: number,
  minutesAhead: number,
): BacktraceResult {
  let latP = lat;
  let lonP = lon;
  let displacementM = 0;
  let hadWind = false;
  /** Sub-hour integration steps; UI horizon steps are hourly (see `projectionTimeLabels`). */
  const subStepMinutes = 10;
  const steps = Math.max(1, Math.floor(minutesAhead / subStepMinutes));

  for (let i = 0; i < steps; i += 1) {
    const minutes = Math.max(0, minutesAhead - i * subStepMinutes);
    const slice = windGridSliceAtMinutes(byTime, minutes);
    const sample = windVectorAtLatLon(slice, latP, lonP);
    if (!sample) continue;
    hadWind = true;
    const mPerDegLon = METERS_PER_DEG_LAT * Math.max(0.2, Math.cos((latP * Math.PI) / 180));
    latP -= (sample.vMs * DT_SECONDS) / METERS_PER_DEG_LAT;
    lonP -= (sample.uMs * DT_SECONDS) / mPerDegLon;
    displacementM += Math.hypot(sample.uMs * DT_SECONDS, sample.vMs * DT_SECONDS);
  }

  return {
    sourceLat: latP,
    sourceLon: lonP,
    displacementM: hadWind ? displacementM : 0,
    outOfBounds: !isInsideGrid(grid, latP, lonP),
  };
}

function meanGridPm25(grid: Grid2D): number {
  let sum = 0;
  let count = 0;
  for (const row of grid.values) {
    for (const v of row) {
      if (Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : 12;
}

/** Weak decay + long-horizon relaxation toward domain-mean PM₂.₅. */
function applyAdvectionDecay(
  advectedPm: number,
  backgroundPm: number,
  minutesAhead: number,
): number {
  const conservation = Math.exp(-minutesAhead / DECAY_TAU_MINUTES);
  let relax = 0;
  if (minutesAhead > RELAX_START_MINUTES) {
    relax = Math.min(
      MAX_RELAX_WEIGHT,
      ((minutesAhead - RELAX_START_MINUTES) / (300 - RELAX_START_MINUTES)) * MAX_RELAX_WEIGHT,
    );
  }
  const conserved = conservation * advectedPm;
  return (1 - relax) * conserved + relax * backgroundPm;
}

function advectedPm25(
  nowGrid: Grid2D,
  lat: number,
  lon: number,
  byTime: ForecastWindGridByTime['byTime'],
  minutesAhead: number,
  backgroundPm: number,
): { pm: number; displacementM: number; outOfBounds: boolean } {
  if (minutesAhead <= 0) {
    return {
      pm: sampleBilinear(nowGrid, lat, lon),
      displacementM: 0,
      outOfBounds: false,
    };
  }

  const trace = semiLagrangianBacktrace(byTime, nowGrid, lat, lon, minutesAhead);
  const raw = trace.outOfBounds
    ? sampleBilinear(nowGrid, lat, lon)
    : sampleBilinear(nowGrid, trace.sourceLat, trace.sourceLon);

  return {
    pm: applyAdvectionDecay(raw, backgroundPm, minutesAhead),
    displacementM: trace.displacementM,
    outOfBounds: trace.outOfBounds,
  };
}

function uncertaintyForStep(
  stepIndex: number,
  maxDisplacementM: number,
  oobFraction: number,
): number {
  const horizon = (stepIndex / PROJECTION_FUTURE_STEPS) * 0.28;
  const displacement =
    Math.min(1, maxDisplacementM / DISP_UNCERTAINTY_SCALE_M) * 0.22;
  const oob = Math.min(0.18, oobFraction * 0.35);
  return Math.min(MAX_UNCERTAINTY, horizon + displacement + oob);
}

type ProjectedGridResult = {
  grid: Grid2D;
  maxDisplacementM: number;
  oobFraction: number;
};

function buildProjectedGrid(
  nowGrid: Grid2D,
  minutesAhead: number,
  wind: ForecastWindGridByTime | null,
  history: TrendHistoryGrids | null,
  debugMode: ProjectionDebugMode,
): ProjectedGridResult {
  const m = nowGrid.latAsc.length;
  const n = nowGrid.lonAsc.length;
  const values: number[][] = [];
  const windOk = wind?.available === true && (wind.byTime.size ?? 0) > 0;
  const weights = blendWeightsForMinutes(minutesAhead);
  const backgroundPm = meanGridPm25(nowGrid);
  let maxDisplacementM = 0;
  let oobCells = 0;
  let cellCount = 0;

  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    const lat = nowGrid.latAsc[yi];
    for (let xi = 0; xi < n; xi += 1) {
      const lon = nowGrid.lonAsc[xi];
      cellCount += 1;
      const currentPm = sampleBilinear(nowGrid, lat, lon);
      const rate = trendRateUgPerMin(lat, lon, currentPm, history);
      const trendPm =
        history && (history.grid10mAgo || history.grid20mAgo || history.grid30mAgo)
          ? trendAdjustedPm25(currentPm, rate, minutesAhead)
          : currentPm;

      let advectedPm = currentPm;
      let displacementM = 0;
      let outOfBounds = false;
      if (windOk) {
        const advection = advectedPm25(
          nowGrid,
          lat,
          lon,
          wind!.byTime,
          minutesAhead,
          backgroundPm,
        );
        advectedPm = advection.pm;
        displacementM = advection.displacementM;
        outOfBounds = advection.outOfBounds;
      }

      if (displacementM > maxDisplacementM) maxDisplacementM = displacementM;
      if (outOfBounds) oobCells += 1;

      const windPm = outOfBounds ? currentPm : advectedPm;

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

  return {
    grid: out,
    maxDisplacementM,
    oobFraction: cellCount > 0 ? oobCells / cellCount : 0,
  };
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
  if (step === 0 || debugMode === 'now') {
    return {
      stepIndex: step,
      minutesAhead,
      label: formatStepShortLabel(minutesAhead),
      grid: currentGrid,
      opacityScale: 1,
      uncertaintyOverlay: 0,
    };
  }

  const { grid: projected, maxDisplacementM, oobFraction } = buildProjectedGrid(
    nowGrid2d,
    minutesAhead,
    wind,
    trendHistory ?? null,
    debugMode,
  );

  return {
    stepIndex: step,
    minutesAhead,
    label: formatStepShortLabel(minutesAhead),
    grid: gridToRows(projected),
    opacityScale: 1,
    uncertaintyOverlay: uncertaintyForStep(step, maxDisplacementM, oobFraction),
  };
}

/**
 * Semi-Lagrangian wind advection (primary short-term) + trend (long horizon).
 * Each frame is rebuilt from the current kriging grid — never chained.
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
