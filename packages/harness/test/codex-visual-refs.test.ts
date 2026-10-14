/**
 * `codex.write`'s visual references (video-prompt-pack.md §3, A5), through the harness tool: the schema takes the list, the plan
 * card shows it as the entry will hold it, a reference that is not an asset id is refused with the entry named, and an update's
 * list replaces the one before, which an undo restores.
 */

import { describe, expect, it } from 'vitest';

import { ENTRY, makeHarness, makeState, refusalOf, run, snapshotOf, valueOf } from './fixtures.js';

const CONFIRMED = { confirmed: true } as const;
const PORTRAIT = 'a_7K2QX9M4A1';
const HARBOUR = 'a_8K3QZ2M7RD';

function entryOf(state: ReturnType<typeof makeState>, id: string) {
  const entry = (state.manifest.codex ?? []).find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`no codex entry ${id}`);
  return entry;
}

/** The plan-card diffs of a batch, as a preflight shows them (the card the writer approves). */
function cardOf(entries: unknown[]): { entries: Record<string, unknown>[] } {
  const preview = makeHarness().previewPlan({ steps: [{ tool: 'codex.write', params: { entries }, expect: 'write the entries' }] });
  if (!preview.ok) throw new Error('expected a preflight');
  return preview.value.steps[0]?.preview as { entries: Record<string, unknown>[] };
}

describe('codex.write visual references (video-prompt-pack.md §3, A5)', () => {
  it('a create carries its references onto the new entry', () => {
    const state = makeState();
    const outcome = valueOf(
      run(makeHarness({}, state), 'codex.write', { entries: [{ action: 'create', name: 'Mara', visualRefs: [PORTRAIT, HARBOUR] }] }, { permission: CONFIRMED }),
    );
    const created = outcome.data['created'] as string[];
    expect(entryOf(state, created[0] ?? '').visualRefs).toEqual([PORTRAIT, HARBOUR]);
  });

  it('an update replaces the list, and its undo puts the list it replaced back, down to the bytes', () => {
    const state = makeState();
    const harness = makeHarness({}, state);
    const pristine = snapshotOf(state);
    const first = valueOf(run(harness, 'codex.write', { entries: [{ action: 'update', id: ENTRY, visualRefs: [PORTRAIT] }] }, { permission: CONFIRMED }));
    const second = valueOf(run(harness, 'codex.write', { entries: [{ action: 'update', id: ENTRY, visualRefs: [HARBOUR] }] }, { permission: CONFIRMED }));
    expect(entryOf(state, ENTRY).visualRefs).toEqual([HARBOUR]);

    harness.undo.undo(second.undoGroupId ?? '');
    expect(entryOf(state, ENTRY).visualRefs).toEqual([PORTRAIT]);
    harness.undo.undo(first.undoGroupId ?? '');
    expect('visualRefs' in entryOf(state, ENTRY)).toBe(false);
    expect(snapshotOf(state)).toBe(pristine);
  });

  it('the preview the plan card reads holds the references a create will hold, and the change an update makes to them', () => {
    // The card's words for these diffs are checked in e2e/unit/agent-plan-preview.spec.ts; this pins the preview they are read from.
    const created = cardOf([{ action: 'create', name: 'Mara', visualRefs: [PORTRAIT] }]);
    expect(created.entries[0]).toMatchObject({ action: 'create', name: 'Mara', visualRefs: [PORTRAIT] });

    const updated = cardOf([{ action: 'update', id: ENTRY, visualRefs: [HARBOUR] }]);
    expect(updated.entries[0]).toMatchObject({
      action: 'update',
      changes: [{ field: 'visualRefs', from: 'null', to: JSON.stringify([HARBOUR]) }],
    });
  });

  it('a picture named twice is one reference, so the preview and the saved entry hold the same list', () => {
    const repeated = [{ action: 'create', name: 'Mara', visualRefs: [PORTRAIT, PORTRAIT, HARBOUR] }];
    expect(cardOf(repeated).entries[0]).toMatchObject({ visualRefs: [PORTRAIT, HARBOUR] });
    expect(cardOf([{ action: 'update', id: ENTRY, visualRefs: [HARBOUR, HARBOUR] }]).entries[0]).toMatchObject({
      changes: [{ field: 'visualRefs', from: 'null', to: JSON.stringify([HARBOUR]) }],
    });

    const state = makeState();
    const outcome = valueOf(run(makeHarness({}, state), 'codex.write', { entries: repeated }, { permission: CONFIRMED }));
    expect(entryOf(state, (outcome.data['created'] as string[])[0] ?? '').visualRefs).toEqual([PORTRAIT, HARBOUR]);
  });

  it('refuses a reference that is not an asset id, names the entry, and writes nothing', () => {
    const state = makeState();
    const before = snapshotOf(state);
    const error = refusalOf(
      run(makeHarness({}, state), 'codex.write', { entries: [{ action: 'update', id: ENTRY, visualRefs: ['portrait.png'] }] }, { permission: CONFIRMED }),
    );
    expect(JSON.stringify(error.details)).toContain('visualRefs[0] \\"portrait.png\\" is not an asset id');
    expect(snapshotOf(state)).toBe(before);
  });

  it('refuses an eleventh reference, because the schema names the most an entry carries', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `a_${String(index).padStart(10, '0')}`);
    const error = refusalOf(run(makeHarness(), 'codex.write', { entries: [{ action: 'update', id: ENTRY, visualRefs: eleven }] }, { permission: CONFIRMED }));
    expect(error.message).toContain('visualRefs');
  });
});
