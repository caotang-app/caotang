/**
 * `shots.annotate` — storyboard.md §4 tool 19. A batch is validated whole before anything changes, a repeat
 * is a no-op, and the plan's commands are the whole write: applied in order they land, and built inverse
 * from the commands alone they restore each shot's stored value exactly.
 */

import { addDocument, removeNode, type ProjectState, type TreeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  addShotNode,
  applyStoryboardCommands,
  importImage,
  planAnnotate,
  presentAssetIds,
  setStoredMeta,
  shotFieldOf,
  type AnnotateRequest,
  type ShotCommand,
} from '../src/index.js';

import { CountingFs, NOW, buildFixture, pngBytes, treeSnapshot, type Fixture } from './fixtures.js';

interface Setup {
  readonly fixture: Fixture;
  readonly assetId: string;
  readonly present: ReadonlySet<string>;
}

/** A storyboard with two shots, one imported image, and a document parked inside the storyboard. */
async function setup(): Promise<Setup> {
  const fixture = buildFixture();
  const { state } = fixture;
  addShotNode(state, { parentId: 'board1', title: 'one', stored: { action: 'a', shotSize: 'WS' }, id: 'n_SHOTONE001', now: NOW });
  addShotNode(state, { parentId: 'board1', title: 'two', stored: {}, id: 'n_SHOTTWO001', now: NOW });
  addDocument(state, { id: 'n_NOTESONE1', parentId: 'board1', title: 'a note', body: '', now: NOW });
  const fs = new CountingFs();
  const imported = await importImage(fs, pngBytes(), {});
  if (!imported.ok) throw new Error('import failed');
  return { fixture, assetId: imported.value.assetId, present: await presentAssetIds(fs) };
}

/** A node the test has just created or named. A missing one is a broken fixture, so it fails loudly. */
function mustNode(state: ProjectState, id: string): TreeNode {
  const node = state.manifest.tree.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`fixture has no node "${id}"`);
  return node;
}

function storedOf(state: ProjectState, id: string): unknown {
  return shotFieldOf(mustNode(state, id));
}

function refusalOf(state: ProjectState, request: AnnotateRequest, present: ReadonlySet<string>) {
  const result = planAnnotate(state, request, present);
  if (result.ok) throw new Error('expected a refusal');
  return result.refusal;
}

/** Applies a plan's commands, and fails the test if the apply refuses. */
function applyOk(state: ProjectState, commands: readonly ShotCommand[], now?: Date): void {
  const result = applyStoryboardCommands(state, commands, now === undefined ? {} : { now });
  if (!result.ok) throw new Error(`apply refused: ${result.refusal.message}`);
}

/**
 * The inverse of a `shot.setMeta` batch, written from the commands alone: each command swaps its `stored`
 * and its `expect`, and the list runs in reverse, as command-bus §5 says an undo does.
 */
function inverseOf(commands: readonly ShotCommand[]): ShotCommand[] {
  return commands
    .map((command): ShotCommand => {
      if (command.name !== 'shot.setMeta') throw new Error(`no inverse is written for ${command.name} here`);
      return {
        name: 'shot.setMeta',
        params: {
          nodeId: command.params.nodeId,
          stored: command.params.expect as Record<string, unknown> | null,
          expect: command.params.stored,
        },
      };
    })
    .reverse();
}

