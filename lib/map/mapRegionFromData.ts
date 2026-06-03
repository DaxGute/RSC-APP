/**
 * Map viewport helpers: static SSF bounding box and in-bounds checks.
 * `regionFromSensorData` ignores sensor/kriging args (kept for stable call sites).
 */

import type { CurrentKrigingRow } from '../shell/supabase';
import type { SensorPoint } from './sensorTypes';

/** South San Francisco map bounds — matches SSF-AQI `app.py`. */
export const SSF_BBOX = {
  nwLat: 37.7,
  nwLon: -122.5,
  seLat: 37.6,
  seLon: -122.35,
} as const;

/** Viewport rectangle (center + span), same shape as the former `react-native-maps` Region. */
export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Map viewport for SSF: always the static bbox (pan/zoom limits applied in `SsfMap`).
 * Sensor/kriging args are kept for call-site stability.
 */
export function regionFromSensorData(_sensors: SensorPoint[], _kriging: CurrentKrigingRow[]): MapRegion {
  const { nwLat, nwLon, seLat, seLon } = SSF_BBOX;
  return {
    latitude: (nwLat + seLat) / 2,
    longitude: (nwLon + seLon) / 2,
    latitudeDelta: Math.abs(nwLat - seLat),
    longitudeDelta: Math.abs(seLon - nwLon),
  };
}

/** True if the point lies inside the rectangle implied by `region` (center ± half deltas). */
export function coordinateInRegion(lat: number, lon: number, region: MapRegion): boolean {
  const latMin = region.latitude - region.latitudeDelta / 2;
  const latMax = region.latitude + region.latitudeDelta / 2;
  const lonMin = region.longitude - region.longitudeDelta / 2;
  const lonMax = region.longitude + region.longitudeDelta / 2;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}
