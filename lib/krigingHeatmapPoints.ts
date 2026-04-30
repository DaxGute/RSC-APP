import { pm25ToAqi } from './aqiUtils';
import type { MapRegion } from './mapRegionFromData';
import type { CurrentKrigingRow } from './database.types';
import type { SensorPoint } from './sensorTypes';

export type HeatmapPoint = {
  latitude: number;
  longitude: number;
  pm25: number;
  weight: number;
  /** Value-scaled opacity [~0.35..1] so cleaner air remains visible but lighter. */
  intensityOpacity: number;
  /**
   * Splat opacity multiplier (~0.25–1), from each row’s `kriging_variance` when present.
   * Higher variance → lower opacity. 1 when variance data is unavailable (constant strength).
   */
  varianceOpacity: number;
};

/**
 * Fallback ~√N for splat radius heuristics in `StaticMapOverlay` when point count is unknown.
 * Does not define a raster grid — splats come one per `current_kriging` row.
 */
export const KRIGING_SPLAT_DENSITY_HINT = 34;

/**
 * One splat per `current_kriging` row at the pipeline’s **own** lat/lon — no IDW or
 * re-interpolation of kriging output. Always apply all valid rows so the current
 * kriging surface fully reflects the fetched dataset.
 */
export function buildKrigingHeatmapPoints(
  kriging: CurrentKrigingRow[],
  _region: MapRegion,
  sensorAnchors: SensorPoint[] = [],
): HeatmapPoint[] {
  const latMin = _region.latitude - _region.latitudeDelta / 2;
  const latMax = _region.latitude + _region.latitudeDelta / 2;
  const lonMin = _region.longitude - _region.longitudeDelta / 2;
  const lonMax = _region.longitude + _region.longitudeDelta / 2;
  const inBounds = (lat: number, lon: number) =>
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

  const normalInBounds = kriging.reduce(
    (acc, row) => acc + (inBounds(row.latitude, row.longitude) ? 1 : 0),
    0,
  );
  const swappedInBounds = kriging.reduce(
    (acc, row) => acc + (inBounds(row.longitude, row.latitude) ? 1 : 0),
    0,
  );
  const shouldSwapLatLon = swappedInBounds > normalInBounds;

  const valid = kriging.filter(
    (p) =>
      p.pm25 != null &&
      Number.isFinite(p.pm25) &&
      Number.isFinite(shouldSwapLatLon ? p.longitude : p.latitude) &&
      Number.isFinite(shouldSwapLatLon ? p.latitude : p.longitude),
  );
  if (valid.length === 0) return [];
  const sources = valid;

  const variances = sources.map((p) =>
    p.kriging_variance != null && Number.isFinite(p.kriging_variance) ? p.kriging_variance : null,
  );
  const hasVariance = variances.some((v) => v != null);
  const finiteVars = variances.filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const maxVar = finiteVars.length > 0 ? Math.max(...finiteVars, 1e-12) : 0;
  const anchorPmValues = sensorAnchors
    .map((s) => s.pm25)
    .filter((pm): pm is number => Number.isFinite(pm) && pm >= 0);
  const maxPm = Math.max(...sources.map((p) => p.pm25 as number), ...anchorPmValues, 1e-9);

  const krigingPoints = sources.map((p) => {
    const pm = p.pm25 as number;
    const aqi = pm25ToAqi(pm);
    const w = aqi != null && Number.isFinite(aqi) ? Math.max(1, Math.min(500, aqi)) : 1;
    const intensityOpacity = Math.max(0.35, Math.min(1, 0.35 + 0.65 * (pm / maxPm)));

    let varianceOpacity = 1;
    if (hasVariance && maxVar > 0) {
      const v = p.kriging_variance;
      if (v != null && Number.isFinite(v) && v >= 0) {
        varianceOpacity = Math.max(0.25, 1 - Math.min(1, v / maxVar));
      } else {
        varianceOpacity = 0.35;
      }
    } else if (hasVariance) {
      varianceOpacity = 0.35;
    }

    return {
      latitude: shouldSwapLatLon ? p.longitude : p.latitude,
      longitude: shouldSwapLatLon ? p.latitude : p.longitude,
      pm25: pm,
      weight: w,
      intensityOpacity,
      varianceOpacity,
    };
  });

  // Anchor the rendered surface at measured sensor points so displayed values
  // at sensor coordinates match observations (kriging exactness behavior).
  const anchorPoints: HeatmapPoint[] = sensorAnchors
    .filter(
      (s) =>
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude) &&
        Number.isFinite(s.pm25) &&
        s.pm25 >= 0,
    )
    .map((s) => {
      const aqi = pm25ToAqi(s.pm25);
      const w = aqi != null && Number.isFinite(aqi) ? Math.max(1, Math.min(500, aqi)) : 1;
      return {
        latitude: s.latitude,
        longitude: s.longitude,
        pm25: s.pm25,
        weight: w,
        intensityOpacity: Math.max(0.35, Math.min(1, 0.35 + 0.65 * (s.pm25 / maxPm))),
        varianceOpacity: 1,
      };
    });

  return [...krigingPoints, ...anchorPoints];
}

export { EPA_AQI_HEATMAP_GRADIENT } from './aqiUtils';
