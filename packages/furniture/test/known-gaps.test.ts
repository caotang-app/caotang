/**
 * The manifest round trip for the furniture lists, as the store writes them.
 *
 * These two tests were `it.fails` while the store's manifest serializer wrote a goal with `"name": undefined` and dropped
 * a saved filter's scope root. The furniture workstream fixed both in packages/store, so they are plain tests now: a
 * regression in the serializer fails them. The updatedAt bump matrix, which was a `todo` here, is tested in
 * packages/store/test/furniture-commands.test.ts with the commands that make the bumps.
 */
import { createEmptyManifest, serializeManifest } from '@caotang/store';
import { describe, expect, it } from 'vitest';

/** A spec-shaped goal (goals-progress §2.2), as this package reads and writes it. */
const GOAL = {
  id: 'g_ABCDEFGHJK',
  nodeId: 'manuscript',
  metric: 'words',
  comparator: 'at-least',
  target: 12_000,
  deadline: '2026-10-31',
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

/** A spec-shaped saved filter (binder-filters §2), with a scope root. */
const FILTER = {
  id: 'q_ABCDEFGHJK',
  name: 'Drafts about the sea',
  root: 'manuscript',
  criteria: { statusId: 'draft', keywordsAny: ['sea'] },
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

/** The store's serializer over an otherwise valid manifest, with this package's shapes under `goals` and `filters`. */
function serializeWith(extra: { goals?: unknown[]; filters?: unknown[] }): string {
  return serializeManifest({ ...createEmptyManifest('Known gaps', new Date(0)), ...extra } as never);
}

describe('the furniture lists round-trip through the manifest', () => {
  it('control: the store serializes an empty manifest, so the cases below are about the goal and filter shapes', () => {
    expect(() => JSON.parse(serializeWith({}))).not.toThrow();
  });

  it('a spec-shaped goal round-trips through the store, with no undefined field', () => {
    const text = serializeWith({ goals: [GOAL] });
    expect(text).not.toContain('undefined');
    const reparsed = JSON.parse(text);
    expect(reparsed.goals[0]).toMatchObject({
      nodeId: 'manuscript',
      comparator: 'at-least',
      target: 12_000,
      deadline: '2026-10-31',
    });
    expect(reparsed.goals[0]).not.toHaveProperty('name');
  });

  it('a chars goal and a weekly goal round-trip with their metric and kind, and a project goal writes no kind key', () => {
    const { deadline: _deadline, ...weeklyBase } = GOAL;
    const text = serializeWith({
      goals: [
        { ...GOAL, metric: 'chars', target: 90_000 },
        { ...weeklyBase, id: 'g_QWERTYASDF', kind: 'weekly', target: 7_000 },
      ],
    });
    expect(text).not.toContain('undefined');
    const reparsed = JSON.parse(text);
    expect(reparsed.goals[0]).toMatchObject({ metric: 'chars', target: 90_000 });
    expect(reparsed.goals[0]).not.toHaveProperty('kind');
    expect(reparsed.goals[1]).toMatchObject({ kind: 'weekly', metric: 'words', target: 7_000 });
    expect(reparsed.goals[1]).not.toHaveProperty('deadline');
  });

  it('a saved filter keeps its scope root', () => {
    const reparsed = JSON.parse(serializeWith({ filters: [FILTER] }));
    expect(reparsed.filters[0]).toMatchObject({ root: 'manuscript' });
  });

  it('an unscoped filter and an open-ended goal carry no empty root or deadline key', () => {
    const { root: _root, ...unscoped } = FILTER;
    const { deadline: _deadline, ...openEnded } = GOAL;
    const reparsed = JSON.parse(serializeWith({ filters: [unscoped], goals: [openEnded] }));
    expect(reparsed.filters[0]).not.toHaveProperty('root');
    expect(reparsed.goals[0]).not.toHaveProperty('deadline');
  });
});

describe('the furniture lists are absent from a manifest that never had them', () => {
  it('writes no filters or goals key when the arrays are absent', () => {
    const reparsed = JSON.parse(serializeWith({}));
    expect(reparsed).not.toHaveProperty('filters');
    expect(reparsed).not.toHaveProperty('goals');
  });
});
