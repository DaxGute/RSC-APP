import { dateKeyFromIso } from './aqiCalendarData';
import { dateKeyLocal, enumerateDaysInMonth } from './aqiTenMinuteAggregation';

export const YEARLY_PM25_MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export type YearlyPm25MonthSource = 'current-year' | 'prior-year';

export type YearlyPm25MonthBar = {
  label: string;
  monthIndex: number;
  avgPm25: number | null;
  source: YearlyPm25MonthSource;
};

export type YearlyPm25ByMonthChart = {
  bars: YearlyPm25MonthBar[];
  /** Index of the first month that uses prior-year data, or null if none. */
  priorYearStartsAtIndex: number | null;
};

type DailyPm25Row = { pm25: number | null; time: string };

/** One average PM2.5 per local calendar day (mean across sensors/readings that day). */
export function buildDailyPm25Map(rows: DailyPm25Row[]): Map<string, number> {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    const dayKey = dateKeyFromIso(row.time);
    if (!dayKey) continue;
    const pm = row.pm25;
    if (pm == null || !Number.isFinite(pm)) continue;
    const prev = byDay.get(dayKey);
    if (prev) prev.push(pm);
    else byDay.set(dayKey, [pm]);
  }
  const out = new Map<string, number>();
  for (const [dayKey, values] of byDay) {
    if (values.length === 0) continue;
    out.set(dayKey, values.reduce((acc, n) => acc + n, 0) / values.length);
  }
  return out;
}

function yearMonthKey(year: number, monthIndex: number): string {
  return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}`;
}

function dayKeysForMonthAverage(monthKey: string, now: Date): string[] {
  const allDays = enumerateDaysInMonth(monthKey);
  const todayKey = dateKeyLocal(now);
  const currentMonthKey = yearMonthKey(now.getFullYear(), now.getMonth());
  if (monthKey !== currentMonthKey) return allDays;
  return allDays.filter((dayKey) => dayKey <= todayKey);
}

function averagePm25ForDays(dailyPm25: Map<string, number>, dayKeys: string[]): number | null {
  const values: number[] = [];
  for (const dayKey of dayKeys) {
    const pm = dailyPm25.get(dayKey);
    if (pm != null && Number.isFinite(pm)) values.push(pm);
  }
  if (values.length === 0) return null;
  return values.reduce((acc, n) => acc + n, 0) / values.length;
}

/**
 * Jan–Dec bars for the calendar year containing `now`.
 * Months after the current month use the prior calendar year's daily average for that month.
 * Each bar is the mean of daily PM2.5 in that month (partial month for the current month).
 */
export function buildYearlyPm25ByMonthChart(
  dailyCurrentYear: Map<string, number>,
  dailyPriorYear: Map<string, number>,
  now = new Date(),
): YearlyPm25ByMonthChart {
  const year = now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const bars: YearlyPm25MonthBar[] = [];
  let priorYearStartsAtIndex: number | null = null;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const usePriorYear = monthIndex > currentMonthIndex;
    if (usePriorYear && priorYearStartsAtIndex == null) {
      priorYearStartsAtIndex = monthIndex;
    }

    const dataYear = usePriorYear ? year - 1 : year;
    const dataMonthKey = yearMonthKey(dataYear, monthIndex);
    const daily = usePriorYear ? dailyPriorYear : dailyCurrentYear;
    const dayKeys = usePriorYear
      ? enumerateDaysInMonth(dataMonthKey)
      : dayKeysForMonthAverage(dataMonthKey, now);

    bars.push({
      label: YEARLY_PM25_MONTH_LABELS[monthIndex],
      monthIndex,
      avgPm25: averagePm25ForDays(daily, dayKeys),
      source: usePriorYear ? 'prior-year' : 'current-year',
    });
  }

  return { bars, priorYearStartsAtIndex };
}

export function filterDailyPm25RowsForYear(
  rows: DailyPm25Row[],
  year: number,
): DailyPm25Row[] {
  return rows.filter((row) => {
    const dayKey = dateKeyFromIso(row.time);
    if (!dayKey) return false;
    return Number(dayKey.slice(0, 4)) === year;
  });
}
