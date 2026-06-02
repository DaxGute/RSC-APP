/**
 * AQI-colored month calendar built on react-native-calendars.
 * Each day cell is tinted by its daily average AQI category; days without data stay disabled.
 *
 * Used by AqiGraphScreen (read-only, parent-controlled month).
 *
 * Month data is fetched lazily per visible month and cached; switching months triggers
 * a staggered fade-in animation on day cells.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { aqiCategory } from '../../lib/aqiUtils';
import {
  buildDaySummaries,
  dateKeyFromIso,
  formatMonthLabel,
  loadCalendarRowsForMonth,
  type DaySummary,
} from '../../lib/aqiCalendarData';
import { dateKeyLocal, enumerateDaysInMonth } from '../../lib/aqiTenMinuteAggregation';

const DAY_FADE_DURATION_MS = 500; // ms for each day cell to reach full opacity
const DAY_FADE_STAGGER_MS = 80; // delay between adjacent days in the fade sequence
const DAY_FADE_TICK_MS = 33; // interval for updating fade progress (~30fps)

export type AqiColoredCalendarProps = {
  timelineTimesAsc: string[];
  timelineIndex: number;
  liveAverageAqi: number | null;
  onPickRecordedTime?: (recordedTime: string) => void;
  /** When set, visible month is controlled by the parent and does not follow timeline selection. */
  monthKey?: string;
  /** When set, parent is notified when the visible month changes (YYYY-MM). */
  onVisibleMonthChange?: (monthKey: string) => void;
  /** Day summaries for the visible month (includes live today when provided). */
  onMonthDaySummariesChange?: (monthKey: string, summaries: Map<string, DaySummary>) => void;
  /** When false, the timeline-selected day uses the same styles as other days. */
  highlightSelectedDay?: boolean;
  height?: number;
};

