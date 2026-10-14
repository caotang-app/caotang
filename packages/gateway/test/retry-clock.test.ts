/**
 * The retry arithmetic and the clock it runs on — provider-gateway.md §4. The numbers
 * here are the spec's: 1s then 4s, ±20%, `Retry-After` honoured, 5xx and 429 and
 * transport failures retryable, and every auth, endpoint, and context error final.
 */

import { describe, expect, it } from 'vitest';
import { backoffMs, createManualClock, DEFAULT_RETRY, DEFAULT_TIMEOUTS, parseRetryAfter, ProviderError, isRetryable } from '../src/index.js';

describe('backoffMs (§4: 1s → 4s, ±20% jitter)', () => {
  it('is exactly the base delay when the jitter source sits at its midpoint', () => {
    expect(backoffMs(0, () => 0.5, DEFAULT_RETRY)).toBe(1_000);
    expect(backoffMs(1, () => 0.5, DEFAULT_RETRY)).toBe(4_000);
  });

  it('stays within ±20% of the base at both ends of the jitter range', () => {
    expect(backoffMs(0, () => 0, DEFAULT_RETRY)).toBe(800);
    expect(backoffMs(1, () => 0, DEFAULT_RETRY)).toBe(3_200);
    const nearTop = backoffMs(0, () => 0.999_999, DEFAULT_RETRY);
    expect(nearTop).toBeGreaterThanOrEqual(1_190);
    expect(nearTop).toBeLessThanOrEqual(1_200);
  });

  it('repeats the last delay if asked for a retry past the table', () => {
    expect(backoffMs(5, () => 0.5, DEFAULT_RETRY)).toBe(4_000);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('reads a count of seconds', () => {
    expect(parseRetryAfter('7', now)).toBe(7_000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('reads an HTTP date relative to now, never negative', () => {
    expect(parseRetryAfter('Thu, 08 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Thu, 08 Oct 2020 12:00:00 GMT', now)).toBe(0);
  });

  it('returns undefined when the header is absent or unreadable, so the backoff applies', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon, maybe', now)).toBeUndefined();
  });
});

describe('isRetryable (§4 table)', () => {
  const error = (kind: ConstructorParameters<typeof ProviderError>[0], status?: number) =>
    new ProviderError(kind, 'x', status === undefined ? {} : { status });

  it('retries transport failures, rate limits, and 5xx', () => {
    expect(isRetryable(error('network'))).toBe(true);
    expect(isRetryable(error('rate_limit', 429))).toBe(true);
    expect(isRetryable(error('provider', 503))).toBe(true);
  });

  it('never retries an answer that will be the same on every attempt', () => {
    expect(isRetryable(error('auth', 401))).toBe(false);
    expect(isRetryable(error('endpoint', 404))).toBe(false);
    expect(isRetryable(error('context_length', 400))).toBe(false);
    expect(isRetryable(error('protocol'))).toBe(false);
    expect(isRetryable(error('provider', 400))).toBe(false);
    expect(isRetryable(error('provider'))).toBe(false);
  });
});

describe('ManualClock', () => {
  it('fires timers in due order at their due time, and only when advanced past them', () => {
    const clock = createManualClock(1_000);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push(`b@${clock.now()}`), 200);
    clock.setTimeout(() => fired.push(`a@${clock.now()}`), 100);
    expect(fired).toEqual([]);
    clock.advance(150);
    expect(fired).toEqual(['a@1100']);
    expect(clock.now()).toBe(1_150);
    clock.advance(100);
    expect(fired).toEqual(['a@1100', 'b@1200']);
    expect(clock.now()).toBe(1_250);
    expect(clock.pending).toBe(0);
  });

  it('does not fire a cleared timer', () => {
    const clock = createManualClock();
    let fired = false;
    const id = clock.setTimeout(() => (fired = true), 50);
    clock.clearTimeout(id);
    clock.advance(100);
    expect(fired).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it('runs a timer scheduled from inside another timer at the time it was scheduled for', () => {
    const clock = createManualClock();
    const seen: number[] = [];
    clock.setTimeout(() => {
      seen.push(clock.now());
      clock.setTimeout(() => seen.push(clock.now()), 30);
    }, 10);
    clock.advance(100);
    expect(seen).toEqual([10, 40]);
  });
});

describe('spec timeouts (§4)', () => {
  it('are connect 10s, first token 30s, idle 60s, and total 5 minutes', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ connectMs: 10_000, firstTokenMs: 30_000, idleMs: 60_000, totalMs: 300_000 });
  });

  it('allow two retries', () => {
    expect(DEFAULT_RETRY.maxRetries).toBe(2);
  });
});
