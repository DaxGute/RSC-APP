import type { CurrentKrigingRow } from '../database.types';
import { SSF_BBOX } from '../constants/ssf';
import { HEATMAP_GRID_STEPS } from '../resolveHeatmapGrid';
import type { WindGridPoint } from '../forecastWindGrid';

export const PM25_GRID_SIZE = HEATMAP_GRID_STEPS;
export const PM25_CELL_COUNT = PM25_GRID_SIZE * PM25_GRID_SIZE;
export const WIND_GRID_SIZE = 20;
export const WIND_CELL_COUNT = WIND_GRID_SIZE * WIND_GRID_SIZE;

const METERS_PER_DEG_LAT = 111_320;

export type Pm25Grid2D = {
  latAsc: number[];
  lonAsc: number[];
  values: number[][];
  time: string;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

export function flatToPm25Values(flat: Float32Array, template: Pm25Grid2D): number[][] {
  const values: number[][] = [];
  for (let yi = 0; yi < template.latAsc.length; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < template.lonAsc.length; xi += 1) {
      row.push(flat[yi * PM25_GRID_SIZE + xi] ?? 0);
    }
    values.push(row);
  }
  return values;
}

export function createEmptyPm25Grid(time: string): Pm25Grid2D {
  const southLat = SSF_BBOX.seLat;
  const northLat = SSF_BBOX.nwLat;
  const westLon = SSF_BBOX.nwLon;
  const eastLon = SSF_BBOX.seLon;
  const latStep = (northLat - southLat) / (PM25_GRID_SIZE - 1);
  const lonStep = (eastLon - westLon) / (PM25_GRID_SIZE - 1);
  const latAsc: number[] = [];
  const lonAsc: number[] = [];
  for (let i = 0; i < PM25_GRID_SIZE; i += 1) latAsc.push(southLat + i * latStep);
  for (let j = 0; j < PM25_GRID_SIZE; j += 1) lonAsc.push(westLon + j * lonStep);
  const values = Array.from({ length: PM25_GRID_SIZE }, () =>
    Array.from({ length: PM25_GRID_SIZE }, () => 0),
  );
  return { latAsc, lonAsc, values, time };
}

/** Downsample 40×40 to poolSize×poolSize block means. */
export function poolPm25Grid(values: number[][], poolSize: number): number[] {
  const block = PM25_GRID_SIZE / poolSize;
  const out: number[] = [];
  for (let py = 0; py < poolSize; py += 1) {
    for (let px = 0; px < poolSize; px += 1) {
      let sum = 0;
      let count = 0;
      for (let yi = py * block; yi < (py + 1) * block; yi += 1) {
        for (let xi = px * block; xi < (px + 1) * block; xi += 1) {
          const v = values[yi]?.[xi];
          if (Number.isFinite(v)) {
            sum += v;
            count += 1;
          }
        }
      }
      out.push(count > 0 ? sum / count : 0);
    }
  }
  return out;
}

