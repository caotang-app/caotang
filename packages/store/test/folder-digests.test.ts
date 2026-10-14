/**
 * The folder digests a save checks against (folder-digests.ts), and the per-file check a write makes against them (write.ts,
 * `WriteOptions.expectedDigests`). A project folder can be written by another program, so a save refuses to overwrite or remove a document
 * or codex file that changed since the writer held its digest, and it keeps the digests of the files it wrote and of none other.
 */

import { describe, expect, it } from 'vitest';

import {
  FolderDriftError,
  MANIFEST_FILE,
  MemoryArtifactFs,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  digestOfBytes,
  digestOfFile,
  digestsAfterWrite,
  driftOf,
  hasDrift,
  isProjectFile,
  projectFileChanges,
  projectFileDigests,
  projectFileLabel,
  projectFileTitles,
  removeNode,
  setBody,
  writeProject,
  type CodexEntry,
  type ProjectState,
} from '../src/index.js';

const STAMP = new Date('2026-10-13T09:00:00.000Z');
const CHAPTER = 'n_CHAPTR0001';
const KEPT = 'n_KEEP000001';
// Crockford base32 has no I, L, O or U: an id the check refuses is never pruned, so the deleted document is spelled without them.
const GONE = 'n_GRAVE00001';
const ELENA = 'c_5H8QK2M9RT';
const ENC = new TextEncoder();

