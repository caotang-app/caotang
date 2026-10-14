/**
 * Time, injected. Every timeout and backoff in the gateway goes through a `Clock`, so
 * the §4 behaviour (10s connect, 30s first token, 60s idle, 5 min total, 1s→4s backoff)
 * is tested by advancing time, not by sleeping. Tests and the harness's own evals use
 * `createManualClock`; the browser uses `systemClock`.
 */

/** Opaque handle returned by `setTimeout`. */
export type TimerId = unknown;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

export interface ManualClock extends Clock {
  /** Moves time forward, firing every timer that comes due, in due order, at its due time. */
  advance(ms: number): void;
  /** Timers still waiting. A test asserts on this to show nothing was left running. */
  readonly pending: number;
}

interface PendingTimer {
  readonly due: number;
  readonly order: number;
  readonly callback: () => void;
}

/** A clock that only moves when told to. Timers fire synchronously inside `advance`. */
export function createManualClock(startAt = 0): ManualClock {
  let current = startAt;
  let order = 0;
  const timers = new Map<number, PendingTimer>();

  return {
    now: () => current,
    setTimeout(callback, ms) {
      order += 1;
      timers.set(order, { due: current + Math.max(0, ms), order, callback });
      return order;
    },
    clearTimeout(id) {
      if (typeof id === 'number') timers.delete(id);
    },
    advance(ms) {
      const target = current + ms;
      for (;;) {
        let next: [number, PendingTimer] | undefined;
        for (const entry of timers) {
          const [, timer] = entry;
          if (timer.due > target) continue;
          if (next === undefined || timer.due < next[1].due || (timer.due === next[1].due && timer.order < next[1].order)) {
            next = entry;
          }
        }
        if (next === undefined) break;
        timers.delete(next[0]);
        current = next[1].due;
        next[1].callback();
      }
      current = target;
    },
    get pending() {
      return timers.size;
    },
  };
}
