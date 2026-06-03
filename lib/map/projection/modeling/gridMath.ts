/**
 * PM₂.₅ grid math for projection modeling: lat/lon ↔ contour index space,
 * bilinear sampling, wind advection warp, and kriging row round-trips.
 */

import type { CurrentKrigingRow } from '../../../shell/supabase';
import { HEATMAP_GRID_STEPS } from '../../recomputeKriging';

/** Side length of the square PM₂.₅ lattice (matches heatmap / kriging steps). */
export const PM25_GRID_SIZE = HEATMAP_GRID_STEPS;
/** Row-major cell count for flat `Float32Array` feature vectors. */
export const PM25_CELL_COUNT = PM25_GRID_SIZE * PM25_GRID_SIZE;

/** Approximate meters per degree latitude (WGS84 mid-latitude). */
const METERS_PER_DEG_LAT = 111_320;

/** PM₂.₅ field on ascending lat/lon axes with a single pipeline timestamp. */
export type Pm25Grid2D = {
  latAsc: number[];
  lonAsc: number[];
  values: number[][];
  time: string;
};

/** Geographic axes for PM2.5 grids (scalar samples at latAsc/lonAsc cell centers). */
export type Pm25GridMeta = Pick<Pm25Grid2D, 'latAsc' | 'lonAsc'>;

/**
 * Map lon/lat to continuous d3-contour grid coordinates.
 * x=0 → minLon (west), y=0 → maxLat (north); spans [0, n−1] × [0, m−1].
 */
export function lonLatToGridXY(
  lat: number,
  lon: number,
  meta: Pm25GridMeta,
): { x: number; y: number } {
  const { latAsc, lonAsc } = meta;
  const m = latAsc.length;
  const n = lonAsc.length;
  if (m < 2 || n < 2) return { x: 0, y: 0 };
  const latMin = latAsc[0];
  const latMax = latAsc[m - 1];
  const lonMin = lonAsc[0];
  const lonMax = lonAsc[n - 1];
  if (!(latMax > latMin) || !(lonMax > lonMin)) return { x: 0, y: 0 };
  const lonT = clamp((lon - lonMin) / (lonMax - lonMin), 0, 1);
  const latFromNorthT = clamp((latMax - lat) / (latMax - latMin), 0, 1);
  return {
    x: lonT * (n - 1),
    y: latFromNorthT * (m - 1),
  };
}

/** Inverse of `lonLatToGridXY` (contour index space → cell-center lon/lat). */
export function gridXYToLonLat(
  x: number,
  y: number,
  meta: Pm25GridMeta,
): { lat: number; lon: number } {
  const { latAsc, lonAsc } = meta;
  const m = latAsc.length;
  const n = lonAsc.length;
  const latMin = latAsc[0];
  const latMax = latAsc[m - 1];
  const lonMin = lonAsc[0];
  const lonMax = lonAsc[n - 1];
  if (m < 2 || n < 2) {
    return { lat: latAsc[0] ?? 0, lon: lonAsc[0] ?? 0 };
  }
  if (!(latMax > latMin) || !(lonMax > lonMin)) {
    return { lat: latAsc[0] ?? 0, lon: lonAsc[0] ?? 0 };
  }
  const lon = lonMin + (x / (n - 1)) * (lonMax - lonMin);
  const lat = latMax - (y / (m - 1)) * (latMax - latMin);
  return { lat, lon };
}

