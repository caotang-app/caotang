/**
 * Save-time checks — binder-filters §2, §5 and goals-progress §2.2, §4, §6: vocabulary
 * ids validated at save, limits clamped (filters) or refused (goals), and the rules a
 * draft must meet before the command may write it.
 */
import { describe, expect, it } from 'vitest';

import { BINDER, NOW, VOCABULARY } from './fixtures/binder.js';
import {
  parseSavedFilters,
  prepareProjectGoal,
  prepareSavedFilter,
  type ProjectGoal,
  type SavedFilter,
  type SavedFilterSaveContext,
  type ProjectGoalSaveContext,
} from '../src/index.js';

const ID_A = 'q_ABCDEFGHJK';
const GOAL_A = 'g_ABCDEFGHJK';

function filterContext(overrides: Partial<SavedFilterSaveContext> = {}): SavedFilterSaveContext {
  return {
    vocabulary: VOCABULARY,
    existing: [],
    now: NOW,
    newId: () => ID_A,
    ...overrides,
  };
}

function existingFilter(id: string, createdAt: string): SavedFilter {
  return { id, name: 'Old', criteria: { text: 'old' }, createdAt, updatedAt: createdAt };
}

function goalContext(overrides: Partial<ProjectGoalSaveContext> = {}): ProjectGoalSaveContext {
  return { tree: BINDER, existing: [], now: NOW, newId: () => GOAL_A, ...overrides };
}

function errorsOf(outcome: ReturnType<typeof prepareSavedFilter>): readonly string[] {
  if (outcome.ok) throw new Error('expected a refusal, got a value');
  return outcome.errors;
}

