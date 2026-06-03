/**
 * Shared air-quality data layer for the map and graph tabs (mounted once in App.tsx).
 *
 * Live mode: poll PurpleAir + Clarity every POLL_INTERVAL_MS, show latest timestamp.
 * Historical mode: scrub timeline → cache or fetch snapshot, recompute kriging per slot.
 *
 * Consumers receive `sensors` / `kriging` already switched for live vs historical;
 * they should not branch on `viewingLive` for display data (only for UX like reminders).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClarityRow, CurrentKrigingRow, DailySensorAqiRow, PurpleAirRow } from '../lib/shell/supabase';
import { pm25ToAqi } from '../lib/shell/airQualityBreakpoints';
import {
  fetchDistinctPipelineTimes,
  fetchDailySensorAqiAtRecordedTime,
  fetchDailySensorAqiBetweenRecordedTimes,
  fetchSensorReadingsBetweenRecordedTimes,
  fetchSensorReadingsAtRecordedTime,
  type FetchError,
} from '../lib/shell/fetchAirQuality';
import { HEATMAP_GRID_STEPS, recomputeKrigingFromSensors } from '../lib/map/recomputeKriging';
import { normalizeSensorIndex, type SensorPoint } from '../lib/map/sensorTypes';

export type { SensorPoint, SensorSource } from '../lib/map/sensorTypes';

/** Live sensor poll interval (PurpleAir + Clarity). */
const POLL_INTERVAL_MS = 30_000;
/** Extra window on rolling 24h queries so pipeline `time` and client clocks do not clip rows. */
const ROLLING_24H_TIME_WINDOW_BUFFER_MS = 15 * 60 * 1000;
/** Rolling window for the map timeline scrubber and live poll queries. */
const TIMELINE_HOURS_BACK = 24;
/** Grid resolution for client-side kriging on historical slots (matches heatmap). */
const HISTORICAL_KRIGING_GRID_STEPS = HEATMAP_GRID_STEPS;

/** Query window with buffer so pipeline `time` values and client clock skew do not clip edge rows. */
function rollingRecordedTimeBounds(): { fromIso: string; toIso: string } {
  const nowMs = Date.now();
  const buf = ROLLING_24H_TIME_WINDOW_BUFFER_MS;
  return {
    fromIso: new Date(nowMs - TIMELINE_HOURS_BACK * 60 * 60 * 1000 - buf).toISOString(),
    toIso: new Date(nowMs + buf).toISOString(),
  };
}

/** Public shape returned by `useSsfAirQuality` (minus `refresh`). */
export type SsfAirQualityState = {
  purpleAir: PurpleAirRow[];
  clarity: ClarityRow[];
  kriging: CurrentKrigingRow[];
  sensors: SensorPoint[];
  loading: boolean;
  error: FetchError | null;
  /** Oldest → newest pipeline `time` values for the timeline scrubber. */
  timelineTimesAsc: string[];
  timelineIndex: number;
  setTimelineIndex: (index: number) => void;
  selectRecordedTime: (recordedTime: string) => void;
  /** True when the scrubber is at the newest snapshot (uses live-polled data). */
  viewingLive: boolean;
  /** Loading a historical snapshot from Supabase (scrubber not at live end). */
  timelineLoading: boolean;
  insufficientData: boolean;
  liveAverageAqi: number | null;
  averageAqiTimeseries: Array<{ time: string; avgAqi: number }>;
};

