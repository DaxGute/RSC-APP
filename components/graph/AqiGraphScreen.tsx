/**
 * Graph tab screen: scrollable analytics dashboard for SSF air quality.
 * Mounted from App.tsx as the middle bottom-tab pane; receives live timeline data
 * from useSsfAirQuality via props (purpleAir, clarity, timelineTimesAsc, timelineIndex, liveAverageAqi).
 *
 * Three sections:
 *  1. Rolling 7-day hourly AQI bars (per-timestamp sensor average, then hourly slot average across 7 days)
 *  2. AQI-colored calendar (AqiColoredCalendar) with per-month category breakdown
 *  3. Yearly PM2.5 by month chart (current year vs prior-year proxy months)
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { dailyAqiMapFromDaySummaries, type DaySummary } from '../../lib/graph/aqiCalendarData';
import {
  buildAverageAqiTimeseries,
  computeRollingWeekHourlyAverages,
  enumerateDaysInMonth,
  monthKeyFromDate,
  ROLLING_WEEK_DAYS,
  countDaysByCategory,
} from '../../lib/graph/aqiHourlyAggregation';
import type { ClarityRow, PurpleAirRow } from '../../lib/shell/supabase';
import { AQI_CATEGORY_BANDS, aqiCategory, pm25ToAqi } from '../../lib/shell/airQualityBreakpoints';
import { fetchDailySensorAqiCalendarRows, fetchSensorReadingsBetweenRecordedTimes } from '../../lib/shell/fetchAirQuality';
import {
  buildDailyPm25Map,
  buildYearlyPm25ByMonthChart,
  filterDailyPm25RowsForYear,
} from '../../lib/graph/yearlyPm25ByMonth';
import { useAppLanguage } from '../../contexts/LanguageProvider';
import { aqiGraphCopy } from '../../lib/graph/aqiGraphContent';
import { educationTheme } from '../../lib/education/educationContent';
import { AqiColoredCalendar } from './AqiColoredCalendar';

type AqiGraphScreenProps = {
  purpleAir: PurpleAirRow[];
  clarity: ClarityRow[];
  timelineTimesAsc: string[];
  timelineIndex: number;
  liveAverageAqi: number | null;
  loading: boolean;
};

const CHART_HEIGHT = 100;
const ROLLING_HOUR_LABEL_HOURS = [0, 6, 12, 18];

function formatRollingHourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function scaleBarHeight(value: number, peak: number, chartHeight = CHART_HEIGHT): number {
  const scale = Math.max(1, peak);
  return Math.max(4, (value / scale) * chartHeight);
}

function useChartWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Number.isFinite(w) && w > 0) setWidth(w);
  }, []);
  return [width, onLayout];
}

type GraphSectionProps = {
  sectionLabel: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

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
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => monthKeyFromDate(new Date()));
  const [calendarMonthSummaries, setCalendarMonthSummaries] = useState<Map<string, DaySummary>>(new Map());
  const [rollingHourChartWidth, onRollingHourChartLayout] = useChartWidth();
  const [yearlyPm25ChartWidth, onYearlyPm25ChartLayout] = useChartWidth();

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

  useEffect(() => {
    let cancelled = false;
    setYearlyPm25Loading(true);
    void (async () => {
      const res = await fetchDailySensorAqiCalendarRows();
      if (cancelled) return;
      const rows = (res.data ?? []).map((row) => ({ pm25: row.pm25, time: row.time }));
      const year = new Date().getFullYear();
      setYearlyPm25DailyCurrentYear(buildDailyPm25Map(filterDailyPm25RowsForYear(rows, year)));
      setYearlyPm25DailyPriorYear(buildDailyPm25Map(filterDailyPm25RowsForYear(rows, year - 1)));
      setYearlyPm25Loading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hourlyAqiPoints = useMemo(
    () =>
      buildAverageAqiTimeseries(
        [...historyPurpleAir, ...purpleAir],
        [...historyClarity, ...clarity],
      ),
    [clarity, historyClarity, historyPurpleAir, purpleAir],
  );

  const rollingWeekHourly = useMemo(
    () => computeRollingWeekHourlyAverages(hourlyAqiPoints),
    [hourlyAqiPoints],
  );

  const rollingWeekHasData = rollingWeekHourly.some((slot) => slot.sampleCount > 0);

  const rollingWeekPeakAvg = useMemo(() => {
    const withData = rollingWeekHourly.filter((slot) => slot.sampleCount > 0);
    if (withData.length === 0) return null;
    return Math.max(...withData.map((slot) => slot.avgAqi));
  }, [rollingWeekHourly]);

  const rollingWeekChartPeakAqi = rollingWeekPeakAvg == null ? 1 : Math.max(1, rollingWeekPeakAvg);

  const rollingWeekPeakLineBottom =
    rollingWeekPeakAvg == null
      ? null
      : scaleBarHeight(rollingWeekPeakAvg, rollingWeekChartPeakAqi);

  const monthDayKeys = useMemo(() => enumerateDaysInMonth(visibleMonthKey), [visibleMonthKey]);
  const monthCategoryCounts = useMemo(() => {
    const dailyByDay = dailyAqiMapFromDaySummaries(calendarMonthSummaries);
    return countDaysByCategory(dailyByDay, monthDayKeys);
  }, [calendarMonthSummaries, monthDayKeys]);
  const monthCategoryTotal = monthCategoryCounts.reduce((a, b) => a + b, 0);

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

  const yearlyPm25HasData = yearlyPm25Chart.bars.some((bar) => bar.avgPm25 != null);

  const yearlyPm25ChartPeak = useMemo(() => {
    const values = yearlyPm25Chart.bars
      .map((bar) => bar.avgPm25)
      .filter((v): v is number => v != null && Number.isFinite(v));
    return values.length === 0 ? 1 : Math.max(1, ...values);
  }, [yearlyPm25Chart.bars]);

  const yearlyPm25ShowPriorYearDivider =
    yearlyPm25Chart.priorYearStartsAtIndex != null && new Date().getMonth() !== 11;

  const yearlyPm25PriorYearDividerX =
    !yearlyPm25ShowPriorYearDivider ||
    yearlyPm25Chart.priorYearStartsAtIndex == null ||
    yearlyPm25ChartWidth <= 0
      ? null
      : (yearlyPm25Chart.priorYearStartsAtIndex / yearlyPm25Chart.bars.length) * yearlyPm25ChartWidth;

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
            <View style={styles.chart}>
              <View style={styles.chartPlot} onLayout={onRollingHourChartLayout}>
                {rollingWeekPeakLineBottom != null && rollingHourChartWidth > 0 ? (
                  <>
                    <Svg
                      width={rollingHourChartWidth}
                      height={CHART_HEIGHT}
                      style={styles.chartOverlaySvg}
                      pointerEvents="none"
                    >
                      <Line
                        x1={0}
                        y1={CHART_HEIGHT - rollingWeekPeakLineBottom}
                        x2={rollingHourChartWidth}
                        y2={CHART_HEIGHT - rollingWeekPeakLineBottom}
                        stroke="#64748b"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    </Svg>
                    <View
                      style={[styles.chartOverlayLabel, styles.chartOverlayLabelRight, { bottom: rollingWeekPeakLineBottom - 8 }]}
                      pointerEvents="none"
                    >
                      <Text style={styles.chartOverlayLabelText}>
                        {rollingWeekPeakAvg == null
                          ? copy.peakAvgShort
                          : copy.peakAvgWithValue(Math.round(rollingWeekPeakAvg))}
                      </Text>
                    </View>
                  </>
                ) : null}
                <View style={[styles.barsRow, { height: CHART_HEIGHT, gap: 1 }]}>
                  {rollingWeekHourly.map((slot) => {
                    const hasData = slot.sampleCount > 0;
                    return (
                      <View key={slot.hour} style={styles.barWrap}>
                        <View
                          style={[
                            styles.rollingHourBar,
                            {
                              height: hasData
                                ? scaleBarHeight(slot.avgAqi, rollingWeekChartPeakAqi)
                                : 4,
                              backgroundColor: hasData ? aqiCategory(slot.avgAqi).bg : '#e2e8f0',
                            },
                            !hasData && styles.barEmpty,
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={[styles.labelsRow, { gap: 1 }]}>
                {rollingWeekHourly.map((slot) => (
                  <View key={slot.hour} style={styles.rollingHourLabelWrap}>
                    {ROLLING_HOUR_LABEL_HOURS.includes(slot.hour) ? (
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
                ))}
              </View>
            </View>
          )}
        </GraphSection>

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
                {AQI_CATEGORY_BANDS.map((band, index) => {
                  const count = monthCategoryCounts[index] ?? 0;
                  if (count === 0) return null;
                  const dayWord = count === 1 ? copy.daySingular : copy.daysPlural;
                  return (
                    <View key={band.label} style={styles.categoryLegendRow}>
                      <View style={[styles.categorySwatch, { backgroundColor: band.bg }]} />
                      <Text style={styles.categoryLegendLabel}>
                        {copy.categoryLabels[index] ?? band.label}: {count} {dayWord}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </GraphSection>

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
            <View style={styles.chart}>
              <View style={styles.chartPlot} onLayout={onYearlyPm25ChartLayout}>
                {yearlyPm25PriorYearDividerX != null ? (
                  <>
                    <Svg
                      width={yearlyPm25ChartWidth}
                      height={CHART_HEIGHT}
                      style={styles.chartOverlaySvg}
                      pointerEvents="none"
                    >
                      <Line
                        x1={yearlyPm25PriorYearDividerX}
                        y1={0}
                        x2={yearlyPm25PriorYearDividerX}
                        y2={CHART_HEIGHT}
                        stroke="#64748b"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                      />
                    </Svg>
                    <View
                      style={[styles.chartOverlayLabel, styles.chartOverlayLabelLeft, { left: yearlyPm25PriorYearDividerX + 4 }]}
                      pointerEvents="none"
                    >
                      <Text style={styles.chartOverlayLabelText}>{copy.previousYear}</Text>
                    </View>
                  </>
                ) : null}
                <View style={[styles.barsRow, { height: CHART_HEIGHT, gap: 2 }]}>
                  {yearlyPm25Chart.bars.map((bar) => {
                    const hasData = bar.avgPm25 != null;
                    const aqi = hasData ? pm25ToAqi(bar.avgPm25) : null;
                    return (
                      <View key={bar.label} style={styles.barWrap}>
                        <View
                          style={[
                            styles.yearlyPm25Bar,
                            {
                              height: hasData
                                ? scaleBarHeight(bar.avgPm25 as number, yearlyPm25ChartPeak)
                                : 4,
                              backgroundColor: hasData && aqi != null ? aqiCategory(aqi).bg : '#e2e8f0',
                            },
                            !hasData && styles.barEmpty,
                            bar.source === 'prior-year' && styles.yearlyPm25BarPriorYear,
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={[styles.labelsRow, { gap: 2 }]}>
                {yearlyPm25Chart.bars.map((bar) => (
                  <View key={bar.label} style={styles.labelWrap}>
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
  chart: {
    marginTop: 4,
    gap: 4,
  },
  chartPlot: {
    position: 'relative',
    height: CHART_HEIGHT,
  },
  chartOverlaySvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  chartOverlayLabel: {
    position: 'absolute',
    zIndex: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  chartOverlayLabelRight: {
    right: 0,
  },
  chartOverlayLabelLeft: {
    top: 2,
    maxWidth: 88,
  },
  chartOverlayLabelText: {
    fontSize: 9,
    fontWeight: '700',
    color: educationTheme.mutedColor,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  barEmpty: {
    opacity: 0.55,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  rollingHourBar: {
    width: '88%',
    maxWidth: 10,
    borderRadius: 3,
    minHeight: 4,
  },
  rollingHourLabelWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    height: 12,
    overflow: 'hidden',
  },
  rollingHourLabel: {
    fontSize: 7,
    lineHeight: 10,
    color: educationTheme.mutedColor,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  yearlyPm25Bar: {
    width: '80%',
    maxWidth: 22,
    borderRadius: 4,
    minHeight: 4,
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
