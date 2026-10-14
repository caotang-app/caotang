/**
 * The folder writer's two data-safety rules that a save depends on (write.ts header, rules 1 and 3):
 *
 *   - a body the file already holds is not written again, so a save touches only the documents that changed (and
 *     project-format §4); and
 *   - a deleted document's file is removed only after the manifest that stops naming it has been written, so a failure between the
 *     two can never leave a manifest that names a file which is gone (the fatal load of project-format §4).
 */

import { describe, expect, it } from 'vitest';

import {
  MANIFEST_FILE,
  MemoryArtifactFs,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  readProject,
  removeNode,
  setBody,
  writeProject,
  type ProjectState,
} from '../src/index.js';

const STAMP = new Date('2026-10-08T09:00:00.000Z');
const CHAPTER = 'n_CHAPTR0001';
const KEPT = 'n_KEEP000001';
// Crockford base32 has no I, L, O or U, so the deleted document's id is spelled without them: an id the check refuses is never pruned.
const GONE = 'n_GRAVE00001';

/** An in-memory folder that counts every atomic write by path, and can be told to refuse the manifest's write. */
class CountingFs extends MemoryArtifactFs {
  readonly writes = new Map<string, number>();
  refuseManifest = false;

  override async writeAtomic(path: string, contents: string): Promise<void> {
    this.writes.set(path, (this.writes.get(path) ?? 0) + 1);
    if (this.refuseManifest && path === MANIFEST_FILE) throw new Error('simulated failure before the manifest was written');
    return super.writeAtomic(path, contents);
  }
}

function twoDocuments(): ProjectState {
  const state = createProjectState(createEmptyManifest('Integrity Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'Kept', body: 'The ferry was late.', now: STAMP, id: KEPT });
  addDocument(state, { parentId: CHAPTER, title: 'Gone', body: 'Cut before the save.', now: STAMP, id: GONE });
  return state;
}

describe('a save writes the documents that changed, and no others', () => {
  it('a body the file already holds is not written again', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    fs.writes.clear();

    setBody(state, KEPT, 'The ferry was late, and the light was late with it.');
    const report = await writeProject(fs, state, { now: STAMP });

    expect(fs.writes.get(`docs/${KEPT}.md`)).toBe(1);
    expect(fs.writes.get(`docs/${GONE}.md`)).toBeUndefined();
    expect(report.written).toContain(`docs/${KEPT}.md`);
    expect(report.written.some((path) => path === `docs/${GONE}.md`)).toBe(false);
  });

  it('a save with nothing changed writes no document at all', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    fs.writes.clear();

    const report = await writeProject(fs, state, { now: STAMP });

    expect(report.written.filter((path) => path.startsWith('docs/'))).toEqual([]);
    expect([...fs.writes.keys()].filter((path) => path.startsWith('docs/'))).toEqual([]);
  });

  it('the store’s own writer, given no digests, writes over a body another program changed: that is its unguarded behaviour, so the caller’s guard must refuse first (folder-digests.test.ts refuses it with expectedDigests)', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    await fs.writeAtomic(`docs/${KEPT}.md`, 'Changed by another program.\n');

    await writeProject(fs, state, { now: STAMP });

    expect(await fs.read(`docs/${KEPT}.md`)).toContain('The ferry was late.');
  });
});

describe('a deleted document’s file goes after the manifest that stops naming it', () => {
  it('a manifest write that fails leaves the deleted file in place, and the project still loads', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });

    removeNode(state, GONE);
    fs.refuseManifest = true;
    await expect(writeProject(fs, state, { now: STAMP, pruneDocumentIds: [GONE] })).rejects.toThrow('simulated failure');

    // The manifest on disk still names the document, and its file is still there: the project loads.
    expect(await fs.exists(`docs/${GONE}.md`)).toBe(true);
    const loaded = await readProject(fs, { now: STAMP });
    expect(loaded.state.documents.has(GONE)).toBe(true);
  });

  it('the next save that succeeds removes the file, and the manifest and the folder agree', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    removeNode(state, GONE);
    fs.refuseManifest = true;
    await expect(writeProject(fs, state, { now: STAMP, pruneDocumentIds: [GONE] })).rejects.toThrow('simulated failure');

    fs.refuseManifest = false;
    const report = await writeProject(fs, state, { now: STAMP, pruneDocumentIds: [GONE] });

    expect(report.pruned).toContain(`docs/${GONE}.md`);
    expect(await fs.exists(`docs/${GONE}.md`)).toBe(false);
    const loaded = await readProject(fs, { now: STAMP });
    expect(loaded.state.documents.has(KEPT)).toBe(true);
    expect(loaded.state.documents.has(GONE)).toBe(false);
    // A file the save did not name is left where it is.
    expect(await fs.exists(`docs/${KEPT}.md`)).toBe(true);
  });

  it('a save that names no deleted document removes nothing from docs/', async () => {
    const fs = new CountingFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    removeNode(state, GONE);

    const report = await writeProject(fs, state, { now: STAMP, pruneDocumentIds: [] });

    expect(report.pruned.filter((path) => path.startsWith('docs/'))).toEqual([]);
    expect(await fs.exists(`docs/${GONE}.md`)).toBe(true);
  });
});