function twoDocuments(): ProjectState {
  const state = createProjectState(createEmptyManifest('Digest Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'Kept', body: 'The ferry was late.', now: STAMP, id: KEPT });
  addDocument(state, { parentId: CHAPTER, title: 'Gone', body: 'Cut before the save.', now: STAMP, id: GONE });
  return state;
}

function elena(): CodexEntry {
  return {
    id: ELENA,
    name: 'Elena Voss',
    aliases: [],
    type: 'character',
    description: 'The lighthouse keeper’s daughter.',
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    createdAt: STAMP.toISOString(),
    updatedAt: STAMP.toISOString(),
  };
}

describe('digestOfBytes is the SHA-256 of the bytes', () => {
  it('matches the published SHA-256 of “abc”', async () => {
    expect(await digestOfBytes(ENC.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('the project files are the document bodies and the codex files, and nothing else', () => {
  it('digests the document and codex files of a project, and leaves the author’s own files out', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, twoDocuments(), { now: STAMP });
    await fs.writeAtomic('docs/notes.md', 'The author’s notes.\n');
    await fs.writeAtomic('codex/readme.md', 'Not a codex entry.\n');

    const digests = await projectFileDigests(fs);

    expect([...digests.keys()].sort()).toEqual([`docs/${GONE}.md`, `docs/${KEPT}.md`]);
  });

  it('names a body file or codex file by an id, and nothing else', () => {
    expect(isProjectFile(`docs/${KEPT}.md`)).toBe(true);
    expect(isProjectFile(`docs/${KEPT}.ink`)).toBe(true);
    expect(isProjectFile(`codex/${ELENA}.md`)).toBe(true);
    expect(isProjectFile('docs/notes.md')).toBe(false);
    expect(isProjectFile('codex/readme.md')).toBe(false);
    expect(isProjectFile(MANIFEST_FILE)).toBe(false);
    expect(isProjectFile(`exports/${KEPT}.md`)).toBe(false);
  });
});

describe('a folder is compared with the digests a writer holds', () => {
  it('names each file that changed, was removed, or was added, and an unchanged folder has no drift', () => {
    const held = new Map([
      ['docs/a.md', '1'],
      ['docs/b.md', '2'],
      ['docs/c.md', '3'],
    ]);
    const now = new Map([
      ['docs/a.md', '1'],
      ['docs/b.md', '9'],
      ['docs/d.md', '4'],
    ]);

    expect(driftOf(held, now)).toEqual({ changed: ['docs/b.md'], removed: ['docs/c.md'], added: ['docs/d.md'] });
    expect(hasDrift(driftOf(held, held))).toBe(false);
  });
});

describe('a write refuses to overwrite or remove a project file another program changed', () => {
  it('a body another program changed is not written over, and the manifest is not written either', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    const manifestBefore = fs.snapshot()[MANIFEST_FILE];
    const edited = 'Changed by another program.\n';
    await fs.writeAtomic(`docs/${KEPT}.md`, edited);
    setBody(state, KEPT, 'The words this writer holds.');

    const error = await writeProject(fs, state, { now: STAMP, expectedDigests: held }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FolderDriftError);
    expect((error as FolderDriftError).paths).toEqual([`docs/${KEPT}.md`]);
    expect(await fs.read(`docs/${KEPT}.md`)).toBe(edited);
    expect(fs.snapshot()[MANIFEST_FILE]).toBe(manifestBefore);
  });

  it('a save whose digests are current writes the body it changed, as before', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    setBody(state, KEPT, 'The words this writer holds, revised.');

    const report = await writeProject(fs, state, { now: STAMP, expectedDigests: held });

    expect(report.written).toContain(`docs/${KEPT}.md`);
    expect(await fs.read(`docs/${KEPT}.md`)).toContain('revised.');
  });

  it('a codex file another program added is kept, and the save that would prune it is refused', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    const added = `codex/c_5H8QK2M9RT.md`;
    await fs.writeAtomic(added, '---\nid: c_5H8QK2M9RT\nname: Written elsewhere\n---\n\nA codex entry nobody here made.\n');

    const error = await writeProject(fs, state, { now: STAMP, expectedDigests: held }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FolderDriftError);
    expect((error as FolderDriftError).paths).toEqual([added]);
    expect(await fs.exists(added)).toBe(true);
  });

  it('a deleted document another program changed is kept, and the manifest that stops naming it is already written', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    await fs.writeAtomic(`docs/${GONE}.md`, 'Edited by another program before the delete.\n');
    removeNode(state, GONE);

    const error = await writeProject(fs, state, { now: STAMP, pruneDocumentIds: [GONE], expectedDigests: held }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(FolderDriftError);
    expect(await fs.exists(`docs/${GONE}.md`)).toBe(true);
    // The manifest goes first (project-format §4): the partial report says so, and the next load recovers the kept file as an orphan.
    expect((error as FolderDriftError).partial.written).toContain(MANIFEST_FILE);
    expect((error as FolderDriftError).partial.pruned).toEqual([]);
  });

  it('without expectedDigests the writer overwrites a body another program changed, so the caller’s check must refuse first', async () => {
    // The store's writer is unguarded by design: it writes what the state holds, and a caller that holds no copy of the folder has nothing
    // to check against. The desktop's save and the MCP server both pass the digests they hold (lifecycle.ts, session.ts).
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    await fs.writeAtomic(`docs/${KEPT}.md`, 'Changed by another program.\n');

    await writeProject(fs, state, { now: STAMP });

    expect(await fs.read(`docs/${KEPT}.md`)).toContain('The ferry was late.');
  });
});

/** A folder whose first read of `path` fails as a file another program briefly holds fails on Windows (EBUSY). */
class BusyOnceFs extends MemoryArtifactFs {
  private busy: boolean;

  constructor(private readonly busyPath: string) {
    super();
    this.busy = false;
  }

  holdNextRead(): void {
    this.busy = true;
  }

  override async readBytes(path: string): Promise<Uint8Array> {
    if (this.busy && path === this.busyPath) {
      this.busy = false;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${path}'`), { code: 'EBUSY' });
    }
    return super.readBytes(path);
  }
}

describe('the write’s check reads each digest through the caller’s reader', () => {
  it('a file another program briefly holds does not fail the check: the default reader retries it, so the save is not refused', async () => {
    const fs = new BusyOnceFs(`docs/${KEPT}.md`);
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    setBody(state, KEPT, 'Written once the hold is let go.');

    // The one read of the document that the check makes is held, once, by another program. The default reader rides it out (digestOfFile).
    fs.holdNextRead();
    const report = await writeProject(fs, state, { now: STAMP, expectedDigests: held });

    expect(report.written).toContain(`docs/${KEPT}.md`);
    expect(await fs.read(`docs/${KEPT}.md`)).toContain('Written once the hold is let go.');
  });

  it('the folder’s digests and the digests after a write are read through the same reader', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const read: string[] = [];
    const recording = (path: string): Promise<string | undefined> => {
      read.push(path);
      return digestOfFile(fs, path);
    };

    const held = await projectFileDigests(fs, recording);
    setBody(state, KEPT, 'Changed words.');
    const report = await writeProject(fs, state, { now: STAMP, expectedDigests: held });
    read.length = 0;
    await digestsAfterWrite(fs, held, report, recording);

    expect(held.size).toBe(2);
    expect(read).toEqual([`docs/${KEPT}.md`]);
  });
});

describe('a changed project file is named in the writer’s words, never by id or file name', () => {
  it('names a document by its title and a codex entry by its name, and describes a file the writer does not hold with its own name', () => {
    const state = twoDocuments();
    state.manifest.codex = [elena()];

    const changes = projectFileChanges(
      { changed: [`docs/${KEPT}.md`], removed: [`codex/${ELENA}.md`], added: ['docs/n_B2C3D4E5F6.md', 'codex/c_B2C3D4E5F6.md'] },
      state,
      new Map(),
      'this copy',
    );

    expect(changes).toEqual([
      { label: 'the document “Kept”', change: 'changed' },
      { label: 'the codex entry “Elena Voss”', change: 'removed' },
      { label: 'a document this copy does not hold', change: 'added' },
      { label: 'a codex entry this copy does not hold', change: 'added' },
    ]);
  });

  it('a document the writer deleted is named by the title it held', () => {
    const state = twoDocuments();
    const held = projectFileTitles(state);
    removeNode(state, GONE);

    expect(projectFileLabel(`docs/${GONE}.md`, projectFileTitles(state), held, 'this server')).toBe('the document “Gone”');
  });
});

describe('the digests a writer keeps after a write name only the files the write named', () => {
  it('re-digests the file the write wrote, and keeps the digest of a file another program changed after it', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    setBody(state, KEPT, 'Changed words.');
    const report = await writeProject(fs, state, { now: STAMP, expectedDigests: held });
    await fs.writeAtomic(`docs/${GONE}.md`, 'Edited by another program after the save.\n');

    const next = await digestsAfterWrite(fs, held, report);

    expect(driftOf(next, await projectFileDigests(fs))).toEqual({ changed: [`docs/${GONE}.md`], removed: [], added: [] });
  });

  it('drops the digest of a document file the write removed, so the removal is not later taken for a change', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    await writeProject(fs, state, { now: STAMP });
    const held = await projectFileDigests(fs);
    removeNode(state, GONE);
    const report = await writeProject(fs, state, { now: STAMP, pruneDocumentIds: [GONE], expectedDigests: held });

    const next = await digestsAfterWrite(fs, held, report);

    expect(report.pruned).toEqual([`docs/${GONE}.md`]);
    expect(next.has(`docs/${GONE}.md`)).toBe(false);
    expect(hasDrift(driftOf(next, await projectFileDigests(fs)))).toBe(false);
  });
});

describe('a codex file is written only when its text changed (project-format §4, the changed-only rule)', () => {
  it('a save with nothing changed writes no codex file, and a changed entry writes its own file only', async () => {
    const fs = new MemoryArtifactFs();
    const state = twoDocuments();
    state.manifest.codex = [elena()];
    await writeProject(fs, state, { now: STAMP });
    const unchangedAt = fs.snapshot()[`codex/${ELENA}.md`];

    const quiet = await writeProject(fs, state, { now: STAMP });
    expect(quiet.written.filter((path) => path.startsWith('codex/'))).toEqual([]);

    const entry = state.manifest.codex?.[0];
    if (entry === undefined) throw new Error('the fixture has its entry');
    entry.description = 'A revised description.';
    const changed = await writeProject(fs, state, { now: STAMP });
    expect(changed.written.filter((path) => path.startsWith('codex/'))).toEqual([`codex/${ELENA}.md`]);
    expect(fs.snapshot()[`codex/${ELENA}.md`]).not.toBe(unchangedAt);
  });
});