export function AqiColoredCalendar({
  timelineTimesAsc,
  timelineIndex,
  liveAverageAqi,
  monthKey,
  onVisibleMonthChange,
  onMonthDaySummariesChange,
  highlightSelectedDay = true,
  height = 360,
}: AqiColoredCalendarProps) {
  const [loadingDayData, setLoadingDayData] = useState(false);
  const [daySummaries, setDaySummaries] = useState<Map<string, DaySummary>>(new Map());
  const [visibleMonth, setVisibleMonth] = useState<string | null>(null);
  const [fadeRun, setFadeRun] = useState<{ monthKey: string; startedAtMs: number; nowMs: number } | null>(null);
  const monthCacheRef = useRef<Map<string, Map<string, DaySummary>>>(new Map());
  const dayAqiCacheRef = useRef<Map<string, DaySummary>>(new Map());
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monthBlendOpacity = useRef(new Animated.Value(1)).current;

  const selectedIso = timelineTimesAsc[timelineIndex] ?? null;
  const selectedDateKey = useMemo(() => {
    if (!selectedIso) return null;
    return dateKeyFromIso(selectedIso);
  }, [selectedIso]);

  const { maxDate, initialDate } = useMemo(() => {
    const now = new Date();
    const endOfCurrentMonth = dateKeyLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return {
      maxDate: endOfCurrentMonth,
      initialDate: selectedDateKey ?? dateKeyLocal(now),
    };
  }, [selectedDateKey]);

  const currentMonthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
  }, []);

  const isMonthControlled = monthKey != null;
  const activeMonthKey = isMonthControlled ? monthKey : (visibleMonth ?? initialDate.slice(0, 7));
  const activeMonthDate = `${activeMonthKey}-01`;

  const setActiveMonthKey = useCallback(
    (nextMonthKey: string) => {
      if (!isMonthControlled) setVisibleMonth(nextMonthKey);
      onVisibleMonthChange?.(nextMonthKey);
    },
    [isMonthControlled, onVisibleMonthChange],
  );

  useEffect(() => {
    onVisibleMonthChange?.(activeMonthKey);
  }, [activeMonthKey, onVisibleMonthChange]);

  const disableArrowRight = activeMonthKey >= currentMonthKey;

  const activeMonthDays = useMemo(() => enumerateDaysInMonth(activeMonthKey), [activeMonthKey]);
  const todayKey = dateKeyLocal(new Date());
  const activeMonthDayIndex = useMemo(() => {
    const out = new Map<string, number>();
    activeMonthDays.forEach((day, index) => out.set(day, index));
    return out;
  }, [activeMonthDays]);

  // Staggered fade-in when a new month's day summaries finish loading.
  const startMonthFadeAnimation = useCallback((monthKey: string) => {
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    const days = enumerateDaysInMonth(monthKey);
    const startedAtMs = Date.now();
    setFadeRun({ monthKey, startedAtMs, nowMs: startedAtMs });
    const totalDurationMs = Math.max(0, (days.length - 1) * DAY_FADE_STAGGER_MS + DAY_FADE_DURATION_MS);
    fadeIntervalRef.current = setInterval(() => {
      const nowMs = Date.now();
      setFadeRun((prev) => {
        if (!prev || prev.monthKey !== monthKey) return prev;
        return { ...prev, nowMs };
      });
      if (nowMs - startedAtMs >= totalDurationMs && fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
    }, DAY_FADE_TICK_MS);
  }, []);

  const resetMonthFadeToHidden = useCallback((monthKey: string) => {
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    const nowMs = Date.now();
    setFadeRun({ monthKey, startedAtMs: nowMs, nowMs });
  }, []);

  const opacityForDay = useCallback(
    (day: string): number => {
      if (!fadeRun || fadeRun.monthKey !== activeMonthKey) return 1;
      const dayIndex = activeMonthDayIndex.get(day);
      if (dayIndex == null) return 1;
      const elapsed = fadeRun.nowMs - fadeRun.startedAtMs - dayIndex * DAY_FADE_STAGGER_MS;
      if (elapsed <= 0) return 0;
      if (elapsed >= DAY_FADE_DURATION_MS) return 1;
      return elapsed / DAY_FADE_DURATION_MS;
    },
    [activeMonthDayIndex, activeMonthKey, fadeRun],
  );

  // Overlay live AQI on today's cell when the parent provides liveAverageAqi.
  const effectiveDaySummaries = useMemo(() => {
    const out = new Map(daySummaries);
    if (liveAverageAqi != null && Number.isFinite(liveAverageAqi)) {
      const cat = aqiCategory(Math.round(liveAverageAqi));
      out.set(todayKey, { dayAqi: Math.round(liveAverageAqi), bg: cat.bg, fg: cat.fg });
    }
    return out;
  }, [daySummaries, liveAverageAqi, todayKey]);

  useEffect(() => {
    onMonthDaySummariesChange?.(activeMonthKey, effectiveDaySummaries);
  }, [activeMonthKey, effectiveDaySummaries, onMonthDaySummariesChange]);

  // Build react-native-calendars markedDates: AQI colors, selection ring, fade opacity.
  const markedDates = useMemo(() => {
    const out: Record<
      string,
      {
        customStyles?: { container: object; text: object };
        disabled?: boolean;
        disableTouchEvent?: boolean;
      }
    > = {};
    for (const day of enumerateDaysInMonth(activeMonthKey)) {
      if (day > maxDate) {
        out[day] = { disabled: true, disableTouchEvent: true };
        continue;
      }
      const summary = effectiveDaySummaries.get(day);
      const isSelected = highlightSelectedDay && day === selectedDateKey;
      const dayOpacity = opacityForDay(day);
      if (summary) {
        out[day] = {
          disabled: false,
          disableTouchEvent: true,
          customStyles: {
            container: {
              backgroundColor: summary.bg,
              borderColor: isSelected ? '#111827' : summary.bg,
              borderWidth: isSelected ? 2 : 1,
              borderRadius: 8,
              opacity: dayOpacity,
            },
            text: {
              color: isSelected ? '#ffffff' : summary.fg,
              fontWeight: '700',
              opacity: dayOpacity,
            },
          },
        };
      } else {
        out[day] = {
          disabled: true,
          disableTouchEvent: true,
          customStyles: {
            container: {
              backgroundColor: 'transparent',
              borderColor: 'transparent',
              borderWidth: 1,
              borderRadius: 8,
              opacity: dayOpacity,
            },
            text: {
              color: '#cbd5e1',
              fontWeight: '700',
              opacity: dayOpacity,
            },
          },
        };
      }
    }
    return out;
  }, [
    activeMonthKey,
    effectiveDaySummaries,
    maxDate,
    opacityForDay,
    highlightSelectedDay,
    selectedDateKey,
  ]);

  useEffect(() => {
    if (isMonthControlled) return;
    setVisibleMonth(initialDate.slice(0, 7));
  }, [initialDate, isMonthControlled]);

  useEffect(() => {
    return () => {
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    monthBlendOpacity.setValue(0.5);
    Animated.timing(monthBlendOpacity, {
      toValue: 1,
      duration: 420,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    }).start();
  }, [activeMonthKey, monthBlendOpacity]);

  // Load and cache daily summaries for the active month (skip fetch on cache hit).
  useEffect(() => {
    let cancelled = false;
    resetMonthFadeToHidden(activeMonthKey);
    const cached = monthCacheRef.current.get(activeMonthKey);
    if (cached) {
      setDaySummaries(cached);
      setFadeRun(null);
      setLoadingDayData(false);
      return;
    }

    setLoadingDayData(true);
    void (async () => {
      try {
        const data = await loadCalendarRowsForMonth(activeMonthKey);
        if (cancelled) return;
        const { summaries } = buildDaySummaries(data);
        for (const [dayKey, summary] of summaries) dayAqiCacheRef.current.set(dayKey, summary);

        const monthSummary = new Map<string, DaySummary>();
        for (const day of enumerateDaysInMonth(activeMonthKey)) {
          const summary = dayAqiCacheRef.current.get(day);
          if (summary) monthSummary.set(day, summary);
        }
        monthCacheRef.current.set(activeMonthKey, monthSummary);
        setDaySummaries(monthSummary);
        startMonthFadeAnimation(activeMonthKey);
      } finally {
        if (!cancelled) setLoadingDayData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMonthKey, resetMonthFadeToHidden, startMonthFadeAnimation]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.calendarWrap, { opacity: monthBlendOpacity, height }]}>
        <Calendar
          key={activeMonthKey}
          current={activeMonthDate}
          maxDate={maxDate}
          hideExtraDays
          hideArrows={false}
          enableSwipeMonths={false}
          disableArrowRight={disableArrowRight}
          renderArrow={(direction) => (
            <Ionicons
              name={direction === 'left' ? 'chevron-back' : 'chevron-forward'}
              size={18}
              color="#1e3a8a"
              style={styles.calendarNavArrow}
            />
          )}
          disabledByDefault
          disableAllTouchEventsForDisabledDays
          markingType="custom"
          markedDates={markedDates}
          onMonthChange={(m) => setActiveMonthKey(`${m.year}-${`${m.month}`.padStart(2, '0')}`)}
          theme={{
            calendarBackground: '#f8fafc',
            monthTextColor: '#0f172a',
            textSectionTitleColor: '#64748b',
            textDayFontWeight: '700',
            textMonthFontWeight: '800',
            textDayHeaderFontWeight: '600',
            arrowColor: '#1e3a8a',
            todayTextColor: '#1e3a8a',
            textDisabledColor: '#cbd5e1',
          }}
        />
        {loadingDayData ? (
          <View style={styles.calendarLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#475569" />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  calendarWrap: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#dbe5f2',
    backgroundColor: '#f8fafc',
  },
  calendarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248,250,252,0.72)',
  },
  calendarNavArrow: {
    paddingHorizontal: 4,
  },
});
