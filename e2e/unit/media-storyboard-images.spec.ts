import { expect, test } from '@playwright/test';

import { ProjectAssets } from '../../apps/desktop/src/app/project-assets.js';
import { animaticLineOf } from '../../apps/desktop/src/media/board-model.js';
import { assignImageCommand, clearImageCommand, firstPicture, isPictureFile } from '../../apps/desktop/src/media/shot-image-model.js';
import type { ShotCommand } from '../../apps/desktop/src/media/engines.js';
import { addShotNode, addStoryboardFolder } from '../../packages/storyboard/src/index.js';
import { MemoryIndexedDb, addDocument, createEmptyManifest, createProjectState, type ProjectState } from '../../packages/store/src/index.js';

const NOW = new Date('2026-10-09T09:00:00Z');
const FOLDER = 'n_SBFOLDER01';
const SHOT = 'n_SHOTA00001';
const OTHER = 'n_SHOTB00001';
// A valid asset id: `a_` and ten Crockford base32 characters (no I, L, O or U).
const ASSET = 'a_ABCDEF2345';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function board(): ProjectState {
  const state = createProjectState(createEmptyManifest('Film', NOW));
  addStoryboardFolder(state, { parentId: 'manuscript', title: 'Scene 1 — Shots', id: FOLDER, now: NOW });
  addShotNode(state, { parentId: FOLDER, id: SHOT, title: 'Wide', stored: { shotSize: 'WS', durationSec: 4 }, now: NOW });
  addShotNode(state, { parentId: FOLDER, id: OTHER, title: 'Close', stored: {}, now: NOW });
  addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late.', now: NOW, id: 'n_LANDING001' });
  return state;
}

function applied(command: ShotCommand): unknown {
  if (command.name !== 'shot.setMeta') throw new Error(`expected shot.setMeta, got ${command.name}`);
  return command.params;
}

test.describe('which files a card takes', () => {
  test('a PNG, JPEG or WebP is a picture by its declared type, and a file with no declared type by its name', () => {
    expect(isPictureFile({ type: 'image/png', name: 'frame' })).toBe(true);
    expect(isPictureFile({ type: 'image/jpeg', name: 'frame' })).toBe(true);
    expect(isPictureFile({ type: 'image/webp', name: 'frame' })).toBe(true);
    expect(isPictureFile({ type: '', name: 'frame.JPG' })).toBe(true);
    expect(isPictureFile({ type: 'image/gif', name: 'frame.gif' })).toBe(false);
    expect(isPictureFile({ type: 'text/plain', name: 'notes.png' })).toBe(false);
  });

  test('a drop or paste takes the first picture among the files it carries, and nothing else', () => {
    const files = [
      { type: 'text/plain', name: 'script.txt' },
      { type: 'image/webp', name: 'frame.webp' },
      { type: 'image/png', name: 'other.png' },
    ];
    expect(firstPicture(files)?.name).toBe('frame.webp');
    expect(firstPicture([{ type: 'text/plain', name: 'script.txt' }])).toBeUndefined();
  });
});

test.describe('the image commands', () => {
  test('assigning an image sets its id, keeps the shot’s other fields, and guards the value it read', () => {
    const state = board();
    const result = assignImageCommand(state, SHOT, ASSET);
    if (!result.ok) throw new Error(result.refusal.message);
    expect(applied(result.value)).toEqual({
      nodeId: SHOT,
      stored: { shotSize: 'WS', durationSec: 4, image: ASSET },
      expect: { shotSize: 'WS', durationSec: 4 },
    });
  });

  test('clearing the image removes only the image, and a shot left with nothing stores no value', () => {
    const state = board();
    const cleared = clearImageCommand(state, SHOT);
    if (!cleared.ok) throw new Error(cleared.refusal.message);
    expect(applied(cleared.value)).toMatchObject({ nodeId: SHOT, stored: { shotSize: 'WS', durationSec: 4 } });

    const bare = clearImageCommand(state, OTHER);
    if (!bare.ok) throw new Error(bare.refusal.message);
    // The shot exists with empty metadata, so its guard is the empty object it holds, and the write removes the value.
    expect(applied(bare.value)).toEqual({ nodeId: OTHER, stored: null, expect: {} });
  });

  test('a node that is not a shot cannot take an image, and the refusal says so', () => {
    const result = assignImageCommand(board(), 'n_LANDING001', ASSET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.code).toBe('not-a-shot');
  });
});

test.describe('the animatic line in the board header', () => {
  test('gives the timed total, and says how many shots are left out for want of a duration', () => {
    const line = animaticLineOf(board(), FOLDER);
    expect(line).toMatchObject({ seconds: 4, timed: 1, untimed: 1 });
    expect(line.text).toBe('4 s of animatic, with 1 shot left out for want of a duration');
  });

  test('says nothing is left out when every shot is timed, and totals a folder with no shots at zero', () => {
    const state = board();
    const timed = animaticLineOf(state, FOLDER);
    expect(timed.text).toContain('left out');
    const empty = createProjectState(createEmptyManifest('Film', NOW));
    addStoryboardFolder(empty, { parentId: 'manuscript', title: 'Empty', id: 'n_EMPTY00001', now: NOW });
    expect(animaticLineOf(empty, 'n_EMPTY00001')).toMatchObject({ seconds: 0, timed: 0, untimed: 0, text: '0 s of animatic' });
  });
});

test.describe('the project’s images, held in the browser', () => {
  test('an image written by one session is read back by a new session of the same project, after the database is reopened', async () => {
    const factory = new MemoryIndexedDb();
    const first = new ProjectAssets();
    await first.persistFor('p_IMAGES0001', factory);
    await first.writeBytes(`assets/${ASSET}.png`, PNG);
    expect(first.durable()).toBe(true);

    const reopened = new ProjectAssets();
    await reopened.persistFor('p_IMAGES0001', factory);
    expect(await reopened.readBytes(`assets/${ASSET}.png`)).toEqual(PNG);
    expect(reopened.presentIds().has(ASSET)).toBe(true);
    expect(await reopened.listPaths()).toEqual([`assets/${ASSET}.png`]);
  });

  test('a project’s images are kept apart from another project’s', async () => {
    const factory = new MemoryIndexedDb();
    const one = new ProjectAssets();
    await one.persistFor('p_ONE0000001', factory);
    await one.writeBytes(`assets/${ASSET}.png`, PNG);

    const two = new ProjectAssets();
    await two.persistFor('p_TWO0000001', factory);
    expect(two.presentIds().has(ASSET)).toBe(false);
    expect(await two.readBytes(`assets/${ASSET}.png`)).toBeNull();
  });

  test('without a browser store, the images are held for the page and the store says it is not durable', async () => {
    const assets = new ProjectAssets();
    await assets.persistFor('p_NOSTORE001');
    expect(assets.durable()).toBe(false);
    await assets.writeBytes(`assets/${ASSET}.png`, PNG);
    expect(await assets.readBytes(`assets/${ASSET}.png`)).toEqual(PNG);
  });

  test('the storyboard reads the images through the assets as an artifact store, and a missing file is not found', async () => {
    const assets = new ProjectAssets();
    await assets.writeBytes(`assets/${ASSET}.png`, PNG);
    const fs = assets.artifactFs();
    expect(await fs.listFiles('assets')).toEqual([`${ASSET}.png`]);
    expect(await fs.listFiles('docs')).toEqual([]);
    expect(await fs.readBytes(`assets/${ASSET}.png`)).toEqual(PNG);
    await expect(fs.readBytes('assets/a_MISSING001.png')).rejects.toThrow();
  });
});
