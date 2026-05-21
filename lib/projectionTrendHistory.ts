import type { CurrentKrigingRow } from './database.types';
import { fetchSensorReadingsAtRecordedTime } from './fetchAirQuality';
import { resolveHeatmapGridRows } from './resolveHeatmapGrid';
import type { SensorPoint } from './sensorTypes';
import type { ClarityRow, PurpleAirRow } from './database.types';

export type TrendHistoryGrids = {
  grid10mAgo: CurrentKrigingRow[] | null;
  grid20mAgo: CurrentKrigingRow[] | null;
  grid30mAgo: CurrentKrigingRow[] | null;
};

const LOOKBACK_MINUTES = [10, 20, 30] as const;
const MAX_TIME_MATCH_MS = 18 * 60 * 1000;

function toSensorPoints(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): SensorPoint[] {
  const out: SensorPoint[] = [];
  for (const r of purple ?? []) {
    if (r.pm25 == null || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      sensorIndex: r.sensor_index,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'purple_air',
      time: r.time,
    });
  }
  for (const r of clarity ?? []) {
    if (r.pm25 == null || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      sensorIndex: r.sensor_index,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'clarity',
      time: r.time,
    });
  }
  return out;
}

function closestRecordedTime(timesAsc: string[], targetMs: number): string | null {
  let best: string | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const iso of timesAsc) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff && diff <= MAX_TIME_MATCH_MS) {
      bestDiff = diff;
      best = iso;
    }
  }
  return best;
}

async function gridAtRecordedTime(recordedTime: string): Promise<CurrentKrigingRow[] | null> {
  const res = await fetchSensorReadingsAtRecordedTime(recordedTime);
  if (res.error) return null;
  const sensors = toSensorPoints(res.purpleAir, res.clarity);
  if (sensors.length === 0) return null;
  const grid = resolveHeatmapGridRows({ kriging: [], sensors });
  return grid.length > 0 ? grid : null;
}

/**
 * Builds PM2.5 grids at ~10 / 20 / 30 minutes before now using pipeline timeline stamps.
 */
export async function fetchProjectionTrendHistory(
  timelineTimesAsc: string[],
): Promise<TrendHistoryGrids | null> {
  if (timelineTimesAsc.length === 0) return null;

  const nowMs = Date.now();
  const grids: (CurrentKrigingRow[] | null)[] = [];

  for (const minutes of LOOKBACK_MINUTES) {
    const targetMs = nowMs - minutes * 60 * 1000;
    const recordedTime = closestRecordedTime(timelineTimesAsc, targetMs);
    if (!recordedTime) {
      grids.push(null);
      continue;
    }
    grids.push(await gridAtRecordedTime(recordedTime));
  }

  const [grid10mAgo, grid20mAgo, grid30mAgo] = grids;
  if (!grid10mAgo && !grid20mAgo && !grid30mAgo) return null;

  return { grid10mAgo, grid20mAgo, grid30mAgo };
}

/** Lookup PM2.5 at lat/lon from a grid (nearest node). */
export function pm25AtLatLon(grid: CurrentKrigingRow[] | null, lat: number, lon: number): number | null {
  if (!grid || grid.length === 0) return null;
  let best: number | null = null;
  let bestDist2 = Number.POSITIVE_INFINITY;
  for (const row of grid) {
    if (!Number.isFinite(row.pm25)) continue;
    const dLat = row.latitude - lat;
    const dLon = row.longitude - lon;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = row.pm25 as number;
    }
  }
  return best;
}
