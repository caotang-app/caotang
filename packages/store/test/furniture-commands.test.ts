/**
 * The writing-furniture commands end to end, and the `updatedAt` bump matrix — binder-filters §2.1 item 4,
 * goals-progress §4.
 *
 * Every test dispatches a real command through the shipped `execute()` over the store's own state, with the shipped undo
 * store, so the assertion that matters is what the manifest holds afterwards and whether `undo()` put it back. A refused
 * dispatch is asserted with its error code and with the state unchanged, because a refusal that wrote anything would be the
 * bug the bus's validate-first rule exists to stop.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@caotang/ids';
import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type CommandName,
  type CommandRegistry,
  type ExecutionOutcome,
  type UndoStore,
} from '@caotang/bus';

import {
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectCommandRegistry,
  createProjectState,
  nodeById,
  serializeManifest,
  type ProjectState,
} from '../src/index.js';

const OPENED = new Date('2026-10-02T15:00:00.000Z');
const OPENED_ISO = OPENED.toISOString();
/** The instant every command in this file is stamped with, so an `updatedAt` is an assertion and not a number. */
const LATER_MS = Date.parse('2026-10-08T09:00:00.000Z');
const LATER = new Date(LATER_MS).toISOString();

const CHAPTER = 'n_CHAPTERONE0';
const OTHER_CHAPTER = 'n_CHAPTERTWO0';
const SCENE = 'n_LANDING00000';
const SECOND_SCENE = 'n_STORM000000';
const FILTER = 'q_ABCDEFGHJK';
const GOAL = 'g_ABCDEFGHJK';
/** A second goal id, drawn from the Crockford alphabet the furniture ids use (no I, L, O or U). */
const WEEKLY = 'g_QWERTYASDF';

interface Harness {
  readonly state: ProjectState;
  readonly bus: BusContext<ProjectState>;
  readonly registry: CommandRegistry;
  readonly undo: UndoStore;
}

function makeState(): ProjectState {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', OPENED));
  state.manifest.vocabulary.labels = [{ id: 'act-1', name: 'Act 1', color: '#8a8a8a' }];
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: OPENED, id: CHAPTER });
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 2', now: OPENED, id: OTHER_CHAPTER });
  addDocument(state, {
    parentId: CHAPTER,
    title: 'The Landing',
    body: 'The ferry was late.',
    now: OPENED,
    id: SCENE,
    status: 'draft',
    synopsis: 'Elena returns.',
  });
  addDocument(state, { parentId: CHAPTER, title: 'The Storm', body: 'Wind.', now: OPENED, id: SECOND_SCENE });
  return state;
}

function harness(): Harness {
  const state = makeState();
  // Each dispatch is stamped with LATER_MS, so the stamp is the instant of the command and not of the fixture.
  const registry = createProjectCommandRegistry({ clock: { now: () => LATER_MS } });
  const undo = createUndoStore({ dispatch: (command) => execute(command, bus, registry) });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log: createActivityLog(),
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  return { state, bus, registry, undo };
}

/** A user dispatch, as the desktop makes one: a fresh id, `issuedBy: 'user'`, and the fixed clock. */
function send(h: Harness, name: CommandName, params: Record<string, unknown>) {
  return execute(
    { id: newId('cmd'), name, params, issuedBy: 'user', createdAt: LATER_MS },
    h.bus,
    h.registry,
  );
}

/** A dispatch that must succeed, returned with its undo group. */
function succeed(h: Harness, name: CommandName, params: Record<string, unknown>): ExecutionOutcome {
  const result = send(h, name, params);
  if (!result.ok) throw new Error(`${name} was refused: ${result.error.message}`);
  return result.value;
}

function undoGroup(h: Harness, outcome: ExecutionOutcome): void {
  if (outcome.undoGroupId === undefined) throw new Error('the command registered no undo group');
  const undone = h.undo.undo(outcome.undoGroupId);
  if (!undone.ok) throw new Error(`undo refused: ${undone.error.message}`);
  expect(undone.value.failures).toEqual([]);
}

const CRITERIA = { statusId: 'draft', keywordsAny: ['sea'] };

