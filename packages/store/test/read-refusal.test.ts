/**
 * What a load does with a `caotang.json` it cannot take as it is (read.ts `readProject`): a manifest another app wrote, or one in a newer format,
 * is refused with the writer's words and nothing is rebuilt from it (project-format §3 step 2, §5). A damaged manifest is still a
 * `ProjectValidationError`, which the recovery ladder answers. The load's notices are sentences for a person, and only the unknown fields a
 * save drops are counted as dropped (`LoadNotice.droppedField`).
 */

import { describe, expect, it } from 'vitest';

import {
  MANIFEST_FILE,
  MemoryArtifactFs,
  ProjectRefusedError,
  ProjectValidationError,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  readProject,
  writeProject,
} from '../src/index.js';

const STAMP = new Date('2026-10-14T09:00:00.000Z');
const CHAPTER = 'n_CHAPTR0001';
const KEPT = 'n_KEEP000001';

/** A folder holding one chapter and one document, written by the store's own writer, so the load reads what a save leaves. */
async function folderWithDocument(): Promise<MemoryArtifactFs> {
  const fs = new MemoryArtifactFs();
  const state = createProjectState(createEmptyManifest('Refusal Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'Kept', body: 'The ferry was late.', now: STAMP, id: KEPT });
  await writeProject(fs, state, { now: STAMP });
  return fs;
}

/** The folder's `caotang.json`, as an object, with `change` applied and written back. */
async function editManifest(fs: MemoryArtifactFs, change: (manifest: Record<string, unknown>) => void): Promise<void> {
  const manifest = JSON.parse(await fs.read(MANIFEST_FILE)) as Record<string, unknown>;
  change(manifest);
  fs.putFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

describe('a manifest this build refuses to open is refused, not rebuilt', () => {
  it('refuses a caotang.json in a format newer than this build, and names the newer Caotang', async () => {
    const fs = await folderWithDocument();
    await editManifest(fs, (manifest) => {
      manifest.formatVersion = 2;
    });
    const refused = readProject(fs);
    await expect(refused).rejects.toBeInstanceOf(ProjectRefusedError);
    await expect(refused).rejects.toThrow('format version 2');
    await expect(refused).rejects.toThrow('newer Caotang');
    await expect(refused).rejects.toThrow('Nothing was written');
  });

  it('refuses a caotang.json that names another app, and says what it names', async () => {
    const fs = await folderWithDocument();
    await editManifest(fs, (manifest) => {
      manifest.app = 'other';
    });
    const refused = readProject(fs);
    await expect(refused).rejects.toBeInstanceOf(ProjectRefusedError);
    await expect(refused).rejects.toThrow('the app “other”');
    await expect(refused).rejects.toThrow('not a Caotang project');
  });

  it('keeps a damaged caotang.json on the recovery ladder: a version below the first format is a validation failure, not a refusal', async () => {
    const fs = await folderWithDocument();
    await editManifest(fs, (manifest) => {
      manifest.formatVersion = 0;
    });
    const failure = await readProject(fs).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProjectValidationError);
    expect(failure).not.toBeInstanceOf(ProjectRefusedError);
  });

  it('a manifest in this build’s own format loads', async () => {
    const fs = await folderWithDocument();
    const loaded = await readProject(fs);
    expect(loaded.state.documents.get(KEPT)?.body).toBe('The ferry was late.');
  });
});

describe('the load’s notices: each is a sentence, and only the fields a save drops are counted as dropped', () => {
  it('marks each unknown field as dropped on the next save, and nothing else', async () => {
    const fs = await folderWithDocument();
    await editManifest(fs, (manifest) => {
      manifest.colour = 'teal';
    });
    const loaded = await readProject(fs);
    const dropped = loaded.notices.filter((notice) => notice.droppedField !== undefined);
    expect(dropped.map((notice) => notice.droppedField)).toEqual(['colour']);
    expect(loaded.notices.filter((notice) => notice.droppedField === undefined)).toEqual([]);
  });

  it('a project with no unknown field has no dropped field', async () => {
    const loaded = await readProject(await folderWithDocument());
    expect(loaded.notices.some((notice) => notice.droppedField !== undefined)).toBe(false);
  });

  it('a document whose text is not UTF-8 is named by its title, and its id is not in the sentence', async () => {
    const fs = await folderWithDocument();
    await fs.writeBytesAtomic(`docs/${KEPT}.md`, new Uint8Array([0xff, 0xfe, 0x41, 0x00]));
    const loaded = await readProject(fs);
    expect(loaded.state.declinedDocFiles.has(`${KEPT}.md`)).toBe(true);
    const notice = loaded.notices.find((item) => item.message.includes('is not UTF-8 text'));
    expect(notice?.message).toContain('“Kept”');
    expect(notice?.message).not.toContain(KEPT);
    expect(notice?.droppedField).toBeUndefined();
  });

  it('the bytes of the held document are left on disk untouched', async () => {
    const fs = await folderWithDocument();
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
    await fs.writeBytesAtomic(`docs/${KEPT}.md`, bytes);
    await readProject(fs);
    expect(await fs.readBytes(`docs/${KEPT}.md`)).toEqual(bytes);
  });
});