describe('saving a filter (binder-filters §5: binder.saveFilter)', () => {
  it('creates a filter with a minted id and stamps both times at now', () => {
    const outcome = prepareSavedFilter({ name: 'Drafts', criteria: { statusId: 'draft' } }, filterContext());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({
      id: ID_A,
      name: 'Drafts',
      criteria: { statusId: 'draft' },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('refuses a new filter when no id is given and no generator is wired', () => {
    const errors = errorsOf(prepareSavedFilter({ name: 'Drafts', criteria: {} }, filterContext({ newId: undefined })));
    expect(errors.join(' ')).toMatch(/needs an id/);
  });

  it('refuses a chosen id that is not a saved-filter id', () => {
    const errors = errorsOf(prepareSavedFilter({ id: 'n_ABCDEFGHJK', name: 'x', criteria: {} }, filterContext()));
    expect(errors.join(' ')).toMatch(/not a saved-filter id/);
  });

  it('updates an existing filter by id, keeping its original creation time', () => {
    const existing = existingFilter(ID_A, '2026-09-01T00:00:00.000Z');
    const outcome = prepareSavedFilter(
      { id: ID_A, name: 'Renamed', criteria: { text: 'new' } },
      filterContext({ existing: [existing] }),
    );
    expect(outcome.ok && outcome.value.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(outcome.ok && outcome.value.updatedAt).toBe(NOW.toISOString());
  });

  it('refuses a name that is empty or only spaces, and trims a good one', () => {
    expect(errorsOf(prepareSavedFilter({ name: '   ', criteria: {} }, filterContext())).join(' ')).toMatch(/needs a name/);
    const outcome = prepareSavedFilter({ name: '  Drafts  ', criteria: {} }, filterContext());
    expect(outcome.ok && outcome.value.name).toBe('Drafts');
  });

  it('clamps a name over 60 characters and reports the clamp', () => {
    const outcome = prepareSavedFilter({ name: 'n'.repeat(75), criteria: {} }, filterContext());
    expect(outcome.ok && outcome.value.name.length).toBe(60);
    expect(outcome.ok && outcome.clamped).toEqual(['name clamped to 60 characters']);
  });

  it('refuses an unknown root value, and keeps an absent root as both roots', () => {
    expect(errorsOf(prepareSavedFilter({ name: 'x', root: 'appendix', criteria: {} }, filterContext())).join(' ')).toMatch(
      /root must be/,
    );
    const outcome = prepareSavedFilter({ name: 'x', criteria: {} }, filterContext());
    expect(outcome.ok && outcome.value).not.toHaveProperty('root');
  });

  it('refuses a status or label id the project does not have (binder.setMeta rule)', () => {
    expect(errorsOf(prepareSavedFilter({ name: 'x', criteria: { statusId: 'retired' } }, filterContext())).join(' ')).toMatch(
      /"retired" is not a status/,
    );
    expect(errorsOf(prepareSavedFilter({ name: 'x', criteria: { labelId: 'act-9' } }, filterContext())).join(' ')).toMatch(
      /"act-9" is not a label/,
    );
  });

  it('refuses a criterion the build does not know, and a malformed value', () => {
    expect(errorsOf(prepareSavedFilter({ name: 'x', criteria: { colour: 'red' } }, filterContext())).join(' ')).toMatch(
      /unknown criterion "colour"/,
    );
    expect(errorsOf(prepareSavedFilter({ name: 'x', criteria: { minWords: 'lots' } }, filterContext())).join(' ')).toMatch(
      /minWords must be/,
    );
  });

  it('clamps text over 200 characters and reports it', () => {
    const outcome = prepareSavedFilter({ name: 'x', criteria: { text: 't'.repeat(250) } }, filterContext());
    expect(outcome.ok && outcome.value.criteria.text?.length).toBe(200);
    expect(outcome.ok && outcome.clamped).toEqual(['text clamped to 200 characters']);
  });

  it('clamps a criteria array over 32 entries and reports it', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const outcome = prepareSavedFilter({ name: 'x', criteria: { keywordsAny: tags } }, filterContext());
    expect(outcome.ok && outcome.value.criteria.keywordsAny).toHaveLength(32);
    expect(outcome.ok && outcome.clamped).toEqual(['keywordsAny clamped to 32 entries']);
  });

  it('refuses a fifty-first filter, and still lets an existing one be updated at the limit', () => {
    const full: SavedFilter[] = Array.from({ length: 50 }, (_, i) =>
      existingFilter(`q_${String(i).padStart(10, 'A')}`, '2026-09-01T00:00:00.000Z'),
    );
    expect(errorsOf(prepareSavedFilter({ name: 'x', criteria: {} }, filterContext({ existing: full }))).join(' ')).toMatch(
      /at most 50 saved filters/,
    );
    const update = prepareSavedFilter(
      { id: full[0]!.id, name: 'x', criteria: {} },
      filterContext({ existing: full }),
    );
    expect(update.ok).toBe(true);
  });

  it('round-trips through the load path: what save writes, load reads back the same', () => {
    const saved = prepareSavedFilter(
      { name: 'Long sea chapters', root: 'manuscript', criteria: { keywordsAll: ['sea'], minWords: 2000, modifiedWithinDays: 14 } },
      filterContext(),
    );
    if (!saved.ok) throw new Error('save refused');
    const loaded = parseSavedFilters([saved.value]);
    expect(loaded.notices).toEqual([]);
    expect(loaded.filters).toEqual([saved.value]);
  });

  it('drops the unknown fields and criteria a load kept in memory, since a save writes a new filter', () => {
    const { filters } = parseSavedFilters([
      {
        id: ID_A,
        name: 'Drafts',
        criteria: { statusId: 'draft', colourBand: 'warm' },
        createdAt: '2026-09-13T10:00:00.000Z',
        updatedAt: '2026-09-13T10:00:00.000Z',
        colour: 'red',
      },
    ]);
    const loaded = filters[0]!;
    expect(loaded.unknownFields).toEqual({ colour: 'red' });
    expect(loaded.unknownCriteria).toEqual({ colourBand: 'warm' });

    const outcome = prepareSavedFilter(
      { id: loaded.id, name: loaded.name, criteria: loaded.criteria },
      filterContext({ existing: filters }),
    );
    if (!outcome.ok) throw new Error('save refused');
    expect(outcome.value).not.toHaveProperty('unknownFields');
    expect(outcome.value).not.toHaveProperty('unknownCriteria');
    expect(outcome.value.criteria).toEqual({ statusId: 'draft' });
  });

  it('trims each tag on save and drops the blank ones, so a blank tag is no constraint', () => {
    const outcome = prepareSavedFilter({ name: 'x', criteria: { keywordsAll: ['  ', ' sea '] } }, filterContext());
    expect(outcome.ok && outcome.value.criteria).toEqual({ keywordsAll: ['sea'] });
    const blank = prepareSavedFilter({ name: 'x', criteria: { keywordsAny: [''] } }, filterContext());
    expect(blank.ok && blank.value.criteria).toEqual({});
  });
});

describe('saving a project goal (goals-progress §2.2, §4: project.saveGoal)', () => {
  it('creates a goal on a folder, with the metric and the comparator checked', () => {
    const outcome = prepareProjectGoal(
      { nodeId: 'act1', comparator: 'at-least', target: 12000, deadline: '2026-10-31' },
      goalContext(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({
      id: GOAL_A,
      nodeId: 'act1',
      metric: 'words',
      comparator: 'at-least',
      target: 12000,
      deadline: '2026-10-31',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it('accepts the manuscript root and the research folder as targets', () => {
    expect(prepareProjectGoal({ nodeId: 'manuscript', comparator: 'at-least', target: 1 }, goalContext()).ok).toBe(true);
    expect(prepareProjectGoal({ nodeId: 'research', comparator: 'at-least', target: 1 }, goalContext()).ok).toBe(true);
  });

  it('refuses a target of zero or below, and one that is not a whole number of words', () => {
    for (const target of [0, -1, 2.5, Number.NaN]) {
      const outcome = prepareProjectGoal({ nodeId: 'act1', comparator: 'at-least', target }, goalContext());
      expect(outcome.ok, String(target)).toBe(false);
      if (!outcome.ok) expect(outcome.errors.join(' ')).toMatch(/positive whole number/);
    }
  });

  it('refuses a node that is a document, the project root, or missing', () => {
    for (const nodeId of ['s1', 'root', 'gone']) {
      const outcome = prepareProjectGoal({ nodeId, comparator: 'at-least', target: 100 }, goalContext());
      expect(outcome.ok, nodeId).toBe(false);
      if (!outcome.ok) expect(outcome.errors.join(' ')).toMatch(/manuscript root or a folder/);
    }
  });

  it('refuses an unknown comparator, an unknown metric and a deadline that is not a date', () => {
    const base = { nodeId: 'act1', comparator: 'at-least', target: 100 };
    expect(prepareProjectGoal({ ...base, comparator: 'roughly' }, goalContext()).ok).toBe(false);
    expect(prepareProjectGoal({ ...base, metric: 'pages' }, goalContext()).ok).toBe(false);
    expect(prepareProjectGoal({ ...base, deadline: '2026-02-30' }, goalContext()).ok).toBe(false);
  });

  it('refuses a twenty-first goal, but updates an existing goal at the limit', () => {
    const full: ProjectGoal[] = Array.from({ length: 20 }, (_, i) => ({
      id: `g_${String(i).padStart(10, 'A')}`,
      nodeId: 'act1',
      metric: 'words',
      comparator: 'at-least',
      target: 100,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }));
    const refused = prepareProjectGoal({ nodeId: 'act1', comparator: 'at-least', target: 100 }, goalContext({ existing: full }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.join(' ')).toMatch(/at most 20 goals/);

    const update = prepareProjectGoal(
      { id: full[0]!.id, nodeId: 'act1', comparator: 'at-least', target: 999 },
      goalContext({ existing: full }),
    );
    expect(update.ok).toBe(true);
  });

  it('refuses a goal id that is not a goal id', () => {
    const outcome = prepareProjectGoal(
      { id: 'q_ABCDEFGHJK', nodeId: 'act1', comparator: 'at-least', target: 100 },
      goalContext(),
    );
    expect(outcome.ok).toBe(false);
  });

  it('keeps a goal’s creation time on update', () => {
    const existing: ProjectGoal[] = [
      {
        id: GOAL_A,
        nodeId: 'act1',
        metric: 'words',
        comparator: 'at-least',
        target: 100,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    const outcome = prepareProjectGoal(
      { id: GOAL_A, nodeId: 'act1', comparator: 'at-least', target: 500 },
      goalContext({ existing }),
    );
    expect(outcome.ok && outcome.value.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });
});
