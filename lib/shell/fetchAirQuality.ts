/**
 * Supabase reads for PurpleAir, Clarity, and daily AQI tables.
 * Handles PostgREST row limits via paginated `.range()` where full snapshots are needed.
 */

import { supabase } from './supabase';

import type { ClarityRow, DailySensorAqiRow, PurpleAirRow } from './supabase';

/** Normalized PostgREST error surfaced to hooks and screens. */
export type FetchError = { message: string; details?: string };

/**
 * PostgREST `max-rows` default on Supabase is 1000. If you request a larger
 * `.range()`, the server still returns at most this many rows — so comparing
 * `batch.length` to a bigger "page size" stops pagination after the first batch.
 */
const POSTGREST_MAX_ROWS_PER_REQUEST = 1000;

/** Cap when selecting all sensors for one pipeline `time` (many rows). */
const SNAPSHOT_ROW_CAP = 50_000;

/**
 * Paginated range reads load every row in `[from, to]` until a short page; this
 * ceiling only guards pathological tables (memory / request storms).
 */
const SENSOR_RANGE_HARD_MAX = 2_000_000;

/**
 * Must stay at or below PostgREST `max-rows` for the project (Supabase default 1000).
 */
const SENSOR_RANGE_PAGE_SIZE = POSTGREST_MAX_ROWS_PER_REQUEST;

/** Scanning `time` (+ tie-breaker) for distinct pipeline stamps. */
const PIPELINE_TIME_PAGE_SIZE = POSTGREST_MAX_ROWS_PER_REQUEST;
const PIPELINE_TIME_SCAN_HARD_MAX = 2_000_000;

const SENSOR_COLUMNS = 'sensor_index,name,latitude,longitude,pm25,time';
const DAILY_SENSOR_AQI_COLUMNS =
  'source,sensor_index,name,latitude,longitude,pm25,aqi,time,reading_count';

/** Filters for single-table PurpleAir / Clarity selects. */
export type SensorTimeQuery = {
  /**
   * Exact match on the pipeline `time` column (ISO 8601).
   * Returns every sensor row recorded at that instant — use for “this run” or a known timestamp.
   */
  atRecordedTime?: string;
  /** Inclusive lower bound on `time` (ISO 8601). Ignored if `atRecordedTime` is set. */
  fromRecordedTime?: string;
  /** Inclusive upper bound on `time` (ISO 8601). Ignored if `atRecordedTime` is set. */
  toRecordedTime?: string;
  /**
   * Max rows when not using `atRecordedTime` (default 500).
   * For `atRecordedTime`, a high internal cap applies instead.
   */
  limit?: number;
};

function mapError(err: { message: string; details?: string; hint?: string }): FetchError {
  return {
    message: err.message,
    details: [err.details, err.hint].filter(Boolean).join(' — ') || undefined,
  };
}

function applySensorTimeFilters<T extends { gte: Function; lte: Function; eq: Function; order: Function; limit: Function }>(
  query: T,
  options: SensorTimeQuery | undefined,
): T {
  let q = query;
  if (options?.atRecordedTime) {
    q = q.eq('time', options.atRecordedTime);
    q = q.order('sensor_index', { ascending: true });
  } else {
    if (options?.fromRecordedTime) q = q.gte('time', options.fromRecordedTime);
    if (options?.toRecordedTime) q = q.lte('time', options.toRecordedTime);
    q = q.order('time', { ascending: false });
  }
  if (options?.atRecordedTime) {
    q = q.limit(SNAPSHOT_ROW_CAP);
  } else {
    q = q.limit(options?.limit ?? 500);
  }
  return q;
}

/** PurpleAir rows for one pipeline `time`, a range, or the latest N by `time`. */
export async function fetchPurpleAirReadings(
  options?: SensorTimeQuery,
): Promise<{ data: PurpleAirRow[] | null; error: FetchError | null }> {
  const base = supabase.from('purple_air').select(SENSOR_COLUMNS);
  const { data, error } = await applySensorTimeFilters(base, options);

  if (error) {
    return { data: null, error: mapError(error) };
  }
  return { data: data as PurpleAirRow[], error: null };
}

