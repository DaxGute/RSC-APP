import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { POLL_INTERVAL_MS } from '../lib/constants/ssf';
import type { ClarityRow, CurrentKrigingRow, PurpleAirRow } from '../lib/database.types';
import {
  fetchCurrentKrigingGrid,
  fetchCurrentSensorReadings,
  fetchDistinctPipelineTimes,
  fetchSensorReadingsAtRecordedTime,
  type FetchError,
} from '../lib/fetchAirQuality';
import type { SensorPoint } from '../lib/sensorTypes';

export type { SensorPoint, SensorSource } from '../lib/sensorTypes';

const TIMELINE_HOURS_BACK = 24;

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
  /** True when the scrubber is at the newest snapshot (uses live-polled data). */
  viewingLive: boolean;
  /** Loading a historical snapshot from Supabase (scrubber not at live end). */
  timelineLoading: boolean;
};

function toSensorPoints(
  purple: PurpleAirRow[] | null,
  clarity: ClarityRow[] | null,
): SensorPoint[] {
  const out: SensorPoint[] = [];
  for (const r of purple ?? []) {
    if (r.pm25 == null || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      sensorIndex: r.sensor_index,
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
      latitude: r.latitude,
      longitude: r.longitude,
      pm25: r.pm25,
      source: 'clarity',
      time: r.time,
    });
  }
  return out;
}

function mergeTimesAsc(prev: string[], additions: readonly string[]): string[] {
  const s = new Set(prev);
  for (const a of additions) {
    if (a) s.add(a);
  }
  return Array.from(s).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

function mergeTimesAscWithNulls(prev: string[], additions: (string | null)[]): string[] {
  return mergeTimesAsc(
    prev,
    additions.filter((x): x is string => Boolean(x)),
  );
}

/** Cached historical sensor rows only; kriging always comes from the latest `fetchCurrentKrigingGrid` poll. */
type HistoricalSensors = { sensors: SensorPoint[] };

export function useSsfAirQuality(): SsfAirQualityState & { refresh: () => Promise<void> } {
  const [purpleAir, setPurpleAir] = useState<PurpleAirRow[]>([]);
  const [clarity, setClarity] = useState<ClarityRow[]>([]);
  const [kriging, setKriging] = useState<CurrentKrigingRow[]>([]);
  const [sensors, setSensors] = useState<SensorPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FetchError | null>(null);

  const [timelineTimesAsc, setTimelineTimesAsc] = useState<string[]>([]);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [historicalDisplay, setHistoricalDisplay] = useState<HistoricalSensors | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const historicalCacheRef = useRef<Map<string, HistoricalSensors>>(new Map());
  const timelineInitRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const { times, error: tErr } = await fetchDistinctPipelineTimes(TIMELINE_HOURS_BACK);
      if (!mounted.current || tErr) return;
      setTimelineTimesAsc((prev) => {
        const merged = mergeTimesAsc(prev, times);
        if (!timelineInitRef.current && merged.length > 0) {
          timelineInitRef.current = true;
          setTimelineIndex(merged.length - 1);
        }
        return merged;
      });
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sensorsRes, gridRes] = await Promise.all([
        fetchCurrentSensorReadings(),
        fetchCurrentKrigingGrid(),
      ]);

      if (!mounted.current) return;

      const err = sensorsRes.error ?? gridRes.error;
      if (err) {
        setError(err);
        setPurpleAir([]);
        setClarity([]);
        setKriging([]);
        setSensors([]);
        return;
      }

      const pa = sensorsRes.purpleAir ?? [];
      const cl = sensorsRes.clarity ?? [];
      const kg = gridRes.data ?? [];
      setPurpleAir(pa);
      setClarity(cl);
      setKriging(kg);
      setSensors(toSensorPoints(pa, cl));
      const rt = sensorsRes.recordedTimes;

      setTimelineTimesAsc((prev) => {
        const merged = mergeTimesAscWithNulls(prev, [rt.purpleAir, rt.clarity]);
        if (merged.length > 0) timelineInitRef.current = true;
        setTimelineIndex((idx) => {
          if (merged.length === 0) return 0;
          if (prev.length === 0) return merged.length - 1;
          if (idx === prev.length - 1) return merged.length - 1;
          return Math.min(idx, merged.length - 1);
        });
        return merged;
      });
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const viewingLive = useMemo(
    () => timelineTimesAsc.length > 0 && timelineIndex === timelineTimesAsc.length - 1,
    [timelineIndex, timelineTimesAsc],
  );

  useEffect(() => {
    if (timelineTimesAsc.length === 0) return;
    const liveEnd = timelineTimesAsc.length - 1;
    if (timelineIndex === liveEnd) {
      setHistoricalDisplay(null);
      setTimelineLoading(false);
      return;
    }

    const t = timelineTimesAsc[timelineIndex];
    const cached = historicalCacheRef.current.get(t);
    if (cached) {
      setHistoricalDisplay(cached);
      setTimelineLoading(false);
      return;
    }

    let cancelled = false;
    setHistoricalDisplay(null);
    setTimelineLoading(true);
    void (async () => {
      const sRes = await fetchSensorReadingsAtRecordedTime(t);
      if (cancelled || !mounted.current) return;
      if (sRes.error) {
        setHistoricalDisplay({ sensors: [] });
        setTimelineLoading(false);
        return;
      }
      const bundle: HistoricalSensors = {
        sensors: toSensorPoints(sRes.purpleAir, sRes.clarity),
      };
      historicalCacheRef.current.set(t, bundle);
      setHistoricalDisplay(bundle);
      setTimelineLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [timelineIndex, timelineTimesAsc]);

  const displaySensors = viewingLive ? sensors : (historicalDisplay?.sensors ?? []);
  /** Interpolated grid is only loaded for the current pipeline output; overlay it for every timeline position. */
  const displayKriging = kriging;

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

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
    viewingLive,
    timelineLoading,
    refresh: load,
  };
}
