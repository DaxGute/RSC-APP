/**
 * Map tab orchestrator (rendered from App.tsx).
 *
 * Owns UI state that useSsfAirQuality does not: map selection, Day/Month time-filter
 * menus, bottom scrub chart data, alert-location picking, and insufficient-data overlay.
 * Live vs historical map snapshots still come from the parent hook via timelineIndex /
 * selectRecordedTime.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ClarityRow, CurrentKrigingRow, DailySensorAqiRow, PurpleAirRow } from '../../lib/database.types';
import type { FetchError } from '../../lib/fetchAirQuality';
import {
  fetchDailySensorAqiCalendarRows,
  fetchDailySensorAqiCalendarRowsForMonth,
  fetchSensorReadingsBetweenRecordedTimes,
} from '../../lib/fetchAirQuality';
import { pm25ToAqi } from '../../lib/aqiUtils';
import { useAirQualityReminder } from '../../hooks/useAirQualityReminder';
import { regionFromSensorData } from '../../lib/mapRegionFromData';
import type { SensorPoint } from '../../lib/sensorTypes';
import { AlertLocationSelectionBanner } from './panel/AlertLocationSelectionBanner';
import { AqiPanel } from './panel/AqiPanel';
import { MapScaleActions, SsfMap, type SsfMapHandle } from './SsfMap';
import { TimeRangeModule } from './TimeRangeModule';
import { useAppLanguage } from '../../contexts/LanguageProvider';
import {
  displayDayFilterLabel,
  displayMonthFilterLabel,
  formatMapScrubMonthDate,
  mapScreenCopy,
  monthAbbrForChart,
} from '../../lib/mapScreenCopy';
import {
  buildHourlyTimelineChart,
  generateLocalCalendarDayHourlySlotIsos,
  generateRolling24hHourlySlotIsos,
} from '../../lib/mapTimelineHourly';

/** Earliest month listed in the Month submenu (Jan 2019). */
const FILTER_MIN_YEAR = 2019;
/** Bottom inset so TimeRangeModule clears the root tab bar. */
const BOTTOM_TAB_BAR_RESERVE = 6;
/** AqiPanel callout sizing for above/below placement and horizontal shift clamping. */
const CALLOUT_WIDTH = 300;
const CALLOUT_HEIGHT_ESTIMATE = 210;
const CALLOUT_SCREEN_GUTTER = 12;
/** Ignore map taps shortly after AqiPanel / callout touch (shared with SsfMap). */
const PANEL_TOUCH_LOCK_MS = 300;
/** Day/Month filter dropdown enter/exit animation timings (ms) and slide offsets. */
const TIME_FILTER_MAIN_IN_MS = 200;
const TIME_FILTER_SUB_IN_MS = 220;
const TIME_FILTER_SUB_OUT_MS = 170;
const TIME_FILTER_MAIN_OUT_MS = 190;
const TIME_FILTER_MAIN_ENTER_OFFSET_Y = -10;
/** Submenu sits left of Day/Month; slide in from the right (+x) and exit back that way. */
const TIME_FILTER_SUB_SLIDE_OFFSET_X = 16;
const TIME_FILTER_SUB_SWITCH_OUT_MS = 140;
const TIME_FILTER_SUB_SWITCH_IN_MS = 190;
const TIME_FILTER_DROPDOWN_ITEM_HEIGHT = 34;
const TIME_FILTER_SUBMENU_VIEWPORT_HEIGHT = 220;
const TIME_FILTER_SUBMENU_CONTENT_PADDING = 4;

/** Centers the selected Day/Month preset in the scrollable submenu viewport. */
function scrollOffsetForSubmenuIndex(index: number, itemCount: number): number {
  if (index < 0 || itemCount <= 0) return 0;
  const padding = TIME_FILTER_SUBMENU_CONTENT_PADDING;
  const viewport = TIME_FILTER_SUBMENU_VIEWPORT_HEIGHT;
  const itemStride = TIME_FILTER_DROPDOWN_ITEM_HEIGHT;
  const contentHeight = padding * 2 + itemCount * itemStride;
  const maxScroll = Math.max(0, contentHeight - viewport);
  const itemTop = padding + index * itemStride;
  const centered = itemTop - (viewport - itemStride) / 2;
  return Math.min(Math.max(0, centered), maxScroll);
}

/** Month chart buckets: use stored AQI or derive from PM2.5 when needed. */
function resolveRowAqi(row: DailySensorAqiRow): number | null {
  if (row.aqi != null && Number.isFinite(row.aqi)) return row.aqi;
  if (row.pm25 != null && Number.isFinite(row.pm25)) {
    const derived = pm25ToAqi(row.pm25);
    return derived != null && Number.isFinite(derived) ? derived : null;
  }
  return null;
}

/** Local calendar date key `YYYY-MM-DD` for bucket grouping and Today checks. */
function dateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local calendar month key `YYYY-MM` for month-filter chart buckets. */
function monthKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parses submenu labels like "Mar '24" into the first day of that month. */
function monthLabelToStartDate(label: string): Date {
  const now = new Date();
  if (label === 'This Month') return new Date(now.getFullYear(), now.getMonth(), 1);
  const m = label.match(/^([A-Za-z]{3}) '(\d{2})$/);
  if (!m) return new Date(now.getFullYear(), now.getMonth(), 1);
  const monthIdx = MONTH_LABELS.findIndex((mm) => mm === m[1]);
  const y = 2000 + Number.parseInt(m[2], 10);
  return new Date(y, Math.max(0, monthIdx), 1);
}

/** Maps "Today", "Yesterday", "N Days Ago" to days-back offset from local midnight. */
function dayOffsetFromRelativeLabel(label: string): number | null {
  if (label === 'Today') return 0;
  if (label === 'Yesterday') return 1;
  const m = label.match(/^(\d+) Days Ago$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Latest `selectableTime` across chart buckets (skips null slots with no readings). */
function latestSelectableTimeFromChartPoints(
  points: Array<{ selectableTime: string | null }>,
): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const p of points) {
    const t = p.selectableTime;
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = t;
  }
  return latest;
}

/** Latest recorded timestamp in a past-day average-AQI series. */
function latestRecordedTimeFromTimeseries(series: Array<{ time: string }>): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const p of series) {
    const ms = new Date(p.time).getTime();
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = p.time;
  }
  return latest;
}

/** Local midnight bounds for a day N days before today (used when loading past-day scrub data). */
function localDayBoundsForOffset(daysAgo: number): { startIso: string; endIso: string; dayKey: string } {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dayKey: dateKeyLocal(start),
  };
}

