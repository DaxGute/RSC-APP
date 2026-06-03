/**
 * Ordinary-kriging PM2.5 surface over the SSF bbox from sensor points.
 * Variogram fitting, per-cell kriging, heatmap grid resolution, and the shared
 * resolver used by `KrigingHeatmapLayer`, tap sampling, and the model projection overlay.
 */

import type { CurrentKrigingRow } from '../shell/supabase';
import { haversineKm } from '../shell/geoUtils';
import { SSF_BBOX } from './mapRegionFromData';
import type { SensorPoint } from './sensorTypes';

/** Lat/lon grid resolution shared by heatmap rendering and tap sampling. */
export const HEATMAP_GRID_STEPS = 40;
const EXPECTED_GRID_CELLS = HEATMAP_GRID_STEPS * HEATMAP_GRID_STEPS;

/** Nearest sensors in each cell's ordinary-kriging solve and local PM2.5 clamp. */
export const LOCAL_KRIGING_NEIGHBORS = 5;
/** µg/m³ buffer beyond local min/max when clamping kriging estimates. */
export const PM25_CLAMP_BUFFER = 2;
/** Grid cells within this distance use the nearest sensor's observed PM2.5 directly. */
export const SENSOR_PIN_RADIUS_METERS = 75;
/** Beyond pin radius, blend kriging toward the nearest sensor out to this distance. */
export const SENSOR_BLEND_RADIUS_METERS = 300;

const SENSOR_PIN_RADIUS_KM = SENSOR_PIN_RADIUS_METERS / 1000;
const METERS_PER_KM = 1000;

const DEFAULT_GRID_LAT_STEPS = 56;
const DEFAULT_GRID_LON_STEPS = 56;

const DEFAULT_RANGE_KM = 8;
const MIN_RANGE_KM = 2;
const MAX_RANGE_KM = 15;
const RANGE_CANDIDATES_KM = [2, 4, 6, 8, 10, 12, 15];
const KRIGING_RIDGE = 1e-8;
const EPS_KM = 1e-6;

type VariogramParams = { nugget: number; sill: number; rangeKm: number };
type PreparedSensor = { lat: number; lon: number; pm25: number };
type KrigingBounds = {
  southLat: number;
  northLat: number;
  westLon: number;
  eastLon: number;
};
type RecomputeOptions = {
  latSteps?: number;
  lonSteps?: number;
  maxNeighbors?: number;
  bounds?: KrigingBounds;
};
type EmpiricalPair = { hKm: number; gamma: number };

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let sum = 0;
  for (const v of values) sum += (v - mean) ** 2;
  return sum / (values.length - 1);
}

function exponentialGamma(hKm: number, params: VariogramParams): number {
  if (hKm <= 0) return 0;
  const psill = Math.max(params.sill - params.nugget, 1e-9);
  return params.nugget + psill * (1 - Math.exp(-hKm / params.rangeKm));
}

function covarianceKm(distKm: number, params: VariogramParams): number {
  if (distKm <= EPS_KM) return params.sill;
  return params.sill - exponentialGamma(distKm, params);
}

function collectEmpiricalPairs(lats: number[], lons: number[], values: number[]): EmpiricalPair[] {
  const pairs: EmpiricalPair[] = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const hKm = haversineKm(lats[i], lons[i], lats[j], lons[j]);
      if (!(hKm > EPS_KM)) continue;
      pairs.push({ hKm, gamma: 0.5 * (values[i] - values[j]) ** 2 });
    }
  }
  return pairs;
}

function fitNuggetAndPsill(
  pairs: EmpiricalPair[],
  rangeKm: number,
): { nugget: number; psill: number; sse: number } {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const { hKm, gamma } of pairs) {
    const x = 1 - Math.exp(-hKm / rangeKm);
    n++;
    sumX += x;
    sumY += gamma;
    sumXX += x * x;
    sumXY += x * gamma;
  }
  if (n === 0) return { nugget: 0, psill: 0, sse: Number.POSITIVE_INFINITY };
  const denom = n * sumXX - sumX * sumX;
  let psill = 0;
  let nugget = sumY / n;
  if (Math.abs(denom) > 1e-12) {
    psill = (n * sumXY - sumX * sumY) / denom;
    nugget = (sumY - psill * sumX) / n;
  }
  psill = Math.max(psill, 0);
  nugget = Math.max(nugget, 0);
  let sse = 0;
  for (const { hKm, gamma } of pairs) {
    const x = 1 - Math.exp(-hKm / rangeKm);
    const pred = nugget + psill * x;
    const err = gamma - pred;
    sse += err * err;
  }
  return { nugget, psill, sse };
}

