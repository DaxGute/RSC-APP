/**
 * Canonical air-quality breakpoint and color definitions.
 * Single source of truth for both AQI index and PM2.5 concentration categories.
 */

export type AqiCategory = { label: string; bg: string; fg: string };

type AqiCategoryBandDef = {
  label: string;
  indexLo: number;
  /** Inclusive upper bound; `null` = open-ended (301+). */
  indexHi: number | null;
  bg: string;
  fg: string;
};

/** Six AQI index bands: 0-50, 51-100, 101-150, 151-200, 201-300, 301+. */
export const AQI_CATEGORY_BANDS: readonly AqiCategoryBandDef[] = [
  {
    label: 'Good',
    indexLo: 0,
    indexHi: 50,
    bg: '#00E400',
    fg: '#111827',
  },
  {
    label: 'Moderate',
    indexLo: 51,
    indexHi: 100,
    bg: '#FFFF00',
    fg: '#111827',
  },
  {
    label: 'Unhealthy for Sensitive Groups',
    indexLo: 101,
    indexHi: 150,
    bg: '#FF7E00',
    fg: '#111827',
  },
  {
    label: 'Unhealthy',
    indexLo: 151,
    indexHi: 200,
    bg: '#FF0000',
    fg: '#FFFFFF',
  },
  {
    label: 'Very Unhealthy',
    indexLo: 201,
    indexHi: 300,
    bg: '#8F3F97',
    fg: '#FFFFFF',
  },
  {
    label: 'Hazardous',
    indexLo: 301,
    indexHi: null,
    bg: '#7E0023',
    fg: '#FFFFFF',
  },
] as const;

/** Monotonic index edges: 0 plus each finite category upper bound. */
export const AQI_BREAKPOINT_EDGES: readonly number[] = [
  0,
  ...AQI_CATEGORY_BANDS.map((b) => b.indexHi).filter((h): h is number => h != null),
];

/** Inclusive upper bound per category. Hazardous uses `Infinity`. */
export const AQI_CATEGORY_UPPER_BOUNDS: readonly number[] = AQI_CATEGORY_BANDS.map((b) =>
  b.indexHi ?? Number.POSITIVE_INFINITY,
);

/** Slider / conversion clamp for AQI index (EPA scale tops out at 500). */
export const AQI_INDEX_MAX = 500;

/** @deprecated Prefer `AQI_INDEX_MAX`. */
export const EPA_AQI_INDEX_MAX = AQI_INDEX_MAX;

export const AQI_CATEGORY_COLORS: readonly string[] = AQI_CATEGORY_BANDS.map((b) => b.bg);

const PM25_AQI_BREAKPOINTS: readonly [number, number, number, number][] = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 400],
  [325.5, 500.4, 401, 500],
];