/** Past-day scrub: average AQI across PurpleAir + Clarity readings at each timestamp. */
function buildAverageAqiTimeseriesFromFeeds(
  purpleAir: PurpleAirRow[] | null | undefined,
  clarity: ClarityRow[] | null | undefined,
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
  for (const row of purpleAir ?? []) addRow(row.time, row.pm25);
  for (const row of clarity ?? []) addRow(row.time, row.pm25);
  return Array.from(sums.entries())
    .map(([time, v]) => ({ time, avgAqi: v.count > 0 ? v.total / v.count : 0 }))
    .filter((r) => Number.isFinite(new Date(r.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

/** Props wired from App.tsx / useSsfAirQuality — timeline and fetch state live in the parent. */
export type SsfAirQualityScreenProps = {
  sensors: SensorPoint[];
  kriging: CurrentKrigingRow[];
  loading: boolean;
  error: FetchError | null;
  timelineTimesAsc: string[];
  timelineIndex: number;
  onTimelineIndexChange: (index: number) => void;
  onSelectRecordedTime: (recordedTime: string) => void;
  viewingLive: boolean;
  timelineLoading: boolean;
  insufficientData: boolean;
  averageAqiTimeseries: Array<{ time: string; avgAqi: number }>;
  modelProjectionOpen: boolean;
  onModelProjectionOpenChange: (open: boolean) => void;
};

/** Composes map, Day/Month filter menus, bottom scrub chart, and alert-location picking. */
export function SsfAirQualityScreen({
  sensors,
  kriging,
  loading,
  error,
  timelineTimesAsc,
  timelineIndex,
  onTimelineIndexChange,
  onSelectRecordedTime,
  viewingLive,
  timelineLoading,
  insufficientData,
  averageAqiTimeseries,
  modelProjectionOpen,
  onModelProjectionOpenChange,
}: SsfAirQualityScreenProps) {
  const { language } = useAppLanguage();
  const copy = mapScreenCopy[language];
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const alertSelectionTopDimHeight = windowHeight * 0.05;

  const [selected, setSelected] = useState<{
    lat: number;
    lon: number;
    label: string | null;
    screenPointX: number | null;
    screenPointY: number | null;
    sensorIndex?: number | string;
    sensorSource?: string;
  } | null>(null);
  const [timeFilterMenuOpen, setTimeFilterMenuOpen] = useState(false);
  const [timeFilterMode, setTimeFilterMode] = useState<'Day' | 'Month'>('Day');
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [selectedDayLabel, setSelectedDayLabel] = useState('Today');
  const [selectedMonthLabel, setSelectedMonthLabel] = useState('This Month');
  const [calendarRows, setCalendarRows] = useState<DailySensorAqiRow[]>([]);
  const [monthRowsLoading, setMonthRowsLoading] = useState(false);
  const [dayPastRowsLoading, setDayPastRowsLoading] = useState(false);
  const [pastDayAverageAqiTimeseries, setPastDayAverageAqiTimeseries] = useState<Array<{ time: string; avgAqi: number }>>(
    [],
  );
  // Tracks a scrub landing on a chart bucket with no underlying readings (its
  // `selectableTime` is null). We keep the marker visible at that position and
  // render a blank map + overlay without touching the live timeline state.
  const [pendingNoDataBucketTime, setPendingNoDataBucketTime] = useState<string | null>(null);
  const dayLoadGenRef = useRef(0);
  const mapRef = useRef<SsfMapHandle>(null);
  const lastPanelTouchMsRef = useRef(0);
  const [mapZoomState, setMapZoomState] = useState({ canZoomIn: true, canZoomOut: true });
  const [openReminderModalSignal, setOpenReminderModalSignal] = useState(0);
  const [modelProjectionPending, setModelProjectionPending] = useState(false);
  useEffect(() => {
    if (!modelProjectionOpen) setModelProjectionPending(false);
  }, [modelProjectionOpen]);
  /** Alert button with no saved pin: user must tap map; next tap sets coords and opens reminder modal. */
  const [isSelectingAlertLocation, setIsSelectingAlertLocation] = useState(false);
  const pendingOpenReminderRef = useRef(false);
  const isSelectingAlertLocationRef = useRef(false);

  const mainDropdownOpacity = useRef(new Animated.Value(0)).current;
  const mainDropdownTranslateY = useRef(new Animated.Value(0)).current;
  const subDropdownOpacity = useRef(new Animated.Value(0)).current;
  const subDropdownTranslateX = useRef(new Animated.Value(0)).current;
  const daySubmenuScrollRef = useRef<ScrollView | null>(null);
  const monthSubmenuScrollRef = useRef<ScrollView | null>(null);
  const timeFilterRunningAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const timeFilterCloseTokenRef = useRef(0);
  const timeFilterSwitchTokenRef = useRef(0);
  const dayMenuOpenRef = useRef(dayMenuOpen);
  const monthMenuOpenRef = useRef(monthMenuOpen);
  const timeFilterMenuOpenRef = useRef(timeFilterMenuOpen);
  const closeTimeFilterMenuRef = useRef<(afterClose?: () => void) => void>(() => {});
  dayMenuOpenRef.current = dayMenuOpen;
  monthMenuOpenRef.current = monthMenuOpen;
  timeFilterMenuOpenRef.current = timeFilterMenuOpen;
  const prevTimeFilterMenuOpenRef = useRef(false);

  const mapRegion = useMemo(() => regionFromSensorData(sensors, kriging), [sensors, kriging]);
  const selectedTimeIsoForUi = useMemo(
    () => timelineTimesAsc[timelineIndex] ?? (timelineTimesAsc.length === 0 ? new Date().toISOString() : null),
    [timelineIndex, timelineTimesAsc],
  );
  const isSelectedDateToday = useMemo(() => {
    if (!selectedTimeIsoForUi) return true;
    const selectedDate = new Date(selectedTimeIsoForUi);
    if (!Number.isFinite(selectedDate.getTime())) return true;
    return dateKeyLocal(selectedDate) === dateKeyLocal(new Date());
  }, [selectedTimeIsoForUi]);
  const todayTimelineTimesAsc = useMemo(() => {
    const todayKey = dateKeyLocal(new Date());
    return timelineTimesAsc
      .filter((iso) => {
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) return false;
        return dateKeyLocal(d) === todayKey;
      })
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  }, [timelineTimesAsc]);
  const prevIsSelectedDateTodayRef = useRef(isSelectedDateToday);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchDailySensorAqiCalendarRows();
      if (cancelled || res.error || !res.data) return;
      setCalendarRows(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const wasToday = prevIsSelectedDateTodayRef.current;
    if (!wasToday && isSelectedDateToday && timelineTimesAsc.length > 0) {
      const latestTodayIso = todayTimelineTimesAsc[todayTimelineTimesAsc.length - 1];
      if (latestTodayIso) {
        const latestTodaySourceIndex = timelineTimesAsc.findIndex((iso) => iso === latestTodayIso);
        if (latestTodaySourceIndex >= 0 && latestTodaySourceIndex !== timelineIndex) {
          onTimelineIndexChange(latestTodaySourceIndex);
        }
      }
    }
    prevIsSelectedDateTodayRef.current = isSelectedDateToday;
  }, [isSelectedDateToday, onTimelineIndexChange, timelineIndex, timelineTimesAsc, todayTimelineTimesAsc]);

  /** Reset Day filter to Today and jump timeline to the newest reading. */
  const goToTodayLatestReading = useCallback(() => {
    setPendingNoDataBucketTime(null);
    setTimeFilterMode('Day');
    setSelectedDayLabel('Today');
    dayLoadGenRef.current += 1;
    setPastDayAverageAqiTimeseries([]);
    setDayPastRowsLoading(false);
    if (timelineTimesAsc.length > 0) {
      const latestTimelineIso = [...timelineTimesAsc]
        .filter((iso) => Number.isFinite(new Date(iso).getTime()))
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        .at(-1);
      if (latestTimelineIso) {
        const latestSourceIndex = timelineTimesAsc.findIndex((iso) => iso === latestTimelineIso);
        if (latestSourceIndex >= 0) onTimelineIndexChange(latestSourceIndex);
      }
    }
  }, [onTimelineIndexChange, timelineTimesAsc]);

  const { reminder, setReminder, clearReminder, isReminderForCoordinate } = useAirQualityReminder(
    sensors,
    kriging,
    viewingLive,
  );

  useEffect(() => {
    isSelectingAlertLocationRef.current = isSelectingAlertLocation;
  }, [isSelectingAlertLocation]);

  /** Updates selected pin + sensor metadata; closes time filter menu if open. */
  const applyMapSelection = useCallback(
    (
      lat: number,
      lon: number,
      detail: {
        screenPointX?: number | null;
        screenPointY?: number | null;
        sensorIndex?: number | string;
        sensorSource?: string;
        sensorName?: string | null;
      },
    ) => {
      if (timeFilterMenuOpenRef.current) {
        closeTimeFilterMenuRef.current();
      }
      const isSensorTap = detail.sensorIndex != null;
      const matchedSensor = isSensorTap
        ? sensors.find(
            (s) =>
              s.sensorIndex === detail.sensorIndex &&
              (detail.sensorSource == null || s.source === detail.sensorSource),
          ) ?? sensors.find((s) => s.sensorIndex === detail.sensorIndex)
        : undefined;
      const sensorName = isSensorTap
        ? detail.sensorName ?? matchedSensor?.name ?? null
        : null;
      setSelected({
        lat,
        lon,
        label: sensorName,
        screenPointX: detail.screenPointX ?? null,
        screenPointY: detail.screenPointY ?? null,
        ...(isSensorTap
          ? {
              sensorIndex: matchedSensor?.sensorIndex ?? detail.sensorIndex,
              sensorSource: matchedSensor?.source ?? detail.sensorSource,
            }
          : {}),
      });
    },
    [sensors],
  );

  /** Map tap entry: respects panel touch lock and alert-location pick mode. */
  const onSelectCoordinate = useCallback(
    (
      lat: number,
      lon: number,
      detail: {
        screenPointX?: number | null;
        screenPointY?: number | null;
        sensorIndex?: number | string;
        sensorSource?: string;
        sensorName?: string | null;
      },
    ) => {
      if (Date.now() - lastPanelTouchMsRef.current < PANEL_TOUCH_LOCK_MS) return;
      if (isSelectingAlertLocationRef.current) {
        applyMapSelection(lat, lon, detail);
        setIsSelectingAlertLocation(false);
        mapRef.current?.focusCoordinate(lat, lon);
        pendingOpenReminderRef.current = true;
        return;
      }
      applyMapSelection(lat, lon, detail);
    },
    [applyMapSelection],
  );

  const markPanelTouch = useCallback(() => {
    lastPanelTouchMsRef.current = Date.now();
  }, []);

  const isPanelTouchLocked = useCallback(
    () => Date.now() - lastPanelTouchMsRef.current < PANEL_TOUCH_LOCK_MS,
    [],
  );

  const clearSelection = useCallback(() => {
    setSelected(null);
  }, []);

  const openNotificationSettings = useCallback(() => {
    setOpenReminderModalSignal((n) => n + 1);
  }, []);

  const requestOpenNotificationSettings = useCallback(() => {
    pendingOpenReminderRef.current = true;
    if (selected != null) {
      openNotificationSettings();
      pendingOpenReminderRef.current = false;
    }
  }, [openNotificationSettings, selected]);

  const selectNotificationCoordinate = useCallback(
    (lat: number, lon: number) => {
      onSelectCoordinate(lat, lon, {
        screenPointX: null,
        screenPointY: null,
      });
    },
    [onSelectCoordinate],
  );

  const cancelAlertLocationSelection = useCallback(() => {
    setIsSelectingAlertLocation(false);
  }, []);

  /** Alert: focus saved pin, current selection, or enter map-pick mode for a new pin. */
  const focusNotificationLocation = useCallback(() => {
    if (reminder != null) {
      mapRef.current?.focusCoordinate(reminder.lat, reminder.lon);
      selectNotificationCoordinate(reminder.lat, reminder.lon);
      requestOpenNotificationSettings();
      return;
    }

    if (selected != null) {
      if (timeFilterMenuOpenRef.current) {
        closeTimeFilterMenuRef.current();
      }
      mapRef.current?.focusCoordinate(selected.lat, selected.lon);
      selectNotificationCoordinate(selected.lat, selected.lon);
      requestOpenNotificationSettings();
      return;
    }

    if (timeFilterMenuOpenRef.current) {
      closeTimeFilterMenuRef.current();
    }
    setIsSelectingAlertLocation(true);
  }, [reminder, requestOpenNotificationSettings, selectNotificationCoordinate, selected]);

  useEffect(() => {
    if (!pendingOpenReminderRef.current || selected == null) return;
    pendingOpenReminderRef.current = false;
    openNotificationSettings();
  }, [openNotificationSettings, selected]);

  /** Animated close: submenu slides out first when Day/Month list was visible. */
  const closeTimeFilterMenu = useCallback(
    (afterClose?: () => void) => {
      timeFilterRunningAnimRef.current?.stop();
      timeFilterSwitchTokenRef.current += 1;
      const closeToken = (timeFilterCloseTokenRef.current += 1);
      const hasSub = dayMenuOpenRef.current || monthMenuOpenRef.current;
      const easingIn = Easing.in(Easing.cubic);

      const subOut = Animated.parallel([
        Animated.timing(subDropdownOpacity, {
          toValue: 0,
          duration: TIME_FILTER_SUB_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
        Animated.timing(subDropdownTranslateX, {
          toValue: TIME_FILTER_SUB_SLIDE_OFFSET_X,
          duration: TIME_FILTER_SUB_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
      ]);
      const mainOut = Animated.parallel([
        Animated.timing(mainDropdownOpacity, {
          toValue: 0,
          duration: TIME_FILTER_MAIN_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
        Animated.timing(mainDropdownTranslateY, {
          toValue: TIME_FILTER_MAIN_ENTER_OFFSET_Y,
          duration: TIME_FILTER_MAIN_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
      ]);

      const closeAnim = hasSub ? Animated.sequence([subOut, mainOut]) : mainOut;
      timeFilterRunningAnimRef.current = closeAnim;
      closeAnim.start(({ finished }) => {
        if (!finished || closeToken !== timeFilterCloseTokenRef.current) return;
        if (timeFilterRunningAnimRef.current === closeAnim) timeFilterRunningAnimRef.current = null;
        setTimeFilterMenuOpen(false);
        setDayMenuOpen(false);
        setMonthMenuOpen(false);
        afterClose?.();
      });
    },
    [mainDropdownOpacity, mainDropdownTranslateY, subDropdownOpacity, subDropdownTranslateX],
  );
  closeTimeFilterMenuRef.current = closeTimeFilterMenu;

  const dismissTimeFilterIfOpen = useCallback(() => {
    if (timeFilterMenuOpenRef.current) {
      closeTimeFilterMenuRef.current();
    }
  }, []);

  /** Cross-fade Day ↔ Month submenus without closing the main dropdown. */
  const switchInnerTimeFilterSubmenu = useCallback(
    (apply: () => void) => {
      timeFilterRunningAnimRef.current?.stop();
      const switchToken = (timeFilterSwitchTokenRef.current += 1);
      const easingIn = Easing.in(Easing.cubic);
      const easingOut = Easing.out(Easing.cubic);

      const subOut = Animated.parallel([
        Animated.timing(subDropdownOpacity, {
          toValue: 0,
          duration: TIME_FILTER_SUB_SWITCH_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
        Animated.timing(subDropdownTranslateX, {
          toValue: TIME_FILTER_SUB_SLIDE_OFFSET_X,
          duration: TIME_FILTER_SUB_SWITCH_OUT_MS,
          easing: easingIn,
          useNativeDriver: true,
        }),
      ]);

      subOut.start(({ finished }) => {
        if (!finished || switchToken !== timeFilterSwitchTokenRef.current) return;
        if (timeFilterRunningAnimRef.current === subOut) timeFilterRunningAnimRef.current = null;
        const runSwapAndIn = () => {
          if (switchToken !== timeFilterSwitchTokenRef.current) return;
          apply();
          subDropdownOpacity.setValue(0);
          subDropdownTranslateX.setValue(TIME_FILTER_SUB_SLIDE_OFFSET_X);

          const subIn = Animated.parallel([
            Animated.timing(subDropdownOpacity, {
              toValue: 1,
              duration: TIME_FILTER_SUB_SWITCH_IN_MS,
              easing: easingOut,
              useNativeDriver: true,
            }),
            Animated.timing(subDropdownTranslateX, {
              toValue: 0,
              duration: TIME_FILTER_SUB_SWITCH_IN_MS,
              easing: easingOut,
              useNativeDriver: true,
            }),
          ]);
          timeFilterRunningAnimRef.current = subIn;
          subIn.start(({ finished: fin }) => {
            if (!fin || switchToken !== timeFilterSwitchTokenRef.current) return;
            if (timeFilterRunningAnimRef.current === subIn) timeFilterRunningAnimRef.current = null;
          });
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(runSwapAndIn);
        });
      });
      timeFilterRunningAnimRef.current = subOut;
    },
    [subDropdownOpacity, subDropdownTranslateX],
  );

  /** Flip callout above/below the pin based on available space under the status bar. */
  const selectedCalloutPlacement = useMemo<'above' | 'below'>(() => {
    if (!selected?.screenPointY) return 'above';
    const requiredTopSpace = CALLOUT_HEIGHT_ESTIMATE + 24;
    return selected.screenPointY - requiredTopSpace >= insets.top ? 'above' : 'below';
  }, [insets.top, selected?.screenPointY]);

  /** Horizontal shift so the 300px callout card stays within screen gutters. */
  const selectedCalloutShiftX = useMemo(() => {
    const x = selected?.screenPointX;
    if (x == null) return 0;
    const halfW = CALLOUT_WIDTH / 2;
    const minLeft = CALLOUT_SCREEN_GUTTER;
    const maxRight = windowWidth - CALLOUT_SCREEN_GUTTER;
    const left = x - halfW;
    const right = x + halfW;
    if (left < minLeft) return minLeft - left;
    if (right > maxRight) return maxRight - right;
    return 0;
  }, [selected?.screenPointX, windowWidth]);

  /** Month submenu labels from "This Month" back to FILTER_MIN_YEAR. */
  const monthOptions = useMemo(() => {
    const now = new Date();
    const out: string[] = ['This Month'];
    // From last month backwards to Jan 2019.
    let d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    while (d.getFullYear() >= FILTER_MIN_YEAR) {
      const yy = `${d.getFullYear()}`.slice(-2);
      out.push(`${MONTH_LABELS[d.getMonth()]} '${yy}`);
      d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    }
    return out;
  }, []);

  /** Day submenu: Today through 7 Days Ago. */
  const dayOptions = useMemo(() => {
    const out: string[] = ['Today', 'Yesterday'];
    for (let i = 2; i <= 7; i += 1) out.push(`${i} Days Ago`);
    return out;
  }, []);

  /** After submenu open animation, scroll so the current preset is centered in view. */
  const scrollSubmenuToCurrentPreset = useCallback(() => {
    if (timeFilterMode === 'Day' && dayMenuOpenRef.current) {
      const idx = dayOptions.indexOf(selectedDayLabel);
      if (idx < 0) return;
      daySubmenuScrollRef.current?.scrollTo({
        y: scrollOffsetForSubmenuIndex(idx, dayOptions.length),
        animated: false,
      });
      return;
    }
    if (timeFilterMode === 'Month' && monthMenuOpenRef.current) {
      const idx = monthOptions.indexOf(selectedMonthLabel);
      if (idx < 0) return;
      monthSubmenuScrollRef.current?.scrollTo({
        y: scrollOffsetForSubmenuIndex(idx, monthOptions.length),
        animated: false,
      });
    }
  }, [dayOptions, monthOptions, selectedDayLabel, selectedMonthLabel, timeFilterMode]);

  /** Main dropdown fade/slide in; optional submenu follows with horizontal slide. */
  const playTimeFilterOpenAnimation = useCallback(
    (withSubmenu: boolean) => {
      timeFilterRunningAnimRef.current?.stop();
      const hasSub = withSubmenu;
      const easingOut = Easing.out(Easing.cubic);

      mainDropdownOpacity.setValue(0);
      mainDropdownTranslateY.setValue(TIME_FILTER_MAIN_ENTER_OFFSET_Y);
      if (hasSub) {
        subDropdownOpacity.setValue(0);
        subDropdownTranslateX.setValue(TIME_FILTER_SUB_SLIDE_OFFSET_X);
      } else {
        subDropdownOpacity.setValue(1);
        subDropdownTranslateX.setValue(0);
      }

      const mainEnter = Animated.parallel([
        Animated.timing(mainDropdownOpacity, {
          toValue: 1,
          duration: TIME_FILTER_MAIN_IN_MS,
          easing: easingOut,
          useNativeDriver: true,
        }),
        Animated.timing(mainDropdownTranslateY, {
          toValue: 0,
          duration: TIME_FILTER_MAIN_IN_MS,
          easing: easingOut,
          useNativeDriver: true,
        }),
      ]);

      const subEnter = Animated.parallel([
        Animated.timing(subDropdownOpacity, {
          toValue: 1,
          duration: TIME_FILTER_SUB_IN_MS,
          easing: easingOut,
          useNativeDriver: true,
        }),
        Animated.timing(subDropdownTranslateX, {
          toValue: 0,
          duration: TIME_FILTER_SUB_IN_MS,
          easing: easingOut,
          useNativeDriver: true,
        }),
      ]);

      const composite: Animated.CompositeAnimation = hasSub
        ? Animated.sequence([mainEnter, subEnter])
        : mainEnter;

      timeFilterRunningAnimRef.current = composite;
      composite.start(({ finished }) => {
        if (timeFilterRunningAnimRef.current === composite) timeFilterRunningAnimRef.current = null;
        if (finished && hasSub) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollSubmenuToCurrentPreset();
            });
          });
        }
      });
    },
    [mainDropdownOpacity, mainDropdownTranslateY, scrollSubmenuToCurrentPreset, subDropdownOpacity, subDropdownTranslateX],
  );

  /** Opens Day or Month submenu matching the active timeFilterMode. */
  const openTimeFilterMenuToCurrentPreset = useCallback(() => {
    if (timeFilterMode === 'Month') {
      setMonthMenuOpen(true);
      setDayMenuOpen(false);
    } else {
      setDayMenuOpen(true);
      setMonthMenuOpen(false);
    }
    setTimeFilterMenuOpen(true);
  }, [timeFilterMode]);

  useLayoutEffect(() => {
    if (timeFilterMenuOpen && !prevTimeFilterMenuOpenRef.current) {
      const withSubmenu = dayMenuOpen || monthMenuOpen;
      playTimeFilterOpenAnimation(withSubmenu);
    }
    prevTimeFilterMenuOpenRef.current = timeFilterMenuOpen;
  }, [dayMenuOpen, monthMenuOpen, playTimeFilterOpenAnimation, timeFilterMenuOpen]);

  /**
   * Scrub chart model for TimeRangeModule. Shape is always { points, ticks, selectedPosition }.
   * Day/Today: hourly slots + hook averageAqiTimeseries. Past day: fetched readings.
   * Month: daily buckets from calendarRows (30-day window or full calendar month).
   */
  const chartData = useMemo(() => {
    if (timeFilterMode === 'Day' && selectedDayLabel === 'Today') {
      const slots = generateRolling24hHourlySlotIsos(averageAqiTimeseries);
      return buildHourlyTimelineChart(slots, averageAqiTimeseries, selectedTimeIsoForUi);
    }

    if (timeFilterMode === 'Day' && selectedDayLabel !== 'Today') {
      const offset = dayOffsetFromRelativeLabel(selectedDayLabel);
      const slots =
        offset == null ? [] : generateLocalCalendarDayHourlySlotIsos(localDayBoundsForOffset(offset).dayKey);
      return buildHourlyTimelineChart(slots, pastDayAverageAqiTimeseries, selectedTimeIsoForUi);
    }

    if (timeFilterMode === 'Month') {
      if (selectedMonthLabel === 'This Month') {
        const end = new Date();
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(start.getDate() - 29);
        start.setHours(0, 0, 0, 0);
        const endMs = end.getTime();
        const startMs = start.getTime();
        const byDay = new Map<string, { sum: number; count: number; latest: string | null }>();
        for (const r of calendarRows) {
          const d = new Date(r.time);
          const ts = d.getTime();
          if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
          const key = dateKeyLocal(d);
          const curr = byDay.get(key) ?? { sum: 0, count: 0, latest: null };
          const rowAqi = resolveRowAqi(r);
          if (rowAqi != null) {
            curr.sum += rowAqi;
            curr.count += 1;
          }
          if (!curr.latest || ts > new Date(curr.latest).getTime()) curr.latest = r.time;
          byDay.set(key, curr);
        }

        const points = Array.from({ length: 30 }, (_, i) => {
          const day = new Date(start);
          day.setDate(start.getDate() + i);
          const key = dateKeyLocal(day);
          const bucket = byDay.get(key);
          const normalized = i / 29;
          return {
            time: day.toISOString(),
            avgAqi: bucket && bucket.count > 0 ? bucket.sum / bucket.count : 0,
            // "This Month" should advance forward in time as position increases.
            position: normalized,
            selectableTime: bucket?.latest ?? null,
          };
        });

        const findLatestDayIndex = (dayOfMonth: number): number => {
          for (let i = points.length - 1; i >= 0; i -= 1) {
            if (new Date(points[i].time).getDate() === dayOfMonth) return i;
          }
          return -1;
        };
        const firstIdx = findLatestDayIndex(1);
        const fifteenthIdx = findLatestDayIndex(15);
        const selectedDayKey = selectedTimeIsoForUi ? dateKeyLocal(new Date(selectedTimeIsoForUi)) : null;
        const selectedPosition =
          selectedDayKey == null
            ? null
            : points.find((p) => dateKeyLocal(new Date(p.time)) === selectedDayKey)?.position ?? null;
        const buildTickLabel = (index: number, kind: 'first' | 'fifteenth') => {
          const d = new Date(points[index].time);
          const abbr = monthAbbrForChart(d.getMonth(), language);
          return kind === 'first' ? copy.monthTickFirst(abbr) : copy.monthTickFifteenth(abbr);
        };
        const ticks = [
          firstIdx >= 0 ? { position: points[firstIdx].position, label: buildTickLabel(firstIdx, 'first') } : null,
          fifteenthIdx >= 0
            ? { position: points[fifteenthIdx].position, label: buildTickLabel(fifteenthIdx, 'fifteenth') }
            : null,
        ].filter((tick): tick is { position: number; label: string } => tick != null);

        return {
          points,
          ticks,
          selectedPosition,
        };
      }

      const target = monthLabelToStartDate(selectedMonthLabel);
      const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      const rows = calendarRows.filter((r) => {
        const d = new Date(r.time);
        return Number.isFinite(d.getTime()) && monthKeyLocal(d) === monthKeyLocal(target);
      });
      const byDay = new Map<number, { sum: number; count: number; latest: string | null }>();
      for (const r of rows) {
        const d = new Date(r.time);
        if (!Number.isFinite(d.getTime())) continue;
        const day = d.getDate();
        const curr = byDay.get(day) ?? { sum: 0, count: 0, latest: null };
        const rowAqi = resolveRowAqi(r);
        if (rowAqi != null) {
          curr.sum += rowAqi;
          curr.count += 1;
        }
        if (!curr.latest || new Date(r.time).getTime() > new Date(curr.latest).getTime()) curr.latest = r.time;
        byDay.set(day, curr);
      }
      const points = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const bucket = byDay.get(day);
        const avgAqi = bucket && bucket.count > 0 ? bucket.sum / bucket.count : 0;
        const iso = new Date(target.getFullYear(), target.getMonth(), day).toISOString();
        const normalized = daysInMonth <= 1 ? 0 : i / (daysInMonth - 1);
        return {
          time: iso,
          avgAqi,
          // Month view should advance forward in time as position increases.
          position: normalized,
          selectableTime: bucket?.latest ?? null,
        };
      });
      const selectedDayKey = selectedTimeIsoForUi ? dateKeyLocal(new Date(selectedTimeIsoForUi)) : null;
      return {
        points,
        ticks: [
          { position: 0, label: '1' },
          { position: 0.25, label: `${Math.max(1, Math.round(daysInMonth * 0.25))}` },
          { position: 0.5, label: `${Math.max(1, Math.round(daysInMonth * 0.5))}` },
          { position: 0.75, label: `${Math.max(1, Math.round(daysInMonth * 0.75))}` },
        ],
        selectedPosition:
          selectedDayKey == null
            ? null
            : points.find((p) => dateKeyLocal(new Date(p.time)) === selectedDayKey)?.position ?? null,
      };
    }

    return { points: [], ticks: [], selectedPosition: null };
  }, [
    calendarRows,
    pastDayAverageAqiTimeseries,
    averageAqiTimeseries,
    selectedDayLabel,
    selectedMonthLabel,
    selectedTimeIsoForUi,
    timelineIndex,
    timelineTimesAsc,
    timeFilterMode,
    copy,
    language,
  ]);

  /** Label on the top-right calendar pill (localized Day/Month preset). */
  const timeFilterButtonLabel = useMemo(() => {
    if (timeFilterMode === 'Day') return displayDayFilterLabel(selectedDayLabel, copy);
    return displayMonthFilterLabel(selectedMonthLabel, language, copy);
  }, [copy, language, selectedDayLabel, selectedMonthLabel, timeFilterMode]);
  const scrubMarkerLabel = useMemo(() => {
    // Prefer the no-data bucket while one is pinned so the marker reflects
    // exactly where the user landed.
    const iso = pendingNoDataBucketTime ?? selectedTimeIsoForUi;
    if (!iso) return null;
    const selectedDate = new Date(iso);
    if (!Number.isFinite(selectedDate.getTime())) return null;
    if (timeFilterMode === 'Day') {
      return selectedDate.toLocaleTimeString(copy.localeTag, { hour: 'numeric' });
    }
    return formatMapScrubMonthDate(selectedDate, language, copy.localeTag);
  }, [copy.localeTag, language, pendingNoDataBucketTime, selectedTimeIsoForUi, timeFilterMode]);

  /** Scrub marker position: pinned no-data bucket wins over chart selectedPosition. */
  const effectiveSelectedPosition = useMemo(() => {
    if (pendingNoDataBucketTime != null) {
      const match = chartData.points.find((p) => p.time === pendingNoDataBucketTime);
      if (match) return match.position;
    }
    return chartData.selectedPosition;
  }, [chartData.points, chartData.selectedPosition, pendingNoDataBucketTime]);

  // Blank map when user scrubbed a no-data bucket OR historical snapshot has zero sensors.
  const showInsufficientOverlay = pendingNoDataBucketTime != null || (!viewingLive && insufficientData);
  const mapSensors = showInsufficientOverlay ? [] : sensors;
  const mapKriging = showInsufficientOverlay ? [] : kriging;

  /** Model requires live Today + kriging; parent opens ModelProjectionMap when gates pass. */
  const handleModelingPress = useCallback(() => {
    closeTimeFilterMenuRef.current();
    setTimeFilterMenuOpen(false);
    setDayMenuOpen(false);
    setMonthMenuOpen(false);
    goToTodayLatestReading();
    setModelProjectionPending(true);
  }, [goToTodayLatestReading]);

  useEffect(() => {
    if (!modelProjectionPending) return;
    if (timeFilterMode !== 'Day' || selectedDayLabel !== 'Today') return;
    if (!viewingLive || timelineLoading || loading) return;
    if (mapKriging.length === 0) return;
    setModelProjectionPending(false);
    onModelProjectionOpenChange(true);
  }, [
    loading,
    mapKriging.length,
    modelProjectionPending,
    onModelProjectionOpenChange,
    selectedDayLabel,
    timeFilterMode,
    timelineLoading,
    viewingLive,
  ]);

  // Drop any open sensor callout when entering an empty-map state, since the
  // pin it referenced is no longer on screen.
  useEffect(() => {
    if (showInsufficientOverlay && selected != null) setSelected(null);
  }, [selected, showInsufficientOverlay]);

  const lastAppliedSwitchKeyRef = useRef<string | null>(null);
  const lastFilterSwitchKeyRef = useRef<string | null>(null);
  /** After filter change, jump timeline to latest valid time; refs avoid fighting user scrubs on re-render. */
  useEffect(() => {
    const switchKey = `${timeFilterMode}:${
      timeFilterMode === 'Month' ? selectedMonthLabel : timeFilterMode === 'Day' ? selectedDayLabel : ''
    }`;
    if (lastFilterSwitchKeyRef.current !== switchKey) {
      lastFilterSwitchKeyRef.current = switchKey;
      // Switching filters invalidates any bucket the user had landed on.
      setPendingNoDataBucketTime(null);
    }

    if (timeFilterMode === 'Day' && selectedDayLabel === 'Today') {
      if (timelineTimesAsc.length === 0) return;
      const latestTimelineIso = [...timelineTimesAsc]
        .filter((iso) => Number.isFinite(new Date(iso).getTime()))
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        .at(-1);
      if (!latestTimelineIso) return;
      const appliedKey = `${switchKey}::${latestTimelineIso}`;
      if (lastAppliedSwitchKeyRef.current === appliedKey) return;
      lastAppliedSwitchKeyRef.current = appliedKey;
      const latestSourceIndex = timelineTimesAsc.findIndex((iso) => iso === latestTimelineIso);
      if (latestSourceIndex >= 0) onTimelineIndexChange(latestSourceIndex);
      return;
    }

    if (timeFilterMode === 'Day' && selectedDayLabel !== 'Today') {
      if (dayPastRowsLoading) return;
      const latest = latestRecordedTimeFromTimeseries(pastDayAverageAqiTimeseries);
      if (!latest) return;
      const appliedKey = `${switchKey}::${latest}`;
      if (lastAppliedSwitchKeyRef.current === appliedKey) return;
      lastAppliedSwitchKeyRef.current = appliedKey;
      onSelectRecordedTime(latest);
      return;
    }

    const latestSelectableTime = latestSelectableTimeFromChartPoints(chartData.points);
    if (!latestSelectableTime) return;
    const appliedKey = `${switchKey}::${latestSelectableTime}`;
    if (lastAppliedSwitchKeyRef.current === appliedKey) return;
    lastAppliedSwitchKeyRef.current = appliedKey;
    onSelectRecordedTime(latestSelectableTime);
  }, [
    chartData.points,
    dayPastRowsLoading,
    onSelectRecordedTime,
    onTimelineIndexChange,
    pastDayAverageAqiTimeseries,
    selectedDayLabel,
    selectedMonthLabel,
    timeFilterMode,
    timelineTimesAsc,
  ]);

  /**
   * Bridge TimeRangeModule scrub → useSsfAirQuality timeline.
   * Preview: only updates index when recordedTime is already in timelineTimesAsc.
   * Commit (or Month / past-day): calls onSelectRecordedTime. No-data buckets
   * set pendingNoDataBucketTime without moving global timeline.
   */
  const applyScrubRecordedTime = useCallback(
    (recordedTime: string, { isCommit }: { isCommit: boolean }) => {
      // Bucket with selectableTime == null: show empty map overlay, do not call onSelectRecordedTime.
      const noDataBucket = chartData.points.find(
        (p) => p.time === recordedTime && p.selectableTime == null,
      );
      if (noDataBucket) {
        if (pendingNoDataBucketTime !== recordedTime) {
          setPendingNoDataBucketTime(recordedTime);
        }
        return;
      }

      if (pendingNoDataBucketTime != null) setPendingNoDataBucketTime(null);

      const sourceIndex = timelineTimesAsc.findIndex((iso) => iso === recordedTime);
      if (sourceIndex >= 0) {
        if (sourceIndex !== timelineIndex) onTimelineIndexChange(sourceIndex);
        return;
      }
      const dayPastMode = timeFilterMode === 'Day' && selectedDayLabel !== 'Today';
      if (isCommit || timeFilterMode === 'Month' || dayPastMode) onSelectRecordedTime(recordedTime);
    },
    [
      chartData.points,
      onSelectRecordedTime,
      onTimelineIndexChange,
      pendingNoDataBucketTime,
      selectedDayLabel,
      timeFilterMode,
      timelineIndex,
      timelineTimesAsc,
    ],
  );

  return (
    // screenRoot: map + calendar filter (top-right) + TimeRangeModule (bottom) + alert-pick overlay
    <View style={styles.screenRoot}>
      <View style={styles.screenContent}>
        <View style={styles.main}>
          <View style={styles.mapCol}>
            {!modelProjectionOpen ? (
            <SsfMap
              ref={mapRef}
              sensors={mapSensors}
              kriging={mapKriging}
              mapRegion={mapRegion}
              onPanelTouch={markPanelTouch}
              isPanelTouchLocked={isPanelTouchLocked}
              onZoomStateChange={setMapZoomState}
              selected={selected ? { latitude: selected.lat, longitude: selected.lon } : null}
              selectedCalloutPlacement={selectedCalloutPlacement}
              selectedCalloutShiftX={selectedCalloutShiftX}
              selectedCallout={
                selected ? (
                  /* Panel: full `sensors` for closest-sensor lookup; `mapKriging` matches visible heatmap (may be []). */
                  <AqiPanel
                    selected={selected}
                    selectedLabel={selected.label}
                    selectedSensor={
                      selected.sensorIndex != null
                        ? {
                            sensorIndex: selected.sensorIndex,
                            source: selected.sensorSource,
                          }
                        : null
                    }
                    loading={loading}
                    error={error}
                    sensors={sensors}
                    kriging={mapKriging}
                    mapRegion={mapRegion}
                    onClose={clearSelection}
                    sheetMode
                    sheetDocked
                    reminderBellActive={isReminderForCoordinate(selected)}
                    onReminderPickThreshold={async (categoryIndex, cooldownMinutes) => {
                      if (selected == null) return;
                      try {
                        await setReminder(selected.lat, selected.lon, categoryIndex, cooldownMinutes);
                      } catch {
                        Alert.alert(copy.connectionAlertTitle, copy.connectionAlertReminderBody);
                      }
                    }}
                    onReminderCooldownChange={async (cooldownMinutes) => {
                      if (reminder == null) return;
                      try {
                        await setReminder(
                          reminder.lat,
                          reminder.lon,
                          reminder.categoryIndex,
                          cooldownMinutes,
                        );
                      } catch {
                        Alert.alert(copy.connectionAlertTitle, copy.connectionAlertReminderBody);
                      }
                    }}
                    onReminderClear={clearReminder}
                    savedReminderCategoryIndex={reminder?.categoryIndex ?? null}
                    savedReminderCooldownMinutes={reminder?.cooldownMinutes ?? null}
                    openReminderModalSignal={openReminderModalSignal}
                    onPanelTouchStart={markPanelTouch}
                  />
                ) : null
              }
              reminderLocation={
                reminder ? { latitude: reminder.lat, longitude: reminder.lon } : null
              }
              onSelectCoordinate={onSelectCoordinate}
            />
            ) : (
              <View style={styles.mapColPlaceholder} />
            )}
            {!modelProjectionOpen && !isSelectingAlertLocation ? (
              <MapScaleActions
                onNotificationPress={focusNotificationLocation}
                onModelingPress={handleModelingPress}
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
                canZoomIn={mapZoomState.canZoomIn}
                canZoomOut={mapZoomState.canZoomOut}
              />
            ) : null}
            {showInsufficientOverlay ? (
              <View style={styles.insufficientWrap} pointerEvents="none">
                <View style={styles.insufficientCard}>
                  <View style={styles.insufficientIconWrap}>
                    <Ionicons name="cloud-offline-outline" size={22} color="#475569" />
                  </View>
                  <Text style={styles.insufficientTitle}>{copy.insufficientDataTitle}</Text>
                  <Text style={styles.insufficientSubtitle}>
                    {pendingNoDataBucketTime != null
                      ? copy.noHourlyReadingSubtitle
                      : copy.insufficientDataSubtitle}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.calendarBtnWrap,
              {
                top: Math.max(insets.top, 6),
                right: Math.max(insets.right + 8, 8),
              },
            ]}
            pointerEvents={isSelectingAlertLocation ? 'none' : 'auto'}
          >
            {timelineLoading || monthRowsLoading || dayPastRowsLoading ? (
              <ActivityIndicator size="small" color="#475569" style={styles.calendarSpinner} />
            ) : null}
            <Pressable
              onPress={() => {
                const nextOpen = !timeFilterMenuOpen;
                if (nextOpen) {
                  openTimeFilterMenuToCurrentPreset();
                } else {
                  closeTimeFilterMenu();
                }
              }}
              style={({ pressed }) => [styles.calendarButton, pressed && styles.calendarButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel={copy.openTimeFilterMenu}
            >
              <Ionicons name="calendar-outline" size={18} color="#1f2937" />
              <Text style={styles.calendarButtonText} numberOfLines={1}>
                {timeFilterButtonLabel}
              </Text>
              <Ionicons name={timeFilterMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#334155" />
            </Pressable>
            {timeFilterMenuOpen ? (
              <Animated.View
                style={[
                  styles.mainDropdown,
                  {
                    opacity: mainDropdownOpacity,
                    transform: [{ translateY: mainDropdownTranslateY }],
                  },
                ]}
              >
                {(['Day', 'Month'] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => {
                      if (option === 'Day') {
                        if (timeFilterMode === 'Day' && dayMenuOpen) return;
                        if (timeFilterMenuOpen && timeFilterMode === 'Month' && monthMenuOpen) {
                          switchInnerTimeFilterSubmenu(() => {
                            setTimeFilterMode('Day');
                            setMonthMenuOpen(false);
                            setDayMenuOpen(true);
                            setSelectedDayLabel('Today');
                            setPastDayAverageAqiTimeseries([]);
                          });
                          return;
                        }
                        setTimeFilterMode('Day');
                        setMonthMenuOpen(false);
                        setDayMenuOpen(true);
                        setTimeFilterMenuOpen(true);
                        if (timeFilterMode === 'Month') {
                          setSelectedDayLabel('Today');
                          setPastDayAverageAqiTimeseries([]);
                        }
                        return;
                      }
                      if (option === 'Month') {
                        if (timeFilterMode === 'Month' && monthMenuOpen) return;
                        if (timeFilterMenuOpen && timeFilterMode === 'Day' && dayMenuOpen) {
                          switchInnerTimeFilterSubmenu(() => {
                            setTimeFilterMode('Month');
                            setDayMenuOpen(false);
                            setMonthMenuOpen(true);
                          });
                          return;
                        }
                        setTimeFilterMode('Month');
                        setDayMenuOpen(false);
                        setMonthMenuOpen(true);
                        setTimeFilterMenuOpen(true);
                        return;
                      }
                    }}
                    style={({ pressed }) => [
                      styles.dropdownItem,
                      timeFilterMode === option && styles.dropdownItemSelected,
                      pressed && styles.dropdownItemPressed,
                    ]}
                  >
                    <Text style={styles.dropdownItemText}>
                      {option === 'Day' ? copy.timeFilterDay : copy.timeFilterMonth}
                    </Text>
                    {option === 'Day' || option === 'Month' ? (
                      <Ionicons name="chevron-back" size={14} color="#475569" />
                    ) : null}
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}
            {dayMenuOpen || monthMenuOpen ? (
              <Animated.View
                collapsable={false}
                needsOffscreenAlphaCompositing={Platform.OS === 'ios'}
                style={[
                  styles.subDropdownLeft,
                  {
                    opacity: subDropdownOpacity,
                    transform: [{ translateX: subDropdownTranslateX }],
                  },
                ]}
              >
                <View style={styles.subDropdownInnerStack}>
                  <View
                    collapsable={false}
                    pointerEvents={dayMenuOpen ? 'auto' : 'none'}
                    style={[
                      styles.subDropdownLayerBase,
                      dayMenuOpen ? styles.subDropdownLayerActive : styles.subDropdownLayerInactive,
                    ]}
                  >
                    <ScrollView
                      ref={daySubmenuScrollRef}
                      style={styles.subDropdownScroll}
                      contentContainerStyle={styles.subDropdownScrollContent}
                      showsVerticalScrollIndicator
                      nestedScrollEnabled
                      removeClippedSubviews={false}
                    >
                      {dayOptions.map((day) => (
                        <Pressable
                          key={`day-${day}`}
                          onPress={() => {
                            const picked = day;
                            closeTimeFilterMenu(() => {
                              void (async () => {
                                setSelectedDayLabel(picked);
                                if (picked === 'Today') {
                                  dayLoadGenRef.current += 1;
                                  setPastDayAverageAqiTimeseries([]);
                                  setDayPastRowsLoading(false);
                                  if (timelineTimesAsc.length > 0) {
                                    const latestTimelineIso = [...timelineTimesAsc]
                                      .filter((iso) => Number.isFinite(new Date(iso).getTime()))
                                      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
                                      .at(-1);
                                    if (latestTimelineIso) {
                                      const latestSourceIndex = timelineTimesAsc.findIndex(
                                        (iso) => iso === latestTimelineIso,
                                      );
                                      if (latestSourceIndex >= 0) onTimelineIndexChange(latestSourceIndex);
                                    }
                                  }
                                  return;
                                }
                                const offset = dayOffsetFromRelativeLabel(picked);
                                if (offset == null) return;
                                const gen = (dayLoadGenRef.current += 1);
                                setDayPastRowsLoading(true);
                                try {
                                  const { startIso, endIso, dayKey } = localDayBoundsForOffset(offset);
                                  const res = await fetchSensorReadingsBetweenRecordedTimes(startIso, endIso);
                                  if (gen !== dayLoadGenRef.current) return;
                                  if (res.error) {
                                    setPastDayAverageAqiTimeseries([]);
                                    return;
                                  }
                                  const seriesAll = buildAverageAqiTimeseriesFromFeeds(res.purpleAir, res.clarity);
                                  const series = seriesAll.filter((p) => dateKeyLocal(new Date(p.time)) === dayKey);
                                  const timesAsc = series
                                    .map((p) => p.time)
                                    .filter((t) => Number.isFinite(new Date(t).getTime()))
                                    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
                                  setPastDayAverageAqiTimeseries(series);
                                  const latest = timesAsc.at(-1);
                                  if (latest) onSelectRecordedTime(latest);
                                } finally {
                                  if (gen === dayLoadGenRef.current) setDayPastRowsLoading(false);
                                }
                              })();
                            });
                          }}
                          style={({ pressed }) => [
                            styles.dropdownItem,
                            selectedDayLabel === day && styles.dropdownItemSelected,
                            pressed && styles.dropdownItemPressed,
                          ]}
                        >
                          <Text style={styles.dropdownItemText}>{displayDayFilterLabel(day, copy)}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                  <View
                    collapsable={false}
                    pointerEvents={monthMenuOpen ? 'auto' : 'none'}
                    style={[
                      styles.subDropdownLayerBase,
                      monthMenuOpen ? styles.subDropdownLayerActive : styles.subDropdownLayerInactive,
                    ]}
                  >
                    <ScrollView
                      ref={monthSubmenuScrollRef}
                      style={styles.subDropdownScroll}
                      contentContainerStyle={styles.subDropdownScrollContent}
                      showsVerticalScrollIndicator
                      nestedScrollEnabled
                      removeClippedSubviews={false}
                    >
                      {monthOptions.map((month) => (
                        <Pressable
                          key={`month-${month}`}
                          onPress={() => {
                            const picked = month;
                            closeTimeFilterMenu(() => {
                              void (async () => {
                                setSelectedMonthLabel(picked);
                                setMonthRowsLoading(true);
                                const monthStart = monthLabelToStartDate(picked);
                                const monthEnd = new Date(
                                  monthStart.getFullYear(),
                                  monthStart.getMonth() + 1,
                                  0,
                                  23,
                                  59,
                                  59,
                                  999,
                                );
                                const res =
                                  picked === 'This Month'
                                    ? await fetchDailySensorAqiCalendarRows()
                                    : await fetchDailySensorAqiCalendarRowsForMonth(
                                        monthStart.toISOString(),
                                        monthEnd.toISOString(),
                                      );
                                if (!res.error && res.data) setCalendarRows(res.data);
                                setMonthRowsLoading(false);
                              })();
                            });
                          }}
                          style={({ pressed }) => [
                            styles.dropdownItem,
                            selectedMonthLabel === month && styles.dropdownItemSelected,
                            pressed && styles.dropdownItemPressed,
                          ]}
                        >
                          <Text style={styles.dropdownItemText}>
                            {displayMonthFilterLabel(month, language, copy)}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              </Animated.View>
            ) : null}
          </View>

          <View
            style={[
              styles.timeOfDayWrap,
              {
                left: 28,
                right: Math.max(insets.right + 8, 8),
                bottom: BOTTOM_TAB_BAR_RESERVE,
              },
            ]}
            pointerEvents={isSelectingAlertLocation ? 'none' : 'auto'}
          >
            <TimeRangeModule
              key={`${timeFilterMode}:${selectedMonthLabel}:${selectedDayLabel}`}
              points={chartData.points}
              active
              loading={timelineLoading || monthRowsLoading || dayPastRowsLoading}
              selectedPosition={effectiveSelectedPosition}
              ticks={chartData.ticks}
              markerLabel={scrubMarkerLabel}
              scrubHintLabel={copy.timelineDragHint}
              onScrubBegin={dismissTimeFilterIfOpen}
              topLabel={
                timeFilterMode === 'Month'
                  ? selectedMonthLabel === 'This Month'
                    ? copy.timelineYesterday
                    : null
                  : timeFilterMode === 'Day' && selectedDayLabel === 'Today'
                    ? copy.timelineNow
                    : null
              }
              graphOnly
              onPreviewTime={(recordedTime) => {
                applyScrubRecordedTime(recordedTime, { isCommit: false });
              }}
              onCommitTime={(recordedTime) => {
                applyScrubRecordedTime(recordedTime, { isCommit: true });
              }}
            />
          </View>
        </View>
        {isSelectingAlertLocation ? (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(15, 23, 42, 0.32)', 'rgba(15, 23, 42, 0.15)', 'rgba(15, 23, 42, 0)']}
            locations={[0, 0.72, 1]}
            style={[styles.alertSelectionTopDim, { height: alertSelectionTopDimHeight }]}
          />
        ) : null}
        <AlertLocationSelectionBanner
          visible={isSelectingAlertLocation}
          onCancel={cancelAlertLocationSelection}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: '#e8f0fe', overflow: 'hidden' },
  screenContent: { flex: 1, position: 'relative' },
  main: { flex: 1, minHeight: 0 },
  mapCol: { flex: 1, minHeight: 0, zIndex: 0 },
  mapColPlaceholder: { flex: 1, minHeight: 0, backgroundColor: '#dbeafe' },
  alertSelectionTopDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 55,
  },
  calendarBtnWrap: {
    position: 'absolute',
    right: 10,
    zIndex: 31,
    backgroundColor: 'transparent',
  },
  calendarSpinner: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  calendarButton: {
    minHeight: 42,
    width: 154,
    paddingHorizontal: 16,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#1e293b',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  calendarButtonPressed: {
    opacity: 0.88,
    transform: [{ translateY: 0.5 }],
  },
  calendarButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: '#334155',
    textAlign: 'center',
  },
  mainDropdown: {
    marginTop: 6,
    alignSelf: 'flex-end',
    minWidth: 136,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  subDropdownLeft: {
    position: 'absolute',
    right: 146,
    top: 48,
    minWidth: 120,
    maxHeight: 220,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  subDropdownInnerStack: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
  },
  subDropdownLayerBase: {
    width: '100%',
  },
  subDropdownLayerActive: {
    position: 'relative',
    zIndex: 2,
    opacity: 1,
  },
  subDropdownLayerInactive: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 0,
    opacity: 0,
  },
  subDropdownScroll: {
    maxHeight: 220,
  },
  subDropdownScrollContent: {
    paddingVertical: 4,
  },
  dropdownItem: {
    minHeight: 34,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownItemSelected: {
    backgroundColor: 'rgba(37,99,235,0.1)',
  },
  dropdownItemPressed: {
    backgroundColor: 'rgba(226,232,240,0.8)',
  },
  dropdownItemText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  timeOfDayWrap: {
    position: 'absolute',
    zIndex: 30,
    elevation: 30,
    overflow: 'visible',
  },
  insufficientWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  insufficientCard: {
    minWidth: 220,
    maxWidth: 320,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 16,
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.45)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  insufficientIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(226,232,240,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.5)',
    marginBottom: 8,
  },
  insufficientTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: '#0f172a',
    textAlign: 'center',
  },
  insufficientSubtitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    letterSpacing: 0.15,
  },
});
