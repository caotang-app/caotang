/**
 * Shot nodes and their order — storyboard.md §2.1 (the node kind and the folder marker), §2.2 (numbering
 * is derived, not stored) and §3.1 (cards are the folder's children in sibling order).
 */

import { addDocument, addFolder, type ProjectState, type TreeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  addShotNode,
  addStoryboardFolder,
  applyStoryboardCommands,
  displayNumberOf,
  displayNumbers,
  exportNumbers,
  isShotNode,
  planMoveShot,
  shotsIn,
  shotsInBinderOrder,
  storyboardFolders,
  walkBinder,
} from '../src/index.js';

import { NOW, buildFixture, treeSnapshot } from './fixtures.js';

function shot(state: ProjectState, folderId: string, title: string, id: string): TreeNode {
  return addShotNode(state, { parentId: folderId, title, stored: { action: title }, id, now: NOW });
}

function titlesOf(state: ProjectState, folderId: string): string[] {
  return shotsIn(state, folderId).map((node) => node.title);
}

/**
 * Plans a shot's move and applies the one command it is made of, the way the bus does. A refused plan
 * throws with the refusal's message, so a test can assert on the words.
 */
function moveShot(state: ProjectState, shotId: string, target: { readonly folderId: string; readonly index: number }): void {
  const planned = planMoveShot(state, shotId, target);
  if (!planned.ok) throw new Error(`plan refused: ${planned.refusal.message}`);
  const applied = applyStoryboardCommands(state, [planned.value]);
  if (!applied.ok) throw new Error(`apply refused: ${applied.refusal.message}`);
}

describe('creating a storyboard folder and a shot', () => {
  it('creates a folder marked kind storyboard, placed after its last sibling', () => {
    const { state, random } = buildFixture();
    const folder = addStoryboardFolder(state, { parentId: 'manuscript', title: 'Act 2 — Shots', now: NOW, randomBytes: random });
    expect(folder).toMatchObject({ type: 'folder', parentId: 'manuscript', kind: 'storyboard' });
    expect(folder.order).toBeGreaterThan(state.manifest.tree.find((node) => node.id === 'board1')?.order ?? 0);
  });

  it('creates a shot as a tree node with no body record, so no docs/ file is ever written for it', () => {
    const { state } = buildFixture();
    const card = shot(state, 'board1', 'Elena crosses', 'n_SHOTONE001');
    expect(card).toMatchObject({ type: 'shot', parentId: 'board1', title: 'Elena crosses', status: null, keywords: [] });
    expect(card.createdAt).toBe(NOW.toISOString());
    expect(state.documents.has('n_SHOTONE001')).toBe(false);
    expect(isShotNode(card)).toBe(true);
  });

  it('gives a shot the next gap-encoded order after its siblings, as the store does for documents', () => {
    const { state } = buildFixture();
    const first = shot(state, 'board1', 'one', 'n_SHOTONE001');
    const second = shot(state, 'board1', 'two', 'n_SHOTTWO001');
    expect(first.order).toBe(10);
    expect(second.order).toBe(20);
  });

  it('refuses an id that is already in use', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'one', 'n_SHOTONE001');
    expect(() => shot(state, 'board1', 'again', 'n_SHOTONE001')).toThrow('already in use');
  });
});

describe('shot order is sibling order', () => {
  it('lists a storyboard’s shots by their order, not by the order they were created', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'first made', 'n_SHOTONE001');
    shot(state, 'board1', 'second made', 'n_SHOTTWO001');
    const third = shot(state, 'board1', 'third made', 'n_SHOTTHREE1');
    third.order = 5;
    expect(titlesOf(state, 'board1')).toEqual(['third made', 'first made', 'second made']);
  });

  it('ignores a non-shot child: it is not a card and is not numbered', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'card', 'n_SHOTONE001');
    addDocument(state, { id: 'n_NOTESONE1', parentId: 'board1', title: 'stray note', body: '', now: NOW });
    expect(titlesOf(state, 'board1')).toEqual(['card']);
    expect(displayNumbers(state, 'board1').size).toBe(1);
  });

  it('finds the storyboard folders in binder order, and only those', () => {
    const { state } = buildFixture();
    addStoryboardFolder(state, { parentId: 'act1', title: 'Act 1 — Shots', id: 'n_BOARDACT1', now: NOW });
    addFolder(state, { id: 'plain1', parentId: 'manuscript', title: 'Plain', now: NOW });
    expect(storyboardFolders(state).map((node) => node.id)).toEqual(['n_BOARDACT1', 'board1']);
  });
});

