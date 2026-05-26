import { haversineKm } from './geoUtils';
import type { SensorPoint } from './sensorTypes';

/** Max distance (km) to treat a map tap as hitting a visible sensor dot. */
export const SENSOR_MAP_HIT_KM = 0.15;

/** Tighter match when resolving from a sensor layer feature's coordinates. */
export const SENSOR_FEATURE_HIT_KM = 0.04;

/**
 * Coerce a DB / GeoJSON sensor id to the app shape (finite number or non-empty string).
 * PostgREST often returns numeric PurpleAir ids as strings; Clarity uses alphanumeric ids.
 */
export function normalizeSensorIndex(raw: unknown): number | string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number.parseInt(trimmed, 10);
      return Number.isFinite(n) ? n : null;
    }
    return trimmed;
  }
  return null;
}

export function isValidSensorIndex(value: unknown): value is number | string {
  return normalizeSensorIndex(value) != null;
}

export function parseSensorIndex(raw: unknown): number | string | null {
  return normalizeSensorIndex(raw);
}

export function sensorIdsEqual(a: unknown, b: unknown): boolean {
  const left = normalizeSensorIndex(a);
  const right = normalizeSensorIndex(b);
  return left != null && right != null && left === right;
}

export function findSensorNear(
  lat: number,
  lon: number,
  sensors: SensorPoint[],
  maxKm: number,
): SensorPoint | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || maxKm <= 0) return null;
  let best: SensorPoint | null = null;
  let bestD = maxKm;
  for (const s of sensors) {
    if (!isValidSensorIndex(s.sensorIndex)) continue;
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const d = haversineKm(lat, lon, s.latitude, s.longitude);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function sensorDetailFromPoint(sensor: SensorPoint): {
  sensorIndex: number | string;
  sensorSource: string;
  sensorName: string | null;
} {
  return {
    sensorIndex: sensor.sensorIndex,
    sensorSource: sensor.source,
    sensorName: sensor.name ?? null,
  };
}