/** Clarity rows — same query shape as `fetchPurpleAirReadings`. */
export async function fetchClarityReadings(
  options?: SensorTimeQuery,
): Promise<{ data: ClarityRow[] | null; error: FetchError | null }> {
  const base = supabase.from('clarity').select(SENSOR_COLUMNS);
  const { data, error } = await applySensorTimeFilters(base, options);

  if (error) {
    return { data: null, error: mapError(error) };
  }
  return { data: data as ClarityRow[], error: null };
}

/** Latest pipeline `time` value per table (may differ slightly if one source is empty or lagging). */
export async function getLatestRecordedTimes(): Promise<{
  purpleAir: string | null;
  clarity: string | null;
  error: FetchError | null;
}> {
  const [p, c] = await Promise.all([
    supabase.from('purple_air').select('time').order('time', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('clarity').select('time').order('time', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const err = p.error ?? c.error;
  if (err) {
    return { purpleAir: null, clarity: null, error: mapError(err) };
  }
  const pt = p.data as { time: string } | null;
  const ct = c.data as { time: string } | null;
  return {
    purpleAir: pt?.time ?? null,
    clarity: ct?.time ?? null,
    error: null,
  };
}

async function fetchPurpleAirReadingsBetweenPaginated(
  fromRecordedTime: string,
  toRecordedTime: string,
): Promise<{ data: PurpleAirRow[] | null; error: FetchError | null }> {
  const rows: PurpleAirRow[] = [];
  let offset = 0;
  while (rows.length < SENSOR_RANGE_HARD_MAX) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('purple_air')
      .select(SENSOR_COLUMNS)
      .gte('time', fromRecordedTime)
      .lte('time', toRecordedTime)
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as PurpleAirRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    }
    if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

async function fetchClarityReadingsBetweenPaginated(
  fromRecordedTime: string,
  toRecordedTime: string,
): Promise<{ data: ClarityRow[] | null; error: FetchError | null }> {
  const rows: ClarityRow[] = [];
  let offset = 0;
  while (rows.length < SENSOR_RANGE_HARD_MAX) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('clarity')
      .select(SENSOR_COLUMNS)
      .gte('time', fromRecordedTime)
      .lte('time', toRecordedTime)
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as ClarityRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    }
    if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

async function fetchPurpleAirAtRecordedTimePaginated(
  recordedTime: string,
): Promise<{ data: PurpleAirRow[] | null; error: FetchError | null }> {
  const rows: PurpleAirRow[] = [];
  let offset = 0;
  while (rows.length < SNAPSHOT_ROW_CAP) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('purple_air')
      .select(SENSOR_COLUMNS)
      .eq('time', recordedTime)
      .order('sensor_index', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as PurpleAirRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SNAPSHOT_ROW_CAP) break;
    }
    if (rows.length >= SNAPSHOT_ROW_CAP) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

async function fetchClarityAtRecordedTimePaginated(
  recordedTime: string,
): Promise<{ data: ClarityRow[] | null; error: FetchError | null }> {
  const rows: ClarityRow[] = [];
  let offset = 0;
  while (rows.length < SNAPSHOT_ROW_CAP) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('clarity')
      .select(SENSOR_COLUMNS)
      .eq('time', recordedTime)
      .order('sensor_index', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as ClarityRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SNAPSHOT_ROW_CAP) break;
    }
    if (rows.length >= SNAPSHOT_ROW_CAP) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/**
 * All PurpleAir + Clarity rows for the same pipeline `time`.
 * Use when you already know the run timestamp (e.g. from a previous call or UI).
 */
export async function fetchSensorReadingsAtRecordedTime(recordedTime: string): Promise<{
  purpleAir: PurpleAirRow[] | null;
  clarity: ClarityRow[] | null;
  error: FetchError | null;
}> {
  const [purple, clarity] = await Promise.all([
    fetchPurpleAirAtRecordedTimePaginated(recordedTime),
    fetchClarityAtRecordedTimePaginated(recordedTime),
  ]);
  const err = purple.error ?? clarity.error;
  return {
    purpleAir: purple.data,
    clarity: clarity.data,
    error: err,
  };
}

/**
 * All PurpleAir + Clarity rows in an inclusive recorded-time range.
 * Use for day-level summaries (e.g., calendar heat cells).
 */
export async function fetchSensorReadingsBetweenRecordedTimes(
  fromRecordedTime: string,
  toRecordedTime: string,
): Promise<{
  purpleAir: PurpleAirRow[] | null;
  clarity: ClarityRow[] | null;
  error: FetchError | null;
}> {
  const [purple, clarity] = await Promise.all([
    fetchPurpleAirReadingsBetweenPaginated(fromRecordedTime, toRecordedTime),
    fetchClarityReadingsBetweenPaginated(fromRecordedTime, toRecordedTime),
  ]);
  const err = purple.error ?? clarity.error;
  return {
    purpleAir: purple.data,
    clarity: clarity.data,
    error: err,
  };
}

/** Paginated `daily_sensor_aqi` rows in an inclusive `time` range. */
export async function fetchDailySensorAqiBetweenRecordedTimes(
  fromRecordedTime: string,
  toRecordedTime: string,
): Promise<{
  data: DailySensorAqiRow[] | null;
  error: FetchError | null;
}> {
  const rows: DailySensorAqiRow[] = [];
  let offset = 0;
  while (rows.length < SENSOR_RANGE_HARD_MAX) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('daily_sensor_aqi')
      .select(DAILY_SENSOR_AQI_COLUMNS)
      .gte('time', fromRecordedTime)
      .lte('time', toRecordedTime)
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .order('source', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as DailySensorAqiRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    }
    if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/** All daily aggregates for one pipeline `time` (both sources). */
export async function fetchDailySensorAqiAtRecordedTime(
  recordedTime: string,
): Promise<{
  data: DailySensorAqiRow[] | null;
  error: FetchError | null;
}> {
  const rows: DailySensorAqiRow[] = [];
  let offset = 0;
  while (rows.length < SNAPSHOT_ROW_CAP) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('daily_sensor_aqi')
      .select(DAILY_SENSOR_AQI_COLUMNS)
      .eq('time', recordedTime)
      .order('sensor_index', { ascending: true })
      .order('source', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as DailySensorAqiRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SNAPSHOT_ROW_CAP) break;
    }
    if (rows.length >= SNAPSHOT_ROW_CAP) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/** Minimal columns (`time`, `aqi`, `pm25`) for the full daily table — calendar year view. */
export async function fetchDailySensorAqiCalendarRows(): Promise<{
  data: DailySensorAqiRow[] | null;
  error: FetchError | null;
}> {
  const rows: DailySensorAqiRow[] = [];
  let offset = 0;
  while (rows.length < SENSOR_RANGE_HARD_MAX) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('daily_sensor_aqi')
      .select('time,aqi,pm25')
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .order('source', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as DailySensorAqiRow[];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

/** Same as `fetchDailySensorAqiCalendarRows` but scoped to one month window. */
export async function fetchDailySensorAqiCalendarRowsForMonth(
  fromRecordedTime: string,
  toRecordedTime: string,
): Promise<{
  data: DailySensorAqiRow[] | null;
  error: FetchError | null;
}> {
  const rows: DailySensorAqiRow[] = [];
  let offset = 0;
  while (rows.length < SENSOR_RANGE_HARD_MAX) {
    const end = offset + SENSOR_RANGE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('daily_sensor_aqi')
      .select('time,aqi,pm25')
      .gte('time', fromRecordedTime)
      .lte('time', toRecordedTime)
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .order('source', { ascending: true })
      .range(offset, end);
    if (error) {
      return { data: null, error: mapError(error) };
    }
    const batch = (data ?? []) as DailySensorAqiRow[];
    if (batch.length === 0) break;
    for (const r of batch) {
      rows.push(r);
      if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    }
    if (rows.length >= SENSOR_RANGE_HARD_MAX) break;
    offset += batch.length;
    if (batch.length < SENSOR_RANGE_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

const HOUR_MS = 60 * 60 * 1000;

/** Extra window on each end of rolling pipeline time scans (clock / ingest skew). */
const ROLLING_24H_TIME_WINDOW_BUFFER_MS = 15 * 60 * 1000;

/**
 * Latest snapshot per source: resolves the newest `time` in each table, then loads all rows for that time.
 * Prefer this for “current” sensor readings when each pipeline run stamps one shared `time`.
 */
export async function fetchCurrentSensorReadings(): Promise<{
  purpleAir: PurpleAirRow[] | null;
  clarity: ClarityRow[] | null;
  recordedTimes: { purpleAir: string | null; clarity: string | null };
  error: FetchError | null;
}> {
  const { purpleAir: tPurple, clarity: tClarity, error: tErr } = await getLatestRecordedTimes();
  if (tErr) {
    return { purpleAir: null, clarity: null, recordedTimes: { purpleAir: null, clarity: null }, error: tErr };
  }

  const [purple, clarity] = await Promise.all([
    tPurple ? fetchPurpleAirAtRecordedTimePaginated(tPurple) : Promise.resolve({ data: [] as PurpleAirRow[], error: null }),
    tClarity ? fetchClarityAtRecordedTimePaginated(tClarity) : Promise.resolve({ data: [] as ClarityRow[], error: null }),
  ]);

  const err = purple.error ?? clarity.error;
  return {
    purpleAir: purple.data,
    clarity: clarity.data,
    recordedTimes: { purpleAir: tPurple, clarity: tClarity },
    error: err,
  };
}

async function collectDistinctPipelineTimesFromTable(
  table: 'purple_air' | 'clarity',
  fromIso: string,
  toIso: string,
  into: Set<string>,
): Promise<FetchError | null> {
  let offset = 0;
  let scanned = 0;
  while (scanned < PIPELINE_TIME_SCAN_HARD_MAX) {
    const end = offset + PIPELINE_TIME_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select('time,sensor_index')
      .gte('time', fromIso)
      .lte('time', toIso)
      .order('time', { ascending: true })
      .order('sensor_index', { ascending: true })
      .range(offset, end);
    if (error) {
      return mapError(error);
    }
    const batch = (data ?? []) as { time: string }[];
    if (batch.length === 0) break;
    for (const row of batch) {
      if (row?.time) into.add(row.time);
    }
    scanned += batch.length;
    if (batch.length < PIPELINE_TIME_PAGE_SIZE) break;
    offset += batch.length;
  }
  return null;
}

/**
 * Distinct pipeline `time` values in the window [now - hoursBack, now], from PurpleAir + Clarity.
 * Sorted ascending (oldest first). Used for timeline scrubbing.
 */
export async function fetchDistinctPipelineTimes(hoursBack: number): Promise<{
  times: string[];
  error: FetchError | null;
}> {
  const nowMs = Date.now();
  const from = new Date(nowMs - hoursBack * HOUR_MS - ROLLING_24H_TIME_WINDOW_BUFFER_MS).toISOString();
  const to = new Date(nowMs).toISOString();
  const set = new Set<string>();
  const [e1, e2] = await Promise.all([
    collectDistinctPipelineTimesFromTable('purple_air', from, to, set),
    collectDistinctPipelineTimesFromTable('clarity', from, to, set),
  ]);
  const err = e1 ?? e2;
  if (err) {
    return { times: [], error: err };
  }
  const times = Array.from(set).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return { times, error: null };
}
