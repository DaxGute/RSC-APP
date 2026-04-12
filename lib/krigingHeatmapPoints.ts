import { pm25ToAqi } from './aqiUtils';
import type { MapRegion } from './mapRegionFromData';
import type { CurrentKrigingRow } from './database.types';
import { idwPoint, idwPointDual } from './geoUtils';

export type HeatmapPoint = {
  latitude: number;
  longitude: number;
  weight: number;
  /**
   * Splat opacity multiplier (0–1), proportional to interpolated kriging variance
   * within the grid. 1 when variance data is unavailable (constant strength).
   */
  varianceOpacity: number;
};

/** Grid density: GRID×GRID points span the full visible map (edge to edge). */
export const KRIGING_HEATMAP_GRID = 34;

/**
 * Builds heatmap points on a full **lat/lon grid** over `region`.
 * Interpolates PM2.5 (IDW), converts to **US EPA AQI** via `pm25ToAqi`, and uses AQI as heatmap weight
 * so the layer colors track EPA category colors (`EPA_AQI_HEATMAP_GRADIENT`).
 */
export function buildKrigingHeatmapPoints(kriging: CurrentKrigingRow[], region: MapRegion): HeatmapPoint[] {
  const sources = kriging.filter(
    (p) =>
      p.pm25 != null &&
      Number.isFinite(p.pm25) &&
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude),
  );
  if (sources.length === 0) return [];

  const xs = sources.map((p) => p.longitude);
  const ys = sources.map((p) => p.latitude);
  const vs = sources.map((p) => p.pm25 as number);
  const variances = sources.map((p) =>
    p.kriging_variance != null && Number.isFinite(p.kriging_variance) ? p.kriging_variance : null,
  );
  const hasVariance = variances.some((v) => v != null);

  const latMin = region.latitude - region.latitudeDelta / 2;
  const latMax = region.latitude + region.latitudeDelta / 2;
  const lonMin = region.longitude - region.longitudeDelta / 2;
  const lonMax = region.longitude + region.longitudeDelta / 2;

  const raw: { latitude: number; longitude: number; weight: number; varInterp: number | null }[] = [];
  for (let i = 0; i < KRIGING_HEATMAP_GRID; i++) {
    for (let j = 0; j < KRIGING_HEATMAP_GRID; j++) {
      const lat = latMin + ((i + 0.5) / KRIGING_HEATMAP_GRID) * (latMax - latMin);
      const lon = lonMin + ((j + 0.5) / KRIGING_HEATMAP_GRID) * (lonMax - lonMin);

      let pm: number | null;
      let varInterp: number | null = null;
      if (hasVariance) {
        const d = idwPointDual(xs, ys, vs, variances, lon, lat);
        pm = d.primary;
        varInterp = d.secondary;
      } else {
        pm = idwPoint(xs, ys, vs, lon, lat);
      }

      const aqi = pm25ToAqi(pm);
      const w = aqi != null && Number.isFinite(aqi) ? Math.max(1, Math.min(500, aqi)) : 1;
      raw.push({ latitude: lat, longitude: lon, weight: w, varInterp });
    }
  }

  const finiteVars = raw
    .map((r) => r.varInterp)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const maxVar = finiteVars.length > 0 ? Math.max(...finiteVars, 1e-12) : 0;

  return raw.map((r) => {
    let varianceOpacity = 1;
    if (hasVariance && maxVar > 0 && r.varInterp != null && Number.isFinite(r.varInterp)) {
      const v = Math.max(0, r.varInterp);
      varianceOpacity = Math.min(1, v / maxVar);
    } else if (hasVariance) {
      varianceOpacity = 0.35;
    }
    return {
      latitude: r.latitude,
      longitude: r.longitude,
      weight: r.weight,
      varianceOpacity,
    };
  });
}

export { EPA_AQI_HEATMAP_GRADIENT } from './aqiUtils';
