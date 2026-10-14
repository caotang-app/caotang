/**
 * Progress and pace — goals-progress §2.2 and the §6 pace fixtures: exact perDay and
 * daysLeft, the deadline-today edge, overdue and met (pace omitted), and the `about`
 * tolerance at both edges.
 */
import { describe, expect, it } from 'vitest';

import { INDEX } from './fixtures/binder.js';
import {
  goalMet,
  goalProgress,
  orderGoalsForFooter,
  type GoalProbe,
  type ProjectGoal,
} from '../src/index.js';

const TODAY = '2026-10-08';

function goal(overrides: Partial<ProjectGoal> = {}): ProjectGoal {
  return {
    id: 'g_ABCDEFGHJK',
    nodeId: 'manuscript',
    metric: 'words',
    comparator: 'at-least',
    target: 12_000,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A probe that reports a fixed word count for any target that exists. */
function fixed(words: number): GoalProbe {
  return { wordsOf: () => words, isGoalTarget: () => true };
}

describe('the comparator triple (goals-progress §2.2)', () => {
  it('at-least holds from the target upward, inclusive', () => {
    expect(goalMet('at-least', 5000, 5000)).toBe(true);
    expect(goalMet('at-least', 4999, 5000)).toBe(false);
  });

  it('at-most holds up to the target, inclusive', () => {
    expect(goalMet('at-most', 2000, 2000)).toBe(true);
    expect(goalMet('at-most', 2001, 2000)).toBe(false);
  });
});

describe('the about tolerance: |progress − target| ≤ 10% of target, inclusive (§6)', () => {
  it('holds at exactly ±10%, on both edges', () => {
    expect(goalMet('about', 900, 1000)).toBe(true);
    expect(goalMet('about', 1100, 1000)).toBe(true);
  });

  it('fails one word outside either edge', () => {
    expect(goalMet('about', 899, 1000)).toBe(false);
    expect(goalMet('about', 1101, 1000)).toBe(false);
  });

  it('is exact in integers at a target where a float tolerance would wobble', () => {
    expect(goalMet('about', 2700, 3000)).toBe(true);
    expect(goalMet('about', 2699, 3000)).toBe(false);
    expect(goalMet('about', 3300, 3000)).toBe(true);
    expect(goalMet('about', 3301, 3000)).toBe(false);
  });
});

describe('progress is the subtree word sum of the goal node', () => {
  it('reads a folder against its descendants (manuscript = 3643 words in the fixture)', () => {
    const progress = goalProgress(goal({ target: 5000 }), INDEX, TODAY);
    expect(progress.current).toBe(3643);
    expect(progress.met).toBe(false);
    expect(progress.state).toBe('open');
  });

  it('reads a sub-folder against its own subtree (act1 = 2743 words)', () => {
    expect(goalProgress(goal({ nodeId: 'act1', target: 2000 }), INDEX, TODAY).current).toBe(2743);
  });
});

describe('pace (goals-progress §2.2): perDay = ceil(max(0, target − current) / max(1, daysLeft))', () => {
  it('computes ceil((12000 − 4500) / 23) = 327 by the §2.2 formula', () => {
    // 12 000 target, 4 500 written, deadline 31 Oct, today 8 Oct: 23 days left.
    const progress = goalProgress(goal({ deadline: '2026-10-31' }), fixed(4500), TODAY);
    expect(progress.pace).toEqual({ perDay: 327, daysLeft: 23 });
  });

  it('rounds up, never down', () => {
    // 8 357 remaining over 23 days is 363.3 a day, so it reads 364.
    const progress = goalProgress(goal({ deadline: '2026-10-31' }), INDEX, TODAY);
    expect(progress.current).toBe(3643);
    expect(progress.pace).toEqual({ perDay: 364, daysLeft: 23 });
  });

  it('gives an exact whole figure when the division is exact', () => {
    // 1 357 remaining over 23 days is 59 exactly.
    const progress = goalProgress(goal({ target: 5000, deadline: '2026-10-31' }), INDEX, TODAY);
    expect(progress.pace).toEqual({ perDay: 59, daysLeft: 23 });
  });

  it('on the deadline day, daysLeft is 1 and the whole remainder is the pace (§6 edge)', () => {
    const progress = goalProgress(goal({ target: 1000, deadline: TODAY }), fixed(400), TODAY);
    expect(progress.pace).toEqual({ perDay: 600, daysLeft: 1 });
    expect(progress.state).toBe('open');
  });

  it('counts days from today to the deadline, not from some other anchor', () => {
    const progress = goalProgress(goal({ target: 1000, deadline: '2026-10-13' }), fixed(0), TODAY);
    expect(progress.pace).toEqual({ perDay: 200, daysLeft: 5 });
  });

  it('crosses a month boundary by calendar days, not by 30-day months', () => {
    // 8 Oct to 2 Nov is 25 calendar days.
    const progress = goalProgress(goal({ target: 2500, deadline: '2026-11-02' }), fixed(0), TODAY);
    expect(progress.pace).toEqual({ perDay: 100, daysLeft: 25 });
  });

  it('crosses a leap day correctly', () => {
    // 27 Feb to 1 Mar 2028 is 3 calendar days in a leap year.
    const progress = goalProgress(goal({ target: 300, deadline: '2028-03-01' }), fixed(0), '2028-02-27');
    expect(progress.pace).toEqual({ perDay: 100, daysLeft: 3 });
  });

  it('is omitted when no deadline is set', () => {
    expect(goalProgress(goal(), fixed(0), TODAY).pace).toBeUndefined();
  });
});

describe('the states the spec names (§2.2, §6)', () => {
  it('a passed deadline on an unmet goal is overdue, and pace is omitted', () => {
    const progress = goalProgress(goal({ deadline: '2026-10-07' }), fixed(4500), TODAY);
    expect(progress.state).toBe('overdue');
    expect(progress.met).toBe(false);
    expect(progress.pace).toBeUndefined();
  });

  it('an already-met goal reports met: true, and pace is omitted even with a future deadline', () => {
    const progress = goalProgress(goal({ deadline: '2026-10-31' }), fixed(12_000), TODAY);
    expect(progress.met).toBe(true);
    expect(progress.state).toBe('met');
    expect(progress.pace).toBeUndefined();
  });

  it('a met goal past its deadline is met, not overdue', () => {
    const progress = goalProgress(goal({ deadline: '2026-10-01' }), fixed(12_000), TODAY);
    expect(progress.state).toBe('met');
  });

  it('a goal whose node has gone is target-missing: it matches nothing and carries no pace', () => {
    const progress = goalProgress(goal({ nodeId: 'gone', deadline: '2026-10-31' }), INDEX, TODAY);
    expect(progress).toEqual({ current: 0, met: false, state: 'target-missing' });
  });

  it('a goal aimed at a document, not a folder, is target-missing too', () => {
    expect(goalProgress(goal({ nodeId: 's1' }), INDEX, TODAY).state).toBe('target-missing');
  });

  it('a cap that has been passed is exceeded: writing cannot bring it back', () => {
    const progress = goalProgress(goal({ comparator: 'at-most', target: 2000 }), fixed(2500), TODAY);
    expect(progress.state).toBe('exceeded');
    expect(progress.met).toBe(false);
  });

  it('an exceeded cap carries no pace even with a future deadline, so no perDay of 0 reads as a plan', () => {
    const progress = goalProgress(goal({ comparator: 'at-most', target: 2000, deadline: '2026-10-31' }), fixed(2500), TODAY);
    expect(progress.state).toBe('exceeded');
    expect(progress.pace).toBeUndefined();
  });

  it('a cap that still holds is met', () => {
    expect(goalProgress(goal({ comparator: 'at-most', target: 2000 }), fixed(1500), TODAY).state).toBe('met');
  });

  it('an overdue cap reads overdue, the spec’s state, rather than exceeded', () => {
    const progress = goalProgress(goal({ comparator: 'at-most', target: 2000, deadline: '2026-10-01' }), fixed(2500), TODAY);
    expect(progress.state).toBe('overdue');
  });
});

describe('the about comparator in progress', () => {
  it('is met anywhere inside the band', () => {
    expect(goalProgress(goal({ comparator: 'about', target: 1000 }), fixed(900), TODAY).state).toBe('met');
    expect(goalProgress(goal({ comparator: 'about', target: 1000 }), fixed(1100), TODAY).state).toBe('met');
  });

  it('is open below the band and still has a pace toward the target', () => {
    // 899 is one word below the band. 101 words remain to the target, over 10 days.
    const progress = goalProgress(goal({ comparator: 'about', target: 1000, deadline: '2026-10-18' }), fixed(899), TODAY);
    expect(progress.state).toBe('open');
    expect(progress.pace).toEqual({ perDay: 11, daysLeft: 10 });
  });

  it('is exceeded above the band, where writing cannot help', () => {
    expect(goalProgress(goal({ comparator: 'about', target: 1000 }), fixed(1101), TODAY).state).toBe('exceeded');
  });

  it('above the band it is exceeded and carries no pace, though a deadline is set', () => {
    const progress = goalProgress(goal({ comparator: 'about', target: 1000, deadline: '2026-10-18' }), fixed(1101), TODAY);
    expect(progress.state).toBe('exceeded');
    expect(progress.pace).toBeUndefined();
  });
});

describe('the footer order (goals-progress §4): nearest deadline first', () => {
  const near = goal({ id: 'g_NEARNEAR01', deadline: '2026-10-10', createdAt: '2026-09-05T00:00:00.000Z' });
  const far = goal({ id: 'g_FARFARFAR1', deadline: '2026-12-01', createdAt: '2026-08-01T00:00:00.000Z' });
  const open = goal({ id: 'g_OPENOPEN01', createdAt: '2026-07-01T00:00:00.000Z' });
  const shelved = goal({ id: 'g_SHELVED001', deadline: '2026-10-09', archived: true });

  it('lists active goals by deadline, dated goals before open-ended ones', () => {
    expect(orderGoalsForFooter([open, far, shelved, near]).map((g) => g.id)).toEqual([
      'g_NEARNEAR01',
      'g_FARFARFAR1',
      'g_OPENOPEN01',
    ]);
  });

  it('leaves archived goals off the rail (they stay in the manifest)', () => {
    expect(orderGoalsForFooter([shelved]).map((g) => g.id)).toEqual([]);
  });

  it('breaks a deadline tie by the older goal, then by id, so the order is total', () => {
    const older = goal({ id: 'g_OLDERGOAL1', deadline: '2026-11-01', createdAt: '2026-06-01T00:00:00.000Z' });
    const newer = goal({ id: 'g_NEWERGOAL1', deadline: '2026-11-01', createdAt: '2026-06-02T00:00:00.000Z' });
    expect(orderGoalsForFooter([newer, older]).map((g) => g.id)).toEqual(['g_OLDERGOAL1', 'g_NEWERGOAL1']);
  });
});
