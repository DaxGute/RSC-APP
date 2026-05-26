import type { AppLanguage } from './appLanguage';
import type { DayAqiCategory } from './aqiTenMinuteAggregation';

export type AqiGraphCategoryLabels = Record<DayAqiCategory, string>;

export type AqiGraphCopy = {
  title: string;
  pageSubtitle: string;
  rollingSectionLabel: string;
  rollingSectionTitle: string;
  rollingSectionSub: string;
  loadingSensorHistory: string;
  noRollingAverages: string;
  peakAvgShort: string;
  peakAvgWithValue: (value: number) => string;
  calendarSectionLabel: string;
  calendarSectionTitle: string;
  calendarSectionSub: string;
  noDailyAveragesMonth: string;
  categoryLabels: AqiGraphCategoryLabels;
  daySingular: string;
  daysPlural: string;
  yearlySectionLabel: string;
  yearlySectionTitle: string;
  yearlySectionSub: (year: number, priorYear: number) => string;
  loadingDailyPm25: string;
  noDailyPm25: string;
  previousYear: string;
  monthLabels: readonly string[];
};

const MONTH_LABELS_EN = [
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

const MONTH_LABELS_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

export const aqiGraphCopy: Record<AppLanguage, AqiGraphCopy> = {
  en: {
    title: 'AQI trends',
    pageSubtitle:
      'Rolling averages, daily calendar colors, and monthly PM2.5 from South San Francisco sensors.',
    rollingSectionLabel: 'Section 1',
    rollingSectionTitle: 'Rolling 7-day average',
    rollingSectionSub:
      'Each bar is the average AQI for that hour across all readings in the last 7 days.',
    loadingSensorHistory: 'Loading sensor history…',
    noRollingAverages: 'No 7-day averages yet.',
    peakAvgShort: 'Peak Avg',
    peakAvgWithValue: (value) => `Peak Avg ${value}`,
    calendarSectionLabel: 'Section 2',
    calendarSectionTitle: 'AQI calendar',
    calendarSectionSub: 'Daily colors from recorded sensor averages',
    noDailyAveragesMonth: 'No daily averages recorded this month.',
    categoryLabels: {
      good: 'Good',
      moderate: 'Moderate',
      usg: 'Unhealthy for Sensitive Groups',
      unhealthy: 'Unhealthy+',
    },
    daySingular: 'day',
    daysPlural: 'days',
    yearlySectionLabel: 'Section 3',
    yearlySectionTitle: 'Yearly PM2.5 average by month',
    yearlySectionSub: (year, priorYear) =>
      `Daily PM2.5 averaged within each month (Jan–Dec ${year}). Months not yet reached use ${priorYear} daily averages.`,
    loadingDailyPm25: 'Loading daily PM2.5…',
    noDailyPm25: 'No daily PM2.5 averages yet.',
    previousYear: 'Previous Year',
    monthLabels: MONTH_LABELS_EN,
  },
  es: {
    title: 'Tendencias del AQI',
    pageSubtitle:
      'Promedios móviles, colores del calendario diario y PM2.5 mensual de los sensores de South San Francisco.',
    rollingSectionLabel: 'Sección 1',
    rollingSectionTitle: 'Promedio móvil de 7 días',
    rollingSectionSub:
      'Cada barra es el AQI promedio de esa hora con todas las lecturas de los últimos 7 días.',
    loadingSensorHistory: 'Cargando historial de sensores…',
    noRollingAverages: 'Aún no hay promedios de 7 días.',
    peakAvgShort: 'Prom. máx',
    peakAvgWithValue: (value) => `Prom. máx ${value}`,
    calendarSectionLabel: 'Sección 2',
    calendarSectionTitle: 'Calendario de AQI',
    calendarSectionSub: 'Colores diarios según los promedios registrados de los sensores',
    noDailyAveragesMonth: 'No hay promedios diarios registrados este mes.',
    categoryLabels: {
      good: 'Bueno',
      moderate: 'Moderado',
      usg: 'Insalubre para grupos sensibles',
      unhealthy: 'Insalubre+',
    },
    daySingular: 'día',
    daysPlural: 'días',
    yearlySectionLabel: 'Sección 3',
    yearlySectionTitle: 'Promedio anual de PM2.5 por mes',
    yearlySectionSub: (year, priorYear) =>
      `PM2.5 diario promediado por mes (ene–dic ${year}). Los meses que aún no han llegado usan los promedios diarios de ${priorYear}.`,
    loadingDailyPm25: 'Cargando PM2.5 diario…',
    noDailyPm25: 'Aún no hay promedios diarios de PM2.5.',
    previousYear: 'Año anterior',
    monthLabels: MONTH_LABELS_ES,
  },
};
