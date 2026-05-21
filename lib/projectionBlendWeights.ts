export type BlendWeights = {
  current: number;
  trend: number;
  wind: number;
};

/** Wind advection is primary for short horizons; trend dominates far out (hourly steps). */
const BLEND_ANCHORS: Array<{ minutes: number } & BlendWeights> = [
  { minutes: 0, current: 1, wind: 0, trend: 0 },
  { minutes: 60, current: 0.05, wind: 0.5, trend: 0.45 },
  { minutes: 120, current: 0.03, wind: 0.42, trend: 0.55 },
  { minutes: 180, current: 0, wind: 0.3, trend: 0.7 },
  { minutes: 240, current: 0, wind: 0.25, trend: 0.75 },
  { minutes: 300, current: 0, wind: 0.2, trend: 0.8 },
];

function normalizeWeights(w: BlendWeights): BlendWeights {
  const sum = w.current + w.trend + w.wind;
  if (!(sum > 0)) return { current: 1, trend: 0, wind: 0 };
  return {
    current: w.current / sum,
    trend: w.trend / sum,
    wind: w.wind / sum,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smoothly interpolate blend weights between horizon anchors. */
export function blendWeightsForMinutes(minutesAhead: number): BlendWeights {
  const m = Math.max(0, minutesAhead);
  if (m <= BLEND_ANCHORS[0].minutes) {
    return normalizeWeights({ ...BLEND_ANCHORS[0] });
  }
  for (let i = 1; i < BLEND_ANCHORS.length; i += 1) {
    const hi = BLEND_ANCHORS[i];
    const lo = BLEND_ANCHORS[i - 1];
    if (m <= hi.minutes) {
      const span = hi.minutes - lo.minutes;
      const t = span > 0 ? (m - lo.minutes) / span : 1;
      return normalizeWeights({
        current: lerp(lo.current, hi.current, t),
        trend: lerp(lo.trend, hi.trend, t),
        wind: lerp(lo.wind, hi.wind, t),
      });
    }
  }
  return normalizeWeights({ ...BLEND_ANCHORS[BLEND_ANCHORS.length - 1] });
}
