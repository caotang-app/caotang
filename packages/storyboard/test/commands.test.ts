/**
 * The storyboard commands' apply — `commands.ts`. Each apply runs its guard before its one write, so a refused
 * command leaves the project as it was, and a list applies all or nothing (command-bus §3: zero partial
 * effects). The bus calls these from its apply step; the planners never do.
 */

import { getRevision, moveNode, removeNode, setBody, type ProjectState, type TreeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  addShotNode,
  applyStoryboardCommand,
  applyStoryboardCommands,
  shotFieldOf,
  shotsIn,
  type ShotCommand,
} from '../src/index.js';

import { NOW, buildFixture, treeSnapshot } from './fixtures.js';

function nodeOf(state: ProjectState, id: string): TreeNode {
  const node = state.manifest.tree.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`fixture has no node "${id}"`);
  return node;
}

function storedOf(state: ProjectState, id: string): unknown {
  return shotFieldOf(nodeOf(state, id));
}

/** A `storyboard.create` for the scene as it stands, under the scene's own parent. */
function createFolder(state: ProjectState, id = 'n_NEWBOARD1'): ShotCommand {
  return {
    name: 'storyboard.create',
    params: { id, parentId: 'act1', title: 'Harbour — Shots', scene: { id: 'scene1', parentId: 'act1', revision: getRevision(state, 'scene1') } },
  };
}

describe('storyboard.create: the folder lands where the plan showed, and only while the scene is as planned', () => {
  it('creates a storyboard folder under the given id, beside the scene', () => {
    const { state } = buildFixture();
    expect(applyStoryboardCommand(state, createFolder(state), { now: NOW }).ok).toBe(true);
    expect(nodeOf(state, 'n_NEWBOARD1')).toMatchObject({ type: 'folder', kind: 'storyboard', parentId: 'act1', title: 'Harbour — Shots' });
  });

  it('refuses when the scene has been moved, since a move leaves the revision alone', () => {
    const { state } = buildFixture();
    const command = createFolder(state);
    moveNode(state, 'scene1', { parentId: 'manuscript' });
    const before = treeSnapshot(state);
    expect(applyStoryboardCommand(state, command)).toMatchObject({ ok: false, refusal: { code: 'scene-moved', askBack: 'conflict' } });
    expect(treeSnapshot(state)).toBe(before);
  });

  it('refuses when the scene’s text has changed, since its quoted anchors would then be stale', () => {
    const { state } = buildFixture();
    const command = createFolder(state);
    setBody(state, 'scene1', 'EXT. HARBOUR.\n\nA new line.');
    expect(applyStoryboardCommand(state, command)).toMatchObject({ ok: false, refusal: { code: 'revision-drift', askBack: 'conflict' } });
  });

  it('refuses when the scene is no longer a screenplay document in the binder', () => {
    const { state } = buildFixture();
    const command = createFolder(state);
    removeNode(state, 'scene1');
    expect(applyStoryboardCommand(state, command)).toMatchObject({ ok: false, refusal: { code: 'scene-changed', askBack: 'conflict' } });
  });

  it('refuses an id that is already in the tree', () => {
    const { state } = buildFixture();
    expect(applyStoryboardCommand(state, createFolder(state, 'board1'))).toMatchObject({ ok: false, refusal: { code: 'id-taken' } });
  });
});

describe('shot.create: a card under a storyboard folder, carrying its own copy of the metadata', () => {
  it('creates the card with the stored metadata, and the state does not share an object with the command', () => {
    const { state } = buildFixture();
    const stored = { action: 'Elena crosses.', shotSize: 'WS' };
    const command: ShotCommand = { name: 'shot.create', params: { id: 'n_SHOTONE001', parentId: 'board1', title: 'Elena', stored } };
    expect(applyStoryboardCommand(state, command, { now: NOW }).ok).toBe(true);
    expect(shotsIn(state, 'board1').map((node) => node.id)).toEqual(['n_SHOTONE001']);
    expect(storedOf(state, 'n_SHOTONE001')).toEqual({ action: 'Elena crosses.', shotSize: 'WS' });
    stored.shotSize = 'ECU';
    expect(storedOf(state, 'n_SHOTONE001')).toEqual({ action: 'Elena crosses.', shotSize: 'WS' });
  });

  it('refuses a parent that is not a storyboard folder, and writes nothing', () => {
    const { state } = buildFixture();
    const before = treeSnapshot(state);
    const command: ShotCommand = { name: 'shot.create', params: { id: 'n_SHOTONE001', parentId: 'act1', title: 'x', stored: {} } };
    expect(applyStoryboardCommand(state, command)).toMatchObject({ ok: false, refusal: { code: 'not-a-storyboard' } });
    expect(treeSnapshot(state)).toBe(before);
  });
});

