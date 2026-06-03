/**
 * IDW-based PM2.5 surface over the SSF bbox from sensor points.
 * Exposes low-level recompute, heatmap grid resolution, and the shared resolver
 * used by `KrigingHeatmapLayer`, tap sampling, and the model projection overlay.
 */

import type { CurrentKrigingRow } from '../shell/supabase';
import { SSF_BBOX } from './mapRegionFromData';
import type { SensorPoint } from './sensorTypes';

/** Lat/lon grid resolution shared by heatmap rendering and tap sampling. */
export const HEATMAP_GRID_STEPS = 40;
const EXPECTED_GRID_CELLS = HEATMAP_GRID_STEPS * HEATMAP_GRID_STEPS;

const DEFAULT_GRID_LAT_STEPS = 56;
const DEFAULT_GRID_LON_STEPS = 56;
const EPS_DEG = 1e-6;
const IDW_POWER = 2;

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

function estimatePm25At(
  lat: number,
  lon: number,
  sensors: PreparedSensor[],
  maxNeighbors: number,
): { pm25: number; variance: number } | null {
  if (sensors.length === 0) return null;
  const nearestDist2: number[] = [];
  const nearestPm25: number[] = [];

  for (let i = 0; i < sensors.length; i++) {
    const s = sensors[i];
    const dLat = lat - s.lat;
    const dLon = lon - s.lon;
    const dist2 = dLat * dLat + dLon * dLon;
    if (nearestDist2.length < maxNeighbors) {
      nearestDist2.push(dist2);
      nearestPm25.push(s.pm25);
      continue;
    }
    let worstIdx = 0;
    let worstDist2 = nearestDist2[0];
    for (let k = 1; k < nearestDist2.length; k++) {
      if (nearestDist2[k] > worstDist2) {
        worstDist2 = nearestDist2[k];
        worstIdx = k;
      }
    }
    if (dist2 < worstDist2) {
      nearestDist2[worstIdx] = dist2;
      nearestPm25[worstIdx] = s.pm25;
    }
  }
  if (nearestDist2.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < nearestDist2.length; i++) {
    const dist2 = nearestDist2[i];
    const w = 1 / Math.pow(Math.max(dist2, EPS_DEG * EPS_DEG), IDW_POWER / 2);
    weightedSum += nearestPm25[i] * w;
    weightTotal += w;
  }
  if (!(weightTotal > 0)) return null;

  const pm25 = weightedSum / weightTotal;
  let weightedVar = 0;
  for (let i = 0; i < nearestDist2.length; i++) {
    const dist2 = nearestDist2[i];
    const w = 1 / Math.pow(Math.max(dist2, EPS_DEG * EPS_DEG), IDW_POWER / 2);
    const d = nearestPm25[i] - pm25;
    weightedVar += w * d * d;
  }
  const variance = weightedVar / weightTotal;
  return { pm25, variance };
}

/** Recompute a full SSF kriging-like surface from current sensor points (IDW approximation). */
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

  const rows: CurrentKrigingRow[] = [];
  const latSteps = Math.max(2, Math.floor(options?.latSteps ?? DEFAULT_GRID_LAT_STEPS));
  const lonSteps = Math.max(2, Math.floor(options?.lonSteps ?? DEFAULT_GRID_LON_STEPS));
  const maxNeighbors = Math.max(1, Math.min(prepared.length, Math.floor(options?.maxNeighbors ?? 8)));
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
      const estimate = estimatePm25At(lat, lon, prepared, maxNeighbors);
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

  // Ensure exact sensor anchors exist in the output surface.
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
 * Prefers a fresh sensor IDW surface at `HEATMAP_GRID_STEPS` when enough cells recompute.
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
