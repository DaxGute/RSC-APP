/**
 * US EPA AQI from PM2.5 and category styling — ported from SSF-AQI `aqi_utils.py` / `aqi_panel.py`.
 */

export type AqiCategory = { label: string; bg: string; fg: string };

/** US EPA AQI index bands (AirNow colors) — same order as heatmap / panel categories. */
export const EPA_AQI_CATEGORY_BANDS: readonly { lo: number; hi: number; cat: AqiCategory }[] = [
  { lo: 0, hi: 50, cat: { label: 'Good', bg: '#00E400', fg: '#111827' } },
  { lo: 51, hi: 100, cat: { label: 'Moderate', bg: '#FFFF00', fg: '#111827' } },
  { lo: 101, hi: 150, cat: { label: 'Unhealthy for Sensitive Groups', bg: '#FF7E00', fg: '#111827' } },
  { lo: 151, hi: 200, cat: { label: 'Unhealthy', bg: '#FF0000', fg: '#FFFFFF' } },
  { lo: 201, hi: 300, cat: { label: 'Very Unhealthy', bg: '#8F3F97', fg: '#FFFFFF' } },
  { lo: 301, hi: 500, cat: { label: 'Hazardous', bg: '#7E0023', fg: '#FFFFFF' } },
] as const;

const AQI_CATEGORIES: { lo: number; hi: number; cat: AqiCategory }[] = [...EPA_AQI_CATEGORY_BANDS];

/** US EPA AQI index upper end used for heatmap normalization (standard scale). */
export const EPA_AQI_INDEX_MAX = 500;

/**
 * Google Maps heatmap gradient: official **AQI index** category colors (AirNow / EPA communication colors).
 * `startPoints` are the lower bounds of each AQI category (0, 51, 101, …) on the 0–500 index scale.
 *
 * PM2.5→AQI uses the EPA breakpoint table in `pm25ToAqi` (NowCast / daily AQI TAD).
 *
 * @see https://www.airnow.gov/aqi/aqi-basics/
 * @see https://www.epa.gov/system/files/documents/2024-02/aqi-technical-assistance-document-sept2018.pdf
 */
export const EPA_AQI_HEATMAP_GRADIENT = {
  colorMapSize: 256,
  colors: AQI_CATEGORIES.map((row) => row.cat.bg),
  startPoints: [
    0 / EPA_AQI_INDEX_MAX,
    51 / EPA_AQI_INDEX_MAX,
    101 / EPA_AQI_INDEX_MAX,
    151 / EPA_AQI_INDEX_MAX,
    201 / EPA_AQI_INDEX_MAX,
    301 / EPA_AQI_INDEX_MAX,
  ],
};

/**
 * True when observed AQI is at least as bad as the chosen band index (0 = Good … 5 = Hazardous).
 * Band 0 means “worse than Good” (AQI above 50). Other bands use the EPA lower bound for that category.
 */
/**
 * AQI index stored with push settings — aligns with `aqiMeetsReminderThreshold` (band 0 → above “Good”).
 */
export function reminderBandToAqiThreshold(bandIndex: number): number {
  if (bandIndex <= 0) return 51;
  const row = EPA_AQI_CATEGORY_BANDS[bandIndex];
  return row?.lo ?? 51;
}

export function aqiMeetsReminderThreshold(aqi: number | null | undefined, bandIndex: number): boolean {
  if (aqi == null || !Number.isFinite(Number(aqi))) return false;
  const a = Math.round(Number(aqi));
  if (bandIndex <= 0) return a > 50;
  const row = EPA_AQI_CATEGORY_BANDS[bandIndex];
  if (!row) return false;
  return a >= row.lo;
}

export function aqiCategory(aqi: number | null | undefined): AqiCategory {
  if (aqi == null || !Number.isFinite(Number(aqi))) {
    return { label: 'Unknown', bg: '#E5E7EB', fg: '#111827' };
  }
  const a = Math.round(Number(aqi));
  for (const row of AQI_CATEGORIES) {
    if (a >= row.lo && a <= row.hi) return row.cat;
  }
  if (a < 0) return AQI_CATEGORIES[0].cat;
  return AQI_CATEGORIES[AQI_CATEGORIES.length - 1].cat;
}

export function pm25ToAqi(pm25UgM3: number | null | undefined): number | null {
  if (pm25UgM3 == null) return null;
  const raw = Number(pm25UgM3);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const c = Math.floor(raw * 10) / 10;

  const bps: [number, number, number, number][] = [
    [0.0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];

  for (const [cLo, cHi, iLo, iHi] of bps) {
    if (c >= cLo && c <= cHi) {
      const aqi = ((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo;
      return Math.round(aqi);
    }
  }
  if (c > 500.4) return 500;
  return null;
}

export type Pm25Category = { label: string; bg: string; fg: string; ring: string };

export function pm25BreakpointCategory(pm25: number | null | undefined): Pm25Category {
  if (pm25 == null || !Number.isFinite(Number(pm25))) {
    return { label: 'No data', bg: '#E5E7EB', fg: '#111827', ring: 'rgba(107,114,128,0.18)' };
  }
  const x = Number(pm25);
  if (x <= 9.0) return { label: 'Good', bg: '#00E400', fg: '#111111', ring: 'rgba(0,228,0,0.22)' };
  if (x <= 35.4) return { label: 'Moderate', bg: '#FFFF00', fg: '#111111', ring: 'rgba(255,255,0,0.24)' };
  if (x <= 55.4)
    return { label: 'Unhealthy for Sensitive Groups', bg: '#FF7E00', fg: '#111111', ring: 'rgba(255,126,0,0.24)' };
  if (x <= 125.4) return { label: 'Unhealthy', bg: '#FF0000', fg: '#FFFFFF', ring: 'rgba(255,0,0,0.22)' };
  if (x <= 225.4) return { label: 'Very Unhealthy', bg: '#8F3F97', fg: '#FFFFFF', ring: 'rgba(143,63,151,0.22)' };
  return { label: 'Hazardous', bg: '#7E0023', fg: '#FFFFFF', ring: 'rgba(126,0,35,0.22)' };
}
