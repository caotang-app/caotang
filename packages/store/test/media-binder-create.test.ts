/**
 * `binder.create` for the media types, through the bus and the store's registry (storyboard.md §2.1,
 * dialogue-narrative.md §2.1, screenplay.md §2.1). The validator refuses what the spec forbids, and the apply makes what
 * it allows, with the body record its kind needs; undo removes it again.
 */

import { describe, expect, it } from 'vitest';

import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type ExecutionOutcome,
} from '@caotang/bus';

import { createProjectCommandRegistry } from '../src/commands.js';
import { addDocument, addNode, createEmptyManifest, createProjectState, type ProjectState } from '../src/index.js';

const T0 = new Date('2026-10-08T09:00:00.000Z');
const clock = { now: () => T0.getTime() };
const MANUSCRIPT = 'manuscript';
const BOARD = 'n_7K2QX9M4A1';
const CHAPTER = 'n_5C8HQ2WT4R';

/**
 * A project with a manuscript, a chapter, a storyboard folder, and one prose document. The prose document sits directly under the
 * manuscript, as an older project's can: it still loads.
 */
function project(): ProjectState {
  const state = createProjectState(createEmptyManifest('Keeper', T0));
  addNode(state, { parentId: MANUSCRIPT, title: 'Chapter 1', now: T0, id: CHAPTER });
  addDocument(state, { parentId: MANUSCRIPT, title: 'The Landing', body: 'Prose.', now: T0, id: 'n_3W8RN2TQ6C' });
  addNode(state, { parentId: MANUSCRIPT, title: 'Board', kind: 'storyboard', now: T0, id: BOARD });
  return state;
}

/** Dispatches one command through the bus into the store's registry, as the app does. */
function dispatcher(state: ProjectState) {
  const registry = createProjectCommandRegistry({ clock });
  const notified: ExecutionOutcome[] = [];
  const undo = createUndoStore({ dispatch: (command) => execute(command, bus, registry) });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log: createActivityLog(),
    idempotency: createIdempotencyCache(),
    notify: (outcome) => notified.push(outcome),
  };
  let ordinal = 0;
  return {
    run: (name: 'binder.create', params: Record<string, unknown>) => {
      ordinal += 1;
      // The same command shape the store's own tests dispatch: an id, the user as issuer, and the clock's tick.
      return execute({ id: `cmd_MEDIA${String(ordinal).padStart(6, '0')}`, issuedBy: 'user', createdAt: T0.getTime() - 1_000, name, params } as never, bus, registry);
    },
    undo,
  };
}

