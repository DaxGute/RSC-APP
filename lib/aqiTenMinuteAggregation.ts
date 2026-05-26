import type { ClarityRow, PurpleAirRow } from './database.types';
import { AQI_CATEGORY_BANDS, AQI_CATEGORY_UPPER_BOUNDS } from './airQualityBreakpoints';
import { pm25ToAqi } from './aqiUtils';

export const TEN_MIN_MS = 10 * 60 * 1000;
/** Max |reading − slot| for a bucket to use that reading. */
export const SLOT_READING_MATCH_MS = TEN_MIN_MS;

export type AvgAqiPoint = { time: string; avgAqi: number };

export type DayAqiCategory = 'good' | 'moderate' | 'usg' | 'unhealthy';

export function dateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

export function generateLocalCalendarDayTenMinuteSlotIsos(dayKey: string): string[] {
  const parts = dayKey.split('-').map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return [];
  const [y, mo, da] = parts;
  let t = new Date(y, mo - 1, da, 0, 0, 0, 0).getTime();
  const last = new Date(y, mo - 1, da, 23, 59, 59, 999).getTime();
  const out: string[] = [];
  while (t <= last) {
    out.push(new Date(t).toISOString());
    t += TEN_MIN_MS;
  }
  return out;
}

export function matchReadingToTenMinuteSlot(
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

export function computeDailyAqiFromTenMinute(pairs: AvgAqiPoint[], dayKey: string): number | null {
  const slots = generateLocalCalendarDayTenMinuteSlotIsos(dayKey);
  let total = 0;
  let count = 0;
  for (const slotIso of slots) {
    const { avgAqi, selectableTime } = matchReadingToTenMinuteSlot(slotIso, pairs);
    if (selectableTime == null) continue;
    total += avgAqi;
    count += 1;
  }
  if (count === 0) return null;
  return total / count;
}

export function computeDailyAqiMap(pairs: AvgAqiPoint[]): Map<string, number> {
  const dayKeys = new Set<string>();
  for (const p of pairs) {
    const d = new Date(p.time);
    if (!Number.isFinite(d.getTime())) continue;
    dayKeys.add(dateKeyLocal(d));
  }
  const out = new Map<string, number>();
  for (const dayKey of dayKeys) {
    const daily = computeDailyAqiFromTenMinute(pairs, dayKey);
    if (daily != null && Number.isFinite(daily)) out.set(dayKey, daily);
  }
  return out;
}

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

export type TenMinuteSlotAverage = {
  time: string;
  avgAqi: number;
  selectableTime: string | null;
  /** How many of the rolling days had a reading in this slot. */
  daySampleCount: number;
};

/**
 * For each 10-minute slot in a local calendar day, average readings from the same
 * slot across the rolling last `ROLLING_WEEK_DAYS` days (inclusive of today).
 */
export type HourlySlotAverage = {
  /** Local hour 0–23. */
  hour: number;
  avgAqi: number;
  /** Number of readings in this hour across the rolling week. */
  sampleCount: number;
};

/**
 * For each local hour, average all readings from that hour across the rolling last
 * `ROLLING_WEEK_DAYS` days (inclusive of today).
 */
export function computeRollingWeekHourlyAverages(
  pairs: AvgAqiPoint[],
  now = new Date(),
): HourlySlotAverage[] {
  const dayKeys = rollingDayKeysLocal(now, ROLLING_WEEK_DAYS);
  const dayKeySet = new Set(dayKeys);
  const valuesByHour: number[][] = Array.from({ length: 24 }, () => []);

  for (const p of pairs) {
    const d = new Date(p.time);
    if (!Number.isFinite(d.getTime())) continue;
    if (!dayKeySet.has(dateKeyLocal(d))) continue;
    if (!Number.isFinite(p.avgAqi)) continue;
    valuesByHour[d.getHours()].push(p.avgAqi);
  }

  return valuesByHour.map((values, hour) => ({
    hour,
    avgAqi: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    sampleCount: values.length,
  }));
}

export function computeRollingWeekTenMinuteAverages(
  pairs: AvgAqiPoint[],
  now = new Date(),
): TenMinuteSlotAverage[] {
  const referenceDayKey = dateKeyLocal(now);
  const dayKeys = rollingDayKeysLocal(now, ROLLING_WEEK_DAYS);
  const dayKeySet = new Set(dayKeys);
  const filteredPairs = pairs.filter((p) => {
    const d = new Date(p.time);
    return Number.isFinite(d.getTime()) && dayKeySet.has(dateKeyLocal(d));
  });

  const slotIsos = generateLocalCalendarDayTenMinuteSlotIsos(referenceDayKey);
  return slotIsos.map((slotIso) => {
    let sum = 0;
    let count = 0;
    let latestSelectable: string | null = null;
    let latestMs = -Infinity;
    for (const dayKey of dayKeys) {
      const daySlotIso = slotIsoOnLocalDayKey(slotIso, dayKey);
      const { avgAqi, selectableTime } = matchReadingToTenMinuteSlot(daySlotIso, filteredPairs);
      if (selectableTime == null) continue;
      sum += avgAqi;
      count += 1;
      const ms = new Date(selectableTime).getTime();
      if (Number.isFinite(ms) && ms > latestMs) {
        latestMs = ms;
        latestSelectable = selectableTime;
      }
    }
    return {
      time: slotIso,
      avgAqi: count > 0 ? sum / count : 0,
      selectableTime: latestSelectable,
      daySampleCount: count,
    };
  });
}

export type DayTimelineChartPoint = {
  time: string;
  avgAqi: number;
  position: number;
  selectableTime: string | null;
};

export type DayTimelineChart = {
  points: DayTimelineChartPoint[];
  ticks: Array<{ position: number; label: string }>;
  selectedPosition: number | null;
};

/** Build scrub chart data for a dense local-day 10-minute series. */
export function buildDayTimelineChart(
  slots: Array<{ time: string; avgAqi: number; selectableTime: string | null }>,
  selectedTimeIso: string | null,
): DayTimelineChart {
  const sortedSlots = [...slots]
    .filter((s) => Number.isFinite(new Date(s.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const n = Math.max(1, sortedSlots.length);
  const pts: DayTimelineChartPoint[] = sortedSlots.map((slot, i) => ({
    time: slot.time,
    avgAqi: Number.isFinite(slot.avgAqi) ? slot.avgAqi : 0,
    position: n <= 1 ? 0 : i / (n - 1),
    selectableTime: slot.selectableTime,
  }));

  const hourTickTargets: Array<{ hour: number; label: string }> = [
    { hour: 6, label: '6a' },
    { hour: 0, label: '12a' },
    { hour: 18, label: '6p' },
    { hour: 12, label: '12p' },
  ];
  const ticks = hourTickTargets
    .map(({ hour, label }) => {
      if (sortedSlots.length === 0) return null;
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sortedSlots.length; i += 1) {
        const d = new Date(sortedSlots[i].time);
        if (!Number.isFinite(d.getTime())) continue;
        const dist = Math.abs(d.getHours() - hour);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      return {
        idx: bestIdx,
        position: n <= 1 ? 0 : bestIdx / (n - 1),
        label,
      };
    })
    .filter((tick): tick is { idx: number; position: number; label: string } => tick != null)
    .sort((a, b) => a.position - b.position)
    .filter((tick, idx, arr) => idx === 0 || tick.idx !== arr[idx - 1].idx)
    .map(({ position, label }) => ({ position, label }));

  let selectedIndex = -1;
  if (selectedTimeIso && sortedSlots.length > 0) {
    const selMs = new Date(selectedTimeIso).getTime();
    if (Number.isFinite(selMs)) {
      let bestI = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sortedSlots.length; i += 1) {
        const d = Math.abs(new Date(sortedSlots[i].time).getTime() - selMs);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const exact = sortedSlots.findIndex((s) => s.time === selectedTimeIso);
      selectedIndex = exact >= 0 ? exact : bestI;
    }
  }

  return {
    points: pts,
    ticks,
    selectedPosition:
      sortedSlots.length <= 1 ? 0 : selectedIndex >= 0 ? selectedIndex / (sortedSlots.length - 1) : 1,
  };
}

export function dayAqiCategory(aqi: number): DayAqiCategory {
  if (aqi <= (AQI_CATEGORY_UPPER_BOUNDS[0] ?? 50)) return 'good';
  if (aqi <= (AQI_CATEGORY_UPPER_BOUNDS[1] ?? 100)) return 'moderate';
  if (aqi <= (AQI_CATEGORY_UPPER_BOUNDS[2] ?? 150)) return 'usg';
  return 'unhealthy';
}

function dayMetaFromBand(index: number) {
  const band = AQI_CATEGORY_BANDS[index];
  return {
    label: band?.label ?? '',
    shortLabel: index === 2 ? 'USG' : (band?.label.split(' ')[0] ?? ''),
    bg: band?.bg ?? '#94a3b8',
    fg: band?.fg ?? '#111827',
  };
}

export const DAY_AQI_CATEGORY_META: Record<
  DayAqiCategory,
  { label: string; shortLabel: string; bg: string; fg: string }
> = {
  good: { ...dayMetaFromBand(0), shortLabel: 'Good' },
  moderate: { ...dayMetaFromBand(1), shortLabel: 'Moderate' },
  usg: { ...dayMetaFromBand(2), shortLabel: 'USG' },
  unhealthy: {
    label: 'Unhealthy+',
    shortLabel: 'Unhealthy+',
    bg: AQI_CATEGORY_BANDS[3]?.bg ?? '#FF0000',
    fg: AQI_CATEGORY_BANDS[3]?.fg ?? '#FFFFFF',
  },
};

export type DayCategoryCounts = Record<DayAqiCategory, number>;

export function countDaysByCategory(dailyByDay: Map<string, number>, dayKeys?: string[]): DayCategoryCounts {
  const counts: DayCategoryCounts = { good: 0, moderate: 0, usg: 0, unhealthy: 0 };
  const keys = dayKeys ?? Array.from(dailyByDay.keys());
  for (const dayKey of keys) {
    const aqi = dailyByDay.get(dayKey);
    if (aqi == null || !Number.isFinite(aqi)) continue;
    counts[dayAqiCategory(aqi)] += 1;
  }
  return counts;
}

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
