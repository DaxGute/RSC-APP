import { aqiCategory, pm25BreakpointCategory, pm25ToAqi } from './airQualityBreakpoints';

export type MetricColorFn = (value: number) => string;

/** EPA AQI category fill color (AirNow-style). */
export function getColorFromAqi(value: number): string {
  if (!Number.isFinite(value)) return '#94a3b8';
  return aqiCategory(value).bg;
}

/** PM2.5 category color from canonical breakpoints (single source of truth). */
export function getColorFromPm25(value: number): string {
  if (!Number.isFinite(value)) return '#94a3b8';
  // Keep PM2.5 colors category-equivalent to AQI categories on metric toggle.
  const asAqi = pm25ToAqi(value);
  if (asAqi != null) return aqiCategory(asAqi).bg;
  return pm25BreakpointCategory(value).bg;
}
