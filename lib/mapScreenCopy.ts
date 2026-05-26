import type { AppLanguage } from './appLanguage';

const EN_MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const ES_MONTH_ABBRS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;

/** EPA AQI category labels (index 0–5), aligned with `airQualityBreakpoints`. */
export const AQI_CATEGORY_LABELS: Record<AppLanguage, readonly string[]> = {
  en: [
    'Good',
    'Moderate',
    'Unhealthy for Sensitive Groups',
    'Unhealthy',
    'Very Unhealthy',
    'Hazardous',
  ],
  es: [
    'Bueno',
    'Moderado',
    'Insalubre para grupos sensibles',
    'Insalubre',
    'Muy insalubre',
    'Peligroso',
  ],
};

export function localizedAqiCategoryLabel(englishLabel: string, language: AppLanguage): string {
  const idx = AQI_CATEGORY_LABELS.en.indexOf(englishLabel);
  return idx >= 0 ? AQI_CATEGORY_LABELS[language][idx]! : englishLabel;
}

export type MapScreenCopy = {
  timeFilterDay: string;
  timeFilterMonth: string;
  today: string;
  yesterday: string;
  thisMonth: string;
  daysAgo: (n: number) => string;
  monthTickFirst: (monthAbbr: string) => string;
  monthTickFifteenth: (monthAbbr: string) => string;
  timelineNow: string;
  timelineYesterday: string;
  openTimeFilterMenu: string;
  insufficientDataTitle: string;
  insufficientDataSubtitle: string;
  connectionAlertTitle: string;
  connectionAlertReminderBody: string;
  alertLocationBanner: string;
  cancelAlertLocationSelection: string;
  mapAlertButton: string;
  mapAlertButtonA11y: string;
  zoomInA11y: string;
  zoomOutA11y: string;
  panelOutOfBounds: string;
  panelAirQuality: string;
  panelClickMap: string;
  panelSensorReading: string;
  panelAirQualityEstimate: string;
  panelObservedAqi: string;
  panelObservedPm25: string;
  panelPredictedAqi: string;
  panelPredictedPm25: string;
  panelLoadingData: string;
  panelNoSensorData: string;
  panelLoadDataError: (message: string) => string;
  panelOobBody: string;
  panelNoData: string;
  panelClosestSensor: string;
  panelSensorDistance: string;
  panelClickMapForSensor: string;
  panelAirQualityReminderA11y: string;
  panelCloseA11y: string;
  panelDismissA11y: string;
  reminderModalTitle: string;
  reminderModalHint: string;
  reminderCooldownLabel: string;
  reminderCooldownHint: string;
  reminderClear: string;
  reminderClearA11y: string;
  reminderBandA11y: (label: string, lo: number, hi: number) => string;
  reminderCooldownA11y: (label: string) => string;
  reminderCooldownA11yForMinutes: (minutes: number) => string;
  localeTag: string;
};