describe('binder.create of a media node, through the bus', () => {
  it('makes a dialogue container with the branching kind, a body record, and no file yet', () => {
    const state = project();
    const run = dispatcher(state).run;
    const outcome = run('binder.create', { parentId: CHAPTER, type: 'dialogue', title: 'Duel' });
    expect(outcome.ok).toBe(true);
    const node = state.manifest.tree.find((n) => n.title === 'Duel');
    expect(node).toMatchObject({ type: 'dialogue', kind: 'branching', parentId: CHAPTER });
    expect(state.documents.get(node!.id)?.body).toBe('');
  });

  it('makes a screenplay scene with the screenplay kind and a body record', () => {
    const state = project();
    const outcome = dispatcher(state).run('binder.create', { parentId: CHAPTER, type: 'document', kind: 'screenplay', title: 'Scene' });
    expect(outcome.ok).toBe(true);
    const node = state.manifest.tree.find((n) => n.title === 'Scene');
    expect(node).toMatchObject({ type: 'document', kind: 'screenplay' });
    expect(state.documents.has(node!.id)).toBe(true);
  });

  it('makes a shot in a storyboard folder with no body record, and refuses one anywhere else', () => {
    const state = project();
    const run = dispatcher(state).run;
    expect(run('binder.create', { parentId: BOARD, type: 'shot', title: 'Shot 1' }).ok).toBe(true);
    const shot = state.manifest.tree.find((n) => n.title === 'Shot 1');
    expect(shot?.type).toBe('shot');
    expect(state.documents.has(shot!.id)).toBe(false);

    const refused = run('binder.create', { parentId: MANUSCRIPT, type: 'shot', title: 'Lost' });
    expect(refused.ok).toBe(false);
    expect(state.manifest.tree.some((n) => n.title === 'Lost')).toBe(false);
  });

  it('refuses the project root as the parent, and nothing is created', () => {
    const state = project();
    const before = state.manifest.tree.length;
    const outcome = dispatcher(state).run('binder.create', { parentId: 'root', type: 'document', title: 'Lost' });
    expect(outcome.ok).toBe(false);
    expect(state.manifest.tree.length).toBe(before);
  });

  // The chapter rule: a new document or dialogue directly under the manuscript is refused,
  // in the binder's words, and a chapter or a storyboard there is not.
  it('refuses a new document or dialogue directly under the manuscript, in the binder’s words, and creates nothing', () => {
    const state = project();
    const run = dispatcher(state).run;
    const before = state.manifest.tree.length;
    for (const params of [
      { parentId: MANUSCRIPT, type: 'document', title: 'Loose' },
      { parentId: MANUSCRIPT, type: 'document', kind: 'screenplay', title: 'Loose scene' },
      { parentId: MANUSCRIPT, type: 'dialogue', title: 'Loose dialogue' },
    ]) {
      const refused = run('binder.create', params);
      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error.code).toBe('invalid-params');
      expect(refused.error.message).toMatch(/goes inside a chapter, not directly under the manuscript\.$/);
    }
    expect(state.manifest.tree.length).toBe(before);
    expect(run('binder.create', { parentId: MANUSCRIPT, type: 'document', title: 'Loose' })).toMatchObject({
      ok: false,
      error: { message: 'A document goes inside a chapter, not directly under the manuscript.', target: 'parentId' },
    });
    // A chapter and a storyboard still go there, and research still takes its documents directly.
    expect(run('binder.create', { parentId: MANUSCRIPT, type: 'folder', title: 'Chapter 2' }).ok).toBe(true);
    expect(run('binder.create', { parentId: MANUSCRIPT, type: 'folder', kind: 'storyboard', title: 'Board 2' }).ok).toBe(true);
    expect(run('binder.create', { parentId: 'research', type: 'document', title: 'A note' }).ok).toBe(true);
  });

  it('keeps an existing chapterless document: it moves into a chapter, and the undo of that move puts it back', () => {
    const state = project();
    const dispatch = dispatcher(state);
    const moved = execute(
      { id: 'cmd_MOVE000001', issuedBy: 'user', createdAt: T0.getTime() - 1_000, name: 'binder.move', params: { nodeId: 'n_3W8RN2TQ6C', newParentId: CHAPTER, index: 0 } } as never,
      { state, view: createViewState(), read: () => state, undo: dispatch.undo, log: createActivityLog(), idempotency: createIdempotencyCache(), notify: () => {} },
      createProjectCommandRegistry({ clock }),
    );
    if (!moved.ok) throw new Error(moved.error.message);
    expect(state.manifest.tree.find((n) => n.id === 'n_3W8RN2TQ6C')?.parentId).toBe(CHAPTER);
    expect(dispatch.undo.undo(moved.value.undoGroupId!).ok).toBe(true);
    expect(state.manifest.tree.find((n) => n.id === 'n_3W8RN2TQ6C')?.parentId).toBe(MANUSCRIPT);
  });

  it('undoes a media create by removing the node and its body record', () => {
    const state = project();
    const dispatch = dispatcher(state);
    const outcome = dispatch.run('binder.create', { parentId: CHAPTER, type: 'dialogue', title: 'Duel' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    const id = state.manifest.tree.find((n) => n.title === 'Duel')!.id;
    const undone = dispatch.undo.undo(outcome.value.undoGroupId!);
    expect(undone.ok).toBe(true);
    expect(state.manifest.tree.some((n) => n.id === id)).toBe(false);
    expect(state.documents.has(id)).toBe(false);
  });
});