describe('shot.setMeta: a whole stored value, written only over the one the plan read', () => {
  function setMeta(nodeId: string, stored: Readonly<Record<string, unknown>> | null, expected: unknown): ShotCommand {
    return { name: 'shot.setMeta', params: { nodeId, stored, expect: expected } };
  }

  it('writes the stored value over the one it expects', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    expect(applyStoryboardCommand(state, setMeta('n_SHOTONE001', { action: 'b' }, { action: 'a' }))).toEqual({ ok: true, value: undefined });
    expect(storedOf(state, 'n_SHOTONE001')).toEqual({ action: 'b' });
  });

  it('refuses when the stored value is not the one the plan read, as a conflict, and writes nothing', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    const before = treeSnapshot(state);
    expect(applyStoryboardCommand(state, setMeta('n_SHOTONE001', { action: 'b' }, { action: 'zzz' }))).toMatchObject({
      ok: false,
      refusal: { code: 'metadata-changed', askBack: 'conflict' },
    });
    expect(treeSnapshot(state)).toBe(before);
  });

  it('reads expect null as “had none”, and removes the stored value when stored is null, which is how an undo restores a bare shot', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'bare', stored: undefined, id: 'n_BARE00001', now: NOW });
    expect(applyStoryboardCommand(state, setMeta('n_BARE00001', { action: 'x' }, null)).ok).toBe(true);
    expect(storedOf(state, 'n_BARE00001')).toEqual({ action: 'x' });
    expect(applyStoryboardCommand(state, setMeta('n_BARE00001', null, { action: 'x' })).ok).toBe(true);
    expect(nodeOf(state, 'n_BARE00001')).not.toHaveProperty('shot');
  });

  it('refuses a node that is not a shot', () => {
    const { state } = buildFixture();
    expect(applyStoryboardCommand(state, setMeta('board1', { action: 'x' }, null))).toMatchObject({ ok: false, refusal: { code: 'not-a-shot' } });
  });

  it('stamps updatedAt when given a clock, and leaves it alone when not', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    const later = new Date('2026-10-09T09:00:00.000Z');
    applyStoryboardCommand(state, setMeta('n_SHOTONE001', { action: 'b' }, { action: 'a' }));
    expect(nodeOf(state, 'n_SHOTONE001').updatedAt).toBe(NOW.toISOString());
    applyStoryboardCommand(state, setMeta('n_SHOTONE001', { action: 'c' }, { action: 'b' }), { now: later });
    expect(nodeOf(state, 'n_SHOTONE001').updatedAt).toBe(later.toISOString());
  });
});

describe('binder.move: the index the bus takes, mapped to a stored order by the store', () => {
  it('moves the node so that it lands at the index among its siblings', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'a', stored: {}, id: 'n_SHOTONE001', now: NOW });
    addShotNode(state, { parentId: 'board1', title: 'b', stored: {}, id: 'n_SHOTTWO001', now: NOW });
    addShotNode(state, { parentId: 'board1', title: 'c', stored: {}, id: 'n_SHOTTHREE1', now: NOW });
    const move: ShotCommand = { name: 'binder.move', params: { nodeId: 'n_SHOTTHREE1', newParentId: 'board1', index: 0 } };
    expect(applyStoryboardCommand(state, move).ok).toBe(true);
    expect(shotsIn(state, 'board1').map((node) => node.title)).toEqual(['c', 'a', 'b']);
  });

  it('refuses an unknown node or folder, and an index that is negative or not a whole number', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'a', stored: {}, id: 'n_SHOTONE001', now: NOW });
    const move = (nodeId: string, newParentId: string, index: number): ShotCommand => ({ name: 'binder.move', params: { nodeId, newParentId, index } });
    expect(applyStoryboardCommand(state, move('n_NOPE00001', 'board1', 0))).toMatchObject({ ok: false, refusal: { code: 'not-found' } });
    expect(applyStoryboardCommand(state, move('n_SHOTONE001', 'n_NOPE00001', 0))).toMatchObject({ ok: false, refusal: { code: 'not-found' } });
    expect(applyStoryboardCommand(state, move('n_SHOTONE001', 'board1', -1))).toMatchObject({ ok: false, refusal: { code: 'invalid-params' } });
    expect(applyStoryboardCommand(state, move('n_SHOTONE001', 'board1', 0.5))).toMatchObject({ ok: false, refusal: { code: 'invalid-params' } });
  });
});

describe('applyStoryboardCommands: the list runs in order, and all of it or none of it', () => {
  it('runs the folder first, so the cards that name it can be created after it', () => {
    const { state } = buildFixture();
    const commands: ShotCommand[] = [
      createFolder(state),
      { name: 'shot.create', params: { id: 'n_SHOTONE001', parentId: 'n_NEWBOARD1', title: 'one', stored: { action: 'a' } } },
      { name: 'shot.create', params: { id: 'n_SHOTTWO001', parentId: 'n_NEWBOARD1', title: 'two', stored: {} } },
    ];
    expect(applyStoryboardCommands(state, commands, { now: NOW }).ok).toBe(true);
    expect(shotsIn(state, 'n_NEWBOARD1').map((node) => node.title)).toEqual(['one', 'two']);
  });

  it('refuses the whole list when a later command is refused, and leaves the earlier ones unwritten', () => {
    const { state } = buildFixture();
    const before = treeSnapshot(state);
    const commands: ShotCommand[] = [
      createFolder(state),
      { name: 'shot.create', params: { id: 'n_SHOTONE001', parentId: 'act1', title: 'lands in a non-storyboard', stored: {} } },
    ];
    expect(applyStoryboardCommands(state, commands, { now: NOW })).toMatchObject({ ok: false, refusal: { code: 'not-a-storyboard' } });
    expect(treeSnapshot(state)).toBe(before);
  });

  it('applies an empty list as a no-op', () => {
    const { state } = buildFixture();
    const before = treeSnapshot(state);
    expect(applyStoryboardCommands(state, [])).toEqual({ ok: true, value: undefined });
    expect(treeSnapshot(state)).toBe(before);
  });

  it('does not change the commands it is given, so a plan can be shown and then applied', () => {
    const { state } = buildFixture();
    const commands: ShotCommand[] = [
      createFolder(state),
      { name: 'shot.create', params: { id: 'n_SHOTONE001', parentId: 'n_NEWBOARD1', title: 'one', stored: { action: 'a' } } },
    ];
    const shown = JSON.stringify(commands);
    applyStoryboardCommands(state, commands, { now: NOW });
    expect(JSON.stringify(commands)).toBe(shown);
  });
});
