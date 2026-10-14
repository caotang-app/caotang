/**
 * The project's pictures between the browser's copy and a project folder (project-format §2 `assets/`, storyboard.md §2.2), below the
 * page. A folder save copies every picture the browser holds; a folder holding another file under one of them is refused before any
 * picture is written; a bundle made from the projects list reads the browser's copy with no session open; and a folder opened here puts
 * its pictures into that copy, so a later open from the list still has them.
 *
 * The browser's copy is an in-memory IndexedDB here, set as the page's `indexedDB` for each test, the way the page's own is.
 */

import { expect, test } from '@playwright/test';

import { ProjectAssets } from '../../apps/desktop/src/app/project-assets.js';
import { ProjectSession } from '../../apps/desktop/src/app/session.js';
import { exportStoredBundle, openFolder, type Opened, type OpenOutcome } from '../../apps/desktop/src/app/lifecycle.js';
import { folderArtifactFs, folderBytes } from '../../apps/desktop/src/app/fs-access.js';
import {
  MemoryIndexedDb,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  openRuntimeStore,
  writeProject,
  type ProjectState,
} from '../../packages/store/src/index.js';

import { zipEntries } from '../zip-entries.js';
import { filesIn, memoryFolder } from './memory-folder.js';

const globals = globalThis as unknown as Record<string, unknown>;
let previous: { document: unknown; window: unknown; indexedDB: unknown } | null = null;

test.beforeAll(() => {
  previous = { document: globals['document'], window: globals['window'], indexedDB: globals['indexedDB'] };
  // The session's autosave listens to the page's visibility and page-hide events, which these stand in for, as session-exports.spec does.
  globals['document'] = new EventTarget();
  globals['window'] = new EventTarget();
});

test.afterAll(() => {
  if (previous === null) return;
  globals['document'] = previous.document;
  globals['window'] = previous.window;
  globals['indexedDB'] = previous.indexedDB;
});

const NOW = new Date('2026-10-09T09:00:00Z');
/** Valid asset ids: `a_` and ten Crockford base32 characters (no I, L, O or U). */
const PICTURE = 'a_ABCDEF2345';
const OTHER = 'a_BCDEFGHJKM';
/** A file that starts with the PNG signature, which is all the cover import checks. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x80, 0xff, 0xc3, 0x28, 0x00, 0x42]);

/** A project with one chapter and one scene, so the project has a body of its own. */
function manuscript(title: string): ProjectState {
  const state = createProjectState(createEmptyManifest(title, NOW));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', id: 'n_CH100000AA', now: NOW });
  addDocument(state, { parentId: 'n_CH100000AA', title: 'The Landing', id: 'n_SCA0000001', body: 'The boat came in with the tide.', now: NOW });
  return state;
}

async function openedOf(outcome: Promise<OpenOutcome>): Promise<Opened> {
  const result = await outcome;
  if (result.kind !== 'opened') throw new Error('expected the project to open, not to be offered a recovery');
  return result.opened;
}

test('a folder attached after a reload gets every picture the browser holds, not only the ones this page wrote', async () => {
  const factory = new MemoryIndexedDb();
  const first = new ProjectAssets();
  await first.persistFor('p_ATTACHALL01', factory);
  await first.writeBytes(`assets/${PICTURE}.png`, PNG);

  const reopened = new ProjectAssets();
  await reopened.persistFor('p_ATTACHALL01', factory);
  const { handle, tree } = memoryFolder();
  await reopened.attach(handle);

  expect(filesIn(tree).get(`assets/${PICTURE}.png`)).toEqual(PNG);
});

test('a folder holding another file under one of the pictures is refused before any picture is written', async () => {
  const factory = new MemoryIndexedDb();
  const first = new ProjectAssets();
  await first.persistFor('p_REFUSEALL01', factory);
  await first.writeBytes(`assets/${PICTURE}.png`, PNG);
  await first.writeBytes(`assets/${OTHER}.png`, PNG);

  // A page after a reload: both pictures are in the browser's copy only, so the clash is found there and not in memory.
  const reopened = new ProjectAssets();
  await reopened.persistFor('p_REFUSEALL01', factory);
  const { handle, tree } = memoryFolder();
  const theirs = Uint8Array.from([1, 2, 3]);
  await folderBytes(handle).writeBytes(`assets/${PICTURE}.png`, theirs);

  await expect(reopened.attach(handle)).rejects.toThrow(`assets/${PICTURE}.png`);
  expect(reopened.hasFolder()).toBe(false);
  // Nothing was written: the other picture is not in the folder, and the clashing file is as it was.
  expect([...filesIn(tree).keys()]).toEqual([`assets/${PICTURE}.png`]);
  expect(filesIn(tree).get(`assets/${PICTURE}.png`)).toEqual(theirs);
});

test('a bundle made from the projects list reads the browser’s copy of the pictures, with no session open', async () => {
  const factory = new MemoryIndexedDb();
  globals['indexedDB'] = factory;
  const store = await openRuntimeStore(new MemoryIndexedDb());
  const state = manuscript('Listed Book');
  const session = new ProjectSession({ store, projectId: state.manifest.project.id, state, shadow: null });
  expect((await session.importCover(PNG)).ok).toBe(true);
  await session.settle();

  // The projects list has no session for the project, so the bundle is made from the browser's copy alone.
  const bundle = await exportStoredBundle(store, state.manifest.project.id);
  expect(bundle.notices).toEqual([]);
  const pictures = [...zipEntries(bundle.bytes).keys()].filter((name) => name.startsWith('assets/'));
  expect(pictures).toHaveLength(1);
});

test('a folder opened here puts its pictures into the browser’s copy, so a later open from the list still has them', async () => {
  const factory = new MemoryIndexedDb();
  globals['indexedDB'] = factory;
  const store = await openRuntimeStore(new MemoryIndexedDb());
  const state = manuscript('Folder Book');
  const { handle } = memoryFolder();
  await writeProject(folderArtifactFs(handle), state, { now: NOW });
  await folderBytes(handle).writeBytes(`assets/${PICTURE}.png`, PNG);

  const opened = await openedOf(openFolder(store, handle));
  await opened.session.close();

  // A later open from the list has no folder, so it reads the browser's copy, which must now hold the picture.
  const later = new ProjectAssets();
  await later.persistFor(state.manifest.project.id, factory);
  expect(later.presentIds().has(PICTURE)).toBe(true);
});