/** Bilinear sample on a grid in continuous index space (same convention as d3-contour). */
export function sampleBilinearAtGridXY(values: number[][], gx: number, gy: number): number {
  const m = values.length;
  const n = values[0]?.length ?? 0;
  if (m === 0 || n === 0) return 0;
  if (m === 1 && n === 1) return values[0]?.[0] ?? 0;

  const x = clamp(gx, 0, n - 1);
  const y = clamp(gy, 0, m - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, m - 1);
  const fx = x - x0;
  const fy = y - y0;

  const v00 = values[y0]?.[x0] ?? 0;
  const v01 = values[y0]?.[x1] ?? 0;
  const v10 = values[y1]?.[x0] ?? 0;
  const v11 = values[y1]?.[x1] ?? 0;
  const top = v00 * (1 - fx) + v01 * fx;
  const bottom = v10 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * 2D scalar field in d3-contour layout: row y=0 is north (maxLat), x=0 is west (minLon).
 * Missing cells use 0, matching contour rendering.
 */
export function pm25GridToContourValues(grid: Pm25Grid2D): number[][] {
  const m = grid.latAsc.length;
  const n = grid.lonAsc.length;
  const out: number[][] = [];
  for (let y = 0; y < m; y += 1) {
    const yi = m - 1 - y;
    const row: number[] = [];
    for (let x = 0; x < n; x += 1) {
      row.push(grid.values[yi]?.[x] ?? 0);
    }
    out.push(row);
  }
  return out;
}

/** Row-major flat array for `d3-contour` (y=0 north). */
export function pm25GridToContourFlat(grid: Pm25Grid2D): number[] {
  const oriented = pm25GridToContourValues(grid);
  return oriented.flat();
}

/** Sample PM2.5 at lon/lat using the same grid transform as rendered contours. */
export function samplePm25AtLonLat(lat: number, lon: number, grid: Pm25Grid2D): number {
  const contourValues = pm25GridToContourValues(grid);
  const { x, y } = lonLatToGridXY(lat, lon, grid);
  return sampleBilinearAtGridXY(contourValues, x, y);
}

/** Clamp `value` to the closed interval [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Pivot kriging rows into a 2D grid; returns null if fewer than 2×2 unique cells. */
export function rowsToPm25Grid2D(rows: CurrentKrigingRow[]): Pm25Grid2D | null {
  const valid = rows.filter(
    (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.pm25),
  );
  if (valid.length === 0) return null;

  const byLat = new Map<number, Map<number, number>>();
  for (const row of valid) {
    let lonMap = byLat.get(row.latitude);
    if (!lonMap) {
      lonMap = new Map<number, number>();
      byLat.set(row.latitude, lonMap);
    }
    lonMap.set(row.longitude, row.pm25 as number);
  }

  const latAsc = Array.from(byLat.keys()).sort((a, b) => a - b);
  const lonAsc = Array.from(byLat.get(latAsc[0])?.keys() ?? []).sort((a, b) => a - b);
  if (latAsc.length < 2 || lonAsc.length < 2) return null;

  const values: number[][] = [];
  for (let yi = 0; yi < latAsc.length; yi += 1) {
    const rowVals: number[] = [];
    const lonMap = byLat.get(latAsc[yi]);
    for (let xi = 0; xi < lonAsc.length; xi += 1) {
      rowVals.push(lonMap?.get(lonAsc[xi]) ?? 0);
    }
    values.push(rowVals);
  }

  return {
    latAsc,
    lonAsc,
    values,
    time: valid[0]?.time ?? new Date().toISOString(),
  };
}

/** Expand a 2D grid back into `CurrentKrigingRow` records (finite cells only). */
export function pm25Grid2DToRows(grid: Pm25Grid2D): CurrentKrigingRow[] {
  const rows: CurrentKrigingRow[] = [];
  for (let yi = 0; yi < grid.latAsc.length; yi += 1) {
    for (let xi = 0; xi < grid.lonAsc.length; xi += 1) {
      const pm25 = grid.values[yi]?.[xi];
      if (pm25 == null || !Number.isFinite(pm25)) continue;
      rows.push({
        latitude: grid.latAsc[yi],
        longitude: grid.lonAsc[xi],
        pm25,
        aqi: null,
        kriging_variance: null,
        time: grid.time,
      });
    }
  }
  return rows;
}

/** Row-major `Float32Array` of length `PM25_CELL_COUNT` for analog deltas. */
export function pm25ValuesToFlat(values: number[][]): Float32Array {
  const out = new Float32Array(PM25_CELL_COUNT);
  const m = values.length;
  const n = values[0]?.length ?? 0;
  for (let yi = 0; yi < m; yi += 1) {
    for (let xi = 0; xi < n; xi += 1) {
      out[yi * PM25_GRID_SIZE + xi] = values[yi][xi] ?? 0;
    }
  }
  return out;
}

/** One light 3×3 smoothing pass. */
export function smoothPm25Grid3x3(values: number[][]): number[][] {
  const m = values.length;
  const n = values[0]?.length ?? 0;
  const next: number[][] = [];
  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < n; xi += 1) {
      let sum = values[yi][xi];
      let count = 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dy === 0 && dx === 0) continue;
          const ny = yi + dy;
          const nx = xi + dx;
          if (ny < 0 || ny >= m || nx < 0 || nx >= n) continue;
          sum += values[ny][nx];
          count += 1;
        }
      }
      row.push(sum / count);
    }
    next.push(row);
  }
  return next;
}

