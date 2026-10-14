/**
 * The daily session target, computed from sessions.jsonl — goals-progress §2.1 and §9.
 *
 * Instants are built with the local-time constructor, so "today" means the same local
 * day under every timezone the test runner might have.
 */
import type { SessionRecord } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { clampDailyTarget, sessionTargetProgress, wordsByLocalDay } from '../src/index.js';

const TODAY = '2026-10-08';

/** An ISO instant on a local calendar day and time. */
function local(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function session(startedAt: string, endedAt: string, wordsWritten: number): SessionRecord {
  return { startedAt, endedAt, wordsWritten, docIds: ['s1'] };
}

describe('today’s words (goals-progress §2.1): sessions whose endedAt falls on the local day', () => {
  it('sums the sessions that ended today and leaves out the other days', () => {
    const sessions = [
      session(local(2026, 10, 8, 8), local(2026, 10, 8, 9), 300),
      session(local(2026, 10, 8, 22), local(2026, 10, 8, 23, 30), 200),
      session(local(2026, 10, 7, 23), local(2026, 10, 7, 23, 59), 999), // yesterday
      session(local(2026, 10, 9, 0), local(2026, 10, 9, 0, 10), 50), // tomorrow
    ];
    expect(sessionTargetProgress({ sessions, dailyTargetWords: 800, today: TODAY }).todayWords).toBe(500);
  });

  it('counts a session that started yesterday by the day it ended, which is today', () => {
    const sessions = [session(local(2026, 10, 7, 23), local(2026, 10, 8, 0, 30), 150)];
    expect(sessionTargetProgress({ sessions, today: TODAY }).todayWords).toBe(150);
  });

  it('leaves out a session that started today and ended tomorrow', () => {
    const sessions = [session(local(2026, 10, 8, 23), local(2026, 10, 9, 0, 40), 150)];
    expect(sessionTargetProgress({ sessions, today: TODAY }).todayWords).toBe(0);
  });

  it('skips a line whose endedAt does not parse, or whose word count is not a whole count', () => {
    const sessions = [
      session(local(2026, 10, 8, 8), 'not a timestamp', 400),
      session(local(2026, 10, 8, 8), local(2026, 10, 8, 9), -5),
      session(local(2026, 10, 8, 8), local(2026, 10, 8, 9), 1.5),
      session(local(2026, 10, 8, 8), local(2026, 10, 8, 9), 100),
    ];
    expect(sessionTargetProgress({ sessions, today: TODAY }).todayWords).toBe(100);
  });
});

describe('the target and the ring', () => {
  const sessions = [session(local(2026, 10, 8, 9), local(2026, 10, 8, 10), 412)];

  it('reports no target when none is set, and no ring fill', () => {
    const progress = sessionTargetProgress({ sessions, today: TODAY });
    expect(progress.target).toBeUndefined();
    expect(progress.met).toBe(false);
    expect(progress.fraction).toBe(0);
    expect(progress.todayWords).toBe(412);
  });

  it('treats a target of zero as no target', () => {
    expect(sessionTargetProgress({ sessions, dailyTargetWords: 0, today: TODAY }).target).toBeUndefined();
  });

  it('reads the ring fraction as today over target, below the goal', () => {
    const progress = sessionTargetProgress({ sessions, dailyTargetWords: 800, today: TODAY });
    expect(progress.target).toBe(800);
    expect(progress.met).toBe(false);
    expect(progress.fraction).toBeCloseTo(412 / 800, 10);
  });

  it('is met at exactly the target, and the ring is full', () => {
    const progress = sessionTargetProgress({ sessions, dailyTargetWords: 412, today: TODAY });
    expect(progress.met).toBe(true);
    expect(progress.fraction).toBe(1);
  });

  it('caps the ring at full when today is well past the target', () => {
    expect(sessionTargetProgress({ sessions, dailyTargetWords: 100, today: TODAY }).fraction).toBe(1);
  });

  it('applies a mid-session target edit at once, with no history recompute', () => {
    expect(sessionTargetProgress({ sessions, dailyTargetWords: 400, today: TODAY }).met).toBe(true);
    expect(sessionTargetProgress({ sessions, dailyTargetWords: 600, today: TODAY }).met).toBe(false);
  });

  it('a new day starts at zero, whatever yesterday held', () => {
    const progress = sessionTargetProgress({ sessions, dailyTargetWords: 400, today: '2026-10-09' });
    expect(progress.todayWords).toBe(0);
    expect(progress.met).toBe(false);
  });
});

describe('the clamp (goals-progress §2.1: 0 to 100 000)', () => {
  it('reads an absent or non-numeric target as no target', () => {
    expect(clampDailyTarget(undefined)).toBeUndefined();
    expect(clampDailyTarget(Number.NaN)).toBeUndefined();
    expect(clampDailyTarget('800')).toBeUndefined();
  });

  it('clamps below zero to zero and above 100 000 to 100 000', () => {
    expect(clampDailyTarget(-40)).toBe(0);
    expect(clampDailyTarget(150_000)).toBe(100_000);
  });

  it('keeps a whole number and floors a fraction', () => {
    expect(clampDailyTarget(800)).toBe(800);
    expect(clampDailyTarget(800.9)).toBe(800);
  });
});

describe('words per local day (the aggregation the v0.2 history panel will read)', () => {
  it('groups session words under the day each session ended on', () => {
    const sessions = [
      session(local(2026, 10, 7, 9), local(2026, 10, 7, 10), 300),
      session(local(2026, 10, 7, 20), local(2026, 10, 7, 21), 200),
      session(local(2026, 10, 8, 9), local(2026, 10, 8, 10), 50),
    ];
    const byDay = wordsByLocalDay(sessions);
    expect(byDay.get('2026-10-07')).toBe(500);
    expect(byDay.get('2026-10-08')).toBe(50);
    expect(byDay.has('2026-10-06')).toBe(false);
  });
});
