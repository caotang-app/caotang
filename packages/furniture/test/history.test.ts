/**
 * The writing history (goals-progress §9.1): days grouped on the device's local calendar, the four stats, and the CSV.
 */
import { describe, expect, it } from 'vitest';

import { historyCsv, historyReading, type HistorySession } from '../src/index.js';

/** Noon on 9 October 2026, on this device's local calendar: "today" in every test below. */
const NOW = new Date(2026, 9, 9, 12, 0, 0);

/** An instant on the given October day, in local time; the sessions are read back on the same local calendar. */
function onOctober(day: number, hour = 12): string {
  return new Date(2026, 9, day, hour, 0, 0).toISOString();
}

describe('the writing history (goals-progress §9.1)', () => {
  it('groups sessions by local day, and reads today, the daily average and the daily best', () => {
    const sessions: HistorySession[] = [
      { endedAt: onOctober(9, 10), wordsWritten: 300 },
      { endedAt: onOctober(9, 15), wordsWritten: 200 },
      { endedAt: onOctober(7), wordsWritten: 900 },
      { endedAt: onOctober(5), wordsWritten: 0 },
    ];
    const reading = historyReading(sessions, NOW, 1000);
    expect(reading.today).toBe(500);
    expect(reading.recorded).toEqual([
      { day: '2026-10-07', words: 900, met: false },
      { day: '2026-10-09', words: 500, met: false },
    ]);
    // Two recorded days: 900 and 500 make 700 a day, and the best is the 900.
    expect(reading.dailyAverage).toBe(700);
    expect(reading.dailyBest).toBe(900);
  });

  it('shows the last ten days oldest first, a day with no writing as zero words, and marks the days that met the target', () => {
    const reading = historyReading([{ endedAt: onOctober(9), wordsWritten: 1000 }, { endedAt: onOctober(1), wordsWritten: 400 }], NOW, 800);
    expect(reading.lastTen).toHaveLength(10);
    expect(reading.lastTen[0]).toEqual({ day: '2026-09-30', words: 0, met: false });
    expect(reading.lastTen[1]).toEqual({ day: '2026-10-01', words: 400, met: false });
    expect(reading.lastTen[9]).toEqual({ day: '2026-10-09', words: 1000, met: true });
  });

  it('marks no day as met when no target is set, and a day with no words is never met', () => {
    const reading = historyReading([{ endedAt: onOctober(9), wordsWritten: 1000 }], NOW, undefined);
    expect(reading.recorded[0]?.met).toBe(false);
    expect(reading.lastTen.every((day) => !day.met)).toBe(true);
    expect(historyReading([], NOW, 0).lastTen.some((day) => day.met)).toBe(false);
  });

  it('reads an empty history as zeros, with no recorded days', () => {
    const reading = historyReading([], NOW, 500);
    expect(reading).toMatchObject({ today: 0, dailyAverage: 0, dailyBest: 0, recorded: [] });
    expect(reading.lastTen.map((day) => day.words)).toEqual(Array(10).fill(0));
  });

  it('leaves out a session whose end does not parse, as the daily target does', () => {
    const reading = historyReading([{ endedAt: 'not a time', wordsWritten: 700 }, { endedAt: onOctober(9), wordsWritten: 50 }], NOW, undefined);
    expect(reading.today).toBe(50);
    expect(reading.recorded).toHaveLength(1);
  });

  it('counts today as the status line does when today’s words are given, so the bar and the stats include the open sitting', () => {
    const sessions: HistorySession[] = [{ endedAt: onOctober(9, 10), wordsWritten: 300 }, { endedAt: onOctober(7), wordsWritten: 900 }];
    // The status line reads 300 from the sessions that ended today and 20 in the open sitting: 320 today.
    const reading = historyReading(sessions, NOW, 1000, 320);
    expect(reading.today).toBe(320);
    expect(reading.lastTen[9]).toEqual({ day: '2026-10-09', words: 320, met: false });
    expect(reading.recorded).toEqual([
      { day: '2026-10-07', words: 900, met: false },
      { day: '2026-10-09', words: 320, met: false },
    ]);
    expect(reading.dailyAverage).toBe(610);
    expect(reading.dailyBest).toBe(900);
    // An open sitting alone makes today a recorded day, the same as a session would.
    expect(historyReading([], NOW, undefined, 20).recorded).toEqual([{ day: '2026-10-09', words: 20, met: false }]);
  });

  it('exports a header and one row per recorded day, oldest first, and no row for a day with no words', () => {
    const reading = historyReading(
      [{ endedAt: onOctober(9, 15), wordsWritten: 500 }, { endedAt: onOctober(7), wordsWritten: 900 }, { endedAt: onOctober(6), wordsWritten: 0 }],
      NOW,
      undefined,
    );
    expect(historyCsv(reading)).toBe('date,words\n2026-10-07,900\n2026-10-09,500\n');
    expect(historyCsv(historyReading([], NOW, undefined))).toBe('date,words\n');
  });
});
