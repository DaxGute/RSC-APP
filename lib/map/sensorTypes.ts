/**
 * Shared sensor shapes and helpers for map overlays (PurpleAir + Clarity).
 * Types, id normalization, proximity hit-testing, and panel detail extraction.
 */

import { haversineKm } from '../shell/geoUtils';

/** Data vendor identifier (`purple_air`, `clarity`, or pipeline-specific strings). */
export type SensorSource = 'purple_air' | 'clarity' | string;

/** One sensor reading at a point in time for map rendering and kriging input. */
export type SensorPoint = {
  /** PurpleAir numeric ids; Clarity alphanumeric ids (PostgREST may return either as strings). */
  sensorIndex: number | string;
  /** Optional display name from the database. */
  name?: string | null;
  latitude: number;
  longitude: number;
  pm25: number;
  source: SensorSource;
  /** ISO timestamp of the reading used for this map frame. */
  time: string;
};

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

/** Type guard for values accepted as a sensor id after normalization. */
export function isValidSensorIndex(value: unknown): value is number | string {
  return normalizeSensorIndex(value) != null;
}

/** Nearest sensor within `maxKm` of a tap coordinate, or null if none qualify. */
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

/** Panel-friendly id/source/name tuple from a resolved `SensorPoint`. */
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
