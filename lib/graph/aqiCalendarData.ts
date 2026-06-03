/**
 * AQI calendar: fetch daily sensor rows, aggregate to per-day AQI summaries with category colors.
 * Powers `AqiColoredCalendar` and section 2 of `AqiGraphScreen`.
 */

import { aqiCategory, pm25ToAqi } from '../shell/airQualityBreakpoints';
import { fetchDailySensorAqiCalendarRows, fetchDailySensorAqiCalendarRowsForMonth } from '../shell/fetchAirQuality';
import { dateKeyLocal } from './aqiHourlyAggregation';

/** Per-day AQI value plus background/foreground colors from the EPA category band. */
export type DaySummary = { dayAqi: number | null; bg: string; fg: string };

/** Parse an ISO timestamp into a local `YYYY-MM-DD` key (fast path when already date-only). */
export function dateKeyFromIso(iso: string): string | null {
  if (typeof iso === 'string' && iso.length >= 10) {
    const candidate = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  }
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return dateKeyLocal(d);
}

/** Mean daily AQI from sensor rows, with category colors and latest recorded time per day. */
export function buildDaySummaries(
  rows: Array<{ aqi: number | null; pm25: number | null; time: string }>,
): { summaries: Map<string, DaySummary>; byDayRecordedTime: Map<string, string> } {
  const byDay = new Map<string, number[]>();
  const byDayRecordedTime = new Map<string, string>();
  for (const row of rows) {
    const dayKey = dateKeyFromIso(row.time);
    if (!dayKey) continue;
    const previousRecordedTime = byDayRecordedTime.get(dayKey);
    if (!previousRecordedTime) {
      byDayRecordedTime.set(dayKey, row.time);
    } else {
      const prevMs = new Date(previousRecordedTime).getTime();
      const nextMs = new Date(row.time).getTime();
      if (Number.isFinite(nextMs) && (!Number.isFinite(prevMs) || nextMs > prevMs)) {
        byDayRecordedTime.set(dayKey, row.time);
      }
    }
    const readingAqi = Number.isFinite(Number(row.aqi))
      ? Math.round(Number(row.aqi))
      : pm25ToAqi(row.pm25);
    if (readingAqi == null || !Number.isFinite(readingAqi)) continue;
    const prev = byDay.get(dayKey);
    if (prev) prev.push(readingAqi);
    else byDay.set(dayKey, [readingAqi]);
  }
  const out = new Map<string, DaySummary>();
  for (const [dayKey, values] of byDay) {
    if (values.length === 0) continue;
    const dayAqi = Math.round(values.reduce((acc, n) => acc + n, 0) / values.length);
    const cat = aqiCategory(dayAqi);
    out.set(dayKey, {
      dayAqi,
      bg: cat.bg,
      fg: cat.fg,
    });
  }
  return { summaries: out, byDayRecordedTime };
}

function monthBoundsToIsoRange(monthKey: string): { fromIso: string; toIso: string } {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthOneBased = Number(monthStr);
  const start = new Date(Date.UTC(year, monthOneBased - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthOneBased, 0, 23, 59, 59, 999));
  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
  };
}

/**
 * Fetch daily AQI/PM2.5 rows for a month (`YYYY-MM`).
 * Tries a bounded month query first, then falls back to filtering the full calendar table.
 */
export async function loadCalendarRowsForMonth(
  monthKey: string,
): Promise<Array<{ aqi: number | null; pm25: number | null; time: string }>> {
  const { fromIso, toIso } = monthBoundsToIsoRange(monthKey);
  const monthly = await fetchDailySensorAqiCalendarRowsForMonth(fromIso, toIso);
  const monthlyRows = (monthly.data ?? [])
    .filter((row) => typeof row.time === 'string' && row.time.length >= 10)
    .map((row) => ({ aqi: row.aqi, pm25: row.pm25, time: row.time }));
  if (monthlyRows.length > 0) return monthlyRows;

  const allRowsRes = await fetchDailySensorAqiCalendarRows();
  const allRows = (allRowsRes.data ?? [])
    .filter((row) => typeof row.time === 'string' && row.time.length >= 10)
    .map((row) => ({ aqi: row.aqi, pm25: row.pm25, time: row.time }));
  return allRows.filter((row) => row.time.slice(0, 7) === monthKey);
}

/** Daily AQI values keyed by YYYY-MM-DD, for category counts matching calendar colors. */
export function dailyAqiMapFromDaySummaries(summaries: Map<string, DaySummary>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [dayKey, summary] of summaries) {
    if (summary.dayAqi != null && Number.isFinite(summary.dayAqi)) {
      out.set(dayKey, summary.dayAqi);
    }
  }
  return out;
}

/** Human-readable month label (e.g. "June 2026") from a `YYYY-MM` key. */
export function formatMonthLabel(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return 'this month';
  return parsed.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
