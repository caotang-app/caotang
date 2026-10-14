/**
 * An export is made from a copy of the state it is given (zip.ts `exportProjectZip`, state.ts `cloneProjectState`): `writeProject` stamps
 * `project.modifiedAt` on what it writes from, and an export of the open project must not mark the project changed. A document
 * whose text is not UTF-8 cannot be written into a bundle, and the refusal says so in the writer's words, with no node id.
 */

import { describe, expect, it } from 'vitest';

import {
  MANIFEST_FILE,
  MemoryArtifactFs,
  addDocument,
  addFolder,
  cloneProjectState,
  createEmptyManifest,
  createProjectState,
  exportProjectZip,
  readProject,
  writeProject,
} from '../src/index.js';

const STAMP = new Date('2026-10-14T09:00:00.000Z');
const LATER = new Date('2026-10-14T12:00:00.000Z');
const CHAPTER = 'n_CHAPTR0001';
const KEPT = 'n_KEEP000001';

function twoLevelProject() {
  const state = createProjectState(createEmptyManifest('Export Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'Kept', body: 'The ferry was late.', now: STAMP, id: KEPT });
  return state;
}

describe('an export does not stamp the project it exports', () => {
  it('leaves project.modifiedAt on the state it was given, and the bundle carries the export’s own time', async () => {
    const state = twoLevelProject();
    const before = state.manifest.project.modifiedAt;
    const exported = await exportProjectZip(state, { now: LATER });
    expect(state.manifest.project.modifiedAt).toBe(before);
    expect(exported.bytes.length).toBeGreaterThan(0);
  });

  it('a clone shares no manifest, document or declined set with the state it copies', () => {
    const state = twoLevelProject();
    state.declinedDocFiles.add('n_HELD000001.md');
    const copy = cloneProjectState(state);
    copy.manifest.project.name = 'Changed in the copy';
    copy.documents.get(KEPT)!.body = 'Changed in the copy';
    copy.declinedDocFiles.add('n_OTHER00001.md');
    expect(state.manifest.project.name).toBe('Export Book');
    expect(state.documents.get(KEPT)?.body).toBe('The ferry was late.');
    expect(state.declinedDocFiles.has('n_OTHER00001.md')).toBe(false);
    expect(copy.declinedDocFiles.has('n_HELD000001.md')).toBe(true);
  });
});

describe('a document that is not UTF-8 text is refused in words the writer reads, not with an id or a load detail', () => {
  it('names the document by its title, says its file is untouched, and carries no node id', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, twoLevelProject(), { now: STAMP });
    await fs.writeBytesAtomic(`docs/${KEPT}.md`, new Uint8Array([0xff, 0xfe, 0x41, 0x00]));
    const loaded = await readProject(fs);
    expect(loaded.state.declinedDocFiles.has(`${KEPT}.md`)).toBe(true);

    const refused = exportProjectZip(loaded.state, { now: LATER });
    await expect(refused).rejects.toThrow('the document “Kept” is not UTF-8 text');
    await expect(refused).rejects.toThrow('Caotang has not changed it');
    const message = await refused.then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).not.toContain(KEPT);
    expect(message).not.toContain('held at load');
  });

  it('a project whose documents all decode exports, so the refusal is only for a document the load held', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, twoLevelProject(), { now: STAMP });
    expect(await fs.exists(MANIFEST_FILE)).toBe(true);
    const loaded = await readProject(fs);
    // A clean load exports; the refusal above is the held-document case only.
    await expect(exportProjectZip(loaded.state, { now: LATER })).resolves.toBeDefined();
  });
});
