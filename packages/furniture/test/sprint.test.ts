/**
 * The sprint timer as a pure state machine — goals-progress §10 (A15(d)). Every case
 * drives it with fixed instants and word totals; there is no clock and no timer.
 */
import { describe, expect, it } from 'vitest';

import {
  SPRINT_DEFAULT_MINUTES,
  SPRINT_MAX_MINUTES,
  createSprint,
  sprintView,
  transitionSprint,
  type SprintEvent,
  type SprintState,
} from '../src/index.js';

const T0 = 1_000_000;
const MINUTE = 60_000;

function run(state: SprintState, events: readonly SprintEvent[]): SprintState {
  return events.reduce(transitionSprint, state);
}

describe('starting, ticking and reading the live count', () => {
  it('starts from idle with the baseline at the session total', () => {
    const started = transitionSprint(createSprint(), { type: 'start', at: T0, words: 100 });
    expect(started).toMatchObject({ status: 'running', runningSince: T0, startWords: 100, lastWords: 100, elapsedMs: 0 });
  });

  it('counts the words written while running, and reads a live words-per-minute', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 100 },
      { type: 'tick', at: T0 + MINUTE, words: 130 },
    ]);
    const view = sprintView(state, T0 + MINUTE);
    expect(view.wordsGained).toBe(30);
    expect(view.elapsedMs).toBe(MINUTE);
    expect(view.wpm).toBe(30);
  });

  it('reads no words-per-minute before any time has run', () => {
    const started = transitionSprint(createSprint(), { type: 'start', at: T0, words: 100 });
    expect(sprintView(started, T0).wpm).toBeNull();
    expect(sprintView(createSprint(), T0).wpm).toBeNull();
  });

  it('keeps the previous count when a sample is not a finite number', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 10 },
      { type: 'tick', at: T0 + 1000, words: 25 },
      { type: 'tick', at: T0 + 2000, words: Number.NaN },
    ]);
    expect(state.lastWords).toBe(25);
  });

  it('reads zero, never negative, when the total falls below the baseline', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 500 },
      { type: 'tick', at: T0 + MINUTE, words: 480 },
    ]);
    expect(sprintView(state, T0 + MINUTE).wordsGained).toBe(0);
  });
});

describe('pause and resume: time and words typed while paused do not belong to the sprint', () => {
  it('stops the clock on pause and keeps it stopped', () => {
    const paused = run(createSprint(), [
      { type: 'start', at: T0, words: 0 },
      { type: 'pause', at: T0 + 2 * MINUTE, words: 150 },
    ]);
    expect(paused.status).toBe('paused');
    expect(sprintView(paused, T0 + 10 * MINUTE).elapsedMs).toBe(2 * MINUTE);
  });

  it('resumes the clock and moves the baseline past words typed during the pause', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 100 },
      { type: 'pause', at: T0 + 2 * MINUTE, words: 150 },
      { type: 'resume', at: T0 + 10 * MINUTE, words: 170 }, // 20 words typed while paused
    ]);
    expect(state.startWords).toBe(120);
    expect(sprintView(state, T0 + 10 * MINUTE).wordsGained).toBe(50);
    expect(sprintView(state, T0 + 11 * MINUTE).elapsedMs).toBe(3 * MINUTE);
  });
});

describe('the countdown ends on time, not on a tick', () => {
  it('finishes time-up at the duration, and clamps the elapsed time to it', () => {
    const state = run(createSprint(1), [
      { type: 'start', at: T0, words: 0 },
      { type: 'tick', at: T0 + MINUTE, words: 40 },
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'time-up', elapsedMs: MINUTE });
  });

  it('reads as finished between ticks once the countdown has run out', () => {
    const running = run(createSprint(1), [{ type: 'start', at: T0, words: 0 }]);
    const view = sprintView(running, T0 + 5 * MINUTE);
    expect(view).toMatchObject({ status: 'finished', endReason: 'time-up', remainingMs: 0, elapsedMs: MINUTE });
  });

  it('a pause that arrives after the countdown has run out is a time-up, not a pause', () => {
    const state = run(createSprint(1), [
      { type: 'start', at: T0, words: 0 },
      { type: 'pause', at: T0 + 3 * MINUTE, words: 60 },
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'time-up', elapsedMs: MINUTE });
  });

  it('a stop that arrives after the countdown has run out, with no tick between, is still a time-up', () => {
    const state = run(createSprint(1), [
      { type: 'start', at: T0, words: 100 },
      { type: 'tick', at: T0 + 10_000, words: 110 },
      { type: 'stop', at: T0 + 10 * MINUTE, words: 400 }, // 290 words typed after the countdown ended
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'time-up', elapsedMs: MINUTE });
    expect(sprintView(state, T0 + 10 * MINUTE).wordsGained).toBe(10);
  });

  it('a tick that arrives after the countdown has run out does not count the words typed after it', () => {
    const state = run(createSprint(1), [
      { type: 'start', at: T0, words: 100 },
      { type: 'tick', at: T0 + 10_000, words: 110 },
      { type: 'tick', at: T0 + 3 * MINUTE, words: 300 }, // a throttled tab, back after expiry
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'time-up', lastWords: 110 });
    expect(sprintView(state, T0 + 3 * MINUTE).wordsGained).toBe(10);
  });

  it('a pause that arrives after the countdown has run out does not count the words typed after it', () => {
    const state = run(createSprint(1), [
      { type: 'start', at: T0, words: 100 },
      { type: 'tick', at: T0 + 10_000, words: 110 },
      { type: 'pause', at: T0 + 3 * MINUTE, words: 300 },
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'time-up', lastWords: 110 });
    expect(sprintView(state, T0 + 3 * MINUTE).wordsGained).toBe(10);
  });

  it('reports the remaining time while running', () => {
    const running = run(createSprint(25), [{ type: 'start', at: T0, words: 0 }]);
    expect(sprintView(running, T0 + 5 * MINUTE).remainingMs).toBe(20 * MINUTE);
  });
});