describe('planning: every named shot and value is checked before a change', () => {
  it('refuses an id that names no node, and names the storyboards whose shots are the ones meant', async () => {
    const { fixture, present } = await setup();
    const refusal = refusalOf(fixture.state, { shots: ['n_NOPE00001'], action: 'x' }, present);
    expect(refusal.code).toBe('shot-unknown');
    expect(refusal.message).toContain('"Board" (board1)');
    expect(refusal.message).toContain('binder.read_tree');
  });

  it('says to derive first when there is no storyboard at all', async () => {
    const { fixture, present } = await setup();
    removeNode(fixture.state, 'board1');
    const refusal = refusalOf(fixture.state, { shots: ['n_NOPE00001'], action: 'x' }, present);
    expect(refusal.message).toContain('Derive shots from a scene with shots.derive first');
  });

  it('refuses a node that is not a shot, and names the storyboard it sits in', async () => {
    const { fixture, present } = await setup();
    const refusal = refusalOf(fixture.state, { shots: ['n_NOTESONE1'], action: 'x' }, present);
    expect(refusal.code).toBe('not-a-shot');
    expect(refusal.message).toContain('is a document, not a shot');
    expect(refusal.message).toContain('storyboard "Board" (board1)');
  });

  it('refuses a batch over 50 and says to split it, and an empty or repeated batch', async () => {
    const { fixture, present } = await setup();
    expect(refusalOf(fixture.state, { shots: Array.from({ length: 51 }, (_, i) => `n_FAKE${String(i).padStart(4, '0')}`), action: 'x' }, present).code).toBe('batch-too-large');
    expect(refusalOf(fixture.state, { shots: [], action: 'x' }, present).code).toBe('batch-empty');
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001', 'n_SHOTONE001'], action: 'x' }, present).code).toBe('batch-duplicate');
  });

  it('accepts exactly 50 shots, so the bound is the spec’s and not one short', async () => {
    const { fixture, present } = await setup();
    const fifty = Array.from({ length: 50 }, (_, i) => `n_FAKE${String(i).padStart(4, '0')}`);
    expect(refusalOf(fixture.state, { shots: fifty, action: 'x' }, present).code).toBe('shot-unknown');
  });

  it('refuses a call that sets nothing', async () => {
    const { fixture, present } = await setup();
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001'] }, present).code).toBe('nothing-to-set');
  });

  it('refuses an image that is not in assets/, and says to import it first', async () => {
    const { fixture, present } = await setup();
    const refusal = refusalOf(fixture.state, { shots: ['n_SHOTONE001'], image: { assetId: 'a_7K2QX9M4A1' } }, present);
    expect(refusal.code).toBe('image-missing');
    expect(refusal.message).toContain('Import the image first');
  });

  it('refuses an image reference that is a path, not an asset id', async () => {
    const { fixture, present } = await setup();
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001'], image: { assetId: '../x.png' } }, present).code).toBe('image-id-invalid');
  });

  it('refuses a spec field the schema does not have, and a spec value outside its list, naming the list', async () => {
    const { fixture, present } = await setup();
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001'], spec: { colour: 'red' } as unknown as AnnotateRequest['spec'] }, present).code).toBe('spec-field-unknown');
    const enumRefusal = refusalOf(fixture.state, { shots: ['n_SHOTONE001'], spec: { shotSize: 'XXL' } }, present);
    expect(enumRefusal.code).toBe('enum-invalid');
    expect(enumRefusal.message).toContain('WS, FS, MFS');
  });

  it('refuses an action over 1000 code points', async () => {
    const { fixture, present } = await setup();
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001'], action: 'a'.repeat(1001) }, present).code).toBe('action-too-long');
  });

  it('refuses a shot whose metadata is not an object, rather than overwrite what it holds', async () => {
    const { fixture, present } = await setup();
    const node = fixture.state.manifest.tree.find((candidate) => candidate.id === 'n_SHOTONE001');
    if (node !== undefined) setStoredMeta(node, 'a bare string');
    expect(refusalOf(fixture.state, { shots: ['n_SHOTONE001'], action: 'x' }, present).code).toBe('shot-malformed');
  });

  it('leaves every shot as it was when one shot in the batch is refused: the batch is all or nothing', async () => {
    const { fixture, present } = await setup();
    const before = treeSnapshot(fixture.state);
    const refusal = refusalOf(fixture.state, { shots: ['n_SHOTONE001', 'n_NOPE00001'], action: 'changed' }, present);
    expect(refusal.code).toBe('shot-unknown');
    expect(treeSnapshot(fixture.state)).toBe(before);
  });

  it('plans without writing: planning a change leaves the state exactly as it was', async () => {
    const { fixture, assetId, present } = await setup();
    const before = treeSnapshot(fixture.state);
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001', 'n_SHOTTWO001'], image: { assetId }, action: 'planned' }, present);
    expect(plan.ok).toBe(true);
    expect(treeSnapshot(fixture.state)).toBe(before);
  });
});