describe('binder.saveFilter', () => {
  it('creates a saved filter in the manifest with its root and criteria, stamped by the clock', () => {
    const h = harness();
    succeed(h, 'binder.saveFilter', { filter: { id: FILTER, name: 'Drafts about the sea', root: 'manuscript', criteria: CRITERIA } });
    expect(h.state.manifest.filters).toEqual([
      { id: FILTER, name: 'Drafts about the sea', root: 'manuscript', criteria: CRITERIA, createdAt: LATER, updatedAt: LATER },
    ]);
  });

  it('undoes a create by removing the filter again', () => {
    const h = harness();
    const outcome = succeed(h, 'binder.saveFilter', { filter: { id: FILTER, name: 'Drafts', criteria: CRITERIA } });
    undoGroup(h, outcome);
    expect(h.state.manifest.filters).toEqual([]);
  });

  it('updates a filter by id, keeps its createdAt, and undoes to the record it replaced', () => {
    const h = harness();
    succeed(h, 'binder.saveFilter', { filter: { id: FILTER, name: 'Drafts', criteria: CRITERIA } });
    const later = Date.parse('2026-10-09T09:00:00.000Z');
    const updater = createProjectCommandRegistry({ clock: { now: () => later } });
    const outcome = execute(
      { id: newId('cmd'), name: 'binder.saveFilter', params: { filter: { id: FILTER, name: 'Renamed', root: 'research', criteria: {} } }, issuedBy: 'user', createdAt: later },
      { ...h.bus },
      updater,
    );
    expect(outcome.ok).toBe(true);
    const saved = h.state.manifest.filters?.[0];
    expect(saved).toMatchObject({ id: FILTER, name: 'Renamed', root: 'research', criteria: {}, createdAt: LATER, updatedAt: new Date(later).toISOString() });
  });

  it('mints a q_ id when the caller gives none', () => {
    const h = harness();
    const outcome = succeed(h, 'binder.saveFilter', { filter: { name: 'Minted', criteria: {} } });
    const minted = (outcome.result as { filterId: string }).filterId;
    expect(minted).toMatch(/^q_[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(h.state.manifest.filters?.[0]?.id).toBe(minted);
  });

  it('refuses a status the project does not have, and writes nothing', () => {
    const h = harness();
    const result = send(h, 'binder.saveFilter', { filter: { name: 'Bad', criteria: { statusId: 'no-such-status' } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-params');
    expect(h.state.manifest.filters).toBeUndefined();
  });

  it('refuses an unknown criterion key, and a malformed id', () => {
    const h = harness();
    const unknown = send(h, 'binder.saveFilter', { filter: { name: 'X', criteria: { colour: 'red' } } });
    expect(unknown.ok).toBe(false);
    const badId = send(h, 'binder.saveFilter', { filter: { id: 'f_BAD', name: 'X', criteria: {} } });
    expect(badId.ok).toBe(false);
    expect(h.state.manifest.filters).toBeUndefined();
  });

  it('refuses a fifty-first filter with limit-exceeded and leaves the fifty', () => {
    const h = harness();
    const fifty = Array.from({ length: 50 }, (_, index) => ({
      id: `q_${String(index).padStart(10, 'A')}`,
      name: `Filter ${index}`,
      criteria: {},
      createdAt: OPENED_ISO,
      updatedAt: OPENED_ISO,
    }));
    h.state.manifest.filters = fifty;
    const result = send(h, 'binder.saveFilter', { filter: { name: 'One too many', criteria: {} } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('limit-exceeded');
    expect(h.state.manifest.filters).toHaveLength(50);
  });
});

describe('binder.deleteFilter', () => {
  it('removes the filter, and its undo restores the name, root and criteria', () => {
    const h = harness();
    succeed(h, 'binder.saveFilter', { filter: { id: FILTER, name: 'Drafts', root: 'manuscript', criteria: CRITERIA } });
    const outcome = succeed(h, 'binder.deleteFilter', { filterId: FILTER });
    expect(h.state.manifest.filters).toEqual([]);
    undoGroup(h, outcome);
    expect(h.state.manifest.filters?.[0]).toMatchObject({ id: FILTER, name: 'Drafts', root: 'manuscript', criteria: CRITERIA });
  });

  it('refuses an id that is not saved, with not-found, and writes nothing', () => {
    const h = harness();
    succeed(h, 'binder.saveFilter', { filter: { id: FILTER, name: 'Drafts', criteria: {} } });
    const result = send(h, 'binder.deleteFilter', { filterId: 'q_ZZZZZZZZZZ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-found');
    expect(h.state.manifest.filters).toHaveLength(1);
  });
});

describe('project.saveGoal', () => {
  it('sets a goal on the manuscript root in the spec shape, with no name field', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', comparator: 'at-least', target: 12_000, deadline: '2026-10-31' } });
    expect(h.state.manifest.goals).toEqual([
      { id: GOAL, nodeId: 'manuscript', metric: 'words', comparator: 'at-least', target: 12_000, deadline: '2026-10-31', createdAt: LATER, updatedAt: LATER },
    ]);
    expect(serializeManifest(h.state.manifest)).not.toContain('undefined');
  });

  it('attaches to a folder, and refuses a scene, a missing node, a zero target and a date that is not real', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { nodeId: CHAPTER, comparator: 'about', target: 2_000 } });
    const scene = send(h, 'project.saveGoal', { goal: { nodeId: SCENE, comparator: 'at-least', target: 500 } });
    const missing = send(h, 'project.saveGoal', { goal: { nodeId: 'n_NOSUCHNODE', comparator: 'at-least', target: 500 } });
    const zero = send(h, 'project.saveGoal', { goal: { nodeId: CHAPTER, comparator: 'at-least', target: 0 } });
    const impossible = send(h, 'project.saveGoal', { goal: { nodeId: CHAPTER, comparator: 'at-least', target: 500, deadline: '2026-02-30' } });
    for (const result of [scene, missing, zero, impossible]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid-params');
    }
    expect(h.state.manifest.goals).toHaveLength(1);
  });

  it('updates a goal by id, keeps its createdAt, and its undo restores the target', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', comparator: 'at-least', target: 12_000 } });
    const outcome = succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', comparator: 'at-most', target: 2_000 } });
    expect(h.state.manifest.goals?.[0]).toMatchObject({ comparator: 'at-most', target: 2_000 });
    undoGroup(h, outcome);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ comparator: 'at-least', target: 12_000 });
  });

  it('refuses a twenty-first goal with limit-exceeded', () => {
    const h = harness();
    h.state.manifest.goals = Array.from({ length: 20 }, (_, index) => ({
      id: `g_${String(index).padStart(10, 'B')}`,
      nodeId: 'manuscript',
      metric: 'words' as const,
      comparator: 'at-least' as const,
      target: 100,
      createdAt: OPENED_ISO,
      updatedAt: OPENED_ISO,
    }));
    const result = send(h, 'project.saveGoal', { goal: { nodeId: 'manuscript', comparator: 'at-least', target: 100 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('limit-exceeded');
    expect(h.state.manifest.goals).toHaveLength(20);
  });

  // goals-progress §9.2 and §9.3: the metric and the kind are carried into the manifest, and the undo of each change puts back the
  // values it replaced, kind and metric included.
  it('saves a characters goal and a weekly goal with their metric and kind, and each undo puts back what it replaced', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', metric: 'chars', comparator: 'at-least', target: 90_000 } });
    expect(h.state.manifest.goals).toEqual([
      { id: GOAL, nodeId: 'manuscript', metric: 'chars', comparator: 'at-least', target: 90_000, createdAt: LATER, updatedAt: LATER },
    ]);
    const weekly = succeed(h, 'project.saveGoal', { goal: { id: WEEKLY, nodeId: 'manuscript', kind: 'weekly', comparator: 'at-least', target: 7_000 } });
    expect(h.state.manifest.goals?.[1]).toEqual({
      id: WEEKLY,
      nodeId: 'manuscript',
      metric: 'words',
      kind: 'weekly',
      comparator: 'at-least',
      target: 7_000,
      createdAt: LATER,
      updatedAt: LATER,
    });
    // The manifest writes the kind and the metric, so a save and a reload keep both (manifest-json's goal shape).
    const text = serializeManifest(h.state.manifest);
    expect(text).toContain('"kind": "weekly"');
    expect(text).toContain('"metric": "chars"');
    undoGroup(h, weekly);
    expect(h.state.manifest.goals?.map((goal) => goal.id)).toEqual([GOAL]);
    // An update that changes the metric is undone to the metric it replaced.
    const toWords = succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', comparator: 'at-least', target: 90_000 } });
    expect(h.state.manifest.goals?.[0]).toMatchObject({ metric: 'words' });
    undoGroup(h, toWords);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ metric: 'chars', target: 90_000 });
  });

  it('an update to a weekly goal keeps its kind through its undo, and a deleted one comes back as it was', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: WEEKLY, nodeId: 'manuscript', kind: 'weekly', comparator: 'at-least', target: 7_000 } });
    const update = succeed(h, 'project.saveGoal', { goal: { id: WEEKLY, nodeId: 'manuscript', kind: 'weekly', comparator: 'at-least', target: 9_000 } });
    expect(h.state.manifest.goals?.[0]).toMatchObject({ kind: 'weekly', target: 9_000 });
    undoGroup(h, update);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ kind: 'weekly', target: 7_000, metric: 'words' });
    const removed = succeed(h, 'project.deleteGoal', { goalId: WEEKLY });
    expect(h.state.manifest.goals).toEqual([]);
    undoGroup(h, removed);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ id: WEEKLY, kind: 'weekly', metric: 'words', comparator: 'at-least', target: 7_000 });
  });

  // goals-progress §9.3: a reset day is carried into the manifest, and an undo puts back the one it replaced.
  it('saves a reset day with a weekly goal, writes it, and an undo of a change puts back the reset day it replaced', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: WEEKLY, nodeId: 'manuscript', kind: 'weekly', resetDay: 0, comparator: 'at-least', target: 7_000 } });
    expect(h.state.manifest.goals?.[0]).toMatchObject({ kind: 'weekly', resetDay: 0 });
    expect(serializeManifest(h.state.manifest)).toContain('"resetDay": 0');
    const toDefault = succeed(h, 'project.saveGoal', { goal: { id: WEEKLY, nodeId: 'manuscript', kind: 'weekly', comparator: 'at-least', target: 7_000 } });
    expect(h.state.manifest.goals?.[0]).not.toHaveProperty('resetDay');
    undoGroup(h, toDefault);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ resetDay: 0 });
    succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', kind: 'monthly', resetDay: 'last', comparator: 'at-least', target: 30_000 } });
    expect(serializeManifest(h.state.manifest)).toContain('"resetDay": "last"');
  });
});

