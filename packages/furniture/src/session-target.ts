/**
 * The daily session target, read from `sessions.jsonl` — [goals-progress.md §2.1, §3, §9](docs/architecture/goals-progress.md).
 *
 * The target is app settings (`session.dailyTargetWords`), not project data. Its
 * progress is the words written in sessions whose `endedAt` falls on today's local
 * calendar day. A session that crosses midnight belongs to the day it ended on.
 * Nothing is recomputed from history when the target changes, because progress is a
 * sum over the log and the target is only the comparison.
 */
import type { SessionRecord } from '@caotang/store';

import { localDayOfInstant, type LocalDay } from './day.js';
import { MAX_DAILY_TARGET_WORDS } from './limits.js';

export interface SessionTargetProgress {
  readonly today: LocalDay;
  /** Words written in sessions that ended today, on the device's local calendar. */
  readonly todayWords: number;
  /** The daily target. Undefined when none is set: absent, or 0 after the clamp. */
  readonly target?: number;
  /** True once `todayWords` reaches the target. Crossing it is the one-shot notification's trigger. */
  readonly met: boolean;
  /** 0 to 1, for the progress ring. 0 when there is no target. */
  readonly fraction: number;
}

/**
 * The clamp of goals-progress §2.1: a whole number of words from 0 to 100 000. A value
 * that is not a finite number is treated as no target at all.
 */
export function clampDailyTarget(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_DAILY_TARGET_WORDS, Math.max(0, Math.floor(value)));
}

/** Today's progress against the target. `today` is injected; the function reads no clock. */
export function sessionTargetProgress(input: {
  readonly sessions: readonly SessionRecord[];
  readonly dailyTargetWords?: unknown;
  readonly today: LocalDay;
}): SessionTargetProgress {
  const todayWords = wordsByLocalDay(input.sessions).get(input.today) ?? 0;
  const clamped = clampDailyTarget(input.dailyTargetWords);
  const target = clamped !== undefined && clamped > 0 ? clamped : undefined;
  return {
    today: input.today,
    todayWords,
    ...(target !== undefined ? { target } : {}),
    met: target !== undefined && todayWords >= target,
    fraction: target === undefined ? 0 : Math.min(1, todayWords / target),
  };
}

/**
 * Words written per device-local day, keyed by the day each session ended on. Sessions
 * whose `endedAt` does not parse, or whose `wordsWritten` is not a whole count, are
 * skipped: the log keeps such a line as history, but it cannot be summed.
 */
export function wordsByLocalDay(sessions: readonly SessionRecord[]): Map<LocalDay, number> {
  const totals = new Map<LocalDay, number>();
  for (const session of sessions) {
    const day = localDayOfInstant(session.endedAt);
    if (day === undefined) continue;
    if (!Number.isInteger(session.wordsWritten) || session.wordsWritten < 0) continue;
    totals.set(day, (totals.get(day) ?? 0) + session.wordsWritten);
  }
  return totals;
}

/**
 * Words written in the sessions that ended on a day from `from` to `to`, both included: the progress of a weekly or monthly session goal
 * (goals-progress §9.3). Days are compared as their `YYYY-MM-DD` text, which orders them.
 */
export function wordsWrittenBetween(sessions: readonly SessionRecord[], from: LocalDay, to: LocalDay): number {
  let sum = 0;
  for (const [day, words] of wordsByLocalDay(sessions)) {
    if (day >= from && day <= to) sum += words;
  }
  return sum;
}
