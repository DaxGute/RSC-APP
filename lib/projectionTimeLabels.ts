export const PROJECTION_STEP_MINUTES = 10;
export const PROJECTION_FUTURE_STEPS = 30;
export const PROJECTION_FRAME_COUNT = PROJECTION_FUTURE_STEPS + 1;

/** Major slider labels every hour (6 × 10-minute steps). */
export const PROJECTION_MAJOR_STEP_INDICES = [0, 6, 12, 18, 24, 30] as const;
export const PROJECTION_MAJOR_LABELS = ['Now', '+1h', '+2h', '+3h', '+4h', '+5h'] as const;

export function minutesAheadForStep(stepIndex: number): number {
  return Math.max(0, stepIndex) * PROJECTION_STEP_MINUTES;
}

export function formatProjectionHeader(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Projection: Now';
  if (minutesAhead < 60) return `Projection: +${minutesAhead} min`;
  const hours = Math.floor(minutesAhead / 60);
  const mins = minutesAhead % 60;
  if (mins === 0) return `Projection: +${hours}h`;
  return `Projection: +${hours}h ${mins}m`;
}

export function formatStepShortLabel(minutesAhead: number): string {
  if (minutesAhead <= 0) return 'Now';
  if (minutesAhead < 60) return `+${minutesAhead}m`;
  const hours = Math.floor(minutesAhead / 60);
  const mins = minutesAhead % 60;
  if (mins === 0) return `+${hours}h`;
  return `+${hours}h ${mins}m`;
}