/**
 * Shift a scalar field by wind displacement (one pass, bilinear sample).
 * Displacement in grid-index units, clamped to maxCells.
 */
export function warpFieldByWind(
  field: number[][],
  grid: Pm25Grid2D,
  uMs: number,
  vMs: number,
  hours: number,
  maxCells = 3,
): number[][] {
  const m = field.length;
  const n = field[0]?.length ?? 0;
  const latMid = (grid.latAsc[0] + grid.latAsc[m - 1]) / 2;
  const mPerDegLon = METERS_PER_DEG_LAT * Math.max(0.2, Math.cos((latMid * Math.PI) / 180));
  const latSpan = grid.latAsc[m - 1] - grid.latAsc[0];
  const lonSpan = grid.lonAsc[n - 1] - grid.lonAsc[0];
  const metersPerRow = (latSpan / Math.max(1, m - 1)) * METERS_PER_DEG_LAT;
  const metersPerCol = (lonSpan / Math.max(1, n - 1)) * mPerDegLon;
  const dt = hours * 3600;
  const dRow = clamp((vMs * dt) / metersPerRow, -maxCells, maxCells);
  const dCol = clamp((uMs * dt) / metersPerCol, -maxCells, maxCells);

  const out: number[][] = [];
  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    const lat = grid.latAsc[yi];
    for (let xi = 0; xi < n; xi += 1) {
      const lon = grid.lonAsc[xi];
      const srcY = yi - dRow;
      const srcX = xi - dCol;
      if (srcY < 0 || srcY > m - 1 || srcX < 0 || srcX > n - 1) {
        row.push(field[yi][xi]);
        continue;
      }
      const y0 = Math.floor(srcY);
      const x0 = Math.floor(srcX);
      const y1 = Math.min(y0 + 1, m - 1);
      const x1 = Math.min(x0 + 1, n - 1);
      const fy = srcY - y0;
      const fx = srcX - x0;
      const lat0 = grid.latAsc[y0];
      const lat1 = grid.latAsc[y1];
      const lon0 = grid.lonAsc[x0];
      const lon1 = grid.lonAsc[x1];
      const v00 = field[y0][x0];
      const v01 = field[y0][x1];
      const v10 = field[y1][x0];
      const v11 = field[y1][x1];
      const latT = clamp((lat - lat0) / (lat1 - lat0 || 1), 0, 1);
      const lonT = clamp((lon - lon0) / (lon1 - lon0 || 1), 0, 1);
      const top = v00 * (1 - lonT) + v01 * lonT;
      const bottom = v10 * (1 - lonT) + v11 * lonT;
      row.push(top * (1 - latT) + bottom * latT);
    }
    out.push(row);
  }
  return out;
}

/** Element-wise `a − b` (future minus anchor flat grids). */
export function subtractFlat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] - b[i];
  return out;
}
