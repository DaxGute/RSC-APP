/**
 * Hourly bucket helpers for the map tab historical scrubber (Day mode).
 * Builds slot ISO lists and chart points for the rolling Today and calendar-day views.
 */

/** Duration of one map timeline bucket (1 hour). */
export const HOUR_MS = 60 * 60 * 1000;

/** One timestamp with mean AQI across sensors at that time. */
export type AvgAqiPair = { time: string; avgAqi: number };

/** One scrubber chart point aligned to an hour-top slot. */
export type TimelineChartPoint = {
  /** Hour-bucket ISO (top of the local hour). */
  time: string;
  avgAqi: number;
  position: number;
  /** Actual pipeline timestamp within the hour; null when the hour has no reading. */
  selectableTime: string | null;
};

/** Fixed label at a normalized position along the day scrubber axis. */
export type TimelineChartTick = {
  position: number;
  label: string;
};

/** Scrub chart payload: hourly points, tick labels, and selected thumb position. */
export type TimelineChart = {
  points: TimelineChartPoint[];
  ticks: TimelineChartTick[];
  selectedPosition: number | null;
};

/** Floor local ms to the start of its calendar hour. */
function alignLocalMsDownToHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

const DAY_SCRUBBER_TICK_TARGETS: Array<{ hour: number; label: string }> = [
  { hour: 6, label: '6a' },
  { hour: 0, label: '12a' },
  { hour: 18, label: '6p' },
  { hour: 12, label: '12p' },
];

function dayScrubberTicks(slotIsos: string[]): TimelineChartTick[] {
  if (slotIsos.length === 0) return [];
  const n = Math.max(1, slotIsos.length);
  return DAY_SCRUBBER_TICK_TARGETS.map(({ hour, label }) => {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < slotIsos.length; i += 1) {
      const d = new Date(slotIsos[i]);
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
    .sort((a, b) => a.position - b.position)
    .filter((tick, idx, arr) => idx === 0 || tick.idx !== arr[idx - 1].idx)
    .map(({ position, label }) => ({ position, label }));
}

/**
 * Among readings in [slotMs, slotMs + 1h), pick the one closest to the hour top.
 * Works for legacy 10-minute rows and new hourly rows alike.
 */
function matchReadingToHourSlot(
  slotIso: string,
  pairs: AvgAqiPair[],
): { avgAqi: number; selectableTime: string | null } {
  const slotMs = new Date(slotIso).getTime();
  if (!Number.isFinite(slotMs)) return { avgAqi: 0, selectableTime: null };
  const windowEndMs = slotMs + HOUR_MS;

  let best: { time: string; avgAqi: number; dist: number } | null = null;
  for (const p of pairs) {
    const pm = new Date(p.time).getTime();
    if (!Number.isFinite(pm) || pm < slotMs || pm >= windowEndMs) continue;
    const dist = Math.abs(pm - slotMs);
    if (!best || dist < best.dist || (dist === best.dist && p.time < best.time)) {
      best = { time: p.time, avgAqi: p.avgAqi, dist };
    }
  }

  if (best && Number.isFinite(best.avgAqi)) {
    return { avgAqi: best.avgAqi, selectableTime: best.time };
  }
  return { avgAqi: 0, selectableTime: null };
}

/** 24 hour-top ISO strings for a local calendar day. */
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

/**
 * Hour-top ISO strings for the rolling "Today" chart.
 * Strict last-24h floor through min(now, latest reading), aligned to hour boundaries.
 */
export function generateRolling24hHourlySlotIsos(averagePairs: AvgAqiPair[]): string[] {
  const nowMs = Date.now();
  const strictStart = nowMs - 24 * HOUR_MS;
  let t = alignLocalMsDownToHour(strictStart);

  let maxDataMs = -Infinity;
  for (const p of averagePairs) {
    const x = new Date(p.time).getTime();
    if (Number.isFinite(x)) maxDataMs = Math.max(maxDataMs, x);
  }
  const rawEnd = maxDataMs === -Infinity ? nowMs : maxDataMs;
  const slotEndBound = Math.max(strictStart, Math.min(nowMs, rawEnd));
  const lastSlotStart = alignLocalMsDownToHour(slotEndBound);
  const lastAxisSlot = alignLocalMsDownToHour(nowMs);

  const out: string[] = [];
  while (t <= lastSlotStart && t <= lastAxisSlot) {
    out.push(new Date(t).toISOString());
    t += HOUR_MS;
  }
  return out;
}

function hourBucketIndexForTime(slotIsos: string[], selectedTimeIso: string): number {
  const selMs = new Date(selectedTimeIso).getTime();
  if (!Number.isFinite(selMs)) return -1;

  for (let i = 0; i < slotIsos.length; i += 1) {
    const slotMs = new Date(slotIsos[i]).getTime();
    if (!Number.isFinite(slotMs)) continue;
    if (selMs >= slotMs && selMs < slotMs + HOUR_MS) return i;
  }

  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slotIsos.length; i += 1) {
    const slotMs = new Date(slotIsos[i]).getTime();
    if (!Number.isFinite(slotMs)) continue;
    const d = Math.abs(slotMs - selMs);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestD <= HOUR_MS ? bestI : -1;
}

/** Build scrub chart data for hourly Day-mode slots. */
export function buildHourlyTimelineChart(
  slotIsos: string[],
  averagePairs: AvgAqiPair[],
  selectedTimeIso: string | null,
): TimelineChart {
  const sortedSlots = [...slotIsos]
    .filter((iso) => Number.isFinite(new Date(iso).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const n = Math.max(1, sortedSlots.length);

  const points: TimelineChartPoint[] = sortedSlots.map((iso, i) => {
    const { avgAqi, selectableTime } = matchReadingToHourSlot(iso, averagePairs);
    return {
      time: iso,
      avgAqi: Number.isFinite(avgAqi) ? avgAqi : 0,
      position: n <= 1 ? 0 : i / (n - 1),
      selectableTime,
    };
  });

  const ticks = dayScrubberTicks(sortedSlots);

  const selectedIndex =
    selectedTimeIso && sortedSlots.length > 0
      ? hourBucketIndexForTime(sortedSlots, selectedTimeIso)
      : -1;

  return {
    points,
    ticks,
    selectedPosition:
      sortedSlots.length <= 1 ? 0 : selectedIndex >= 0 ? selectedIndex / (sortedSlots.length - 1) : 1,
  };
}
