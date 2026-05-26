/**
 * Health impact estimates shown on the map AQI panel (?) and Education tab explorer.
 * PM2.5-scaled rows match `AqiPanel` / SSF-AQI literature scaling.
 */

export const AQI_HEALTH_PAPER_URL =
  'https://www.sciencedirect.com/science/article/pii/S0160412020318316';

export const BMJ_PM25_HOSPITAL_ER_URL = 'https://www.bmj.com/content/384/bmj-2023-076322';

export const OUTDOOR_MASK_PAPER_URL =
  'https://www.sciencedirect.com/science/article/abs/pii/S1309104223001940';

export const INDOOR_FILTER_PAPER_URL =
  'https://www.sciencedirect.com/science/article/abs/pii/S0048969720361143';

/** Outdoor mask efficacy — fixed pooled estimate (does not scale with PM2.5). */
export const OUTDOOR_MASK_EFFICACY_PCT = 72;
export const OUTDOOR_MASK_CI_LO_PCT = 43;
export const OUTDOOR_MASK_CI_HI_PCT = 86;

/** Indoor filter efficacy — fixed pooled estimate (does not scale with PM2.5). */
export const INDOOR_FILTER_EFFICACY_PCT = 57;
export const INDOOR_FILTER_CI_LO_PCT = 22.6;
export const INDOOR_FILTER_CI_HI_PCT = 92.0;

/**
 * Meta-analysis (short-term PM2.5): effect scaled from +65% / ±21% per +10 µg/m³; values are divided by 100
 * so displayed percentages match the literature scale used in the UI.
 */
export function mortalityPercentFromInterpolatedPm25(
  pm25UgM3: number | null | undefined,
): { pct: number; uncPct: number } | null {
  if (pm25UgM3 == null || !Number.isFinite(pm25UgM3) || pm25UgM3 <= 0) return null;
  const per10 = pm25UgM3 / 10;
  return { pct: (per10 * 65) / 100, uncPct: (per10 * 21) / 100 };
}

/** Linear scale of per–10 µg/m³ effect to current interpolated µg/m³. */
export function scalePer10ug(
  pm25UgM3: number | null | undefined,
  per10: number,
  per10Lo: number,
  per10Hi: number,
): { mid: number; lo: number; hi: number } | null {
  if (pm25UgM3 == null || !Number.isFinite(pm25UgM3) || pm25UgM3 <= 0) return null;
  const k = pm25UgM3 / 10;
  return { mid: k * per10, lo: k * per10Lo, hi: k * per10Hi };
}

export function formatSmallPct(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

export function formatCiPct(lo: number, hi: number): string {
  return `${lo.toFixed(2)}–${hi.toFixed(2)}%`;
}

/** BMJ respiratory ED visits — excess relative risk per +10 µg/m³ two-day PM2.5. */
export function erVisitRateFromPm25(pm25UgM3: number | null | undefined) {
  return scalePer10ug(pm25UgM3, 1.34, 0.73, 1.94);
}
