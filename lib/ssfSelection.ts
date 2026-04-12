import type { CurrentKrigingRow } from './database.types';
import { haversineKm, idwPoint } from './geoUtils';
import type { SensorPoint } from './sensorTypes';
import { pm25BreakpointCategory, type Pm25Category } from './aqiUtils';

export function computeSsfSelection(
  lat0: number,
  lon0: number,
  sensors: SensorPoint[],
  kriging: CurrentKrigingRow[],
): {
  predPm25: number | null;
  predPm25Category: Pm25Category;
  closest: { lat: number; lon: number; pm25: number; distKm: number } | null;
} {
  const kg = kriging.filter(
    (r) =>
      r.pm25 != null &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude) &&
      Number.isFinite(r.pm25),
  );

  let predPm25: number | null = null;
  if (kg.length > 0) {
    predPm25 = idwPoint(
      kg.map((r) => r.longitude),
      kg.map((r) => r.latitude),
      kg.map((r) => r.pm25 as number),
      lon0,
      lat0,
    );
  } else if (sensors.length > 0) {
    predPm25 = idwPoint(
      sensors.map((s) => s.longitude),
      sensors.map((s) => s.latitude),
      sensors.map((s) => s.pm25),
      lon0,
      lat0,
    );
  }

  const predPm25Category = pm25BreakpointCategory(predPm25);

  let closest: { lat: number; lon: number; pm25: number; distKm: number } | null = null;
  if (sensors.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < sensors.length; i++) {
      const d = haversineKm(lat0, lon0, sensors[i].latitude, sensors[i].longitude);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const s = sensors[bestI];
    closest = { lat: s.latitude, lon: s.longitude, pm25: s.pm25, distKm: bestD };
  }

  return { predPm25, predPm25Category, closest };
}
