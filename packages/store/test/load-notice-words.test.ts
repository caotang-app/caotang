/**
 * The writer's sentence a load notice carries (read.ts `LoadNotice.say`). An open quotes these to the writer and counts the
 * notices that have none, so each one has to be a whole sentence in plain words: a capital, a full stop, an item named by its title, and
 * no path, id or spec section.
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
  writeProject,
  type LoadNotice,
} from '../src/index.js';

const STAMP = new Date('2026-10-14T09:00:00.000Z');
const CHAPTER = 'n_CHAPTR0001';
const KEPT = 'n_KEEP000001';
const LOST = 'n_MSSNG00001';

/** A folder holding one chapter and two documents, written by the store's own writer. */
async function folder(): Promise<MemoryArtifactFs> {
  const fs = new MemoryArtifactFs();
  const state = createProjectState(createEmptyManifest('Words Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'Kept', body: 'The ferry was late.', now: STAMP, id: KEPT });
  addDocument(state, { parentId: CHAPTER, title: 'Lost Scene', body: 'Nobody came.', now: STAMP, id: LOST });
  await writeProject(fs, state, { now: STAMP });
  return fs;
}

async function editManifest(fs: MemoryArtifactFs, change: (manifest: Record<string, unknown>) => void): Promise<void> {
  const manifest = JSON.parse(await fs.read(MANIFEST_FILE)) as Record<string, unknown>;
  change(manifest);
  fs.putFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

/** Asserts that a notice's sentence is one the writer can read: a whole sentence, with no path, id or spec section in it. */
function expectWritersWords(say: string): void {
  expect(say).toMatch(/^[A-Z“]/);
  expect(say).toMatch(/\.$/);
  expect(say).not.toMatch(/§|n_[A-Z0-9]|\.md\b|caotang\.json|manifest|front matter|UTF-8/);
}

function sayOf(notices: readonly LoadNotice[], path: string): string | undefined {
  return notices.find((notice) => notice.path === path)?.say;
}

describe('a load notice carries the writer’s sentence', () => {
  it('says the language and the identifier an open made, each as a whole sentence', async () => {
    const fs = await folder();
    await editManifest(fs, (manifest) => {
      const project = manifest.project as Record<string, unknown>;
      delete project.language;
      delete project.identifier;
    });
    const { notices } = await readProject(fs, { locale: 'en-GB' });
    const language = sayOf(notices, 'project.language');
    const identifier = sayOf(notices, 'project.identifier.uuid');
    expect(language).toBe('The project had no language, so it is set from the app’s language. You can change it in the project panel.');
    expect(identifier).toBe('The project had no book identifier for EPUB, so Caotang made one, and the project keeps it from now on.');
  });

  it('names a document found in the folder but not in the project by its title, not by its file', async () => {
    const fs = await folder();
    await editManifest(fs, (manifest) => {
      manifest.tree = (manifest.tree as { id: string }[]).filter((node) => node.id !== LOST);
    });
    const { notices } = await readProject(fs);
    const say = notices.find((notice) => notice.say?.includes('Lost Scene'))?.say;
    expect(say).toBe('“Lost Scene” was in the project’s folder but not in the project, so it is added under Recovered.');
    expectWritersWords(say!);
  });

  it('says a document whose file disagrees about its title by the title the project keeps, without the id', async () => {
    const fs = await folder();
    await editManifest(fs, (manifest) => {
      const node = (manifest.tree as { id: string; title: string }[]).find((item) => item.id === KEPT)!;
      node.title = 'Kept Again';
    });
    const { notices } = await readProject(fs);
    const say = notices.find((notice) => notice.say?.includes('Kept Again'))?.say;
    expect(say).toBe('The file for “Kept Again” disagrees with the project about its title. The project’s details are kept.');
    expectWritersWords(say!);
  });

  it('gives a validator warning no sentence, so an open counts it rather than quoting its terms', async () => {
    const fs = await folder();
    await editManifest(fs, (manifest) => {
      (manifest.project as Record<string, unknown>).author = 42;
    });
    const { notices } = await readProject(fs);
    const warning = notices.find((notice) => notice.path === 'project.author');
    expect(warning).toBeDefined();
    expect(warning!.say).toBeUndefined();
  });
});