describe('stopping early', () => {
  it('finishes as stopped, with the elapsed time up to the stop', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 0 },
      { type: 'tick', at: T0 + 30_000, words: 20 },
      { type: 'stop', at: T0 + 30_000, words: 20 },
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'stopped', elapsedMs: 30_000 });
  });

  it('stops from paused: neither the time nor the words typed during the pause are counted', () => {
    const state = run(createSprint(), [
      { type: 'start', at: T0, words: 100 },
      { type: 'pause', at: T0 + MINUTE, words: 110 },
      { type: 'stop', at: T0 + 9 * MINUTE, words: 160 }, // the 50 words typed while still paused are not the sprint's
    ]);
    expect(state).toMatchObject({ status: 'finished', endReason: 'stopped', elapsedMs: MINUTE });
    expect(sprintView(state, T0 + 9 * MINUTE).wordsGained).toBe(10);
  });
});

describe('editing the duration and resetting (goals-progress §10: "editable duration")', () => {
  it('starts at the default of 25 minutes', () => {
    expect(createSprint().durationMs).toBe(SPRINT_DEFAULT_MINUTES * MINUTE);
    expect(SPRINT_DEFAULT_MINUTES).toBe(25);
  });

  it('edits the duration only while idle, in whole minutes, clamped to the bounds', () => {
    expect(transitionSprint(createSprint(), { type: 'setDuration', minutes: 12.4 }).durationMs).toBe(12 * MINUTE);
    expect(transitionSprint(createSprint(), { type: 'setDuration', minutes: 0 }).durationMs).toBe(MINUTE);
    expect(transitionSprint(createSprint(), { type: 'setDuration', minutes: 10_000 }).durationMs).toBe(
      SPRINT_MAX_MINUTES * MINUTE,
    );
    expect(transitionSprint(createSprint(), { type: 'setDuration', minutes: Number.NaN }).durationMs).toBe(
      SPRINT_DEFAULT_MINUTES * MINUTE,
    );
  });

  it('ignores a duration edit once the sprint has started', () => {
    const running = run(createSprint(), [{ type: 'start', at: T0, words: 0 }]);
    expect(transitionSprint(running, { type: 'setDuration', minutes: 5 })).toBe(running);
  });

  it('cancels a running sprint back to idle, so the writer is never stuck in it', () => {
    const running = run(createSprint(10), [{ type: 'start', at: T0, words: 3 }]);
    expect(transitionSprint(running, { type: 'reset' })).toEqual({
      status: 'idle',
      durationMs: 10 * MINUTE,
      elapsedMs: 0,
      runningSince: null,
      startWords: 0,
      lastWords: 0,
      endReason: null,
    });
  });

  it('resets a finished sprint to idle, keeping the duration the writer chose', () => {
    const finished = run(createSprint(10), [
      { type: 'start', at: T0, words: 0 },
      { type: 'stop', at: T0 + MINUTE, words: 9 },
    ]);
    const reset = transitionSprint(finished, { type: 'reset' });
    expect(reset).toEqual({
      status: 'idle',
      durationMs: 10 * MINUTE,
      elapsedMs: 0,
      runningSince: null,
      startWords: 0,
      lastWords: 0,
      endReason: null,
    });
  });
});

describe('events that do not apply are ignored (the same state comes back)', () => {
  const idle = createSprint();
  const running = run(idle, [{ type: 'start', at: T0, words: 0 }]);
  const paused = transitionSprint(running, { type: 'pause', at: T0 + MINUTE, words: 0 });
  const finished = transitionSprint(paused, { type: 'stop', at: T0 + MINUTE, words: 0 });

  it('ignores pause, resume, tick and stop while idle', () => {
    expect(transitionSprint(idle, { type: 'pause', at: T0, words: 0 })).toBe(idle);
    expect(transitionSprint(idle, { type: 'resume', at: T0, words: 0 })).toBe(idle);
    expect(transitionSprint(idle, { type: 'tick', at: T0, words: 0 })).toBe(idle);
    expect(transitionSprint(idle, { type: 'stop', at: T0, words: 0 })).toBe(idle);
  });

  it('ignores start while already running, and resume while running', () => {
    expect(transitionSprint(running, { type: 'start', at: T0 + 1, words: 0 })).toBe(running);
    expect(transitionSprint(running, { type: 'resume', at: T0 + 1, words: 0 })).toBe(running);
  });

  it('ignores a tick while paused, so words typed in the pause never reach the baseline', () => {
    expect(transitionSprint(paused, { type: 'tick', at: T0 + 2 * MINUTE, words: 999 })).toBe(paused);
  });

  it('accepts nothing but reset once finished', () => {
    expect(transitionSprint(finished, { type: 'start', at: T0, words: 0 })).toBe(finished);
    expect(transitionSprint(finished, { type: 'resume', at: T0, words: 0 })).toBe(finished);
    expect(transitionSprint(finished, { type: 'setDuration', minutes: 3 })).toBe(finished);
    expect(transitionSprint(finished, { type: 'reset' })).not.toBe(finished);
  });
});

describe('purity', () => {
  it('never changes the state it is given', () => {
    const before = run(createSprint(), [{ type: 'start', at: T0, words: 5 }]);
    const snapshot = JSON.stringify(before);
    transitionSprint(before, { type: 'pause', at: T0 + MINUTE, words: 50 });
    sprintView(before, T0 + 2 * MINUTE);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