describe('the plan: one shot.setMeta per changed shot, in request order, and none for an unchanged one', () => {
  it('names each changed shot once, and carries the whole stored value it would write', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTTWO001', 'n_SHOTONE001'], spec: { cameraAngle: 'low' } }, present);
    if (!plan.ok) throw new Error('plan refused');
    expect(plan.value.commands).toEqual([
      { name: 'shot.setMeta', params: { nodeId: 'n_SHOTTWO001', stored: { cameraAngle: 'low' }, expect: {} } },
      { name: 'shot.setMeta', params: { nodeId: 'n_SHOTONE001', stored: { action: 'a', shotSize: 'WS', cameraAngle: 'low' }, expect: { action: 'a', shotSize: 'WS' } } },
    ]);
  });

  it('carries null as the expectation for a shot that had no stored metadata, so the apply knows it had none', async () => {
    const fresh = buildFixture();
    addShotNode(fresh.state, { parentId: 'board1', title: 'bare', stored: undefined, id: 'n_BARE00001', now: NOW });
    const plan = planAnnotate(fresh.state, { shots: ['n_BARE00001'], action: 'x' }, new Set());
    if (!plan.ok) throw new Error('plan refused');
    expect(plan.value.commands).toEqual([{ name: 'shot.setMeta', params: { nodeId: 'n_BARE00001', stored: { action: 'x' }, expect: null } }]);
  });

  it('emits no command for a shot the call would not change', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], spec: { shotSize: 'WS' }, action: 'a' }, present);
    if (!plan.ok) throw new Error('plan refused');
    expect(plan.value.commands).toEqual([]);
  });
});

describe('applying the commands: the values land on the shots, and only on them', () => {
  it('sets an image, and reports the shot as changed', async () => {
    const { fixture, assetId, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], image: { assetId } }, present);
    if (!plan.ok) throw new Error('plan refused');
    expect(plan.value.changes.map((change) => change.nodeId)).toEqual(['n_SHOTONE001']);
    applyOk(fixture.state, plan.value.commands);
    expect(storedOf(fixture.state, 'n_SHOTONE001')).toMatchObject({ image: assetId, action: 'a', shotSize: 'WS' });
  });

  it('merges a spec into the stored values, so a field the call did not name keeps its value', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], spec: { cameraAngle: 'low', lens: '50mm' } }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    expect(storedOf(fixture.state, 'n_SHOTONE001')).toEqual({ action: 'a', shotSize: 'WS', cameraAngle: 'low', lens: '50mm' });
  });

  it('writes the same action to several shots in one batch', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001', 'n_SHOTTWO001'], action: 'Shared line.' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    expect(storedOf(fixture.state, 'n_SHOTONE001')).toMatchObject({ action: 'Shared line.' });
    expect(storedOf(fixture.state, 'n_SHOTTWO001')).toEqual({ action: 'Shared line.' });
  });

  it('is idempotent: naming a shot with the values it already has changes nothing, and is not an error', async () => {
    const { fixture, present } = await setup();
    const first = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], spec: { shotSize: 'WS' }, action: 'a' }, present);
    expect(first.ok && first.value.changes).toEqual([]);
    expect(first.ok && first.value.unchanged).toEqual(['n_SHOTONE001']);
  });

  it('does not count a difference only in the order of stored keys as a change', async () => {
    const { fixture, present } = await setup();
    setStoredMeta(mustNode(fixture.state, 'n_SHOTTWO001'), { action: 'x', cameraAngle: 'eye' });
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTTWO001'], action: 'x', spec: { cameraAngle: 'eye' } }, present);
    expect(plan.ok && plan.value.unchanged).toEqual(['n_SHOTTWO001']);
  });

  it('stamps the shot’s update time when given a clock, because a metadata edit is a content change', async () => {
    const { fixture, present } = await setup();
    const later = new Date('2026-10-09T09:00:00.000Z');
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], action: 'later' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands, later);
    expect(fixture.state.manifest.tree.find((node) => node.id === 'n_SHOTONE001')?.updatedAt).toBe(later.toISOString());
  });

  it('replaces a value the load kept as unknown when the call sets that field', async () => {
    const { fixture, present } = await setup();
    setStoredMeta(mustNode(fixture.state, 'n_SHOTTWO001'), { shotSize: 'XXL' });
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTTWO001'], spec: { shotSize: 'WS' } }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    expect(storedOf(fixture.state, 'n_SHOTTWO001')).toEqual({ shotSize: 'WS' });
  });

  it('keeps an unknown value the call did not name, so an unrelated edit does not destroy it', async () => {
    const { fixture, present } = await setup();
    setStoredMeta(mustNode(fixture.state, 'n_SHOTTWO001'), { shotSize: 'XXL' });
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTTWO001'], action: 'unrelated' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    expect(storedOf(fixture.state, 'n_SHOTTWO001')).toEqual({ shotSize: 'XXL', action: 'unrelated' });
  });
});