describe('numbering is derived from position, and renumbering is free', () => {
  it('numbers a storyboard’s shots 1 to n from its sibling order', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'one', 'n_SHOTONE001');
    shot(state, 'board1', 'two', 'n_SHOTTWO001');
    expect([...displayNumbers(state, 'board1').entries()]).toEqual([
      ['n_SHOTONE001', 1],
      ['n_SHOTTWO001', 2],
    ]);
    expect(displayNumberOf(state, 'n_SHOTTWO001')).toBe(2);
  });

  it('gives a non-shot node no display number', () => {
    const { state } = buildFixture();
    expect(displayNumberOf(state, 'board1')).toBeUndefined();
    expect(displayNumberOf(state, 'no-such-node')).toBeUndefined();
  });

  it('moving a shot renumbers the cards, and changes the order of the moved node only', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    shot(state, 'board1', 'c', 'n_SHOTTHREE1');
    const before = new Map(state.manifest.tree.map((node) => [node.id, node.order]));

    moveShot(state, 'n_SHOTTHREE1', { folderId: 'board1', index: 0 });

    expect(titlesOf(state, 'board1')).toEqual(['c', 'a', 'b']);
    expect(displayNumberOf(state, 'n_SHOTTHREE1')).toBe(1);
    const changed = state.manifest.tree.filter((node) => node.order !== before.get(node.id)).map((node) => node.id);
    expect(changed).toEqual(['n_SHOTTHREE1']);
  });

  it('places a shot between two others, using the store’s gap arithmetic', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    shot(state, 'board1', 'c', 'n_SHOTTHREE1');
    moveShot(state, 'n_SHOTTHREE1', { folderId: 'board1', index: 1 });
    expect(titlesOf(state, 'board1')).toEqual(['a', 'c', 'b']);
  });

  it('renormalises a crowded run of orders when there is no gap left, and keeps the order right', () => {
    const { state } = buildFixture();
    const a = shot(state, 'board1', 'a', 'n_SHOTONE001');
    const b = shot(state, 'board1', 'b', 'n_SHOTTWO001');
    const c = shot(state, 'board1', 'c', 'n_SHOTTHREE1');
    a.order = 10;
    b.order = 11;
    c.order = 12;
    moveShot(state, 'n_SHOTTHREE1', { folderId: 'board1', index: 1 });
    expect(titlesOf(state, 'board1')).toEqual(['a', 'c', 'b']);
  });

  it('appends when the index is past the last shot', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    moveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: 99 });
    expect(titlesOf(state, 'board1')).toEqual(['b', 'a']);
  });

  it('counts shots only when it places a move, so a non-shot sibling does not shift the position', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    addDocument(state, { id: 'n_NOTESONE1', parentId: 'board1', title: 'note', body: '', now: NOW });
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    moveShot(state, 'n_SHOTTWO001', { folderId: 'board1', index: 0 });
    expect(titlesOf(state, 'board1')).toEqual(['b', 'a']);
  });

  it('counts a shot’s target index among shots, so a non-shot sibling ahead of the target is not counted', () => {
    const { state } = buildFixture();
    addDocument(state, { id: 'n_NOTESONE1', parentId: 'board1', title: 'note', body: '', now: NOW });
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    moveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: 1 });
    expect(titlesOf(state, 'board1')).toEqual(['b', 'a']);
  });

  it('moves a shot into another storyboard', () => {
    const { state } = buildFixture();
    const other = addStoryboardFolder(state, { parentId: 'act1', title: 'Other — Shots', id: 'n_BOARDACT1', now: NOW });
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    moveShot(state, 'n_SHOTONE001', { folderId: other.id, index: 0 });
    expect(titlesOf(state, 'board1')).toEqual([]);
    expect(titlesOf(state, other.id)).toEqual(['a']);
  });

  it('refuses a move that names no shot, a non-storyboard folder, or a negative index', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    expect(() => moveShot(state, 'board1', { folderId: 'board1', index: 0 })).toThrow('no shot');
    expect(() => moveShot(state, 'n_SHOTONE001', { folderId: 'act1', index: 0 })).toThrow('not a storyboard folder');
    expect(() => moveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: -1 })).toThrow('whole number');
  });
});