export function pm25ToAqi(pm25UgM3: number | null | undefined): number | null {
  if (pm25UgM3 == null) return null;
  const raw = Number(pm25UgM3);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const c = Math.floor(raw * 10) / 10;

  for (const [cLo, cHi, iLo, iHi] of PM25_AQI_BREAKPOINTS) {
    if (c >= cLo && c <= cHi) {
      const aqi = ((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo;
      return Math.round(aqi);
    }
  }
  if (c > 500.4) return AQI_INDEX_MAX;
  return null;
}

/** Inverse of `pm25ToAqi` within EPA concentration breakpoint segments (rounded AQI in). */
export function aqiToPm25(aqi: number | null | undefined): number | null {
  if (aqi == null || !Number.isFinite(Number(aqi))) return null;
  const a = Math.round(Number(aqi));
  const clamped = Math.max(0, Math.min(AQI_INDEX_MAX, a));

  for (const [cLo, cHi, iLo, iHi] of PM25_AQI_BREAKPOINTS) {
    if (clamped >= iLo && clamped <= iHi) {
      const pm25 = ((cHi - cLo) / (iHi - iLo)) * (clamped - iLo) + cLo;
      return Math.floor(pm25 * 10) / 10;
    }
  }
  if (clamped <= 0) return 0;
  return 500.4;
}

/** Lower bounds per band for heatmap gradients and reminders (51, 101, ...). */
export const AQI_CATEGORY_LOWER_BOUNDS: readonly number[] = AQI_CATEGORY_BANDS.map((b) => b.indexLo);

/**
 * Legacy shape `{ lo, hi, cat }` - `hi` uses `AQI_INDEX_MAX` when the band is open-ended.
 */
export const EPA_AQI_CATEGORY_BANDS: readonly { lo: number; hi: number; cat: AqiCategory }[] =
  AQI_CATEGORY_BANDS.map((b) => ({
    lo: b.indexLo,
    hi: b.indexHi ?? AQI_INDEX_MAX,
    cat: { label: b.label, bg: b.bg, fg: b.fg },
  }));

const AQI_UNKNOWN: AqiCategory = { label: 'Unknown', bg: '#E5E7EB', fg: '#111827' };

function aqiBandToCategory(band: AqiCategoryBandDef): AqiCategory {
  return { label: band.label, bg: band.bg, fg: band.fg };
}

function aqiInBand(aqi: number, band: AqiCategoryBandDef): boolean {
  if (aqi < band.indexLo) return false;
  if (band.indexHi == null) return true;
  return aqi <= band.indexHi;
}

export function formatAqiIndexRange(band: Pick<AqiCategoryBandDef, 'indexLo' | 'indexHi'>): string {
  if (band.indexHi == null) return `AQI ${band.indexLo}+`;
  return `AQI ${band.indexLo}-${band.indexHi}`;
}

export function aqiCategory(aqi: number | null | undefined): AqiCategory {
  if (aqi == null || !Number.isFinite(Number(aqi))) return AQI_UNKNOWN;
  const a = Math.round(Number(aqi));
  for (const band of AQI_CATEGORY_BANDS) {
    if (aqiInBand(a, band)) return aqiBandToCategory(band);
  }
  if (a < 0) return aqiBandToCategory(AQI_CATEGORY_BANDS[0]);
  return aqiBandToCategory(AQI_CATEGORY_BANDS[AQI_CATEGORY_BANDS.length - 1]);
}

/** Bin index 0 ... `AQI_CATEGORY_BANDS.length - 1`. */
export function aqiCategoryBinIndex(aqi: number): number {
  const a = Math.round(aqi);
  for (let i = 0; i < AQI_CATEGORY_UPPER_BOUNDS.length; i++) {
    if (a <= AQI_CATEGORY_UPPER_BOUNDS[i]) return i;
  }
  return AQI_CATEGORY_BANDS.length - 1;
}

/**
 * Google Maps heatmap gradient: AQI index category colors.
 * `startPoints` are lower bounds of each band on the 0-`AQI_INDEX_MAX` scale.
 */
export const AQI_HEATMAP_GRADIENT = {
  colorMapSize: 256,
  colors: AQI_CATEGORY_COLORS,
  startPoints: AQI_CATEGORY_LOWER_BOUNDS.map((lo) => lo / AQI_INDEX_MAX),
} as const;

/** @deprecated Prefer `AQI_HEATMAP_GRADIENT`. */
export const EPA_AQI_HEATMAP_GRADIENT = AQI_HEATMAP_GRADIENT;

/**
 * AQI index for push reminders - aligns with `aqiMeetsReminderThreshold`.
 * Band 0 -> threshold above "Good" (51); other bands use that category's lower bound.
 */
export function reminderBandToAqiThreshold(bandIndex: number): number {
  if (bandIndex <= 0) return AQI_CATEGORY_BANDS[1]?.indexLo ?? 51;
  return AQI_CATEGORY_BANDS[bandIndex]?.indexLo ?? AQI_CATEGORY_BANDS[1].indexLo;
}

export function aqiMeetsReminderThreshold(aqi: number | null | undefined, bandIndex: number): boolean {
  if (aqi == null || !Number.isFinite(Number(aqi))) return false;
  const a = Math.round(Number(aqi));
  const goodHi = AQI_CATEGORY_BANDS[0].indexHi;
  if (bandIndex <= 0) return goodHi != null && a > goodHi;
  const band = AQI_CATEGORY_BANDS[bandIndex];
  if (!band) return false;
  return a >= band.indexLo;
}

export type Pm25Category = { label: string; bg: string; fg: string; ring: string };

type Pm25CategoryBandDef = {
  label: string;
  concentrationLo: number;
  /** Inclusive upper bound; `null` = open-ended (Hazardous). */
  concentrationHi: number | null;
  bg: string;
  fg: string;
  ring: string;
};

/** Updated PM2.5 category bands aligned to AQI category colors. */
export const PM25_CATEGORY_BANDS: readonly Pm25CategoryBandDef[] = [
  {
    label: 'Good',
    concentrationLo: 0.0,
    concentrationHi: 9.0,
    bg: '#00E400',
    fg: '#111111',
    ring: 'rgba(0,228,0,0.22)',
  },
  {
    label: 'Moderate',
    concentrationLo: 9.1,
    concentrationHi: 35.4,
    bg: '#FFFF00',
    fg: '#111111',
    ring: 'rgba(255,255,0,0.24)',
  },
  {
    label: 'Unhealthy for Sensitive Groups',
    concentrationLo: 35.5,
    concentrationHi: 55.4,
    bg: '#FF7E00',
    fg: '#111111',
    ring: 'rgba(255,126,0,0.24)',
  },
  {
    label: 'Unhealthy',
    concentrationLo: 55.5,
    concentrationHi: 125.4,
    bg: '#FF0000',
    fg: '#FFFFFF',
    ring: 'rgba(255,0,0,0.22)',
  },
  {
    label: 'Very Unhealthy',
    concentrationLo: 125.5,
    concentrationHi: 225.4,
    bg: '#8F3F97',
    fg: '#FFFFFF',
    ring: 'rgba(143,63,151,0.22)',
  },
  {
    label: 'Hazardous',
    concentrationLo: 225.5,
    concentrationHi: null,
    bg: '#7E0023',
    fg: '#FFFFFF',
    ring: 'rgba(126,0,35,0.22)',
  },
] as const;

/** Monotonic ug/m3 edges: 0 plus each finite category upper bound. */
export const PM25_BREAKPOINT_EDGES: readonly number[] = [
  0,
  ...PM25_CATEGORY_BANDS.map((b) => b.concentrationHi).filter((h): h is number => h != null),
];

/** Inclusive upper bound per category (for binning). Hazardous uses `Infinity`. */
export const PM25_CATEGORY_UPPER_BOUNDS: readonly number[] = PM25_CATEGORY_BANDS.map((b) =>
  b.concentrationHi ?? Number.POSITIVE_INFINITY,
);

export const PM25_CATEGORY_LOWER_BOUNDS: readonly number[] = PM25_CATEGORY_BANDS.map((b) => b.concentrationLo);

/** d3-contour thresholds at each band's lower bound (excludes 0). */
export const PM25_CONTOUR_THRESHOLDS: number[] = PM25_CATEGORY_LOWER_BOUNDS.slice(1);

/** Display-only cap for gradient/legend interpolation in the open-ended Hazardous band. */
export const PM25_GRADIENT_CLAMP_MAX = 325.4;

/** Legend/gradient edges: category edges plus display clamp for the top band. */
export const PM25_GRADIENT_EDGES: readonly number[] = [...PM25_BREAKPOINT_EDGES, PM25_GRADIENT_CLAMP_MAX];

/** @deprecated Prefer `PM25_GRADIENT_EDGES` or `PM25_BREAKPOINT_EDGES`. */
export const PM25_AQI_BOUNDS = PM25_GRADIENT_EDGES;

export const PM25_CATEGORY_COLORS: readonly string[] = PM25_CATEGORY_BANDS.map((b) => b.bg);

const PM25_NO_DATA: Pm25Category = {
  label: 'No data',
  bg: '#E5E7EB',
  fg: '#111827',
  ring: 'rgba(107,114,128,0.18)',
};

function pm25BandToCategory(band: Pm25CategoryBandDef): Pm25Category {
  return { label: band.label, bg: band.bg, fg: band.fg, ring: band.ring };
}

function pm25InBand(x: number, band: Pm25CategoryBandDef): boolean {
  if (x < band.concentrationLo) return false;
  if (band.concentrationHi == null) return true;
  return x <= band.concentrationHi;
}

export function pm25BreakpointCategory(pm25: number | null | undefined): Pm25Category {
  if (pm25 == null || !Number.isFinite(Number(pm25))) return PM25_NO_DATA;
  // Normalize to EPA reporting precision (0.1 µg/m³, truncated) so
  // category binning matches `pm25ToAqi` at boundaries like 9.0/9.1.
  const x = Math.floor(Number(pm25) * 10) / 10;
  for (const band of PM25_CATEGORY_BANDS) {
    if (pm25InBand(x, band)) return pm25BandToCategory(band);
  }
  return pm25BandToCategory(PM25_CATEGORY_BANDS[PM25_CATEGORY_BANDS.length - 1]);
}

/** Bin index 0 ... `PM25_CATEGORY_BANDS.length - 1` for kriging / contour maps. */
export function pm25CategoryBinIndex(pm25: number): number {
  const x = Math.floor(pm25 * 10) / 10;
  for (let i = 0; i < PM25_CATEGORY_UPPER_BOUNDS.length; i++) {
    const hi = PM25_CATEGORY_UPPER_BOUNDS[i];
    if (x <= hi) return i;
  }
  return PM25_CATEGORY_BANDS.length - 1;
}