describe('undo: the commands carry the prior metadata, so the inverse restores it exactly', () => {
  it('restores every changed shot to its stored value from before the write', async () => {
    const { fixture, assetId, present } = await setup();
    const before = treeSnapshot(fixture.state);
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001', 'n_SHOTTWO001'], image: { assetId }, action: 'new' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    expect(treeSnapshot(fixture.state)).not.toBe(before);
    applyOk(fixture.state, inverseOf(plan.value.commands));
    expect(treeSnapshot(fixture.state)).toBe(before);
  });

  it('restores an unknown value and an unknown field exactly, because the expectation holds the raw prior value', async () => {
    const { fixture, present } = await setup();
    setStoredMeta(mustNode(fixture.state, 'n_SHOTTWO001'), { shotSize: 'XXL', mystery: 9 });
    const before = treeSnapshot(fixture.state);
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTTWO001'], action: 'x' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    applyOk(fixture.state, inverseOf(plan.value.commands));
    expect(treeSnapshot(fixture.state)).toBe(before);
  });

  it('removes the metadata a shot did not have before, so the restore is exact and not a leftover empty object', () => {
    const fresh = buildFixture();
    addShotNode(fresh.state, { parentId: 'board1', title: 'bare', stored: undefined, id: 'n_BARE00001', now: NOW });
    const plan = planAnnotate(fresh.state, { shots: ['n_BARE00001'], action: 'x' }, new Set());
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fresh.state, plan.value.commands);
    expect(storedOf(fresh.state, 'n_BARE00001')).toEqual({ action: 'x' });
    applyOk(fresh.state, inverseOf(plan.value.commands));
    expect(storedOf(fresh.state, 'n_BARE00001')).toBeUndefined();
    expect(mustNode(fresh.state, 'n_BARE00001')).not.toHaveProperty('shot');
  });

  it('refuses to apply a plan made against metadata that has since changed, and writes nothing', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], action: 'planned' }, present);
    if (!plan.ok) throw new Error('plan refused');
    setStoredMeta(mustNode(fixture.state, 'n_SHOTONE001'), { action: 'changed under the plan' });
    const before = treeSnapshot(fixture.state);
    const applied = applyStoryboardCommands(fixture.state, plan.value.commands);
    expect(applied).toMatchObject({ ok: false, refusal: { code: 'metadata-changed', askBack: 'conflict' } });
    expect(treeSnapshot(fixture.state)).toBe(before);
  });

  it('refuses an inverse whose shot was removed since the write, and writes nothing, so the caller decides what undo does', async () => {
    const { fixture, present } = await setup();
    const plan = planAnnotate(fixture.state, { shots: ['n_SHOTONE001'], action: 'x' }, present);
    if (!plan.ok) throw new Error('plan refused');
    applyOk(fixture.state, plan.value.commands);
    removeNode(fixture.state, 'n_SHOTONE001');
    const before = treeSnapshot(fixture.state);
    expect(applyStoryboardCommands(fixture.state, inverseOf(plan.value.commands))).toMatchObject({
      ok: false,
      refusal: { code: 'shot-unknown' },
    });
    expect(treeSnapshot(fixture.state)).toBe(before);
  });
});
