import {
  PM25_GRADIENT_CLAMP_MAX,
  PM25_GRADIENT_EDGES,
  PM25_CATEGORY_COLORS,
  pm25BreakpointCategory,
} from './airQualityBreakpoints';

export { PM25_AQI_BOUNDS, PM25_GRADIENT_EDGES, PM25_BREAKPOINT_EDGES } from './airQualityBreakpoints';

export type Pm25LegendBand = {
  flex: number;
  label: string;
  bg: string;
  fg: string;
};

function mergeAdjacentSameCategory(bands: Pm25LegendBand[]): Pm25LegendBand[] {
  const out: Pm25LegendBand[] = [];
  for (const b of bands) {
    const prev = out[out.length - 1];
    if (prev && prev.label === b.label && prev.bg === b.bg) {
      prev.flex += b.flex;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/**
 * Visible PM2.5 legend segments from 0 to `maxPm` (µg/m³), canonical category colors.
 * High PM2.5 first (top of column). Values above the last breakpoint use the top category.
 */
export function buildPm25LegendBands(maxPm: number): Pm25LegendBand[] {
  const max = Math.max(0, Number.isFinite(maxPm) ? maxPm : 0);
  const bounds = PM25_GRADIENT_EDGES;
  const cap = bounds[bounds.length - 1];

  if (max <= 0) {
    const cat = pm25BreakpointCategory(0);
    return [{ flex: 1, label: cat.label, bg: cat.bg, fg: cat.fg }];
  }

  const acc: Pm25LegendBand[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i];
    const hi = bounds[i + 1];
    const segLo = Math.max(lo, 0);
    const segHi = Math.min(hi, max);
    if (segHi <= segLo + 1e-9) continue;
    const mid = (lo + hi) / 2;
    const cat = pm25BreakpointCategory(mid);
    acc.push({ flex: segHi - segLo, label: cat.label, bg: cat.bg, fg: cat.fg });
  }

  if (max > cap + 1e-9) {
    const cat = pm25BreakpointCategory(cap + 1);
    acc.push({ flex: max - cap, label: cat.label, bg: cat.bg, fg: cat.fg });
  }

  const merged = mergeAdjacentSameCategory(acc);
  return merged.slice().reverse();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Piecewise-linear color between PM2.5 bands (display only). */
export function pm25ToGradientColor(pm25: number | null | undefined): string {
  if (pm25 == null || !Number.isFinite(pm25)) return '#94a3b8';
  const v = clamp(pm25, 0, PM25_GRADIENT_CLAMP_MAX);
  const b = PM25_GRADIENT_EDGES;
  let i = 0;
  for (let k = 0; k < b.length - 1; k++) {
    if (v >= b[k] && v <= b[k + 1]) {
      i = k;
      break;
    }
    if (v > b[k + 1]) i = k + 1;
  }
  i = clamp(i, 0, b.length - 2);
  const t = (v - b[i]) / Math.max(1e-9, b[i + 1] - b[i]);
  if (i + 1 >= PM25_CATEGORY_COLORS.length) {
    return PM25_CATEGORY_COLORS[PM25_CATEGORY_COLORS.length - 1];
  }
  return interpolateHex(PM25_CATEGORY_COLORS[i], PM25_CATEGORY_COLORS[i + 1], clamp(t, 0, 1));
}

function interpolateHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(bl)}`;
}