function fitExponentialVariogram(lats: number[], lons: number[], values: number[]): VariogramParams {
  const sampleVar = Math.max(sampleVariance(values), 0.25);
  if (values.length < 2) {
    return { nugget: 0.1 * sampleVar, sill: sampleVar, rangeKm: DEFAULT_RANGE_KM };
  }

  const pairs = collectEmpiricalPairs(lats, lons, values);
  if (pairs.length === 0) {
    return { nugget: 0.15 * sampleVar, sill: sampleVar, rangeKm: DEFAULT_RANGE_KM };
  }

  let best = fitNuggetAndPsill(pairs, DEFAULT_RANGE_KM);
  let bestRange = DEFAULT_RANGE_KM;
  for (const rangeKm of RANGE_CANDIDATES_KM) {
    const fit = fitNuggetAndPsill(pairs, rangeKm);
    if (fit.sse < best.sse) {
      best = fit;
      bestRange = rangeKm;
    }
  }

  const nugget = Math.min(Math.max(best.nugget, 0), sampleVar * 0.45);
  const sill = Math.max(nugget + best.psill, sampleVar * 0.5, 0.5);
  const rangeKm = Math.min(MAX_RANGE_KM, Math.max(MIN_RANGE_KM, bestRange));
  return { nugget, sill, rangeKm };
}

function selectNearestIndices(
  lat0: number,
  lon0: number,
  lats: number[],
  lons: number[],
  maxNeighbors: number,
): number[] {
  const dists: { idx: number; dKm: number }[] = [];
  for (let i = 0; i < lats.length; i++) {
    dists.push({ idx: i, dKm: haversineKm(lat0, lon0, lats[i], lons[i]) });
  }
  dists.sort((a, b) => a.dKm - b.dKm);
  const k = Math.max(1, Math.min(maxNeighbors, dists.length));
  return dists.slice(0, k).map((d) => d.idx);
}

function localObservedRange(indices: number[], values: number[]): { localMin: number; localMax: number } {
  let localMin = Infinity;
  let localMax = -Infinity;
  for (const idx of indices) {
    const v = values[idx];
    if (v < localMin) localMin = v;
    if (v > localMax) localMax = v;
  }
  return { localMin, localMax };
}

function clampPm25ToLocalRange(
  predicted: number,
  localMin: number,
  localMax: number,
): number {
  if (!Number.isFinite(localMin) || !Number.isFinite(localMax)) return predicted;
  return Math.max(localMin - PM25_CLAMP_BUFFER, Math.min(localMax + PM25_CLAMP_BUFFER, predicted));
}

/** Blend kriging toward the nearest sensor between pin and blend radii (stronger local green/moderate pockets). */
function applyNearestSensorInfluence(
  krigingPm25: number,
  nearestDistKm: number,
  nearestPm25: number,
): number {
  const nearestDistMeters = nearestDistKm * METERS_PER_KM;
  if (nearestDistMeters <= SENSOR_PIN_RADIUS_METERS) {
    return nearestPm25;
  }
  if (nearestDistMeters >= SENSOR_BLEND_RADIUS_METERS) {
    return krigingPm25;
  }
  const t =
    (nearestDistMeters - SENSOR_PIN_RADIUS_METERS) /
    (SENSOR_BLEND_RADIUS_METERS - SENSOR_PIN_RADIUS_METERS);
  const sensorWeight = 1 - t;
  return sensorWeight * nearestPm25 + t * krigingPm25;
}

function solveKrigingSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row) => row.slice());
  const b = rhs.slice();

  for (let col = 0; col < n; col++) {
    let pivot = col;
    let maxAbs = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(a[row][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivot = row;
      }
    }
    if (!(maxAbs > 1e-12)) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const pivotVal = a[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / pivotVal;
      for (let j = col; j < n; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let j = row + 1; j < n; j++) sum -= a[row][j] * x[j];
    const diag = a[row][row];
    if (!(Math.abs(diag) > 1e-12)) return null;
    x[row] = sum / diag;
  }
  return x;
}

