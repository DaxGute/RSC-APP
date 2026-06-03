/**
 * AQI graph aggregation: hourly slot bucketing, rolling 7-day averages, and daily AQI helpers.
 * Core data layer for section 1 of `AqiGraphScreen` and shared calendar day-key helpers.
 */

import type { ClarityRow, PurpleAirRow } from '../shell/supabase';
import { AQI_CATEGORY_BANDS, aqiCategoryBinIndex, pm25ToAqi } from '../shell/airQualityBreakpoints';

/** Duration of one graph time bucket (1 hour). */
export const HOUR_MS = 60 * 60 * 1000;
/** Max |reading − slot| for a bucket to use that reading. */
export const SLOT_READING_MATCH_MS = HOUR_MS;

/** One timestamp with mean AQI across PurpleAir + Clarity sensors at that time. */
export type AvgAqiPoint = { time: string; avgAqi: number };

/** Number of EPA AQI index bands (Good … Hazardous), aligned with `AQI_CATEGORY_BANDS`. */
export const AQI_CATEGORY_BIN_COUNT = AQI_CATEGORY_BANDS.length;

/** Local calendar month as `YYYY-MM` (device timezone). */
export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

/** Local calendar day as `YYYY-MM-DD` (device timezone). */
export function dateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Merge PurpleAir and Clarity rows into a sorted mean-AQI timeseries keyed by `time`. */
export function buildAverageAqiTimeseries(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): AvgAqiPoint[] {
  const sums = new Map<string, { total: number; count: number }>();
  const addRow = (time: string | null | undefined, pm25: number | null | undefined) => {
    if (!time || pm25 == null || !Number.isFinite(pm25)) return;
    const aqi = pm25ToAqi(pm25);
    if (aqi == null || !Number.isFinite(aqi)) return;
    const curr = sums.get(time) ?? { total: 0, count: 0 };
    curr.total += aqi;
    curr.count += 1;
    sums.set(time, curr);
  };
  for (const row of purple ?? []) addRow(row.time, row.pm25);
  for (const row of clarity ?? []) addRow(row.time, row.pm25);
  return Array.from(sums.entries())
    .map(([time, v]) => ({ time, avgAqi: v.count > 0 ? v.total / v.count : 0 }))
    .filter((r) => Number.isFinite(new Date(r.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

/** ISO timestamps for every hourly slot on a local calendar day (`YYYY-MM-DD`). */
export function generateLocalCalendarDayHourlySlotIsos(dayKey: string): string[] {
  const parts = dayKey.split('-').map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return [];
  const [y, mo, da] = parts;
  const out: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    out.push(new Date(y, mo - 1, da, hour, 0, 0, 0).toISOString());
  }
  return out;
}

/** Pick the nearest reading within `SLOT_READING_MATCH_MS` of an hourly slot timestamp. */
export function matchReadingToHourlySlot(
  slotIso: string,
  pairs: AvgAqiPoint[],
): { avgAqi: number; selectableTime: string | null } {
  const slotMs = new Date(slotIso).getTime();
  if (!Number.isFinite(slotMs)) return { avgAqi: 0, selectableTime: null };
  let best: { time: string; avgAqi: number; dist: number } | null = null;
  for (const p of pairs) {
    const pm = new Date(p.time).getTime();
    if (!Number.isFinite(pm)) continue;
    const dist = Math.abs(pm - slotMs);
    if (dist > SLOT_READING_MATCH_MS) continue;
    if (!best || dist < best.dist || (dist === best.dist && p.time < best.time)) {
      best = { time: p.time, avgAqi: p.avgAqi, dist };
    }
  }
  if (best && Number.isFinite(best.avgAqi)) {
    return { avgAqi: best.avgAqi, selectableTime: best.time };
  }
  return { avgAqi: 0, selectableTime: null };
}

/** Mean AQI across filled hourly slots for one local day. */
export function computeDailyAqiFromHourly(pairs: AvgAqiPoint[], dayKey: string): number | null {
  const slots = generateLocalCalendarDayHourlySlotIsos(dayKey);
  let total = 0;
  let count = 0;
  for (const slotIso of slots) {
    const { avgAqi, selectableTime } = matchReadingToHourlySlot(slotIso, pairs);
    if (selectableTime == null) continue;
    total += avgAqi;
    count += 1;
  }
  if (count === 0) return null;
  return total / count;
}

/** Daily AQI values keyed by local `YYYY-MM-DD` for every day present in the timeseries. */
export function computeDailyAqiMap(pairs: AvgAqiPoint[]): Map<string, number> {
  const dayKeys = new Set<string>();
  for (const p of pairs) {
    const d = new Date(p.time);
    if (!Number.isFinite(d.getTime())) continue;
    dayKeys.add(dateKeyLocal(d));
  }
  const out = new Map<string, number>();
  for (const dayKey of dayKeys) {
    const daily = computeDailyAqiFromHourly(pairs, dayKey);
    if (daily != null && Number.isFinite(daily)) out.set(dayKey, daily);
  }
  return out;
}

/** Number of local calendar days in the rolling average window (today inclusive). */
export const ROLLING_WEEK_DAYS = 7;

/** Local calendar day keys for today through `dayCount - 1` days ago. */
export function rollingDayKeysLocal(now = new Date(), dayCount = ROLLING_WEEK_DAYS): string[] {
  const keys: string[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    keys.push(dateKeyLocal(d));
  }
  return keys;
}

/** Same clock time as `templateSlotIso` on the given local `dayKey`. */
export function slotIsoOnLocalDayKey(templateSlotIso: string, dayKey: string): string {
  const slot = new Date(templateSlotIso);
  if (!Number.isFinite(slot.getTime())) return templateSlotIso;
  const parts = dayKey.split('-').map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return templateSlotIso;
  const [y, mo, da] = parts;
  return new Date(
    y,
    mo - 1,
    da,
    slot.getHours(),
    slot.getMinutes(),
    slot.getSeconds(),
    slot.getMilliseconds(),
  ).toISOString();
}

/** Rolling 7-day mean AQI at one local hour (0–23). */
export type HourlySlotAverage = {
  /** Local hour 0–23. */
  hour: number;
  avgAqi: number;
  /** How many of the rolling days had a reading in this hour. */
  sampleCount: number;
};

/**
 * For each local hour, average readings from the same hour across the rolling last
 * `ROLLING_WEEK_DAYS` days (inclusive of today).
 */
export function computeRollingWeekHourlyAverages(
  pairs: AvgAqiPoint[],
  now = new Date(),
): HourlySlotAverage[] {
  const referenceDayKey = dateKeyLocal(now);
  const dayKeys = rollingDayKeysLocal(now, ROLLING_WEEK_DAYS);
  const dayKeySet = new Set(dayKeys);
  const filteredPairs = pairs.filter((p) => {
    const d = new Date(p.time);
    return Number.isFinite(d.getTime()) && dayKeySet.has(dateKeyLocal(d));
  });

  const slotIsos = generateLocalCalendarDayHourlySlotIsos(referenceDayKey);
  return slotIsos.map((slotIso) => {
    let sum = 0;
    let count = 0;
    for (const dayKey of dayKeys) {
      const daySlotIso = slotIsoOnLocalDayKey(slotIso, dayKey);
      const { avgAqi, selectableTime } = matchReadingToHourlySlot(daySlotIso, filteredPairs);
      if (selectableTime == null) continue;
      sum += avgAqi;
      count += 1;
    }
    const d = new Date(slotIso);
    return {
      hour: d.getHours(),
      avgAqi: count > 0 ? sum / count : 0,
      sampleCount: count,
    };
  });
}

/** Day counts per EPA category bin index (0 = Good … 5 = Hazardous). */
export type DayCategoryCounts = number[];

/** Zero-filled day counts for every EPA AQI band. */
export function emptyDayCategoryCounts(): DayCategoryCounts {
  return Array.from({ length: AQI_CATEGORY_BIN_COUNT }, () => 0);
}

/** Tally how many days fall into each EPA AQI category band. */
export function countDaysByCategory(dailyByDay: Map<string, number>, dayKeys?: string[]): DayCategoryCounts {
  const counts = emptyDayCategoryCounts();
  const keys = dayKeys ?? Array.from(dailyByDay.keys());
  for (const dayKey of keys) {
    const aqi = dailyByDay.get(dayKey);
    if (aqi == null || !Number.isFinite(aqi)) continue;
    counts[aqiCategoryBinIndex(aqi)] += 1;
  }
  return counts;
}

/** All local `YYYY-MM-DD` keys in a calendar month (`YYYY-MM`). */
export function enumerateDaysInMonth(monthKey: string): string[] {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthOneBased = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthOneBased)) return [];
  const cursor = new Date(year, monthOneBased - 1, 1);
  if (!Number.isFinite(cursor.getTime())) return [];
  const out: string[] = [];
  while (cursor.getMonth() === monthOneBased - 1) {
    out.push(dateKeyLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
