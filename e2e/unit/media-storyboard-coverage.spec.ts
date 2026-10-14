import { expect, test } from '@playwright/test';

import { captureSelection, coverCommand, coverageRowsOf, scriptChoicesOf, uncoverCommand } from '../../apps/desktop/src/media/coverage-model.js';
import type { ShotCommand } from '../../apps/desktop/src/media/engines.js';
import { addShotNode, addStoryboardFolder } from '../../packages/storyboard/src/index.js';
import { addDocument, createEmptyManifest, createProjectState, nodeById, setBody, type ProjectState } from '../../packages/store/src/index.js';

const NOW = new Date('2026-10-09T09:00:00Z');
const FOLDER = 'n_SBFOLDER01';
const SHOT = 'n_SHOTA00001';
const SCENE = 'n_SCENE00001';
const PROSE = 'n_PROSE00001';
const DIALOGUE = 'n_INK000001';
const SCENE_TEXT = 'ELENA: "We leave at dawn."\n\nThe ferry waits.';

/** A project with a screenplay scene, a prose document, a dialogue container, and a storyboard holding one shot. */
function project(sceneBody = SCENE_TEXT): ProjectState {
  const state = createProjectState(createEmptyManifest('Film', NOW));
  addDocument(state, { parentId: 'manuscript', title: 'Scene 1', body: sceneBody, kind: 'screenplay', now: NOW, id: SCENE });
  addDocument(state, { parentId: 'manuscript', title: 'Chapter text', body: 'The ferry was late.', now: NOW, id: PROSE });
  addDocument(state, { parentId: 'manuscript', title: 'Dialogue', body: '=== start ===\n', kind: 'branching', type: 'dialogue', now: NOW, id: DIALOGUE });
  addStoryboardFolder(state, { parentId: 'manuscript', title: 'Scene 1 — Shots', id: FOLDER, now: NOW });
  addShotNode(state, { parentId: FOLDER, id: SHOT, title: 'Wide', stored: {}, now: NOW });
  return state;
}

test.describe('the scripts a shot can cover', () => {
  test('a screenplay scene and a prose document are offered, and a dialogue container is not', () => {
    const choices = scriptChoicesOf(project());
    expect(choices).toEqual([
      { id: SCENE, title: 'Scene 1', kind: 'screenplay' },
      { id: PROSE, title: 'Chapter text', kind: 'prose' },
    ]);
  });
});

test.describe('capturing the text a shot covers', () => {
  test('a selection in a body with no carriage returns is captured at its offsets, against the stored text', () => {
    const captured = captureSelection(project(), SCENE, { from: 0, to: 5, text: 'ELENA' });
    if (!captured.ok) throw new Error(captured.message);
    expect(captured.anchor).toMatchObject({ from: 0, to: 5, exact: 'ELENA', prefix: '', capturedRevision: expect.any(Number) });
    expect(captured.anchor.suffix.startsWith(': "We')).toBe(true);
  });

  test('a selection the stored text does not hold where the picker showed it is refused, and nothing is guessed', () => {
    const captured = captureSelection(project(), SCENE, { from: 0, to: 5, text: 'FERRY' });
    expect(captured.ok).toBe(false);
    if (!captured.ok) expect(captured.message).toContain('changed since it was selected');
  });

  test('an empty selection is refused', () => {
    const captured = captureSelection(project(), SCENE, { from: 2, to: 2, text: '' });
    expect(captured.ok).toBe(false);
  });

  test('a body with carriage returns is located by its words, and a passage that appears twice is refused', () => {
    const state = project();
    setBody(state, SCENE, 'The lamp turns.\r\n\r\nThe lamp turns.\r\n');
    const twice = captureSelection(state, SCENE, { from: 0, to: 15, text: 'The lamp turns.' });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.message).toContain('more than once');

    setBody(state, SCENE, 'The lamp turns.\r\n\r\nThe ferry waits.\r\n');
    const once = captureSelection(state, SCENE, { from: 0, to: 15, text: 'The ferry waits.' });
    if (!once.ok) throw new Error(once.message);
    expect(once.anchor.exact).toBe('The ferry waits.');
  });

  test('a passage longer than a coverage can hold is refused, and the words say how to shorten it', () => {
    const long = 'x'.repeat(2001);
    const captured = captureSelection(project(long), SCENE, { from: 0, to: 2001, text: long });
    expect(captured.ok).toBe(false);
    if (!captured.ok) expect(captured.message).toContain('2000 characters');
  });
});

test.describe('the coverage a shot holds', () => {
  test('covering text adds it to the coverage the shot already holds, and the write is guarded by what it read', () => {
    const state = project();
    const captured = captureSelection(state, SCENE, { from: 0, to: 5, text: 'ELENA' });
    if (!captured.ok) throw new Error(captured.message);
    const added = coverCommand(state, SHOT, SCENE, captured.anchor);
    if (!added.ok) throw new Error(added.refusal.message);
    expect(added.value.name).toBe('shot.setMeta');
    // The shot holds empty metadata, so the guard is that empty object, and the new coverage is the whole stored value.
    expect(added.value.params).toMatchObject({ nodeId: SHOT, expect: {}, stored: { dialogue: [{ kind: 'fountain-element', docId: SCENE }] } });
  });

  test('the rows name the document and the covered text, and an uncover takes out the row at its index', () => {
    const state = project();
    const shot = nodeById(state, SHOT);
    if (shot === undefined) throw new Error('no shot');
    shot.shot = {
      dialogue: [
        { kind: 'fountain-element', docId: SCENE, anchor: { from: 0, to: 5, exact: 'ELENA', prefix: '', suffix: '', capturedRevision: 0 } },
        { kind: 'fountain-element', docId: PROSE, anchor: { from: 4, to: 8, exact: 'ferry', prefix: '', suffix: '', capturedRevision: 0 } },
      ],
    };
    expect(coverageRowsOf(state, SHOT)).toEqual([
      { index: 0, docId: SCENE, title: 'Scene 1', text: 'ELENA' },
      { index: 1, docId: PROSE, title: 'Chapter text', text: 'ferry' },
    ]);
    const removed = uncoverCommand(state, SHOT, 0);
    if (!removed.ok) throw new Error(removed.refusal.message);
    const params = removed.value.params as unknown as { stored: { dialogue: { docId: string }[] } };
    expect(params.stored.dialogue.map((entry) => entry.docId)).toEqual([PROSE]);
  });

  test('a command for a node that is not a shot is refused, and no command is built', () => {
    const refused = coverCommand(project(), SCENE, SCENE, { from: 0, to: 1, exact: 'E', prefix: '', suffix: '', capturedRevision: 0 });
    expect(refused.ok).toBe(false);
    const command: ShotCommand | undefined = refused.ok ? refused.value : undefined;
    expect(command).toBeUndefined();
  });
});
