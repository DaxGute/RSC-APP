/**
 * Phase-aware load progress: advances toward explicit targets only (no fake global timer).
 * Display value never moves backward; optional easing within the current target.
 */

/** Yields one event-loop tick so RN can paint progress before heavy sync work. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Monotonic load bar API used while building analog library / frames. */
export type PhaseLoadProgressController = {
  /** Raise floor to at least `progress` [0..1] and update status text. */
  setProgress: (progress: number, message: string) => void;
  /** Jump display and floor immediately (e.g. phase boundary). */
  setProgressImmediate: (progress: number, message: string) => void;
  /** Animate display to 1, then invoke `onDone` (clears interval). */
  finish: (message: string, onDone: () => void) => void;
  /** Cancel ticking and reset finishing state. */
  stop: () => void;
};

/** UI refresh interval for eased progress updates. */
const TICK_MS = 48;
/** Fraction of remaining gap applied per tick toward `target`. */
const EASE = 0.22;

/** Factory for phase-aware projection load progress (monotonic display). */
export function createPhaseLoadProgress(
  onUpdate: (display: number, message: string) => void,
): PhaseLoadProgressController {
  let target = 0;
  let display = 0;
  let message = 'Preparing projection…';
  let tickId: ReturnType<typeof setInterval> | null = null;
  let finishing = false;

  const emit = () => onUpdate(display, message);

  /** Ease `display` toward `target` without overshooting. */
  const tick = () => {
    if (finishing) return;
    const delta = target - display;
    if (Math.abs(delta) < 0.003) {
      if (display !== target) {
        display = target;
        emit();
      }
      return;
    }
    display += delta * EASE;
    emit();
  };

  /** Start the interval loop on first `setProgress` call. */
  const ensureTicking = () => {
    if (tickId != null) return;
    tickId = setInterval(tick, TICK_MS);
    tick();
  };

  return {
    setProgress(progress: number, nextMessage: string) {
      target = Math.max(target, Math.max(0, Math.min(1, progress)));
      message = nextMessage;
      ensureTicking();
      emit();
    },
    setProgressImmediate(progress: number, nextMessage: string) {
      const p = Math.max(0, Math.min(1, progress));
      target = Math.max(target, p);
      display = p;
      message = nextMessage;
      emit();
    },
    finish(nextMessage: string, onDone: () => void) {
      finishing = true;
      message = nextMessage;
      target = 1;
      const fromDisplay = display;
      const finishStart = Date.now();
      const finishMs = 320;
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
      tickId = setInterval(finishTick, TICK_MS);
      finishTick();
    },
    stop() {
      finishing = false;
      if (tickId != null) clearInterval(tickId);
      tickId = null;
    },
  };
}