export function quadrantMeans(values: number[][]): number[] {
  const mid = Math.floor(PM25_GRID_SIZE / 2);
  const quads = [
    [0, mid, 0, mid],
    [0, mid, mid, PM25_GRID_SIZE],
    [mid, PM25_GRID_SIZE, 0, mid],
    [mid, PM25_GRID_SIZE, mid, PM25_GRID_SIZE],
  ] as const;
  return quads.map(([y0, y1, x0, x1]) => {
    let sum = 0;
    let count = 0;
    for (let yi = y0; yi < y1; yi += 1) {
      for (let xi = x0; xi < x1; xi += 1) {
        const v = values[yi]?.[xi];
        if (Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  });
}

export function meanStd(values: number[][]): { mean: number; std: number } {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (const row of values) {
    for (const v of row) {
      if (!Number.isFinite(v)) continue;
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }
  if (count === 0) return { mean: 0, std: 0 };
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

export function windSliceToFlatArrays(
  points: WindGridPoint[] | null | undefined,
): { u: Float32Array; v: Float32Array } | null {
  if (!points || points.length < 4) return null;
  const byLat = new Map<number, Map<number, { u: number; v: number }>>();
  for (const p of points) {
    let lonMap = byLat.get(p.lat);
    if (!lonMap) {
      lonMap = new Map();
      byLat.set(p.lat, lonMap);
    }
    lonMap.set(p.lon, { u: p.uMs, v: p.vMs });
  }
  const latAsc = [...byLat.keys()].sort((a, b) => a - b);
  const lonAsc = [...(byLat.get(latAsc[0])?.keys() ?? [])].sort((a, b) => a - b);
  if (latAsc.length < 2 || lonAsc.length < 2) return null;

  const u = new Float32Array(WIND_CELL_COUNT);
  const v = new Float32Array(WIND_CELL_COUNT);
  const latStep = (latAsc[latAsc.length - 1] - latAsc[0]) / Math.max(1, WIND_GRID_SIZE - 1);
  const lonStep = (lonAsc[lonAsc.length - 1] - lonAsc[0]) / Math.max(1, WIND_GRID_SIZE - 1);
  const latMin = latAsc[0];
  const lonMin = lonAsc[0];

  for (const p of points) {
    const li = Math.round((p.lat - latMin) / (latStep || 1e-9));
    const lj = Math.round((p.lon - lonMin) / (lonStep || 1e-9));
    if (li < 0 || li >= WIND_GRID_SIZE || lj < 0 || lj >= WIND_GRID_SIZE) continue;
    const idx = li * WIND_GRID_SIZE + lj;
    u[idx] = p.uMs;
    v[idx] = p.vMs;
  }
  return { u, v };
}

export function poolWindFlat(u: Float32Array, v: Float32Array, poolSize: number): number[] {
  const block = WIND_GRID_SIZE / poolSize;
  const out: number[] = [];
  for (let py = 0; py < poolSize; py += 1) {
    for (let px = 0; px < poolSize; px += 1) {
      let su = 0;
      let sv = 0;
      let count = 0;
      for (let yi = py * block; yi < (py + 1) * block; yi += 1) {
        for (let xi = px * block; xi < (px + 1) * block; xi += 1) {
          const idx = yi * WIND_GRID_SIZE + xi;
          su += u[idx];
          sv += v[idx];
          count += 1;
        }
      }
      if (count > 0) {
        out.push(su / count, sv / count);
      } else {
        out.push(0, 0);
      }
    }
  }
  return out;
}

export function sampleBilinearGrid(values: number[][], lat: number, lon: number, grid: Pm25Grid2D): number {
  const { latAsc, lonAsc } = grid;
  const m = latAsc.length;
  const n = lonAsc.length;
  if (m < 2 || n < 2) return values[0]?.[0] ?? 0;
  const latMin = latAsc[0];
  const latMax = latAsc[m - 1];
  const lonMin = lonAsc[0];
  const lonMax = lonAsc[n - 1];
  if (!(latMax > latMin) || !(lonMax > lonMin)) return values[0]?.[0] ?? 0;

  const latT = clamp((lat - latMin) / (latMax - latMin), 0, 1);
  const lonT = clamp((lon - lonMin) / (lonMax - lonMin), 0, 1);
  const y = latT * (m - 1);
  const x = lonT * (n - 1);
  const y0 = Math.floor(y);
  const x0 = Math.floor(x);
  const y1 = Math.min(y0 + 1, m - 1);
  const x1 = Math.min(x0 + 1, n - 1);
  const fy = y - y0;
  const fx = x - x0;

  const v00 = values[y0]?.[x0] ?? 0;
  const v01 = values[y0]?.[x1] ?? 0;
  const v10 = values[y1]?.[x0] ?? 0;
  const v11 = values[y1]?.[x1] ?? 0;
  const top = v00 * (1 - fx) + v01 * fx;
  const bottom = v10 * (1 - fx) + v11 * fx;
  return top * (1 - fy) + bottom * fy;
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

export function subtractFlat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] - b[i];
  return out;
}

export function addFlatToGrid(base: number[][], delta: Float32Array): number[][] {
  const m = base.length;
  const n = base[0]?.length ?? 0;
  const out: number[][] = [];
  for (let yi = 0; yi < m; yi += 1) {
    const row: number[] = [];
    for (let xi = 0; xi < n; xi += 1) {
      row.push(Math.max(0, (base[yi][xi] ?? 0) + (delta[yi * PM25_GRID_SIZE + xi] ?? 0)));
    }
    out.push(row);
  }
  return out;
}
