import { pm25BreakpointCategory, type Pm25Category } from './aqiUtils';
import { PM25_CONTOUR_THRESHOLDS } from './airQualityBreakpoints';
import type { Pm25GridMeta } from './modeling/gridMath';
import { lonLatToGridXY } from './modeling/gridMath';

/** Set to `true` to log tap samples near EPA PM2.5 contour breakpoints. */
export const PM25_TAP_GRID_DEBUG = false;

const NEAR_BREAKPOINT_UG = 0.25;

function nearestContourBreakpoint(pm25: number): { value: number; distance: number } | null {
  if (!Number.isFinite(pm25)) return null;
  let best: { value: number; distance: number } | null = null;
  for (const bp of PM25_CONTOUR_THRESHOLDS) {
    const distance = Math.abs(pm25 - bp);
    if (best == null || distance < best.distance) {
      best = { value: bp, distance };
    }
  }
  return best;
}

export function maybeLogPm25TapNearBreakpoint(
  lat: number,
  lon: number,
  sampledPm25: number,
  gridMeta: Pm25GridMeta,
): void {
  if (!PM25_TAP_GRID_DEBUG) return;
  const nearest = nearestContourBreakpoint(sampledPm25);
  if (nearest == null || nearest.distance > NEAR_BREAKPOINT_UG) return;

  const gridXY = lonLatToGridXY(lat, lon, gridMeta);
  const category: Pm25Category = pm25BreakpointCategory(sampledPm25);

  console.log('[PM25 tap grid debug]', {
    sampledPm25,
    category: category.label,
    nearestBreakpoint: nearest.value,
    distanceToBreakpoint: nearest.distance,
    tapLat: lat,
    tapLon: lon,
    gridX: gridXY.x,
    gridY: gridXY.y,
  });
}
