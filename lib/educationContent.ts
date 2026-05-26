import type { AppLanguage } from './appLanguage';
import { AQI_CATEGORY_BANDS, formatAqiIndexRange } from './airQualityBreakpoints';

function educationAqiRange(bandIndex: number): string {
  const band = AQI_CATEGORY_BANDS[bandIndex];
  return band ? formatAqiIndexRange(band) : '';
}

export type EducationVideoItem = {
  videoId: string;
  title: string;
};

export type EducationAqiLevelId =
  | 'good'
  | 'moderate'
  | 'usg'
  | 'unhealthy'
  | 'very_unhealthy'
  | 'hazardous';

export type EducationAqiLevel = {
  id: EducationAqiLevelId;
  label: string;
  range: string;
  leftColor: string;
  barFg: string;
  advice: string[];
  actions: string[];
};

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

export type EducationCopy = {
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

export const educationCopy: Record<AppLanguage, EducationCopy> = {
  en: {
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

export function youtubeThumbnailUri(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
