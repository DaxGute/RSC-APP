import {
  meanStd,
  PM25_CELL_COUNT,
  poolPm25Grid,
  poolWindFlat,
  quadrantMeans,
  type Pm25Grid2D,
  WIND_CELL_COUNT,
} from './gridMath';

export const FEATURE_POOL_SIZE = 4;
/** Per-dimension weights for analog distance (same order as buildProjectionFeatureVector). */
export const FEATURE_WEIGHTS = {
  pm25Mean: 2.5,
  pm25Std: 1.8,
  pm25Quadrant: 2.2,
  pm25Pool: 2.8,
  windMean: 1.4,
  windPool: 1.6,
  hourSinCos: 0.9,
} as const;

export type ProjectionFeatureVector = Float32Array;

const FEATURE_DIM =
  2 + 4 + FEATURE_POOL_SIZE * FEATURE_POOL_SIZE + 2 + FEATURE_POOL_SIZE * FEATURE_POOL_SIZE * 2 + 2;

export function featureVectorDimension(): number {
  return FEATURE_DIM;
}

export function hourOfDaySinCos(timeMs: number): [number, number] {
  const d = new Date(timeMs);
  const hour = d.getHours() + d.getMinutes() / 60;
  const angle = (2 * Math.PI * hour) / 24;
  return [Math.sin(angle), Math.cos(angle)];
}

export function buildProjectionFeatureVector(
  pm25: Pm25Grid2D,
  windU: Float32Array | null,
  windV: Float32Array | null,
  timeMs: number,
): ProjectionFeatureVector {
  const out = new Float32Array(FEATURE_DIM);
  let idx = 0;

  const { mean, std } = meanStd(pm25.values);
  out[idx++] = mean;
  out[idx++] = std;

  for (const q of quadrantMeans(pm25.values)) out[idx++] = q;
  for (const p of poolPm25Grid(pm25.values, FEATURE_POOL_SIZE)) out[idx++] = p;

  if (windU && windV && windU.length >= WIND_CELL_COUNT) {
    let su = 0;
    let sv = 0;
    for (let i = 0; i < WIND_CELL_COUNT; i += 1) {
      su += windU[i];
      sv += windV[i];
    }
    out[idx++] = su / WIND_CELL_COUNT;
    out[idx++] = sv / WIND_CELL_COUNT;
    for (const w of poolWindFlat(windU, windV, FEATURE_POOL_SIZE)) out[idx++] = w;
  } else {
    idx += 2;
    idx += FEATURE_POOL_SIZE * FEATURE_POOL_SIZE * 2;
  }

  const [sinH, cosH] = hourOfDaySinCos(timeMs);
  out[idx++] = sinH;
  out[idx++] = cosH;

  return out;
}

/** Index ranges for weighted distance (start inclusive, end exclusive). */
const FEATURE_RANGES: Array<{ start: number; end: number; weight: number }> = (() => {
  let i = 0;
  const ranges: Array<{ start: number; end: number; weight: number }> = [];
  ranges.push({ start: i, end: (i += 2), weight: FEATURE_WEIGHTS.pm25Mean });
  ranges.push({ start: i, end: (i += 4), weight: FEATURE_WEIGHTS.pm25Quadrant });
  ranges.push({
    start: i,
    end: (i += FEATURE_POOL_SIZE * FEATURE_POOL_SIZE),
    weight: FEATURE_WEIGHTS.pm25Pool,
  });
  ranges.push({ start: i, end: (i += 2), weight: FEATURE_WEIGHTS.windMean });
  ranges.push({
    start: i,
    end: (i += FEATURE_POOL_SIZE * FEATURE_POOL_SIZE * 2),
    weight: FEATURE_WEIGHTS.windPool,
  });
  ranges.push({ start: i, end: (i += 2), weight: FEATURE_WEIGHTS.hourSinCos });
  return ranges;
})();

export function weightedFeatureDistance(a: ProjectionFeatureVector, b: ProjectionFeatureVector): number {
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