describe('binder order and export numbers', () => {
  it('walks the tree depth first, children in sibling order, and visits each node once', () => {
    const { state } = buildFixture();
    const order = walkBinder(state).map((entry) => entry.node.id);
    expect(order).toEqual(['root', 'manuscript', 'act1', 'scene1', 'prose1', 'empty1', 'board1', 'research']);
    expect(new Set(order).size).toBe(order.length);
  });

  it('ignores a cycle that no root reaches, rather than looping on it', () => {
    const { state } = buildFixture();
    const x = addFolder(state, { parentId: 'manuscript', title: 'x', id: 'n_CYCLEX001', now: NOW });
    const y = addFolder(state, { parentId: x.id, title: 'y', id: 'n_CYCLEY001', now: NOW });
    x.parentId = y.id;
    expect(walkBinder(state).map((entry) => entry.node.id)).not.toContain('n_CYCLEX001');
  });

  it('lists shots across storyboards in binder order and numbers them continuously from 1', () => {
    const { state } = buildFixture();
    addStoryboardFolder(state, { parentId: 'manuscript', title: 'Later — Shots', id: 'n_BOARDLATER', now: NOW });
    shot(state, 'board1', 'early one', 'n_SHOTONE001');
    shot(state, 'board1', 'early two', 'n_SHOTTWO001');
    shot(state, 'n_BOARDLATER', 'late one', 'n_SHOTLATE01');
    const listed = shotsInBinderOrder(state).map((node) => node.title);
    expect(listed).toEqual(['early one', 'early two', 'late one']);
    expect([...exportNumbers(shotsInBinderOrder(state)).values()]).toEqual([1, 2, 3]);
  });

  it('lists only the subtree of a selection, and nothing for an empty selection', () => {
    const { state } = buildFixture();
    addStoryboardFolder(state, { parentId: 'manuscript', title: 'Later — Shots', id: 'n_BOARDLATER', now: NOW });
    shot(state, 'board1', 'early', 'n_SHOTONE001');
    shot(state, 'n_BOARDLATER', 'late', 'n_SHOTLATE01');
    expect(shotsInBinderOrder(state, ['n_BOARDLATER']).map((node) => node.title)).toEqual(['late']);
    expect(shotsInBinderOrder(state, [])).toEqual([]);
    expect(shotsInBinderOrder(state, ['manuscript']).map((node) => node.title)).toEqual(['early', 'late']);
  });
});

describe('planning a move: one binder.move whose index is the bus’s, and no write', () => {
  it('plans a binder.move whose index counts the siblings other than the moved shot', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    shot(state, 'board1', 'c', 'n_SHOTTHREE1');
    expect(planMoveShot(state, 'n_SHOTTHREE1', { folderId: 'board1', index: 0 })).toEqual({
      ok: true,
      value: { name: 'binder.move', params: { nodeId: 'n_SHOTTHREE1', newParentId: 'board1', index: 0 } },
    });
    expect(planMoveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: 1 })).toEqual({
      ok: true,
      value: { name: 'binder.move', params: { nodeId: 'n_SHOTONE001', newParentId: 'board1', index: 1 } },
    });
  });

  it('counts a non-shot sibling in the index, because the bus counts every sibling it places around', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    addDocument(state, { id: 'n_NOTESONE1', parentId: 'board1', title: 'note', body: '', now: NOW });
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    // Moving b to shot-index 0 places it before a. The siblings other than b are [a, note], so a sits at 0.
    expect(planMoveShot(state, 'n_SHOTTWO001', { folderId: 'board1', index: 0 })).toMatchObject({
      ok: true,
      value: { params: { index: 0 } },
    });
    // Shot-index 1 is past the last other shot (b), so a goes to the end. The others are [note, b], and the index is their count.
    expect(planMoveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: 1 })).toMatchObject({
      ok: true,
      value: { params: { index: 2 } },
    });
  });

  it('plans without writing: the state is exactly as it was before the plan', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    const before = treeSnapshot(state);
    expect(planMoveShot(state, 'n_SHOTONE001', { folderId: 'board1', index: 1 }).ok).toBe(true);
    expect(treeSnapshot(state)).toBe(before);
  });

  it('refuses a move with a clean refusal rather than a throw, so the caller can report it', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    expect(planMoveShot(state, 'board1', { folderId: 'board1', index: 0 })).toMatchObject({ ok: false, refusal: { code: 'not-a-shot' } });
    expect(planMoveShot(state, 'n_SHOTONE001', { folderId: 'act1', index: 0 })).toMatchObject({ ok: false, refusal: { code: 'not-a-storyboard' } });
  });

  it('applies the binder.move, and the shots land in the planned order', () => {
    const { state } = buildFixture();
    shot(state, 'board1', 'a', 'n_SHOTONE001');
    shot(state, 'board1', 'b', 'n_SHOTTWO001');
    const planned = planMoveShot(state, 'n_SHOTTWO001', { folderId: 'board1', index: 0 });
    if (!planned.ok) throw new Error('plan refused');
    expect(applyStoryboardCommands(state, [planned.value]).ok).toBe(true);
    expect(titlesOf(state, 'board1')).toEqual(['b', 'a']);
  });
});