export const mapScreenCopy: Record<AppLanguage, MapScreenCopy> = {
  en: {
    timeFilterDay: 'Day',
    timeFilterMonth: 'Month',
    today: 'Today',
    yesterday: 'Yesterday',
    thisMonth: 'This Month',
    daysAgo: (n) => `${n} Days Ago`,
    monthTickFirst: (monthAbbr) => `${monthAbbr} 1st`,
    monthTickFifteenth: (monthAbbr) => `${monthAbbr} 15th`,
    timelineNow: 'now',
    timelineYesterday: 'yesterday',
    openTimeFilterMenu: 'Open time filter menu',
    insufficientDataTitle: 'Insufficient Data',
    insufficientDataSubtitle: 'No sensor readings for this time.',
    connectionAlertTitle: 'Check your connection',
    connectionAlertReminderBody: 'We could not save your reminder. Check your connection.',
    alertLocationBanner: 'Click on a location to set an alert',
    cancelAlertLocationSelection: 'Cancel alert location selection',
    mapAlertButton: 'Alert',
    mapAlertButtonA11y: 'Go to notification location and open settings',
    zoomInA11y: 'Zoom in map',
    zoomOutA11y: 'Zoom out map',
    panelOutOfBounds: 'Out of bounds',
    panelAirQuality: 'Air quality',
    panelClickMap: 'Click a point on the map',
    panelSensorReading: 'Sensor Reading',
    panelAirQualityEstimate: 'Air Quality Estimate',
    panelObservedAqi: 'Observed AQI',
    panelObservedPm25: 'Observed PM2.5',
    panelPredictedAqi: 'Predicted AQI',
    panelPredictedPm25: 'Predicted PM2.5',
    panelLoadingData: 'Loading PurpleAir data…',
    panelNoSensorData: 'No sensor or grid data yet.',
    panelLoadDataError: (message) => `Couldn't load data: ${message}`,
    panelOobBody: "Those coordinates aren't inside the configured map area.",
    panelNoData: 'No data',
    panelClosestSensor: 'Closest sensor',
    panelSensorDistance: 'Sensor distance',
    panelClickMapForSensor: 'Click the map to see the nearest sensor',
    panelAirQualityReminderA11y: 'Air quality reminder',
    panelCloseA11y: 'Close air quality panel',
    panelDismissA11y: 'Dismiss',
    reminderModalTitle: 'Remind when',
    reminderModalHint:
      "Tap an EPA color — we'll notify when the estimated AQI at this spot reaches that level or worse. Only one location can be saved.",
    reminderCooldownLabel: 'Minimum time between alerts',
    reminderCooldownHint: 'After a notification, wait this long before the next one at this spot.',
    reminderClear: 'Clear reminder',
    reminderClearA11y: 'Clear reminder for this location',
    reminderBandA11y: (label, lo, hi) => `${label}, AQI ${lo}–${hi}`,
    reminderCooldownA11y: (label) => `Cooldown ${label}`,
    reminderCooldownA11yForMinutes: (minutes) => {
      if (minutes === 30) return '30 minutes';
      if (minutes === 60) return '1 hour';
      if (minutes === 300) return '5 hours';
      if (minutes === 720) return '12 hours';
      if (minutes === 1440) return '24 hours';
      return `${minutes} minutes`;
    },
    localeTag: 'en-US',
  },
  es: {
    timeFilterDay: 'Día',
    timeFilterMonth: 'Mes',
    today: 'Hoy',
    yesterday: 'Ayer',
    thisMonth: 'Este mes',
    daysAgo: (n) => (n === 1 ? 'Hace 1 día' : `Hace ${n} días`),
    monthTickFirst: (monthAbbr) => `${monthAbbr} 1`,
    monthTickFifteenth: (monthAbbr) => `${monthAbbr} 15`,
    timelineNow: 'ahora',
    timelineYesterday: 'ayer',
    openTimeFilterMenu: 'Abrir menú de filtro de tiempo',
    insufficientDataTitle: 'Datos insuficientes',
    insufficientDataSubtitle: 'No hay lecturas de sensores para este momento.',
    connectionAlertTitle: 'Revisa tu conexión',
    connectionAlertReminderBody: 'No pudimos guardar tu recordatorio. Revisa tu conexión.',
    alertLocationBanner: 'Toca un lugar en el mapa para configurar una alerta',
    cancelAlertLocationSelection: 'Cancelar selección de ubicación de alerta',
    mapAlertButton: 'Alerta',
    mapAlertButtonA11y: 'Ir a la ubicación de notificación y abrir ajustes',
    zoomInA11y: 'Acercar mapa',
    zoomOutA11y: 'Alejar mapa',
    panelOutOfBounds: 'Fuera del área',
    panelAirQuality: 'Calidad del aire',
    panelClickMap: 'Toca un punto en el mapa',
    panelSensorReading: 'Lectura del sensor',
    panelAirQualityEstimate: 'Estimación de calidad del aire',
    panelObservedAqi: 'ICA observado',
    panelObservedPm25: 'PM2.5 observado',
    panelPredictedAqi: 'ICA estimado',
    panelPredictedPm25: 'PM2.5 estimado',
    panelLoadingData: 'Cargando datos de PurpleAir…',
    panelNoSensorData: 'Aún no hay datos de sensores ni de la cuadrícula.',
    panelLoadDataError: (message) => `No se pudieron cargar los datos: ${message}`,
    panelOobBody: 'Esas coordenadas no están dentro del área del mapa configurada.',
    panelNoData: 'Sin datos',
    panelClosestSensor: 'Sensor más cercano',
    panelSensorDistance: 'Distancia al sensor',
    panelClickMapForSensor: 'Toca el mapa para ver el sensor más cercano',
    panelAirQualityReminderA11y: 'Recordatorio de calidad del aire',
    panelCloseA11y: 'Cerrar panel de calidad del aire',
    panelDismissA11y: 'Cerrar',
    reminderModalTitle: 'Recordar cuando',
    reminderModalHint:
      'Toca un color de la EPA: te avisaremos cuando el ICA estimado en este punto llegue a ese nivel o peor. Solo se puede guardar una ubicación.',
    reminderCooldownLabel: 'Tiempo mínimo entre alertas',
    reminderCooldownHint: 'Después de una notificación, espera este tiempo antes de la siguiente en este punto.',
    reminderClear: 'Borrar recordatorio',
    reminderClearA11y: 'Borrar recordatorio para esta ubicación',
    reminderBandA11y: (label, lo, hi) => `${label}, ICA ${lo}–${hi}`,
    reminderCooldownA11y: (label) => `Espera ${label}`,
    reminderCooldownA11yForMinutes: (minutes) => {
      if (minutes === 30) return '30 minutos';
      if (minutes === 60) return '1 hora';
      if (minutes === 300) return '5 horas';
      if (minutes === 720) return '12 horas';
      if (minutes === 1440) return '24 horas';
      return `${minutes} minutos`;
    },
    localeTag: 'es-US',
  },
};