/** Normalize PurpleAir + Clarity rows into map-ready points; drops invalid coords/pm25. */
function toSensorPoints(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): SensorPoint[] {
  const out: SensorPoint[] = [];
  for (const r of purple ?? []) {
    const sensorIndex = normalizeSensorIndex(r.sensor_index);
    if (
      r.pm25 == null ||
      !Number.isFinite(r.latitude) ||
      !Number.isFinite(r.longitude) ||
      sensorIndex == null
    ) {
      continue;
    }
    out.push({
      sensorIndex,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'purple_air',
      time: r.time,
    });
  }
  for (const r of clarity ?? []) {
    const sensorIndex = normalizeSensorIndex(r.sensor_index);
    if (
      r.pm25 == null ||
      !Number.isFinite(r.latitude) ||
      !Number.isFinite(r.longitude) ||
      sensorIndex == null
    ) {
      continue;
    }
    out.push({
      sensorIndex,
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

/** Same as `toSensorPoints`, but for pre-aggregated `daily_sensor_aqi` rows. */
function toDailySensorPoints(rows: DailySensorAqiRow[] | null): SensorPoint[] {
  const out: SensorPoint[] = [];
  for (const r of rows ?? []) {
    const sensorIndex = normalizeSensorIndex(r.sensor_index);
    if (
      r.pm25 == null ||
      !Number.isFinite(r.latitude) ||
      !Number.isFinite(r.longitude) ||
      sensorIndex == null
    ) {
      continue;
    }
    out.push({
      sensorIndex,
      name: r.name ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: r.source ?? 'daily_sensor_aqi',
      time: r.time,
    });
  }
  return out;
}

/** Bucket daily AQI rows by pipeline `time` for timeline cache seeding. */
function groupDailyRowsByTime(rows: DailySensorAqiRow[]): Map<string, DailySensorAqiRow[]> {
  const grouped = new Map<string, DailySensorAqiRow[]>();
  for (const row of rows) {
    const t = row.time;
    if (!t) continue;
    const curr = grouped.get(t);
    if (curr) curr.push(row);
    else grouped.set(t, [row]);
  }
  return grouped;
}

/** Group live sensor readings by `time` so each scrubber slot has a full snapshot. */
function groupSensorsByRecordedTime(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): Map<string, SensorPoint[]> {
  const grouped = new Map<string, SensorPoint[]>();
  const append = (rows: SensorPoint[]) => {
    for (const row of rows) {
      if (!row.time) continue;
      const existing = grouped.get(row.time);
      if (existing) existing.push(row);
      else grouped.set(row.time, [row]);
    }
  };
  append(toSensorPoints(purple, null));
  append(toSensorPoints(null, clarity));
  return grouped;
}

/** Union timeline ISO strings and sort oldest → newest. */
function mergeTimesAsc(prev: string[], additions: readonly string[]): string[] {
  const s = new Set(prev);
  for (const a of additions) {
    if (a) s.add(a);
  }
  return Array.from(s).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

/** Per-timestamp mean AQI across all sensors (graph tab timeseries). */
function buildAverageAqiTimeseries(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): Array<{ time: string; avgAqi: number }> {
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

/**
 * Drop timeline slots outside the rolling 24h window.
 * `preserveIso` keeps a calendar-picked timestamp visible even when it falls outside the window.
 */
function trimTimesToRollingDay(timesAsc: string[], preserveIso?: string | null): string[] {
  const now = Date.now();
  const floor = now - TIMELINE_HOURS_BACK * 60 * 60 * 1000;
  const ceiling = now;
  const trimmed = timesAsc.filter((iso) => {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= floor && t <= ceiling;
  });
  if (preserveIso && timesAsc.includes(preserveIso) && !trimmed.includes(preserveIso)) {
    return mergeTimesAsc(trimmed, [preserveIso]);
  }
  return trimmed;
}

/** Cached or fetched display payload for one timeline timestamp. */
type HistoricalSnapshot = { sensors: SensorPoint[]; kriging: CurrentKrigingRow[]; insufficientData: boolean };

/**
 * Single source of truth for SSF air quality: live polling, timeline scrubbing, and kriging.
 * Mount once in App.tsx; pass state into map and graph screens.
 */
export function useSsfAirQuality(): SsfAirQualityState & { refresh: () => Promise<void> } {
  // Live-end state: updated every poll; drives map/graph when scrubber is at newest time.
  const [purpleAir, setPurpleAir] = useState<PurpleAirRow[]>([]);
  const [clarity, setClarity] = useState<ClarityRow[]>([]);
  const [kriging, setKriging] = useState<CurrentKrigingRow[]>([]);
  const [sensors, setSensors] = useState<SensorPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FetchError | null>(null);

  // Timeline scrubber: index into `timelineTimesAsc`; historical branch uses `historicalDisplay`.
  const [timelineTimesAsc, setTimelineTimesAsc] = useState<string[]>([]);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [historicalDisplay, setHistoricalDisplay] = useState<HistoricalSnapshot | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [insufficientData, setInsufficientData] = useState(false);

  const historicalCacheRef = useRef<Map<string, HistoricalSnapshot>>(new Map());
  /** Fallback kriging when a sparse historical slot cannot be recomputed client-side. */
  const latestKrigingRef = useRef<CurrentKrigingRow[]>([]);
  /** True once timeline index has been initialized to the live end at least once. */
  const timelineInitRef = useRef(false);
  /** Set by selectRecordedTime so trimTimesToRollingDay does not drop calendar picks outside 24h. */
  const pinnedHistoricalTimeRef = useRef<string | null>(null);
  /** Ignore async setState after unmount (poll + fetch effects). */
  const mounted = useRef(true);
  /** After the first successful map payload, background polls skip the loading overlay. */
  const hasDisplayedMapDataRef = useRef(false);

  /** Client-side kriging for one timestamp (live latest slot and historical scrub). */
  const recomputeHistoricalKriging = useCallback((sensorRows: SensorPoint[], recordedTime: string) => {
    if (sensorRows.length === 0) return [];
    return recomputeKrigingFromSensors(sensorRows, recordedTime, {
      latSteps: HISTORICAL_KRIGING_GRID_STEPS,
      lonSteps: HISTORICAL_KRIGING_GRID_STEPS,
    });
  }, []);

  useEffect(() => {
    latestKrigingRef.current = kriging;
  }, [kriging]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Boot: seed timeline from pipeline distinct times and daily AQI rows (parallel effects below).
  // Either effect may set timelineInitRef; last successful fetch wins the initial live-end index.
  useEffect(() => {
    void (async () => {
      const { times, error: tErr } = await fetchDistinctPipelineTimes(TIMELINE_HOURS_BACK);
      if (!mounted.current || tErr) return;
      setTimelineTimesAsc((prev) => {
        const merged = trimTimesToRollingDay(mergeTimesAsc(prev, times), pinnedHistoricalTimeRef.current);
        if (!timelineInitRef.current && merged.length > 0) {
          timelineInitRef.current = true;
          setTimelineIndex(merged.length - 1);
        }
        return merged;
      });
    })();
  }, []);

  // Boot: prefetch daily_sensor_aqi snapshots into historicalCacheRef for faster scrubbing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { fromIso, toIso } = rollingRecordedTimeBounds();
      const dayRes = await fetchDailySensorAqiBetweenRecordedTimes(fromIso, toIso);
      if (cancelled || !mounted.current || dayRes.error || !dayRes.data || dayRes.data.length === 0) return;

      const byTime = groupDailyRowsByTime(dayRes.data);
      const times = Array.from(byTime.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      for (const t of times) {
        const rows = byTime.get(t) ?? [];
        const sensorRows = toDailySensorPoints(rows);
        if (sensorRows.length === 0) continue;
        const snapshot: HistoricalSnapshot = {
          sensors: sensorRows,
          kriging: recomputeHistoricalKriging(sensorRows, t),
          insufficientData: false,
        };
        historicalCacheRef.current.set(t, snapshot);
      }

      setTimelineTimesAsc((prev) => {
        const merged = trimTimesToRollingDay(mergeTimesAsc(prev, times), pinnedHistoricalTimeRef.current);
        if (!timelineInitRef.current && merged.length > 0) {
          timelineInitRef.current = true;
          setTimelineIndex(merged.length - 1);
        }
        return merged;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Poll PurpleAir + Clarity for the rolling window; refresh live state and warm the cache. */
  const loadSensors = useCallback(async () => {
    const showLoadingOverlay = !hasDisplayedMapDataRef.current;
    if (showLoadingOverlay) setLoading(true);
    setError(null);
    try {
      const { fromIso, toIso } = rollingRecordedTimeBounds();
      const sensorsRes = await fetchSensorReadingsBetweenRecordedTimes(fromIso, toIso);
      if (!mounted.current) return;

      const pa = sensorsRes.purpleAir ?? [];
      const cl = sensorsRes.clarity ?? [];
      const sensorsErr = sensorsRes.error;
      let liveKriging: CurrentKrigingRow[] = [];

      // Preserve whichever feed succeeds so the map can still render partially.
      if (!sensorsErr || pa.length > 0 || cl.length > 0) {
        const groupedByTime = groupSensorsByRecordedTime(pa, cl);
        const times = Array.from(groupedByTime.keys()).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const latestTime = times[times.length - 1] ?? null;
        const sensorPoints = latestTime ? (groupedByTime.get(latestTime) ?? []) : [];
        // Keep live and historical snapshots on the same kriging pipeline.
        liveKriging = recomputeHistoricalKriging(sensorPoints, latestTime ?? new Date().toISOString());
        setError(sensorsErr ?? null);
        setPurpleAir(pa);
        setClarity(cl);
        setSensors(sensorPoints);
        setKriging(liveKriging);
        if (sensorPoints.length > 0 || liveKriging.length > 0) {
          hasDisplayedMapDataRef.current = true;
        }
        for (const t of times) {
          const rows = groupedByTime.get(t) ?? [];
          if (rows.length === 0) continue;
          const snapshot: HistoricalSnapshot = {
            sensors: rows,
            kriging: recomputeHistoricalKriging(rows, t),
            insufficientData: false,
          };
          historicalCacheRef.current.set(t, snapshot);
        }
        setTimelineTimesAsc((prev) => {
          const merged = trimTimesToRollingDay(mergeTimesAsc(prev, times), pinnedHistoricalTimeRef.current);
          if (merged.length > 0) timelineInitRef.current = true;
          // During live poll: stay at live end if already there; else preserve scrub position clamped.
          setTimelineIndex((idx) => {
            if (merged.length === 0) return 0;
            if (prev.length === 0) return merged.length - 1;
            if (idx === prev.length - 1) return merged.length - 1;
            return Math.min(idx, merged.length - 1);
          });
          return merged;
        });
      } else {
        setError(sensorsErr ?? null);
        setPurpleAir([]);
        setClarity([]);
        setSensors([]);
        setKriging([]);
      }
    } finally {
      if (mounted.current && showLoadingOverlay) setLoading(false);
    }
  }, []);

  const viewingLive = useMemo(
    () => timelineTimesAsc.length > 0 && timelineIndex === timelineTimesAsc.length - 1,
    [timelineIndex, timelineTimesAsc],
  );

  useEffect(() => {
    if (!viewingLive) return;
    pinnedHistoricalTimeRef.current = null;
  }, [viewingLive]);

  /** Jump scrubber to a calendar-picked ISO time (may lie outside the default 24h window). */
  const selectRecordedTime = useCallback((recordedTime: string) => {
    pinnedHistoricalTimeRef.current = recordedTime;
    setTimelineTimesAsc((prev) => {
      const merged = trimTimesToRollingDay(mergeTimesAsc(prev, [recordedTime]), recordedTime);
      const idx = merged.findIndex((t) => t === recordedTime);
      if (idx >= 0) setTimelineIndex(idx);
      return merged;
    });
  }, []);

  // When scrubber leaves live end: resolve snapshot from cache or Supabase fetch.
  useEffect(() => {
    if (timelineTimesAsc.length === 0) return;
    const liveEnd = timelineTimesAsc.length - 1;
    if (timelineIndex === liveEnd) {
      setHistoricalDisplay(null);
      setTimelineLoading(false);
      setInsufficientData(false);
      return;
    }

    const t = timelineTimesAsc[timelineIndex];
    const cached = historicalCacheRef.current.get(t);
    if (cached) {
      // Recompute on each selection so switching away from live always refreshes
      // historical kriging with the configured 20x20 surface.
      const recomputed = recomputeHistoricalKriging(cached.sensors, t);
      const refreshed: HistoricalSnapshot = {
        sensors: cached.sensors,
        kriging: recomputed.length > 0 ? recomputed : cached.kriging,
        insufficientData: cached.insufficientData,
      };
      setHistoricalDisplay(refreshed);
      setInsufficientData(refreshed.insufficientData);
      setTimelineLoading(false);
      return;
    }

    let cancelled = false;
    setHistoricalDisplay(null);
    setTimelineLoading(true);
    setInsufficientData(false);
    void (async () => {
      const [dailyRes, sRes] = await Promise.all([
        fetchDailySensorAqiAtRecordedTime(t),
        fetchSensorReadingsAtRecordedTime(t),
      ]);
      if (cancelled || !mounted.current) return;
      const dailySensors = toDailySensorPoints(dailyRes.data);
      const sensorRows = dailySensors.length > 0 ? dailySensors : toSensorPoints(sRes.purpleAir, sRes.clarity);
      const recomputed = recomputeHistoricalKriging(sensorRows, t);
      // A single sensor datapoint is enough to consider the timestamp usable.
      // Kriging may be missing for sparse historical slots, but the snapshot is still informative.
      const isInsufficient = sensorRows.length === 0;
      // When the slot is insufficient, blank the heatmap too instead of bleeding live kriging through.
      const krigingRows = isInsufficient
        ? []
        : recomputed.length > 0
          ? recomputed
          : latestKrigingRef.current;
      if (sRes.error) {
        setError((prev) => prev ?? sRes.error ?? null);
      }
      const snapshot: HistoricalSnapshot = {
        sensors: sensorRows,
        kriging: krigingRows,
        insufficientData: isInsufficient,
      };
      if (isInsufficient) {
        setHistoricalDisplay(snapshot);
        setInsufficientData(true);
        setTimelineLoading(false);
        return;
      }
      historicalCacheRef.current.set(t, snapshot);
      setHistoricalDisplay(snapshot);
      setInsufficientData(false);
      setTimelineLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [recomputeHistoricalKriging, timelineIndex, timelineTimesAsc]);

  // Public API: swap live poll state vs historical snapshot here so screens stay dumb.
  const displaySensors = viewingLive ? sensors : (historicalDisplay?.sensors ?? []);
  const displayKriging = viewingLive ? kriging : (historicalDisplay?.kriging ?? []);
  /** Mean AQI at the live-end sensor set (panel headline when viewing live). */
  const liveAverageAqi = useMemo(() => {
    if (sensors.length === 0) return null;
    const avgPm = sensors.reduce((acc, s) => acc + s.pm25, 0) / sensors.length;
    if (!Number.isFinite(avgPm)) return null;
    return pm25ToAqi(avgPm);
  }, [sensors]);
  const averageAqiTimeseries = useMemo(
    () => buildAverageAqiTimeseries(purpleAir, clarity),
    [clarity, purpleAir],
  );

  useEffect(() => {
    // Bootstrap the app with full latest sensor snapshots first.
    void loadSensors();
    const sensorTimer = setInterval(() => void loadSensors(), POLL_INTERVAL_MS);
    return () => {
      clearInterval(sensorTimer);
    };
  }, [loadSensors]);

  return {
    purpleAir,
    clarity,
    kriging: displayKriging,
    sensors: displaySensors,
    loading,
    error,
    timelineTimesAsc,
    timelineIndex,
    setTimelineIndex,
    selectRecordedTime,
    viewingLive,
    timelineLoading,
    insufficientData,
    liveAverageAqi,
    averageAqiTimeseries,
    refresh: loadSensors,
  };
}
