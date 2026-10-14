/**
 * The writing history (goals-progress §9.1): the sessions in `sessions.jsonl`, grouped by the device's local calendar day, with
 * the stats the History panel shows and the CSV it exports. A pure read: nothing is stored that the sessions do not already
 * hold, and the clock is handed in as `now`, never read here.
 */

import { localDayOf, localDayOfInstant, type LocalDay } from './day.js';

/** One recorded session, as `sessions.jsonl` holds it: the instant it ended and the words it wrote. */
export interface HistorySession {
  readonly endedAt: string;
  readonly wordsWritten: number;
}

/** One local day: the words written on it, and whether they met the daily target (never, with no target set). */
export interface HistoryDay {
  readonly day: LocalDay;
  readonly words: number;
  readonly met: boolean;
}

export interface HistoryReading {
  /** The words written today, on the device's local day. */
  readonly today: number;
  /** The words per recorded day, rounded to a whole word; zero with no recorded day. A recorded day is one with words in it. */
  readonly dailyAverage: number;
  /** The most words written on one recorded day; zero with none. */
  readonly dailyBest: number;
  /** The last ten local days, oldest first, with a day that had no writing counted as zero words. */
  readonly lastTen: readonly HistoryDay[];
  /** Every recorded day, oldest first: the rows the CSV carries. */
  readonly recorded: readonly HistoryDay[];
}

/** How many days the history's bars show, counting today. */
export const HISTORY_BAR_DAYS = 10;

/**
 * The history of a set of sessions, read on `now`'s local day. A session whose end does not parse is left out, as the
 * daily target leaves it out. `dailyTarget` is the session target in words, or `undefined` when none is set.
 *
 * `todayWords`, when given, is today's total as the status line counts it: the sessions that ended today plus the sitting
 * that is open now. It replaces today's total from the sessions, so the bar, the average, the best and the Today figure
 * agree with the status line. Without it, today is the sessions alone.
 */
export function historyReading(
  sessions: readonly HistorySession[],
  now: Date,
  dailyTarget: number | undefined,
  todayWords?: number,
): HistoryReading {
  const totals = new Map<LocalDay, number>();
  for (const session of sessions) {
    const day = localDayOfInstant(session.endedAt);
    if (day === undefined) continue;
    totals.set(day, (totals.get(day) ?? 0) + session.wordsWritten);
  }
  if (todayWords !== undefined) totals.set(localDayOf(now), todayWords);
  const met = (words: number): boolean => dailyTarget !== undefined && words > 0 && words >= dailyTarget;

  const recorded: HistoryDay[] = [...totals.entries()]
    .filter(([, words]) => words > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, words]) => ({ day, words, met: met(words) }));
  const total = recorded.reduce((sum, row) => sum + row.words, 0);
  const best = recorded.reduce((max, row) => Math.max(max, row.words), 0);

  // The bars count back from today by calendar day, so a day with no sessions is still a bar, and the arithmetic stays on the
  // local calendar (no fixed number of milliseconds per day, so no daylight-saving drift).
  const lastTen: HistoryDay[] = [];
  for (let offset = HISTORY_BAR_DAYS - 1; offset >= 0; offset -= 1) {
    const day = localDayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    const words = totals.get(day) ?? 0;
    lastTen.push({ day, words, met: met(words) });
  }

  const today = localDayOf(now);
  return {
    today: totals.get(today) ?? 0,
    dailyAverage: recorded.length === 0 ? 0 : Math.round(total / recorded.length),
    dailyBest: best,
    lastTen,
    recorded,
  };
}

/** The CSV of a history (goals-progress §9.1): a header, then one row per recorded day, oldest first. Days with no words are not rows. */
export function historyCsv(reading: HistoryReading): string {
  const rows = ['date,words', ...reading.recorded.map((row) => `${row.day},${row.words}`)];
  return `${rows.join('\n')}\n`;
}
