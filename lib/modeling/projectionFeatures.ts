import {
  meanStd,
  PM25_CELL_COUNT,
  poolPm25Grid,
  quadrantMeans,
  type Pm25Grid2D,
} from './gridMath';

export const FEATURE_POOL_SIZE = 4;

/** 2 summary + 4 quadrants + 16 pooled + 2 time-of-day */
export const PROJECTION_FEATURE_DIM =
  2 + 4 + FEATURE_POOL_SIZE * FEATURE_POOL_SIZE + 2;

/** Per-block weights for analog distance (same order as buildProjectionFeatureVector). */
export const FEATURE_WEIGHTS = {
  pm25MeanStd: 2.5,
  pm25Quadrant: 2.2,
  pm25Pool: 2.8,
  hourSinCos: 0.9,
} as const;

export type ProjectionFeatureVector = Float32Array;

export function featureVectorDimension(): number {
  return PROJECTION_FEATURE_DIM;
}

export function hourOfDaySinCos(timeMs: number): [number, number] {
  const d = new Date(timeMs);
  const hour = d.getHours() + d.getMinutes() / 60;
  const angle = (2 * Math.PI * hour) / 24;
  return [Math.sin(angle), Math.cos(angle)];
}

/** PM₂.₅ spatial pattern + hour-of-day (no wind — historical wind is not available for anchors). */
export function buildProjectionFeatureVector(
  pm25: Pm25Grid2D,
  timeMs: number,
): ProjectionFeatureVector {
  const out = new Float32Array(PROJECTION_FEATURE_DIM);
  let idx = 0;

  const { mean, std } = meanStd(pm25.values);
  out[idx++] = mean;
  out[idx++] = std;

  for (const q of quadrantMeans(pm25.values)) out[idx++] = q;
  for (const p of poolPm25Grid(pm25.values, FEATURE_POOL_SIZE)) out[idx++] = p;

  const [sinH, cosH] = hourOfDaySinCos(timeMs);
  out[idx++] = sinH;
  out[idx++] = cosH;

  return out;
}

function buildFeatureRanges(): Array<{ start: number; end: number; weight: number }> {
  let i = 0;
  const ranges: Array<{ start: number; end: number; weight: number }> = [];
  ranges.push({ start: i, end: (i += 2), weight: FEATURE_WEIGHTS.pm25MeanStd });
  ranges.push({ start: i, end: (i += 4), weight: FEATURE_WEIGHTS.pm25Quadrant });
  ranges.push({
    start: i,
    end: (i += FEATURE_POOL_SIZE * FEATURE_POOL_SIZE),
    weight: FEATURE_WEIGHTS.pm25Pool,
  });
  ranges.push({ start: i, end: (i += 2), weight: FEATURE_WEIGHTS.hourSinCos });
  if (i !== PROJECTION_FEATURE_DIM) {
    throw new Error(`Feature ranges (${i}) do not match PROJECTION_FEATURE_DIM (${PROJECTION_FEATURE_DIM})`);
  }
  return ranges;
}

const FEATURE_RANGES = buildFeatureRanges();

export function weightedFeatureDistance(a: ProjectionFeatureVector, b: ProjectionFeatureVector): number {
  const dim = featureVectorDimension();
  if (a.length !== dim || b.length !== dim) return Number.POSITIVE_INFINITY;

  let sum = 0;
  for (const { start, end, weight } of FEATURE_RANGES) {
    for (let i = start; i < end; i += 1) {
      const d = a[i] - b[i];
      sum += weight * d * d;
    }
  }
  return sum;
}

export { PM25_CELL_COUNT };
