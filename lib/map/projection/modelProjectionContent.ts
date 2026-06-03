/**
 * PM₂.₅ scenario projection overlay: hourly timeline (+5h), labels, and localized UI copy.
 * Timeline constants align with `forecast_wind_grid`; copy is consumed by `ModelProjectionMap`.
 */

import type { AppLanguage } from '../../../contexts/appLanguage';

/** Matches hourly `forecast_wind_grid` valid times in the database. */
export const PROJECTION_STEP_HOURS = 1;
/** Minutes per projection slider step (derived from `PROJECTION_STEP_HOURS`). */
export const PROJECTION_STEP_MINUTES = PROJECTION_STEP_HOURS * 60;
/** Number of future hourly steps after “Now” (+1h … +5h). */
export const PROJECTION_FUTURE_STEPS = 5;
/** Total frames including the current-time step (Now + `PROJECTION_FUTURE_STEPS`). */
export const PROJECTION_FRAME_COUNT = PROJECTION_FUTURE_STEPS + 1;

/** Major slider tick indices (0 = Now, 5 = +5h). */
export const PROJECTION_MAJOR_STEP_INDICES = [0, 1, 2, 3, 4, 5] as const;
/** Major slider tick labels: Now through +5h (one step per hour). */
export const PROJECTION_MAJOR_LABELS = ['Now', '+1h', '+2h', '+3h', '+4h', '+5h'] as const;

/** Whole hours ahead for a zero-based slider step index. */
function hoursAheadForStep(stepIndex: number): number {
  return Math.max(0, stepIndex) * PROJECTION_STEP_HOURS;
}

/** Minutes ahead of “now” for a projection slider step (0 = current time). */
export function minutesAheadForStep(stepIndex: number): number {
  return hoursAheadForStep(stepIndex) * 60;
}

/** Panel/header title for the active projection horizon. */
export function formatProjectionHeader(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Projection: Now';
  const hours = Math.round(minutesAhead / 60);
  return `Projection: +${hours}h`;
}

/** Compact tick label for the projection time slider. */
export function formatStepShortLabel(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Now';
  const hours = Math.round(minutesAhead / 60);
  return `+${hours}h`;
}

/** User-facing copy keys for the model projection overlay and help sheet. */
export type ModelProjectionContent = {
  experimentalBadge: string;
  title: string;
  shortBlurb: string;
  helpTitle: string;
  helpPipeline: readonly string[];
  helpMatchesHeading: string;
  helpMatchesLoading: string;
  helpCloseA11y: string;
  helpBtnA11y: string;
  localeTag: string;
  matchLibraryLine: (count: number, belowMin: boolean, min: number) => string;
  matchTopKLine: (topK: number, meanDist: string | null, bestDist: string | null) => string;
  matchFallbackLine: (pct: string, active: boolean) => string;
  matchRankedHeading: string;
  matchNoMatches: string;
  matchFutureHeading: string;
  matchAnalogRow: (index: number, time: string, distance: string, weight: string) => string;
  matchHorizonLine: (label: string, libN: number, topN: number, sufficient: boolean) => string;
};

