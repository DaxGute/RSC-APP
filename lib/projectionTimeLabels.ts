/** Matches hourly `forecast_wind_grid` valid times in the database. */
export const PROJECTION_STEP_HOURS = 1;
export const PROJECTION_STEP_MINUTES = PROJECTION_STEP_HOURS * 60;
export const PROJECTION_FUTURE_STEPS = 5;
export const PROJECTION_FRAME_COUNT = PROJECTION_FUTURE_STEPS + 1;

/** Major slider ticks: Now through +5h (one step per hour). */
export const PROJECTION_MAJOR_STEP_INDICES = [0, 1, 2, 3, 4, 5] as const;
export const PROJECTION_MAJOR_LABELS = ['Now', '+1h', '+2h', '+3h', '+4h', '+5h'] as const;

export function hoursAheadForStep(stepIndex: number): number {
  return Math.max(0, stepIndex) * PROJECTION_STEP_HOURS;
}

export function minutesAheadForStep(stepIndex: number): number {
  return hoursAheadForStep(stepIndex) * 60;
}

export function formatProjectionHeader(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Projection: Now';
  const hours = Math.round(minutesAhead / 60);
  return `Projection: +${hours}h`;
}

export function formatStepShortLabel(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Now';
  const hours = Math.round(minutesAhead / 60);
  return `+${hours}h`;
}