function ordinaryKrigingAt(
  lat0: number,
  lon0: number,
  lats: number[],
  lons: number[],
  values: number[],
  variogram: VariogramParams,
  maxNeighbors: number,
): { pm25: number; variance: number } | null {
  if (values.length === 0) return null;
  if (values.length === 1) {
    return { pm25: values[0], variance: variogram.nugget };
  }

  const nearestIdx = selectNearestIndices(lat0, lon0, lats, lons, 1)[0];
  const nearestDistKm = haversineKm(lat0, lon0, lats[nearestIdx], lons[nearestIdx]);
  const nearestPm25 = values[nearestIdx];

  if (nearestDistKm <= SENSOR_PIN_RADIUS_KM) {
    return { pm25: nearestPm25, variance: 0 };
  }

  const indices = selectNearestIndices(lat0, lon0, lats, lons, maxNeighbors);

  const n = indices.length;
  const size = n + 1;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);

  for (let i = 0; i < n; i++) {
    const ii = indices[i];
    for (let j = 0; j < n; j++) {
      const jj = indices[j];
      const dist = i === j ? 0 : haversineKm(lats[ii], lons[ii], lats[jj], lons[jj]);
      matrix[i][j] = covarianceKm(dist, variogram);
      if (i === j) matrix[i][j] += variogram.sill * KRIGING_RIDGE;
    }
    matrix[i][n] = 1;
    matrix[n][i] = 1;
    rhs[i] = covarianceKm(haversineKm(lat0, lon0, lats[ii], lons[ii]), variogram);
  }
  matrix[n][n] = 0;
  rhs[n] = 1;

  const solution = solveKrigingSystem(matrix, rhs);
  if (!solution) return null;

  const weights = solution.slice(0, n);
  const mu = solution[n];
  let pm25 = 0;
  for (let i = 0; i < n; i++) pm25 += weights[i] * values[indices[i]];
  if (!Number.isFinite(pm25)) return null;

  pm25 = applyNearestSensorInfluence(pm25, nearestDistKm, nearestPm25);

  const { localMin, localMax } = localObservedRange(indices, values);
  pm25 = clampPm25ToLocalRange(pm25, localMin, localMax);

  const c00 = covarianceKm(0, variogram);
  let rhsDot = 0;
  for (let i = 0; i < n; i++) rhsDot += weights[i] * rhs[i];
  const variance = Math.max(0, c00 - rhsDot - mu);
  return { pm25, variance };
}

/** Recompute a full SSF kriging surface from current sensor points (ordinary kriging). */
export function recomputeKrigingFromSensors(
  sensors: SensorPoint[],
  recordedTime: string,
  options?: RecomputeOptions,
): CurrentKrigingRow[] {
  if (sensors.length === 0) return [];
  const prepared: PreparedSensor[] = sensors
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && Number.isFinite(s.pm25))
    .map((s) => ({ lat: s.latitude, lon: s.longitude, pm25: s.pm25 }));
  if (prepared.length === 0) return [];

  const lats = prepared.map((s) => s.lat);
  const lons = prepared.map((s) => s.lon);
  const pm25 = prepared.map((s) => s.pm25);
  const variogram = fitExponentialVariogram(lats, lons, pm25);

  const rows: CurrentKrigingRow[] = [];
  const latSteps = Math.max(2, Math.floor(options?.latSteps ?? DEFAULT_GRID_LAT_STEPS));
  const lonSteps = Math.max(2, Math.floor(options?.lonSteps ?? DEFAULT_GRID_LON_STEPS));
  const maxNeighbors = Math.max(
    1,
    Math.min(prepared.length, Math.floor(options?.maxNeighbors ?? LOCAL_KRIGING_NEIGHBORS)),
  );
  const bounds = options?.bounds;
  const southLat = bounds?.southLat ?? SSF_BBOX.seLat;
  const northLat = bounds?.northLat ?? SSF_BBOX.nwLat;
  const westLon = bounds?.westLon ?? SSF_BBOX.nwLon;
  const eastLon = bounds?.eastLon ?? SSF_BBOX.seLon;
  const latStep = (northLat - southLat) / (latSteps - 1);
  const lonStep = (eastLon - westLon) / (lonSteps - 1);
  const rowKey = (lat: number, lon: number) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const seen = new Set<string>();

  for (let i = 0; i < latSteps; i++) {
    const lat = southLat + i * latStep;
    for (let j = 0; j < lonSteps; j++) {
      const lon = westLon + j * lonStep;
      const estimate = ordinaryKrigingAt(lat, lon, lats, lons, pm25, variogram, maxNeighbors);
      if (!estimate) continue;
      seen.add(rowKey(lat, lon));
      rows.push({
        latitude: lat,
        longitude: lon,
        pm25: estimate.pm25,
        aqi: null,
        kriging_variance: estimate.variance,
        time: recordedTime,
      });
    }
  }

  for (const sensor of prepared) {
    const key = rowKey(sensor.lat, sensor.lon);
    if (seen.has(key)) continue;
    rows.push({
      latitude: sensor.lat,
      longitude: sensor.lon,
      pm25: sensor.pm25,
      aqi: null,
      kriging_variance: 0,
      time: recordedTime,
    });
  }
  return rows;
}

/**
 * Resolve grid rows for heatmap rendering and tap sampling.
 * Prefers a fresh sensor kriging surface at `HEATMAP_GRID_STEPS` when enough cells recompute.
 */
export function resolveHeatmapGridRows({
  kriging,
  sensors,
}: {
  kriging: CurrentKrigingRow[];
  sensors: SensorPoint[];
}): CurrentKrigingRow[] {
  const time = sensors[0]?.time ?? new Date().toISOString();
  const recomputed =
    sensors.length > 0
      ? recomputeKrigingFromSensors(sensors, time, {
          latSteps: HEATMAP_GRID_STEPS,
          lonSteps: HEATMAP_GRID_STEPS,
        })
      : [];
  return recomputed.length >= EXPECTED_GRID_CELLS
    ? recomputed.slice(0, EXPECTED_GRID_CELLS)
    : kriging;
}
