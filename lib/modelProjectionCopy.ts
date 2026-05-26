/** User-facing copy for the experimental model projection overlay. */

export const MODEL_EXPERIMENTAL_BADGE = 'Experimental';

export const MODEL_TITLE = 'PM₂.₅ analog forecast';

/** One-line summary shown under the title. */
export const MODEL_SHORT_BLURB =
  'Finds past hours with similar pollution, wind, and time-of-day, then blends how those situations changed over the next 1–5 hours onto today’s map.';

export const MODEL_HELP_TITLE = 'How this forecast works';

export const MODEL_HELP_PIPELINE = [
  'This is a research preview, not an official air-quality forecast. Use it to explore patterns only.',
  'The app builds a library from about seven days of sensor readings: at each past timestamp it stores a kriging PM₂.₅ map, wind (when available), time-of-day, and how the map changed at +1h through +5h.',
  'For “now” it summarizes the current heatmap and wind into a feature vector (mean, spread, quadrants, pooled cells, wind, and hour-of-day).',
  'It ranks library entries by weighted distance to that vector, keeps the top 12 matches, and weights them by similarity (inverse distance²) with a slight preference for more recent days.',
  'Each future step adds a weighted blend of those matches’ PM₂.₅ changes to the current grid, with caps based on historical change magnitudes and light spatial smoothing.',
  'If the library is small or matches are weak, it blends in a recent 48-hour trend so the map does not go blank.',
  'When a wind forecast is available, the predicted change field is shifted along that wind before it is applied; arrows on the map show forecast wind at the selected time.',
];

export const MODEL_HELP_MATCHES_HEADING = 'This run’s analog matches';

export const MODEL_HELP_MATCHES_LOADING =
  'Match details appear after the library finishes loading.';

export const MODEL_HELP_CLOSE_A11Y = 'Close help';

export const MODEL_HELP_BTN_A11Y = 'How this forecast works';