/** Display label for internal day filter keys (`Today`, `Yesterday`, `N Days Ago`). */
export function displayDayFilterLabel(internal: string, copy: MapScreenCopy): string {
  if (internal === 'Today') return copy.today;
  if (internal === 'Yesterday') return copy.yesterday;
  const m = internal.match(/^(\d+) Days Ago$/i);
  if (m) return copy.daysAgo(Number.parseInt(m[1]!, 10));
  return internal;
}

/** Display label for internal month filter keys (`This Month`, `Jan '24`, …). */
export function displayMonthFilterLabel(internal: string, language: AppLanguage, copy: MapScreenCopy): string {
  if (internal === 'This Month') return copy.thisMonth;
  const parsed = internal.match(/^([A-Za-z]{3}) '(\d{2})$/);
  if (!parsed) return internal;
  const monthIdx = EN_MONTH_ABBRS.findIndex((mm) => mm === parsed[1]);
  const abbrs = language === 'es' ? ES_MONTH_ABBRS : EN_MONTH_ABBRS;
  const abbr = monthIdx >= 0 ? abbrs[monthIdx]! : parsed[1]!;
  return `${abbr} '${parsed[2]}`;
}

export function monthAbbrForChart(monthIndex: number, language: AppLanguage): string {
  const abbrs = language === 'es' ? ES_MONTH_ABBRS : EN_MONTH_ABBRS;
  return abbrs[monthIndex] ?? EN_MONTH_ABBRS[monthIndex] ?? '';
}

/** Month-mode scrub marker on the map timeline (e.g. `15 May 24` / `May 15, 24`). */
export function formatMapScrubMonthDate(date: Date, language: AppLanguage, localeTag: string): string {
  if (language === 'es') {
    const abbr = monthAbbrForChart(date.getMonth(), language);
    const yy = String(date.getFullYear()).slice(-2);
    return `${date.getDate()} ${abbr} ${yy}`;
  }
  return date.toLocaleDateString(localeTag, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}
