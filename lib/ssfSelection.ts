import type { CurrentKrigingRow } from './database.types';
import { haversineKm } from './geoUtils';
import { rowsToPm25Grid2D, sampleBilinearGrid } from './modeling/gridMath';
import { resolveHeatmapGridRows } from './resolveHeatmapGrid';
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

  // Sample the same continuous PM2.5 surface used by the rendered overlay.
  const sharedRows = resolveHeatmapGridRows({ kriging, sensors });
  const sharedGrid = rowsToPm25Grid2D(sharedRows);
  const predPm25: number | null = sharedGrid
    ? sampleBilinearGrid(sharedGrid.values, lat0, lon0, sharedGrid)
    : null;

  const predPm25Category = pm25BreakpointCategory(predPm25);

  return { predPm25, predPm25Category, closest };
}