/** English and Spanish copy for `ModelProjectionContent`. */
export const modelProjectionContent: Record<AppLanguage, ModelProjectionContent> = {
  en: {
    experimentalBadge: 'Experimental',
    title: 'PM₂.₅ Scenario Projection',
    shortBlurb:
      'This model projects PM₂.₅ from now to +5h using a conservative blend of recent live trend, same-hour historical priors, and a small wind shift.',
    helpTitle: 'How this forecast works',
    helpPipeline: [
      'Research preview only—not an official air-quality forecast.',
      'From about 7 days of data, the app builds same-hour historical priors for +1h through +5h change.',
      'For each future step, it blends a recent live PM₂.₅ trend with those historical priors.',
      'When sample support is strong, it adds broad west/central/east structure from historical deltas; all changes are capped conservatively.',
      'If forecast wind is available, the projected field receives a small post-blend wind shift. Arrows show wind at the selected time.',
    ],
    helpMatchesHeading: 'This run’s analog matches',
    helpMatchesLoading: 'Loads after the library is ready.',
    helpCloseA11y: 'Close help',
    helpBtnA11y: 'How this forecast works',
    localeTag: 'en-US',
    matchLibraryLine: (count, belowMin, min) =>
      `Library: ${count} anchor samples${belowMin ? ` (below ${min} recommended minimum)` : ''}`,
    matchTopKLine: (topK, meanDist, bestDist) => {
      let line = `Top-${topK} used for blending`;
      if (meanDist != null) line += ` · avg distance ${meanDist}`;
      if (bestDist != null) line += ` · best ${bestDist}`;
      return line;
    },
    matchFallbackLine: (pct, active) =>
      `Recent-trend fallback weight: ${pct}%${active ? ' (active)' : ''}`,
    matchRankedHeading: 'Ranked analogs (lower distance = closer match)',
    matchNoMatches: 'No matches in library.',
    matchFutureHeading: 'Future change data available',
    matchAnalogRow: (index, time, distance, weight) =>
      `${index}. ${time} · distance ${distance} · weight ${weight}`,
    matchHorizonLine: (label, libN, topN, sufficient) =>
      `${label}: ${libN} in full library / ${topN} in top matches · ${sufficient ? 'sufficient' : 'thin coverage'}`,
  },
  es: {
    experimentalBadge: 'Experimental',
    title: 'Proyección de escenario de PM₂.₅',
    shortBlurb:
      'Este modelo proyecta PM₂.₅ desde ahora hasta +5h con una mezcla conservadora de tendencia reciente en vivo, históricos de la misma hora y un pequeño ajuste por viento.',
    helpTitle: 'Cómo funciona este pronóstico',
    helpPipeline: [
      'Solo vista previa de investigación: no es un pronóstico oficial de calidad del aire.',
      'Con cerca de 7 días de datos, la app construye históricos de la misma hora para el cambio entre +1h y +5h.',
      'Para cada paso futuro, mezcla una tendencia reciente de PM₂.₅ en vivo con esos históricos.',
      'Cuando hay suficiente muestra, agrega estructura amplia oeste/centro/este desde deltas históricos; todos los cambios se limitan de forma conservadora.',
      'Si hay viento pronosticado disponible, el campo proyectado recibe un pequeño desplazamiento posterior por viento. Las flechas muestran el viento en el tiempo seleccionado.',
    ],
    helpMatchesHeading: 'Análogos de esta ejecución',
    helpMatchesLoading: 'Se carga cuando la biblioteca esté lista.',
    helpCloseA11y: 'Cerrar ayuda',
    helpBtnA11y: 'Cómo funciona este pronóstico',
    localeTag: 'es-US',
    matchLibraryLine: (count, belowMin, min) =>
      `Biblioteca: ${count} muestras ancla${belowMin ? ` (por debajo del mínimo recomendado de ${min})` : ''}`,
    matchTopKLine: (topK, meanDist, bestDist) => {
      let line = `Top-${topK} usados para la mezcla`;
      if (meanDist != null) line += ` · distancia media ${meanDist}`;
      if (bestDist != null) line += ` · mejor ${bestDist}`;
      return line;
    },
    matchFallbackLine: (pct, active) =>
      `Peso de respaldo por tendencia reciente: ${pct}%${active ? ' (activo)' : ''}`,
    matchRankedHeading: 'Análogos ordenados (menor distancia = mejor coincidencia)',
    matchNoMatches: 'Sin coincidencias en la biblioteca.',
    matchFutureHeading: 'Datos de cambio futuro disponibles',
    matchAnalogRow: (index, time, distance, weight) =>
      `${index}. ${time} · distancia ${distance} · peso ${weight}`,
    matchHorizonLine: (label, libN, topN, sufficient) =>
      `${label}: ${libN} en biblioteca completa / ${topN} en mejores coincidencias · ${sufficient ? 'suficiente' : 'cobertura escasa'}`,
  },
};
