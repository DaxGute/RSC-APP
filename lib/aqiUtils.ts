/**
 * US EPA AQI from PM2.5 — ported from SSF-AQI `aqi_utils.py` / `aqi_panel.py`.
 * Index category breakpoints live in `airQualityBreakpoints.ts`.
 */

export {
  AQI_BREAKPOINT_EDGES,
  AQI_CATEGORY_BANDS,
  AQI_CATEGORY_COLORS,
  AQI_CATEGORY_LOWER_BOUNDS,
  AQI_CATEGORY_UPPER_BOUNDS,
  AQI_HEATMAP_GRADIENT,
  AQI_INDEX_MAX,
  EPA_AQI_CATEGORY_BANDS,
  EPA_AQI_HEATMAP_GRADIENT,
  EPA_AQI_INDEX_MAX,
  aqiToPm25,
  aqiCategory,
  aqiCategoryBinIndex,
  aqiMeetsReminderThreshold,
  formatAqiIndexRange,
  pm25ToAqi,
  reminderBandToAqiThreshold,
  type AqiCategory,
} from './airQualityBreakpoints';

export { pm25BreakpointCategory, type Pm25Category } from './airQualityBreakpoints';
