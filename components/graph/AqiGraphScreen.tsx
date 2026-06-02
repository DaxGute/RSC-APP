/**
 * Graph tab screen: scrollable analytics dashboard for SSF air quality.
 * Mounted from App.tsx as the middle bottom-tab pane; receives live timeline data
 * from useSsfAirQuality via props (purpleAir, clarity, timelineTimesAsc, timelineIndex, liveAverageAqi).
 *
 * Three sections:
 *  1. Rolling 7-day hourly AQI bars (per-timestamp sensor average, then 10-min slot average across 7 days)
 *  2. AQI-colored calendar (AqiColoredCalendar) with per-month category breakdown
 *  3. Yearly PM2.5 by month chart (current year vs prior-year proxy months)
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { dailyAqiMapFromDaySummaries, type DaySummary } from '../../lib/aqiCalendarData';
import {
  buildAverageAqiTimeseries,
  computeRollingWeekHourlyAverages,
  ROLLING_WEEK_DAYS,
  countDaysByCategory,
  DAY_AQI_CATEGORY_META,
  enumerateDaysInMonth,
  type DayAqiCategory,
} from '../../lib/aqiTenMinuteAggregation';
import type { ClarityRow, PurpleAirRow } from '../../lib/database.types';
import { aqiCategory, pm25ToAqi } from '../../lib/aqiUtils';
import { fetchDailySensorAqiCalendarRows, fetchSensorReadingsBetweenRecordedTimes } from '../../lib/fetchAirQuality';
import {
  buildDailyPm25Map,
  buildYearlyPm25ByMonthChart,
  filterDailyPm25RowsForYear,
} from '../../lib/yearlyPm25ByMonth';
import { useAppLanguage } from '../../contexts/LanguageProvider';
import { aqiGraphCopy } from '../../lib/aqiGraphContent';
import { educationTheme } from '../../lib/educationTheme';
import { AqiColoredCalendar } from './AqiColoredCalendar';

type AqiGraphScreenProps = {
  purpleAir: PurpleAirRow[];
  clarity: ClarityRow[];
  timelineTimesAsc: string[];
  timelineIndex: number;
  liveAverageAqi: number | null;
  loading: boolean;
};

const ROLLING_HOUR_CHART_HEIGHT = 100;
const ROLLING_HOUR_LABEL_HOURS = [0, 6, 12, 18];
const YEARLY_PM25_CHART_HEIGHT = 100;

function formatRollingHourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function rollingHourBarHeight(avgAqi: number, chartPeakAqi: number): number {
  const scale = Math.max(1, chartPeakAqi);
  return Math.max(4, (avgAqi / scale) * ROLLING_HOUR_CHART_HEIGHT);
}

function yearlyPm25BarHeight(avgPm25: number, chartPeakPm25: number): number {
  const scale = Math.max(1, chartPeakPm25);
  return Math.max(4, (avgPm25 / scale) * YEARLY_PM25_CHART_HEIGHT);
}

type GraphSectionProps = {
  sectionLabel: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

/** Card wrapper shared by each analytics section on the graph tab. */
function GraphSection({ sectionLabel, title, subtitle, children }: GraphSectionProps) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionLabel}>{sectionLabel}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function AqiGraphScreen({
  purpleAir,
  clarity,
  timelineTimesAsc,
  timelineIndex,
  liveAverageAqi,
  loading,
}: AqiGraphScreenProps) {
  const { language } = useAppLanguage();
  const copy = aqiGraphCopy[language];
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPurpleAir, setHistoryPurpleAir] = useState<PurpleAirRow[]>([]);
  const [historyClarity, setHistoryClarity] = useState<ClarityRow[]>([]);
  const [yearlyPm25Loading, setYearlyPm25Loading] = useState(true);
  const [yearlyPm25DailyCurrentYear, setYearlyPm25DailyCurrentYear] = useState<Map<string, number>>(new Map());
  const [yearlyPm25DailyPriorYear, setYearlyPm25DailyPriorYear] = useState<Map<string, number>>(new Map());
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
  });
  const [calendarMonthSummaries, setCalendarMonthSummaries] = useState<Map<string, DaySummary>>(new Map());

  // Fetch the past 7 days of sensor readings for the rolling hourly chart.
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    const toIso = new Date().toISOString();
    const fromIso = new Date(Date.now() - ROLLING_WEEK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    void (async () => {
      const res = await fetchSensorReadingsBetweenRecordedTimes(fromIso, toIso);
      if (cancelled) return;
      if (!res.error) {
        setHistoryPurpleAir(res.purpleAir ?? []);
        setHistoryClarity(res.clarity ?? []);
      }
      setHistoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch daily PM2.5 rows for the yearly-by-month comparison chart.
  useEffect(() => {
    let cancelled = false;
    setYearlyPm25Loading(true);
    void (async () => {
      const res = await fetchDailySensorAqiCalendarRows();
      if (cancelled) return;
      const rows = (res.data ?? []).map((row) => ({ pm25: row.pm25, time: row.time }));
      const now = new Date();
      const year = now.getFullYear();
      const currentYearRows = filterDailyPm25RowsForYear(rows, year);
      const priorYearRows = filterDailyPm25RowsForYear(rows, year - 1);
      setYearlyPm25DailyCurrentYear(buildDailyPm25Map(currentYearRows));
      setYearlyPm25DailyPriorYear(buildDailyPm25Map(priorYearRows));
      setYearlyPm25Loading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // One series: every recorded timestamp averages PurpleAir + Clarity (7-day fetch + live poll).
  const tenMinutePoints = useMemo(
    () =>
      buildAverageAqiTimeseries(
        [...historyPurpleAir, ...purpleAir],
        [...historyClarity, ...clarity],
      ),
    [clarity, historyClarity, historyPurpleAir, purpleAir],
  );

  const rollingWeekHourly = useMemo(
    () => computeRollingWeekHourlyAverages(tenMinutePoints),
    [tenMinutePoints],
  );

  const rollingWeekHasData = useMemo(
    () => rollingWeekHourly.some((slot) => slot.sampleCount > 0),
    [rollingWeekHourly],
  );

  const rollingWeekPeakAvg = useMemo(() => {
    const withData = rollingWeekHourly.filter((slot) => slot.sampleCount > 0);
    if (withData.length === 0) return null;
    return Math.max(...withData.map((slot) => slot.avgAqi));
  }, [rollingWeekHourly]);

  const rollingWeekChartPeakAqi = useMemo(() => {
    if (rollingWeekPeakAvg == null) return 1;
    return Math.max(1, rollingWeekPeakAvg);
  }, [rollingWeekPeakAvg]);

  const [rollingHourChartWidth, setRollingHourChartWidth] = useState(0);

  const handleRollingHourChartLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Number.isFinite(w) && w > 0) setRollingHourChartWidth(w);
  }, []);

  const rollingWeekPeakLineBottom = useMemo(() => {
    if (rollingWeekPeakAvg == null) return null;
    return rollingHourBarHeight(rollingWeekPeakAvg, rollingWeekChartPeakAqi);
  }, [rollingWeekPeakAvg, rollingWeekChartPeakAqi]);

  const monthDayKeys = useMemo(() => enumerateDaysInMonth(visibleMonthKey), [visibleMonthKey]);
  const monthCategoryCounts = useMemo(() => {
    const dailyByDay = dailyAqiMapFromDaySummaries(calendarMonthSummaries);
    return countDaysByCategory(dailyByDay, monthDayKeys);
  }, [calendarMonthSummaries, monthDayKeys]);
  const monthCategoryTotal = useMemo(
    () => (Object.values(monthCategoryCounts) as number[]).reduce((a, b) => a + b, 0),
    [monthCategoryCounts],
  );

  const handleVisibleMonthChange = useCallback((monthKey: string) => {
    setVisibleMonthKey(monthKey);
    setCalendarMonthSummaries(new Map());
  }, []);

  const handleMonthDaySummariesChange = useCallback((monthKey: string, summaries: Map<string, DaySummary>) => {
    setVisibleMonthKey(monthKey);
    setCalendarMonthSummaries(summaries);
  }, []);

  const yearlyPm25Chart = useMemo(
    () => buildYearlyPm25ByMonthChart(yearlyPm25DailyCurrentYear, yearlyPm25DailyPriorYear),
    [yearlyPm25DailyCurrentYear, yearlyPm25DailyPriorYear],
  );

  const yearlyPm25HasData = useMemo(
    () => yearlyPm25Chart.bars.some((bar) => bar.avgPm25 != null),
    [yearlyPm25Chart.bars],
  );

  const yearlyPm25ChartPeak = useMemo(() => {
    const values = yearlyPm25Chart.bars
      .map((bar) => bar.avgPm25)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) return 1;
    return Math.max(1, ...values);
  }, [yearlyPm25Chart.bars]);

  const [yearlyPm25ChartWidth, setYearlyPm25ChartWidth] = useState(0);

  const handleYearlyPm25ChartLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Number.isFinite(w) && w > 0) setYearlyPm25ChartWidth(w);
  }, []);

  const yearlyPm25ShowPriorYearDivider = useMemo(() => {
    const startIndex = yearlyPm25Chart.priorYearStartsAtIndex;
    if (startIndex == null) return false;
    // December: every month has occurred this year; no prior-year proxy months.
    return new Date().getMonth() !== 11;
  }, [yearlyPm25Chart.priorYearStartsAtIndex]);

  const yearlyPm25PriorYearDividerX = useMemo(() => {
    const startIndex = yearlyPm25Chart.priorYearStartsAtIndex;
    if (!yearlyPm25ShowPriorYearDivider || startIndex == null || yearlyPm25ChartWidth <= 0) {
      return null;
    }
    return (startIndex / yearlyPm25Chart.bars.length) * yearlyPm25ChartWidth;
  }, [
    yearlyPm25Chart.bars.length,
    yearlyPm25Chart.priorYearStartsAtIndex,
    yearlyPm25ChartWidth,
    yearlyPm25ShowPriorYearDivider,
  ]);

  const currentYear = new Date().getFullYear();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.titleRow}>
            <View style={styles.titleIconWrap}>
              <Ionicons name="bar-chart" size={22} color={educationTheme.accentColor} />
            </View>
            <Text style={styles.pageTitle}>{copy.title}</Text>
          </View>
          <Text style={styles.pageSubtitle}>{copy.pageSubtitle}</Text>
        </View>

        {/* Section 1: rolling 7-day average AQI by hour of day (24 bars). */}
        <GraphSection
          sectionLabel={copy.rollingSectionLabel}
          title={copy.rollingSectionTitle}
          subtitle={copy.rollingSectionSub}
        >
          {historyLoading || loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={educationTheme.mutedColor} />
              <Text style={styles.loadingText}>{copy.loadingSensorHistory}</Text>
            </View>
          ) : !rollingWeekHasData ? (
            <Text style={styles.emptyText}>{copy.noRollingAverages}</Text>
          ) : (
            <View style={styles.rollingHourChart}>
              <View style={styles.rollingHourBarsArea} onLayout={handleRollingHourChartLayout}>
                {rollingWeekPeakLineBottom != null && rollingHourChartWidth > 0 ? (
                  <>
                    <Svg
                      width={rollingHourChartWidth}
                      height={ROLLING_HOUR_CHART_HEIGHT}
                      style={styles.rollingHourPeakLineSvg}
                      pointerEvents="none"
                    >
                      <Line
                        x1={0}
                        y1={ROLLING_HOUR_CHART_HEIGHT - rollingWeekPeakLineBottom}
                        x2={rollingHourChartWidth}
                        y2={ROLLING_HOUR_CHART_HEIGHT - rollingWeekPeakLineBottom}
                        stroke="#64748b"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    </Svg>
                    <View
                      style={[
                        styles.rollingHourPeakLabel,
                        { bottom: rollingWeekPeakLineBottom - 8 },
                      ]}
                      pointerEvents="none"
                    >
                      <Text style={styles.rollingHourPeakLabelText}>
                        {rollingWeekPeakAvg == null
                          ? copy.peakAvgShort
                          : copy.peakAvgWithValue(Math.round(rollingWeekPeakAvg))}
                      </Text>
                    </View>
                  </>
                ) : null}
                <View style={styles.rollingHourBarsRow}>
                  {rollingWeekHourly.map((slot) => {
                    const hasData = slot.sampleCount > 0;
                    const barHeight = hasData
                      ? rollingHourBarHeight(slot.avgAqi, rollingWeekChartPeakAqi)
                      : 4;
                    const barColor = hasData ? aqiCategory(slot.avgAqi).bg : '#e2e8f0';
                    return (
                      <View key={slot.hour} style={styles.rollingHourBarWrap}>
                        <View
                          style={[
                            styles.rollingHourBar,
                            { height: barHeight, backgroundColor: barColor },
                            !hasData && styles.rollingHourBarEmpty,
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={styles.rollingHourLabelsRow}>
                {rollingWeekHourly.map((slot) => {
                  const showLabel = ROLLING_HOUR_LABEL_HOURS.includes(slot.hour);
                  return (
                    <View key={slot.hour} style={styles.rollingHourLabelWrap}>
                      {showLabel ? (
                        <Text
                          style={styles.rollingHourLabel}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.65}
                        >
                          {formatRollingHourLabel(slot.hour)}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </GraphSection>

        {/* Section 2: AQI-colored calendar + good/moderate/USG/unhealthy day counts. */}
        <GraphSection
          sectionLabel={copy.calendarSectionLabel}
          title={copy.calendarSectionTitle}
          subtitle={copy.calendarSectionSub}
        >
          <AqiColoredCalendar
            timelineTimesAsc={timelineTimesAsc}
            timelineIndex={timelineIndex}
            liveAverageAqi={liveAverageAqi}
            highlightSelectedDay={false}
            monthKey={visibleMonthKey}
            onVisibleMonthChange={handleVisibleMonthChange}
            onMonthDaySummariesChange={handleMonthDaySummariesChange}
          />
          <View style={styles.monthBreakdown}>
            {monthCategoryTotal === 0 ? (
              <Text style={styles.emptyText}>{copy.noDailyAveragesMonth}</Text>
            ) : (
              <View style={styles.categoryLegend}>
                {(['good', 'moderate', 'usg', 'unhealthy'] as DayAqiCategory[]).map((key) => {
                  const count = monthCategoryCounts[key];
                  if (count === 0) return null;
                  const meta = DAY_AQI_CATEGORY_META[key];
                  const dayWord = count === 1 ? copy.daySingular : copy.daysPlural;
                  return (
                    <View key={key} style={styles.categoryLegendRow}>
                      <View style={[styles.categorySwatch, { backgroundColor: meta.bg }]} />
                      <Text style={styles.categoryLegendLabel}>
                        {copy.categoryLabels[key]}: {count} {dayWord}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </GraphSection>

        {/* Section 3: monthly PM2.5 bars; dashed divider marks prior-year proxy months. */}
        <GraphSection
          sectionLabel={copy.yearlySectionLabel}
          title={copy.yearlySectionTitle}
          subtitle={copy.yearlySectionSub(currentYear, currentYear - 1)}
        >
          {yearlyPm25Loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={educationTheme.mutedColor} />
              <Text style={styles.loadingText}>{copy.loadingDailyPm25}</Text>
            </View>
          ) : !yearlyPm25HasData ? (
            <Text style={styles.emptyText}>{copy.noDailyPm25}</Text>
          ) : (
            <View style={styles.yearlyPm25Chart}>
              <View style={styles.yearlyPm25BarsArea} onLayout={handleYearlyPm25ChartLayout}>
                {yearlyPm25PriorYearDividerX != null && yearlyPm25ChartWidth > 0 ? (
                  <>
                    <Svg
                      width={yearlyPm25ChartWidth}
                      height={YEARLY_PM25_CHART_HEIGHT}
                      style={styles.yearlyPm25DividerSvg}
                      pointerEvents="none"
                    >
                      <Line
                        x1={yearlyPm25PriorYearDividerX}
                        y1={0}
                        x2={yearlyPm25PriorYearDividerX}
                        y2={YEARLY_PM25_CHART_HEIGHT}
                        stroke="#64748b"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    </Svg>
                    <View
                      style={[
                        styles.yearlyPm25PriorYearLabel,
                        { left: yearlyPm25PriorYearDividerX + 4 },
                      ]}
                      pointerEvents="none"
                    >
                      <Text style={styles.yearlyPm25PriorYearLabelText}>{copy.previousYear}</Text>
                    </View>
                  </>
                ) : null}
                <View style={styles.yearlyPm25BarsRow}>
                  {yearlyPm25Chart.bars.map((bar) => {
                    const hasData = bar.avgPm25 != null;
                    const barHeight = hasData
                      ? yearlyPm25BarHeight(bar.avgPm25 as number, yearlyPm25ChartPeak)
                      : 4;
                    const aqi = hasData ? pm25ToAqi(bar.avgPm25) : null;
                    const barColor = hasData && aqi != null ? aqiCategory(aqi).bg : '#e2e8f0';
                    return (
                      <View key={bar.label} style={styles.yearlyPm25BarWrap}>
                        <View
                          style={[
                            styles.yearlyPm25Bar,
                            { height: barHeight, backgroundColor: barColor },
                            !hasData && styles.yearlyPm25BarEmpty,
                            bar.source === 'prior-year' && styles.yearlyPm25BarPriorYear,
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={styles.yearlyPm25LabelsRow}>
                {yearlyPm25Chart.bars.map((bar) => (
                  <View key={bar.label} style={styles.yearlyPm25LabelWrap}>
                    <Text style={styles.yearlyPm25Label} numberOfLines={1}>
                      {copy.monthLabels[bar.monthIndex] ?? bar.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </GraphSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: educationTheme.screenBackground,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 24,
    gap: educationTheme.sectionGap,
  },
  heroCard: {
    backgroundColor: educationTheme.cardBackground,
    borderRadius: educationTheme.cardRadius,
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    padding: educationTheme.cardPadding,
    gap: 10,
    ...educationTheme.shadow,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  titleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: educationTheme.innerSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: educationTheme.titleColor,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: educationTheme.bodyColor,
  },
  sectionCard: {
    backgroundColor: educationTheme.cardBackground,
    borderRadius: educationTheme.cardRadius,
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    padding: educationTheme.cardPadding,
    gap: 6,
    ...educationTheme.shadow,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: educationTheme.mutedColor,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: educationTheme.titleColor,
  },
  sectionSubtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    color: educationTheme.bodyColor,
    marginBottom: 4,
  },
  sectionBody: {
    gap: 10,
    marginTop: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: educationTheme.mutedColor,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 13,
    color: educationTheme.mutedColor,
    fontWeight: '600',
    paddingVertical: 8,
  },
  monthBreakdown: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: educationTheme.cardBorderColor,
  },
  categoryLegend: {
    gap: 6,
  },
  categoryLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categorySwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
  },
  categoryLegendLabel: {
    fontSize: 13,
    color: educationTheme.bodyColor,
    fontWeight: '600',
  },
  rollingHourChart: {
    marginTop: 4,
    gap: 4,
  },
  rollingHourBarsArea: {
    position: 'relative',
    height: ROLLING_HOUR_CHART_HEIGHT,
  },
  rollingHourPeakLineSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  rollingHourPeakLabel: {
    position: 'absolute',
    right: 0,
    zIndex: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  rollingHourPeakLabelText: {
    fontSize: 9,
    fontWeight: '700',
    color: educationTheme.mutedColor,
  },
  rollingHourBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: ROLLING_HOUR_CHART_HEIGHT,
    gap: 1,
  },
  rollingHourLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 1,
  },
  rollingHourBarWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  rollingHourLabelWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    height: 12,
    overflow: 'hidden',
  },
  rollingHourBar: {
    width: '88%',
    maxWidth: 10,
    borderRadius: 3,
    minHeight: 4,
  },
  rollingHourBarEmpty: {
    opacity: 0.55,
  },
  rollingHourLabel: {
    fontSize: 7,
    lineHeight: 10,
    color: educationTheme.mutedColor,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  yearlyPm25Chart: {
    marginTop: 4,
    gap: 4,
  },
  yearlyPm25BarsArea: {
    position: 'relative',
    height: YEARLY_PM25_CHART_HEIGHT,
  },
  yearlyPm25DividerSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  yearlyPm25PriorYearLabel: {
    position: 'absolute',
    top: 2,
    zIndex: 2,
    maxWidth: 88,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  yearlyPm25PriorYearLabelText: {
    fontSize: 9,
    fontWeight: '700',
    color: educationTheme.mutedColor,
  },
  yearlyPm25BarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: YEARLY_PM25_CHART_HEIGHT,
    gap: 2,
  },
  yearlyPm25LabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  },
  yearlyPm25BarWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  yearlyPm25LabelWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  yearlyPm25Bar: {
    width: '80%',
    maxWidth: 22,
    borderRadius: 4,
    minHeight: 4,
  },
  yearlyPm25BarEmpty: {
    opacity: 0.55,
  },
  yearlyPm25BarPriorYear: {
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.18)',
    borderStyle: 'dashed',
  },
  yearlyPm25Label: {
    fontSize: 9,
    color: educationTheme.mutedColor,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
});
