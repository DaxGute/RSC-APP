import type { AppLanguage } from './appLanguage';

/** User-facing copy for the experimental model projection overlay. */
export type ModelProjectionCopy = {
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

export const modelProjectionCopy: Record<AppLanguage, ModelProjectionCopy> = {
  en: {
    experimentalBadge: 'Experimental',
    title: 'PM₂.₅ Analog Forecast',
    shortBlurb:
      'Matches today’s PM₂.₅ pattern to similar past hours, then projects their +1h–+5h changes onto the map.',
    helpTitle: 'How this forecast works',
    helpPipeline: [
      'Research preview only—not an official air-quality forecast.',
      'From ~7 days of sensors, the app stores past PM₂.₅ maps and how each changed at +1h through +5h.',
      'For now, it finds the 12 closest past hours by PM₂.₅ layout and time-of-day, then blends those historical changes onto today’s map.',
      'Large changes are capped; weak matches fall back to a recent 48-hour trend.',
      'Forecast wind can shift the projected change field afterward (not used to pick analogs). Arrows show wind at the selected time.',
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
    title: 'Pronóstico analógico de PM₂.₅',
    shortBlurb:
      'Compara el patrón de PM₂.₅ de hoy con horas pasadas similares y proyecta sus cambios de +1h a +5h en el mapa.',
    helpTitle: 'Cómo funciona este pronóstico',
    helpPipeline: [
      'Solo vista previa de investigación: no es un pronóstico oficial de calidad del aire.',
      'Con ~7 días de sensores, la app guarda mapas pasados de PM₂.₅ y cómo cambió cada uno entre +1h y +5h.',
      'Por ahora busca las 12 horas pasadas más parecidas por distribución de PM₂.₅ y hora del día, y mezcla esos cambios históricos sobre el mapa de hoy.',
      'Los cambios grandes están limitados; si la coincidencia es débil, usa una tendencia reciente de 48 horas.',
      'El viento previsto puede desplazar después el campo de cambio proyectado (no se usa para elegir análogos). Las flechas muestran el viento en el tiempo seleccionado.',
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
