/**
 * Load-time tolerance for `goals[]` — goals-progress §3 and §6 persistence fixtures: an
 * absent array is no goals; an unknown comparator or metric drops the goal with a
 * warning; a dangling nodeId is kept and flagged, never blocking; a malformed goal is dropped.
 */
import { describe, expect, it } from 'vitest';

import { BINDER } from './fixtures/binder.js';
import { parseProjectGoals } from '../src/index.js';

const VALID = {
  id: 'g_ABCDEFGHJK',
  nodeId: 'act1',
  metric: 'words',
  comparator: 'at-least',
  target: 12000,
  deadline: '2026-10-31',
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

describe('absence and shape', () => {
  it('treats an absent goals array as no goals, with no notice (the additive rule)', () => {
    expect(parseProjectGoals(undefined)).toEqual({ goals: [], notices: [] });
  });

  it('keeps a valid goal with every spec field', () => {
    const { goals, notices } = parseProjectGoals([VALID]);
    expect(notices).toEqual([]);
    expect(goals).toEqual([
      {
        id: 'g_ABCDEFGHJK',
        nodeId: 'act1',
        metric: 'words',
        comparator: 'at-least',
        target: 12000,
        deadline: '2026-10-31',
        createdAt: '2026-09-13T10:00:00.000Z',
        updatedAt: '2026-09-13T10:00:00.000Z',
      },
    ]);
  });

  it('keeps an open-ended goal with no deadline, and an archived one', () => {
    const { goals } = parseProjectGoals([{ ...VALID, deadline: undefined, archived: true }]);
    expect(goals[0]).not.toHaveProperty('deadline');
    expect(goals[0]?.archived).toBe(true);
  });

  it('reports a goals value that is not a list and loads nothing from it', () => {
    const { goals, notices } = parseProjectGoals('twelve thousand');
    expect(goals).toEqual([]);
    expect(notices[0]?.path).toBe('goals');
  });
});

describe('unknown comparator or metric (§3: dropped with a load warning)', () => {
  it('drops a goal whose comparator this build does not know', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, comparator: 'roughly' }]);
    expect(goals).toEqual([]);
    expect(notices).toEqual([expect.objectContaining({ path: 'goals[0]' })]);
    expect(notices[0]?.message).toContain('roughly');
  });

  it('drops a goal whose metric this build does not measure (words and chars are the metrics, §9.2)', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, metric: 'pages' }]);
    expect(goals).toEqual([]);
    expect(notices[0]?.message).toContain('pages');
  });

  it('says a dropped goal is not written back, so the writer learns it will be lost on save', () => {
    const { notices } = parseProjectGoals([{ ...VALID, metric: 'pages' }]);
    expect(notices[0]?.message).toBe('project goal dropped on load: unknown metric "pages"; it is not written back');
  });
});

describe('dangling nodeId (§2.2: kept and flagged, never blocking)', () => {
  it('keeps a goal whose folder has gone, and flags it when the tree is given', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, nodeId: 'deleted1' }], BINDER);
    expect(goals.map((g) => g.nodeId)).toEqual(['deleted1']);
    expect(notices).toEqual([expect.objectContaining({ path: 'goals[0].nodeId' })]);
    expect(notices[0]?.message).toContain('kept and flagged');
  });

  it('flags a goal aimed at a document, which is not a goal target', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, nodeId: 's1' }], BINDER);
    expect(goals).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  it('raises no notice for a valid folder target', () => {
    const { notices } = parseProjectGoals([VALID], BINDER);
    expect(notices).toEqual([]);
  });

  it('does not check targets when no tree is given (the caller decides when it has one)', () => {
    const { notices } = parseProjectGoals([{ ...VALID, nodeId: 'deleted1' }]);
    expect(notices).toEqual([]);
  });
});

describe('malformed goals (dropped with a warning, load proceeds)', () => {
  it('drops a target that is not a positive whole number of words', () => {
    for (const target of [0, -500, 12.5, '12000', null]) {
      const { goals, notices } = parseProjectGoals([{ ...VALID, target }]);
      expect(goals, String(target)).toEqual([]);
      expect(notices, String(target)).toHaveLength(1);
    }
  });

  it('drops a deadline that is not a real calendar date', () => {
    expect(parseProjectGoals([{ ...VALID, deadline: '2026-02-30' }]).goals).toEqual([]);
    expect(parseProjectGoals([{ ...VALID, deadline: '31/10/2026' }]).goals).toEqual([]);
  });

  it('drops a goal with no node id, and keeps its neighbours', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, id: 'g_BROKEN001', nodeId: '' }, VALID]);
    expect(goals.map((g) => g.id)).toEqual(['g_ABCDEFGHJK']);
    expect(notices).toHaveLength(1);
  });

  it('drops a non-object entry without throwing', () => {
    const { goals, notices } = parseProjectGoals([42, VALID]);
    expect(goals).toHaveLength(1);
    expect(notices[0]?.path).toBe('goals[0]');
  });

  it('reports an unknown field on a goal with the unknown-field notice and keeps the goal', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, colour: 'red' }]);
    expect(goals).toHaveLength(1);
    expect(notices).toEqual([expect.objectContaining({ path: 'goals[0].colour' })]);
  });

  it('keeps an unknown field in memory, and the notice says it is dropped on the next save', () => {
    const { goals, notices } = parseProjectGoals([{ ...VALID, colour: 'red' }]);
    expect(goals[0]?.unknownFields).toEqual({ colour: 'red' });
    expect(notices[0]?.message).toBe('unknown field "colour" is kept in memory and dropped on next save');
  });

  it('adds no kept field to a goal with no unknown keys', () => {
    expect(parseProjectGoals([VALID]).goals[0]).not.toHaveProperty('unknownFields');
  });
});

describe('notices are plain text and bounded, since a manifest controls every value in them', () => {
  it('cuts a long metric to a short quote in the notice', () => {
    const { notices } = parseProjectGoals([{ ...VALID, metric: 'm'.repeat(5000) }]);
    expect(notices[0]?.message.length).toBeLessThan(200);
    expect(notices[0]?.message).toContain('…');
  });

  it('flattens control and bidi-override characters in a comparator', () => {
    const { notices } = parseProjectGoals([{ ...VALID, comparator: 'roughly\n‮evil\u0007' }]);
    expect(notices[0]?.message).not.toMatch(/\p{Cc}|\p{Cf}/u);
    expect(notices[0]?.message).toContain('roughly');
  });

  it('cuts a long key name in the unknown-field notice', () => {
    const { notices } = parseProjectGoals([{ ...VALID, [`colour${'x'.repeat(300)}`]: 'red' }]);
    expect(notices[0]?.path.length).toBeLessThan(120);
    expect(notices[0]?.message.length).toBeLessThan(160);
  });
});
