/**
 * Deadlines and cancellation, the two ways a provider call stops early.
 *
 * Both are internal. The public surface never throws them: a caller's abort becomes the
 * stream's terminal `finishReason: 'error'` (§3, "resolves the iterator with what
 * arrived"), and a deadline becomes a `network` ProviderError naming the phase that
 * ran out. These classes exist so the transport can tell the two apart from a real
 * network failure, which is retryable and a deadline is not, in the sense that it
 * retries only before the first token.
 */

import type { Clock } from './clock.js';

/** The caller aborted. Internal. */
export class CallerCancelled extends Error {
  constructor() {
    super('cancelled by caller');
    this.name = 'CallerCancelled';
  }
}

/** A timeout elapsed. Internal. */
export class DeadlineReached extends Error {
  constructor() {
    super('deadline reached');
    this.name = 'DeadlineReached';
  }
}

/**
 * Races `work` against a deadline and the caller's signal.
 *
 * `work` is always observed, even after the race is decided. A rejection that arrives
 * late would otherwise be unhandled, which in Node is a crash. `onStop` runs when the
 * race is lost to the deadline or to the caller, so the transport can abort the fetch
 * behind `work` and cancel a response body that arrives after we have given up.
 */
export function guard<T>(
  work: Promise<T>,
  limitMs: number,
  clock: Clock,
  signal?: AbortSignal,
  onStop?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    // The timer handle is held in an object so the cleanup below can read it after the
    // timer has been created, without a binding that is reassigned once.
    const handles: { timer?: unknown } = {};

    const release = (): void => {
      settled = true;
      if (handles.timer !== undefined) clock.clearTimeout(handles.timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      release();
      onStop?.();
      reject(new CallerCancelled());
    };

    work.then(
      (value) => {
        if (settled) return;
        release();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        release();
        reject(error);
      },
    );

    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (limitMs <= 0) {
      settled = true;
      onStop?.();
      reject(new DeadlineReached());
      return;
    }
    handles.timer = clock.setTimeout(() => {
      if (settled) return;
      release();
      onStop?.();
      reject(new DeadlineReached());
    }, limitMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves after `ms`, or rejects with `CallerCancelled` if the signal aborts first. */
export function sleep(ms: number, clock: Clock, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CallerCancelled());
      return;
    }
    const onAbort = (): void => {
      clock.clearTimeout(timer);
      reject(new CallerCancelled());
    };
    const timer = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
