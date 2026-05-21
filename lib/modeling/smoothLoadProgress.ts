/**
 * Drives a load bar that advances steadily (time-based) while work runs in the background.
 * Work callbacks only raise the floor — the displayed value never jumps backward.
 */

export type SmoothLoadProgressOptions = {
  /** Expected load duration used for the linear time ramp (default 16s). */
  estimatedMs?: number;
  /** Max display value before explicit finish (default 0.99). */
  capUntilFinish?: number;
};

export type SmoothLoadProgressController = {
  /** Raise the work floor [0..1] and optionally update status text. */
  setTarget: (progress: number, message?: string) => void;
  getDisplay: () => number;
  getMessage: () => string;
  /** Run ~linear finish animation to 1, then invoke onDone. */
  finish: (message: string, onDone: () => void) => void;
  stop: () => void;
};

const DEFAULT_TICK_MS = 48;

export function createSmoothLoadProgress(
  onUpdate: (display: number, message: string) => void,
  options?: SmoothLoadProgressOptions,
): SmoothLoadProgressController {
  const estimatedMs = options?.estimatedMs ?? 16_000;
  const capUntilFinish = options?.capUntilFinish ?? 0.99;

  let target = 0;
  let display = 0;
  let message = 'Preparing projection…';
  let startMs = Date.now();
  let tickId: ReturnType<typeof setInterval> | null = null;
  let finishing = false;

  const emit = () => onUpdate(display, message);

  const tick = () => {
    if (finishing) return;
    const elapsed = Date.now() - startMs;
    const timeLinear = Math.min(capUntilFinish, (elapsed / estimatedMs) * capUntilFinish);
    const next = Math.max(display, Math.min(capUntilFinish, Math.max(timeLinear, target)));
    if (next !== display) {
      display = next;
      emit();
    }
  };

  const startTicking = () => {
    if (tickId != null) return;
    startMs = Date.now();
    tickId = setInterval(tick, DEFAULT_TICK_MS);
    tick();
  };

  return {
    setTarget(progress: number, nextMessage?: string) {
      target = Math.max(target, Math.max(0, Math.min(1, progress)));
      if (nextMessage) message = nextMessage;
      startTicking();
      emit();
    },
    getDisplay: () => display,
    getMessage: () => message,
    finish(nextMessage: string, onDone: () => void) {
      finishing = true;
      message = nextMessage;
      target = 1;
      const fromDisplay = display;
      const finishStart = Date.now();
      const finishMs = 380;
      if (tickId != null) clearInterval(tickId);
      const finishTick = () => {
        const t = Math.min(1, (Date.now() - finishStart) / finishMs);
        display = fromDisplay + (1 - fromDisplay) * t;
        emit();
        if (t >= 1) {
          display = 1;
          if (tickId != null) clearInterval(tickId);
          tickId = null;
          onDone();
        }
      };
      tickId = setInterval(finishTick, DEFAULT_TICK_MS);
      finishTick();
    },
    stop() {
      finishing = false;
      if (tickId != null) clearInterval(tickId);
      tickId = null;
    },
  };
}
