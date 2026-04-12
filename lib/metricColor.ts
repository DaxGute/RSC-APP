import { aqiCategory } from './aqiUtils';
import { pm25ToGradientColor } from './pm25ColorScale';

export type MetricColorFn = (value: number) => string;

/** EPA AQI category fill color (AirNow-style). */
export function getColorFromAqi(value: number): string {
  if (!Number.isFinite(value)) return '#94a3b8';
  return aqiCategory(value).bg;
}

/** Smooth PM2.5 scale (µg/m³) using legend breakpoints. */
export function getColorFromPm25(value: number): string {
  return pm25ToGradientColor(value);
}
