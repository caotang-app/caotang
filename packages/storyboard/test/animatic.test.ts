/**
 * The animatic's arithmetic (storyboard.md §2.2): the sum of the timed shots, and the shots left out because
 * they have no duration. Also the parent rule for a shot (§2.1) and the store's own validator on a derive.
 */

import { addDocument, addFolder, createEmptyManifest, createProjectState, documentIds, validateManifest } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  addShotNode,
  addStoryboardFolder,
  animaticTotals,
  applyStoryboardCommands,
  planDerive,
  setNodeKind,
  setStoredMeta,
} from '../src/index.js';

import { NOW, buildFixture } from './fixtures.js';

describe('animaticTotals: timed shots sum, untimed shots are listed and left out', () => {
  it('sums the durations of the timed shots, in seconds to two places', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'a', stored: { durationSec: 2.5 }, id: 'n_SHOTONE001', now: NOW });
    addShotNode(state, { parentId: 'board1', title: 'b', stored: { durationSec: 0.1 }, id: 'n_SHOTTWO001', now: NOW });
    addShotNode(state, { parentId: 'board1', title: 'c', stored: { durationSec: 0.2 }, id: 'n_SHOTTHREE1', now: NOW });
    expect(animaticTotals(state)).toEqual({ seconds: 2.8, timedCount: 3, untimed: [] });
  });

  it('counts a zero-second shot as timed, and lists a shot with no duration as untimed', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'zero', stored: { durationSec: 0 }, id: 'n_SHOTONE001', now: NOW });
    addShotNode(state, { parentId: 'board1', title: 'none', stored: { action: 'x' }, id: 'n_SHOTTWO001', now: NOW });
    expect(animaticTotals(state)).toEqual({ seconds: 0, timedCount: 1, untimed: ['n_SHOTTWO001'] });
  });

  it('treats a duration the load would drop as missing, because the read has decided it is not one', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'bad', stored: { durationSec: -4 }, id: 'n_SHOTONE001', now: NOW });
    expect(animaticTotals(state)).toEqual({ seconds: 0, timedCount: 0, untimed: ['n_SHOTONE001'] });
  });

  it('lists the untimed shots in binder order, and sums only over the selection it is given', () => {
    const { state } = buildFixture();
    addShotNode(state, { parentId: 'board1', title: 'early', stored: {}, id: 'n_SHOTONE001', now: NOW });
    addStoryboardFolder(state, { parentId: 'manuscript', title: 'Later — Shots', id: 'n_LATERFOLD1', now: NOW });
    addShotNode(state, { parentId: 'n_LATERFOLD1', title: 'late', stored: { durationSec: 6 }, id: 'n_SHOTTWO001', now: NOW });
    expect(animaticTotals(state)).toEqual({ seconds: 6, timedCount: 1, untimed: ['n_SHOTONE001'] });
    expect(animaticTotals(state, ['board1'])).toEqual({ seconds: 0, timedCount: 0, untimed: ['n_SHOTONE001'] });
  });

  it('is zero for a project with no shots', () => {
    expect(animaticTotals(buildFixture().state)).toEqual({ seconds: 0, timedCount: 0, untimed: [] });
  });

  it('reads the duration the writer set through the same path the list reads', () => {
    const { state } = buildFixture();
    const card = addShotNode(state, { parentId: 'board1', title: 'x', stored: {}, id: 'n_SHOTONE001', now: NOW });
    setStoredMeta(card, { durationSec: 1.25 });
    expect(animaticTotals(state).seconds).toBe(1.25);
  });
});

describe('a shot lives in a storyboard folder, and only there', () => {
  it('refuses a parent that is a plain folder, a document, or nothing', () => {
    const { state } = buildFixture();
    addFolder(state, { parentId: 'manuscript', title: 'Plain', id: 'n_PLAINFOLD', now: NOW });
    expect(() => addShotNode(state, { parentId: 'n_PLAINFOLD', title: 'x', stored: {}, id: 'n_SHOTONE001', now: NOW })).toThrow(
      'is not a storyboard folder',
    );
    expect(() => addShotNode(state, { parentId: 'scene1', title: 'x', stored: {}, id: 'n_SHOTTWO001', now: NOW })).toThrow(
      'is not a storyboard folder',
    );
    expect(() => addShotNode(state, { parentId: 'n_NOPE00001', title: 'x', stored: {}, id: 'n_SHOTTHREE1', now: NOW })).toThrow(
      'is not a storyboard folder',
    );
  });
});

describe('the store’s own validator accepts what an approved derive leaves', () => {
  it('validates the manifest with the shot and storyboard fields in place (project-format §2)', () => {
    // The ids are the format's own: `n_` and ten Crockford characters. The validator rejects anything else,
    // which is why this fixture is not the shared one, whose readable ids the validator would refuse.
    const manifest = createEmptyManifest('Conformant', NOW);
    const state = createProjectState(manifest, { now: NOW });
    addFolder(state, { id: 'n_ACT1000001', parentId: 'manuscript', title: 'Act 1', now: NOW });
    setNodeKind(
      addDocument(state, { id: 'n_SCN1000001', parentId: 'n_ACT1000001', title: 'Harbour', body: 'EXT. HARBOUR.\n\nElena crosses the quay.', now: NOW }),
      'screenplay',
    );
    const plan = planDerive(state, { docId: 'n_SCN1000001' }, { shots: [{ shotSize: 'WS', action: 'Elena crosses the quay.' }] });
    if (!plan.ok) throw new Error('plan refused');
    const applied = applyStoryboardCommands(state, plan.value.commands, { now: NOW });
    expect(applied.ok).toBe(true);
    const docFiles = documentIds(state).map((id) => `${id}.md`);
    const report = validateManifest(state.manifest, { docFiles });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
