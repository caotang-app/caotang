/**
 * `codex.upsert`'s apply for visual references (video-prompt-pack.md §3, A5), through the store's registry.
 *
 * What these pin, and what would fail without them:
 * - a create carries the list, de-duplicated, and an empty list leaves no key on the entry (the manifest omits it too);
 * - an update replaces the list, and undo puts back the list it replaced, or removes the key when the entry had none,
 *   so the entry is byte-for-byte what it was (the same absence rule `updatedAt` follows, command-bus §5).
 */
import { describe, expect, it } from 'vitest';

import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type Command,
  type CommandError,
  type ExecutionOutcome,
  type Result,
  type UndoStore,
} from '@caotang/bus';
import { newId } from '@caotang/ids';

import {
  addDocument,
  createEmptyManifest,
  createProjectCommandRegistry,
  createProjectState,
  type ProjectState,
} from '../src/index.js';

const OPENED = new Date('2026-10-01T09:00:00.000Z');
const clock = { now: () => Date.parse('2026-10-08T10:00:00.000Z') };

const ENTRY = 'c_ENTRY00000';
const PORTRAIT = 'a_7K2QX9M4A1';
const HARBOUR = 'a_8K3QZ2M7RD';
const FERRY = 'a_9M4RX1P6TE';

function fixture(): ProjectState {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', OPENED));
  addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'Elena came in on the tide.', now: OPENED });
  state.manifest.codex = [
    {
      id: ENTRY,
      name: 'Elena',
      aliases: [],
      type: 'character',
      description: 'The keeper.',
      includePolicy: 'detected',
      caseSensitive: false,
      exclude: [],
      attachments: [],
      keywords: [],
      origin: 'manual',
      sources: [],
      createdAt: OPENED.toISOString(),
      updatedAt: OPENED.toISOString(),
    },
  ];
  return state;
}

interface Harness {
  readonly state: ProjectState;
  readonly undo: UndoStore;
  send(params: Record<string, unknown>): Result<ExecutionOutcome, CommandError>;
}

function harness(state: ProjectState = fixture()): Harness {
  const registry = createProjectCommandRegistry({ clock });
  const undo: UndoStore = createUndoStore({
    dispatch: (command) => execute(command, bus, registry),
  });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log: createActivityLog(),
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  return {
    state,
    undo,
    send(params) {
      const command: Command = {
        id: newId('cmd'),
        name: 'codex.upsert',
        params,
        issuedBy: 'user',
        createdAt: clock.now(),
      };
      return execute(command, bus, registry);
    },
  };
}

function expectOk(result: Result<ExecutionOutcome, CommandError>): ExecutionOutcome {
  if (!result.ok) throw new Error(`refused: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function entryOf(state: ProjectState) {
  const entry = (state.manifest.codex ?? []).find((candidate) => candidate.id === ENTRY);
  if (entry === undefined) throw new Error('the fixture entry is missing');
  return entry;
}

describe('codex.upsert visualRefs apply (video-prompt-pack.md §3, A5)', () => {
  it('a create carries its references, with repeats dropped and the order the writer gave', () => {
    const h = harness();
    expectOk(h.send({ entries: [{ action: 'create', name: 'Harbour', visualRefs: [HARBOUR, PORTRAIT, HARBOUR] }] }));
    const created = (h.state.manifest.codex ?? []).find((entry) => entry.name === 'Harbour');
    expect(created?.visualRefs).toEqual([HARBOUR, PORTRAIT]);
  });

  it('a create with no references, or an empty list, leaves no key on the entry', () => {
    const h = harness();
    expectOk(h.send({ entries: [{ action: 'create', name: 'Quay' }, { action: 'create', name: 'Pier', visualRefs: [] }] }));
    for (const name of ['Quay', 'Pier']) {
      const entry = (h.state.manifest.codex ?? []).find((candidate) => candidate.name === name);
      expect(entry !== undefined && 'visualRefs' in entry).toBe(false);
    }
  });

  it('an update replaces the list, and undo puts back the list it replaced', () => {
    const h = harness();
    expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [PORTRAIT] }] }));
    const before = entryOf(h.state);
    expect(before.visualRefs).toEqual([PORTRAIT]);

    const outcome = expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [HARBOUR, FERRY] }] }));
    expect(entryOf(h.state).visualRefs).toEqual([HARBOUR, FERRY]);

    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect(entryOf(h.state).visualRefs).toEqual([PORTRAIT]);
  });

  it('an update that adds the first references is undone to an entry with no key, byte for byte', () => {
    const h = harness();
    const bytesBefore = JSON.stringify(entryOf(h.state));
    expect('visualRefs' in entryOf(h.state)).toBe(false);

    const outcome = expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [PORTRAIT] }] }));
    expect(entryOf(h.state).visualRefs).toEqual([PORTRAIT]);

    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect('visualRefs' in entryOf(h.state)).toBe(false);
    expect(JSON.stringify(entryOf(h.state))).toBe(bytesBefore);
  });

  it('an empty list clears the references, and undo brings them back', () => {
    const h = harness();
    expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [PORTRAIT, HARBOUR] }] }));
    const outcome = expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [] }] }));
    expect(entryOf(h.state).visualRefs).toEqual([]);

    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect(entryOf(h.state).visualRefs).toEqual([PORTRAIT, HARBOUR]);
  });

  it('an update that does not name visualRefs leaves the list as it is', () => {
    const h = harness();
    expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, visualRefs: [PORTRAIT] }] }));
    expectOk(h.send({ entries: [{ action: 'update', id: ENTRY, description: 'The keeper of the light.' }] }));
    expect(entryOf(h.state).visualRefs).toEqual([PORTRAIT]);
  });
});