describe('project.deleteGoal', () => {
  it('removes the goal, and its undo restores it', () => {
    const h = harness();
    succeed(h, 'project.saveGoal', { goal: { id: GOAL, nodeId: 'manuscript', comparator: 'at-least', target: 12_000, archived: true } });
    const outcome = succeed(h, 'project.deleteGoal', { goalId: GOAL });
    expect(h.state.manifest.goals).toEqual([]);
    undoGroup(h, outcome);
    expect(h.state.manifest.goals?.[0]).toMatchObject({ id: GOAL, target: 12_000, archived: true });
  });

  it('refuses an unknown goal id with not-found', () => {
    const h = harness();
    const result = send(h, 'project.deleteGoal', { goalId: 'g_ZZZZZZZZZZ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-found');
  });
});

/**
 * binder-filters §2.1 item 1: `updatedAt` bumps on a content change to a node (rename, its synopsis, its metadata, its
 * notes and its document's body) and not on a structure op. The matrix is the spec's list, one row each.
 */
describe('the updatedAt bump matrix', () => {
  const cases: { name: CommandName; params: Record<string, unknown>; node: string; bumps: boolean; label: string }[] = [
    { name: 'binder.rename', params: { nodeId: SCENE, title: 'The Harbour' }, node: SCENE, bumps: true, label: 'binder.rename' },
    { name: 'binder.setSynopsis', params: { nodeId: SCENE, synopsis: 'A new synopsis.' }, node: SCENE, bumps: true, label: 'binder.setSynopsis' },
    { name: 'binder.setMeta', params: { nodeId: SCENE, patch: { label: 'act-1' } }, node: SCENE, bumps: true, label: 'binder.setMeta' },
    { name: 'notes.set', params: { nodeId: SCENE, notes: 'Remember the lamp.' }, node: SCENE, bumps: true, label: 'notes.set' },
    { name: 'notes.append', params: { nodeId: SCENE, text: 'A second thought.' }, node: SCENE, bumps: true, label: 'notes.append' },
    { name: 'doc.write', params: { docId: SCENE, body: 'The ferry came at noon.' }, node: SCENE, bumps: true, label: 'doc.write' },
    { name: 'editor.insert', params: { docId: SCENE, offset: 0, text: 'Dawn. ' }, node: SCENE, bumps: true, label: 'editor.insert' },
    {
      name: 'binder.move',
      params: { nodeId: SECOND_SCENE, newParentId: OTHER_CHAPTER, index: 0 },
      node: SECOND_SCENE,
      bumps: false,
      label: 'binder.move (a structure op)',
    },
  ];

  for (const row of cases) {
    it(`${row.label} ${row.bumps ? 'stamps' : 'leaves alone'} the node's updatedAt`, () => {
      const h = harness();
      const before = nodeById(h.state, row.node)?.updatedAt;
      expect(before).toBe(OPENED_ISO);
      succeed(h, row.name, row.params);
      expect(nodeById(h.state, row.node)?.updatedAt).toBe(row.bumps ? LATER : OPENED_ISO);
    });
  }

  it('undoing a notes write restores the stamp it replaced, because the write is compensable', () => {
    const h = harness();
    const outcome = succeed(h, 'notes.set', { nodeId: SCENE, notes: 'Remember the lamp.' });
    expect(nodeById(h.state, SCENE)?.updatedAt).toBe(LATER);
    undoGroup(h, outcome);
    expect(nodeById(h.state, SCENE)?.updatedAt).toBe(OPENED_ISO);
  });
});
