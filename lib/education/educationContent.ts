/**
 * Education tab: localized copy, theme tokens, health-explorer stats, and YouTube helpers
 * (`EducationHubScreen`, `AqiHealthExplorer`, `AqiGraphScreen`).
 */

import type { AppLanguage } from '../../contexts/appLanguage';
import { AQI_CATEGORY_BANDS, aqiCategoryBinIndex, formatAqiIndexRange } from '../shell/airQualityBreakpoints';

/** Shared visual tokens for the Education tab tutorial flow. */
export const educationTheme = {
  screenBackground: '#f1f5f9',
  cardBackground: '#ffffff',
  cardBorderColor: '#e2e8f0',
  cardRadius: 12,
  cardPadding: 14,
  sectionGap: 12,
  titleColor: '#0f172a',
  bodyColor: '#475569',
  mutedColor: '#64748b',
  accentColor: '#0f172a',
  innerSurface: '#f8fafc',
  citationAccentColor: '#2563eb',
  healthImpactColor: '#dc2626',
  protectionImpactColor: '#15803d',
  subduedCaptionColor: '#94a3b8',
  shadow: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

/** Shared bordered card shell for Education and Graph tab hero/section cards. */
export const educationHubCardStyle = {
  backgroundColor: educationTheme.cardBackground,
  borderRadius: educationTheme.cardRadius,
  borderWidth: 1,
  borderColor: educationTheme.cardBorderColor,
  padding: educationTheme.cardPadding,
  ...educationTheme.shadow,
} as const;

/** Must match ios.bundleIdentifier / android package for YouTube embed referrer policy. */
export const YOUTUBE_EMBED_ORIGIN = 'https://com.rscapp.metric';

/** Initial AQI when the Section 3 health explorer first mounts (moderate band). */
export const EDUCATION_HEALTH_EXPLORER_DEFAULT_AQI = 72;

/** Short-term PM2.5 mortality meta-analysis (Education explorer citation). */
export const AQI_HEALTH_PAPER_URL =
  'https://www.sciencedirect.com/science/article/pii/S0160412020318316';

/** BMJ two-day PM2.5 and respiratory ED visit risk (`erVisitRateFromPm25`). */
export const BMJ_PM25_HOSPITAL_ER_URL = 'https://www.bmj.com/content/384/bmj-2023-076322';

/** Outdoor mask PM2.5 reduction pooled estimate source. */
export const OUTDOOR_MASK_PAPER_URL =
  'https://www.sciencedirect.com/science/article/abs/pii/S1309104223001940';

/** Indoor filtration PM2.5 reduction pooled estimate source. */
export const INDOOR_FILTER_PAPER_URL =
  'https://www.sciencedirect.com/science/article/abs/pii/S0048969720361143';

/** Outdoor mask efficacy — fixed pooled estimate (does not scale with PM2.5). */
export const OUTDOOR_MASK_EFFICACY_PCT = 72;
export const OUTDOOR_MASK_CI_LO_PCT = 43;
export const OUTDOOR_MASK_CI_HI_PCT = 86;

/** Indoor filter efficacy — fixed pooled estimate (does not scale with PM2.5). */
export const INDOOR_FILTER_EFFICACY_PCT = 57;
export const INDOOR_FILTER_CI_LO_PCT = 22.6;
export const INDOOR_FILTER_CI_HI_PCT = 92.0;

/** Maps [n] citation markers in the health explorer to study URLs. */
export const EDUCATION_HEALTH_CITATION_URLS: Record<number, string> = {
  1: AQI_HEALTH_PAPER_URL,
  2: BMJ_PM25_HOSPITAL_ER_URL,
  3: OUTDOOR_MASK_PAPER_URL,
  4: INDOOR_FILTER_PAPER_URL,
};

/**
 * Meta-analysis (short-term PM2.5): effect scaled from +65% / ±21% per +10 µg/m³; values are divided by 100
 * so displayed percentages match the literature scale used in the UI.
 */
export function mortalityPercentFromInterpolatedPm25(
  pm25UgM3: number | null | undefined,
): { pct: number; uncPct: number } | null {
  if (pm25UgM3 == null || !Number.isFinite(pm25UgM3) || pm25UgM3 <= 0) return null;
  const per10 = pm25UgM3 / 10;
  return { pct: (per10 * 65) / 100, uncPct: (per10 * 21) / 100 };
}

/** Linear scale of per–10 µg/m³ effect to current PM2.5 µg/m³. */
export function scalePer10ug(
  pm25UgM3: number | null | undefined,
  per10: number,
  per10Lo: number,
  per10Hi: number,
): { mid: number; lo: number; hi: number } | null {
  if (pm25UgM3 == null || !Number.isFinite(pm25UgM3) || pm25UgM3 <= 0) return null;
  const k = pm25UgM3 / 10;
  return { mid: k * per10, lo: k * per10Lo, hi: k * per10Hi };
}

/** Signed percentage for health-impact rows (always two decimal places). */
export function formatHealthImpactPct(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`;
}

/** Confidence-interval range for display, e.g. "1.23–4.56%". */
export function formatHealthImpactCiPct(lo: number, hi: number): string {
  return `${lo.toFixed(2)}–${hi.toFixed(2)}%`;
}

/** BMJ respiratory ED visits — excess relative risk per +10 µg/m³ two-day PM2.5. */
export function erVisitRateFromPm25(pm25UgM3: number | null | undefined) {
  return scalePer10ug(pm25UgM3, 1.34, 0.73, 1.94);
}

/** Display range for an EPA band index (0–5), e.g. "0–50". */
function educationAqiRange(bandIndex: number): string {
  const band = AQI_CATEGORY_BANDS[bandIndex];
  return band ? formatAqiIndexRange(band) : '';
}

/** YouTube item shown in Section 4 (language-specific `videoId` / title). */
export type EducationVideoItem = {
  videoId: string;
  title: string;
};

/** Stable id for each EPA AQI band card in Section 2. */
export type EducationAqiLevelId =
  | 'good'
  | 'moderate'
  | 'usg'
  | 'unhealthy'
  | 'very_unhealthy'
  | 'hazardous';

/** One expandable AQI category: colors, range, advice bullets, and action chips. */
export type EducationAqiLevel = {
  id: EducationAqiLevelId;
  label: string;
  range: string;
  leftColor: string;
  barFg: string;
  advice: string[];
  actions: string[];
};

/** Localized EPA category label for a given AQI (matches Section 2 `aqiLevels` order). */
export function educationAqiCategoryLabel(aqi: number, language: AppLanguage): string {
  const levels = educationCopy[language].aqiLevels;
  const idx = aqiCategoryBinIndex(aqi);
  return levels[idx]?.label ?? levels[0]?.label ?? '';
}

/** Strings for the Section 3 slider / literature-backed impact labels. */
export type EducationHealthExplorerCopy = {
  healthImpactsHeading: string;
  mortalityTitle: string;
  erTitle: string;
  protectionEfficacyHeading: string;
  outdoorMaskLabel: string;
  indoorFilterLabel: string;
  assumptionsTitle: string;
  assumptionsBody: string;
  pm25Equivalent: string;
  pm25Unknown: string;
  sliderHint: string;
};

/** Full Education tab copy tree for one locale. */
export type EducationCopy = {
  pageTitle: string;
  pageSubtitle: string;
  pmSectionLabel: string;
  pmTitle: string;
  pmBody: string[];
  aqiSectionLabel: string;
  aqiSectionTitle: string;
  aqiSectionSubtitle: string;
  aqiLevels: EducationAqiLevel[];
  sensitiveGroupsTitle: string;
  sensitiveGroups: string[];
  healthSectionLabel: string;
  healthSectionTitle: string;
  healthSectionSubtitle: string;
  healthExplorer: EducationHealthExplorerCopy;
  videoSectionLabel: string;
  videoSectionTitle: string;
  videoSectionSubtitle: string;
  videoTapHint: string;
  videoPlayingHint: string;
  videos: EducationVideoItem[];
};

/** English and Spanish Education tab content; consumed via `useLanguage().t.education`. */
export const educationCopy: Record<AppLanguage, EducationCopy> = {
  en: {
    pageTitle: 'Education',
    pageSubtitle:
      'Air quality guidance, health tips, and practical home tutorials to reduce pollution indoors.',
    pmSectionLabel: 'Section 1',
    pmTitle: 'About PM2.5',
    pmBody: [
      'PM2.5 are fine particles small enough to travel deep into the lungs and sometimes into the bloodstream. Common sources include wildfire smoke, traffic emissions, industry, and burning fuels.',
      'Even short-term exposure can worsen asthma and heart symptoms. Long-term exposure is linked to higher risk of respiratory and cardiovascular disease.',
    ],
    aqiSectionLabel: 'Section 2',
    aqiSectionTitle: 'AQI health guide',
    aqiSectionSubtitle: 'Tap a category to see health guidance and recommended actions for each level.',
    aqiLevels: [
      {
        id: 'good',
        label: 'Good',
        range: educationAqiRange(0),
        leftColor: '#00e400',
        barFg: '#0f172a',
        advice: [
          'Air quality is satisfactory and health risk is minimal.',
          'No special precautions are needed for most people.',
          'Ideal conditions for outdoor activities and exercise.',
        ],
        actions: ['Enjoy outdoor activities', 'Keep windows open', 'Use bike/walk routes'],
      },
      {
        id: 'moderate',
        label: 'Moderate',
        range: educationAqiRange(1),
        leftColor: '#ffdb00',
        barFg: '#0f172a',
        advice: [
          'Air quality is acceptable for most people.',
          'Very sensitive people may notice minor irritation with prolonged exposure.',
          'Most people can continue normal outdoor activity.',
        ],
        actions: ['Take breaks if sensitive', 'Watch for symptoms', 'Limit heavy exertion if needed'],
      },
      {
        id: 'usg',
        label: 'Unhealthy for Sensitive Groups',
        range: educationAqiRange(2),
        leftColor: '#ff7e00',
        barFg: '#0f172a',
        advice: [
          'Sensitive groups are at greater risk from prolonged exposure.',
          'People with asthma/COPD or heart disease may respond to symptoms sooner.',
          'Older adults and children should reduce prolonged outdoor exertion.',
        ],
        actions: ['Reduce prolonged exertion', 'Carry inhalers', 'Choose lower-traffic routes'],
      },
      {
        id: 'unhealthy',
        label: 'Unhealthy',
        range: educationAqiRange(3),
        leftColor: '#ff0000',
        barFg: '#ffffff',
        advice: [
          'Everyone can begin to experience health effects.',
          'Sensitive groups may feel effects earlier and more intensely.',
          'Extended outdoor activity may worsen breathing and cardiovascular symptoms.',
        ],
        actions: ['Limit time outdoors', 'Use well-fitted masks', 'Run indoor air filtration'],
      },
      {
        id: 'very_unhealthy',
        label: 'Very Unhealthy',
        range: educationAqiRange(4),
        leftColor: '#8f3f97',
        barFg: '#ffffff',
        advice: [
          'Health alert: risk is high for the entire population.',
          'Avoid prolonged or heavy outdoor activity.',
          'Children, older adults, and people with medical conditions should stay indoors.',
        ],
        actions: ['Stay indoors', 'Seal windows', 'Use HEPA filters'],
      },
      {
        id: 'hazardous',
        label: 'Hazardous',
        range: educationAqiRange(5),
        leftColor: '#7e0023',
        barFg: '#ffffff',
        advice: [
          'Emergency conditions. Serious health impacts are likely.',
          'Avoid all outdoor exertion and remain indoors when possible.',
          'Follow local public health guidance and emergency alerts.',
        ],
        actions: ['Avoid outdoor exposure', 'Use clean air shelters', 'Follow emergency guidance'],
      },
    ],
    sensitiveGroupsTitle: 'Who counts as a sensitive group?',
    sensitiveGroups: [
      'People with asthma, COPD, respiratory or other breathing conditions',
      'People with heart disease or those over 65 years old',
      'Children and teens, because lungs are still developing',
      'Pregnant people',
      'People who work or exercise heavily outdoors',
    ],
    healthSectionLabel: 'Section 3',
    healthSectionTitle: 'Health impact explorer',
    healthSectionSubtitle:
      'Drag AQI to see how estimated PM2.5 scales mortality and ER visit rates from published studies.',
    healthExplorer: {
      healthImpactsHeading: 'Short-term Health Impact',
      mortalityTitle: 'Mortality risk',
      erTitle: 'Respiratory ER visits',
      protectionEfficacyHeading: 'Protection efficacy',
      outdoorMaskLabel: 'Outdoor masks',
      indoorFilterLabel: 'Indoor filtration',
      assumptionsTitle: 'Supporting assumptions',
      assumptionsBody:
        '[1] Assumes short-term mortality risk increases approximately linearly with PM₂.₅ exposure and that published population-level epidemiological risk estimates are applicable to local outdoor exposure conditions\n\n[2] Assumes respiratory emergency department visit risk increases approximately linearly with short-term PM₂.₅ exposure and that the published population-level association is transferable to local outdoor exposure conditions\n\n[3] Assumes properly worn outdoor masks provide an approximately constant average PM₂.₅ exposure reduction across pollution levels and environmental conditions\n\n[4] Assumes indoor air filtration provides an approximately constant average reduction in indoor PM₂.₅ exposure across pollution levels, building conditions, and user behaviors',
      pm25Equivalent: '{value} µg/m³',
      pm25Unknown: '—',
      sliderHint: 'Drag the colored slider to explore different AQI levels.',
    },
    videoSectionLabel: 'Section 4',
    videoSectionTitle: 'How-To Videos',
    videoSectionSubtitle:
      'Watch quick how-to videos for improving indoor air quality and reducing outdoor pollution indoors.',
    videoTapHint: 'Tap to play',
    videoPlayingHint: 'Tap to close',
    videos: [
      { videoId: 'G4q7uainSxk', title: 'DIY Home Air Filter' },
      { videoId: 'uWorSY9C7ZQ', title: 'Home Door Sweeper' },
    ],
  },
  es: {
    pageTitle: 'Educación',
    pageSubtitle:
      'Guía de calidad del aire, salud y tutoriales prácticos para reducir la contaminación dentro del hogar.',
    pmSectionLabel: 'Sección 1',
    pmTitle: 'Sobre PM2.5',
    pmBody: [
      'PM2.5 son partículas finas lo bastante pequeñas como para llegar profundo a los pulmones y, a veces, al torrente sanguíneo. Las fuentes comunes incluyen humo de incendios, emisiones del tráfico, la industria y la quema de combustibles.',
      'Incluso la exposición a corto plazo puede empeorar los síntomas de asma y del corazón. La exposición prolongada se asocia con mayor riesgo de enfermedades respiratorias y cardiovasculares.',
    ],
    aqiSectionLabel: 'Sección 2',
    aqiSectionTitle: 'Guía de salud según AQI',
    aqiSectionSubtitle:
      'Toca una categoría para ver orientación de salud y acciones recomendadas en cada nivel.',
    aqiLevels: [
      {
        id: 'good',
        label: 'Bueno',
        range: educationAqiRange(0),
        leftColor: '#00e400',
        barFg: '#0f172a',
        advice: [
          'La calidad del aire es satisfactoria y el riesgo para la salud es mínimo.',
          'La mayoría de las personas no necesita precauciones especiales.',
          'Condiciones ideales para actividades y ejercicio al aire libre.',
        ],
        actions: ['Disfruta actividades al aire libre', 'Mantén ventanas abiertas', 'Usa rutas en bici o a pie'],
      },
      {
        id: 'moderate',
        label: 'Moderado',
        range: educationAqiRange(1),
        leftColor: '#ffdb00',
        barFg: '#0f172a',
        advice: [
          'La calidad del aire es aceptable para la mayoría.',
          'Personas muy sensibles pueden notar irritación leve con exposición prolongada.',
          'La mayoría puede seguir con actividad normal al aire libre.',
        ],
        actions: ['Haz pausas si eres sensible', 'Vigila los síntomas', 'Limita el esfuerzo intenso si hace falta'],
      },
      {
        id: 'usg',
        label: 'Insalubre para grupos sensibles',
        range: educationAqiRange(2),
        leftColor: '#ff7e00',
        barFg: '#0f172a',
        advice: [
          'Los grupos sensibles tienen mayor riesgo con exposición prolongada.',
          'Personas con asma/EPOC o enfermedad cardíaca pueden notar síntomas antes.',
          'Adultos mayores y niños deben reducir el esfuerzo prolongado al aire libre.',
        ],
        actions: ['Reduce el esfuerzo prolongado', 'Lleva inhaladores', 'Elige rutas con menos tráfico'],
      },
      {
        id: 'unhealthy',
        label: 'Insalubre',
        range: educationAqiRange(3),
        leftColor: '#ff0000',
        barFg: '#ffffff',
        advice: [
          'Todos pueden empezar a notar efectos en la salud.',
          'Los grupos sensibles pueden sentirlos antes y con más intensidad.',
          'La actividad prolongada al aire libre puede empeorar síntomas respiratorios y cardiovasculares.',
        ],
        actions: [
          'Limita el tiempo al aire libre',
          'Usa mascarillas bien ajustadas',
          'Usa filtración de aire interior',
        ],
      },
      {
        id: 'very_unhealthy',
        label: 'Muy insalubre',
        range: educationAqiRange(4),
        leftColor: '#8f3f97',
        barFg: '#ffffff',
        advice: [
          'Alerta de salud: el riesgo es alto para toda la población.',
          'Evita actividad prolongada o intensa al aire libre.',
          'Niños, adultos mayores y personas con condiciones médicas deben permanecer en interiores.',
        ],
        actions: ['Permanece en interiores', 'Sella ventanas', 'Usa filtros HEPA'],
      },
      {
        id: 'hazardous',
        label: 'Peligroso',
        range: educationAqiRange(5),
        leftColor: '#7e0023',
        barFg: '#ffffff',
        advice: [
          'Condiciones de emergencia. Es probable un impacto grave en la salud.',
          'Evita todo esfuerzo al aire libre y permanece en interiores cuando sea posible.',
          'Sigue la orientación de salud pública y alertas de emergencia locales.',
        ],
        actions: [
          'Evita la exposición al aire libre',
          'Usa refugios de aire limpio',
          'Sigue la orientación de emergencia',
        ],
      },
    ],
    sensitiveGroupsTitle: '¿Quién se considera grupo sensible?',
    sensitiveGroups: [
      'Personas con asma, EPOC, afecciones respiratorias u otras condiciones respiratorias',
      'Personas con enfermedad cardíaca o mayores de 65 años',
      'Niños y adolescentes, porque los pulmones aún se están desarrollando',
      'Personas embarazadas',
      'Personas que trabajan o hacen ejercicio intenso al aire libre',
    ],
    healthSectionLabel: 'Sección 3',
    healthSectionTitle: 'Explorador de impacto en la salud',
    healthSectionSubtitle:
      'Arrastra el AQI para ver cómo el PM2.5 estimado afecta mortalidad y visitas a urgencias según estudios publicados.',
    healthExplorer: {
      healthImpactsHeading: 'Estimaciones de impacto en la salud',
      mortalityTitle: 'Riesgo de mortalidad',
      erTitle: 'Visitas respiratorias a urgencias',
      protectionEfficacyHeading: 'Eficacia de protección',
      outdoorMaskLabel: 'Mascarillas al aire libre',
      indoorFilterLabel: 'Filtración interior',
      assumptionsTitle: 'Supuestos de apoyo',
      assumptionsBody:
        'Mortalidad y urgencias escalan linealmente con el PM₂.₅ (µg/m³) convertido desde el AQI de la EPA. Los valores de protección son estimaciones fijas de la literatura y no cambian con el AQI.',
      pm25Equivalent: '{value} µg/m³',
      pm25Unknown: '—',
      sliderHint: 'Arrastra el control de color para explorar distintos niveles de AQI.',
    },
    videoSectionLabel: 'Sección 4',
    videoSectionTitle: 'Videos prácticos',
    videoSectionSubtitle:
      'Mira videos rápidos sobre cómo mejorar la calidad del aire interior y reducir la contaminación que entra al hogar.',
    videoTapHint: 'Toca para reproducir',
    videoPlayingHint: 'Toca para cerrar',
    videos: [
      { videoId: '6VwHEfYrEqU', title: 'Filtro de Aire Casero' },
      { videoId: 'EDu464pi1h8', title: 'Burlete Para Puertas' },
    ],
  },
};

/** Medium-quality YouTube preview image for video list tiles. */
export function youtubeThumbnailUri(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Full-page iframe markup passed to the Education tab video WebView. */
export function buildYouTubeEmbedHtml(videoId: string): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '1',
    origin: YOUTUBE_EMBED_ORIGIN,
  });
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
    iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <iframe
    src="${embedUrl}"
    title="YouTube video player"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"
  ></iframe>
</body>
</html>`;
}
