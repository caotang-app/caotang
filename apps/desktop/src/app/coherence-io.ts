/**
 * Where a project's `coherence.json` lives, and how it is loaded and saved (coherence.md §3, project-format §1 and §4).
 *
 * The file sits beside `caotang.json`, so two places can hold it in this build:
 * - **The project's row in the browser store**, which is the working copy of every project in this browser. The file is kept
 *   as the small set of text files the coherence module reads and writes (the file, its three snapshots and any kept corrupt
 *   copy), under the project's own row (`readCoherenceFiles` / `writeCoherenceFiles`, the store's home for it). Before the store
 *   had that home, the set lived under one app-database key; that key is read once, when the store has no set, and the first
 *   save moves the set into the store.
 * - **The open project folder**, when one is attached. A folder that already holds a `coherence.json` is the copy that is read
 *   at open, and every save is written to both places.
 *
 * Every write goes through the coherence module's own `saveCoherence`, so the rotation and the atomic write are the module's.
 *
 * Neither read can stop a project from opening, but neither failure is papered over:
 * - A stored set that cannot be read is never written over. The findings are shown empty, and the file is read-only until
 *   the project is opened again, since a save would replace the stored set with a partial one (coherence.md §3).
 * - A folder copy that cannot be read is left as it is, and the browser's copy is used. Findings are recomputable, so no single
 *   file should block a project.
 */

import { loadCoherence, reconcileCoherence, saveCoherence, type CoherenceFile, type LoadResult } from '@caotang/coherence';
import {
  MemoryArtifactFs,
  ProjectNotFoundError,
  readCoherenceFiles,
  writeCoherenceFiles,
  writeProjectState,
  type ArtifactFs,
  type ProjectState,
  type RuntimeStore,
} from '@caotang/store';

import { activeAppDb, type AppDb } from './app-db.js';
import { folderArtifactFs, type DirectoryHandleLike } from './fs-access.js';
import type { CoherencePort, ProjectSession } from './session.js';

/** The app-database key the findings file used before the store had a home for it. Read once, when the store has no set. */
export function legacyCoherenceKey(projectId: string): string {
  return `coherence:${projectId}`;
}

/**
 * An `ArtifactFs` over an in-memory set of files that writes its whole set to the store after each change. Reads and listings
 * come from memory; the only writes are `writeAtomic`, `writeBytesAtomic` and `remove`, and each one persists.
 */
class StoreArtifactFs implements ArtifactFs {
  constructor(
    private readonly files: MemoryArtifactFs,
    private readonly persist: () => Promise<void>,
  ) {}

  read(path: string): Promise<string> {
    return this.files.read(path);
  }

  async writeAtomic(path: string, contents: string): Promise<void> {
    await this.files.writeAtomic(path, contents);
    await this.persist();
  }

  listFiles(dir: string): Promise<string[]> {
    return this.files.listFiles(dir);
  }

  listDirs(dir: string): Promise<string[]> {
    return this.files.listDirs(dir);
  }

  exists(path: string): Promise<boolean> {
    return this.files.exists(path);
  }

  ensureDir(dir: string): Promise<void> {
    return this.files.ensureDir(dir);
  }

  async remove(path: string): Promise<void> {
    await this.files.remove(path);
    await this.persist();
  }

  readBytes(path: string): Promise<Uint8Array> {
    return this.files.readBytes(path);
  }

  async writeBytesAtomic(path: string, bytes: Uint8Array): Promise<void> {
    await this.files.writeBytesAtomic(path, bytes);
    await this.persist();
  }
}

/**
 * The mirror for one project: its files, read back from the store, and a persist step that writes them there. A set that could
 * not be read makes the mirror unreadable, and an unreadable mirror never writes: the stored set is then the only copy, and a
 * write of the partial set would replace it.
 */
async function openMirror(
  store: RuntimeStore,
  db: AppDb | null,
  projectId: string,
  state: ProjectState,
): Promise<{ fs: StoreArtifactFs; notice: string | null; readable: boolean }> {
  const files = new MemoryArtifactFs();
  let notice: string | null = null;
  let readable = true;
  let stored: Record<string, string> = {};
  try {
    stored = await readCoherenceFiles(store, projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      // A project whose row the store has not written yet (a project made this session) has no set to read. Its state is
      // written first, the same first write the session makes, so the set has a row to live on.
      await writeProjectState(store, state, { now: new Date() });
    } else {
      readable = false;
      notice =
        `The findings file could not be read from this browser: ${messageOf(error)}. The findings are shown empty, and nothing is saved ` +
        'over the stored file until the project is opened again.';
    }
  }
  if (readable && Object.keys(stored).length === 0 && db !== null) {
    // The interim home. A record that cannot be read there is not the store's failure, so it is simply not used.
    try {
      const legacy = await db.get<Record<string, string>>(legacyCoherenceKey(projectId));
      if (legacy !== undefined && legacy !== null) stored = legacy;
    } catch {
      // Left out on purpose: the store is the home, and a legacy copy that cannot be read is no reason to stop.
    }
  }
  for (const [path, text] of Object.entries(stored)) {
    if (typeof text === 'string') await files.writeAtomic(path, text);
  }
  const fs = new StoreArtifactFs(files, async () => {
    if (readable) await writeCoherenceFiles(store, projectId, files.snapshot());
  });
  return { fs, notice, readable };
}

/** A folder's copy of the findings file, read, and ready to be written. */
interface FolderCopy {
  readonly fs: ArtifactFs;
  readonly load: LoadResult;
}

/**
 * Reads the open folder's findings file. A read that fails is thrown with the file named, and the folder is not touched: the
 * caller decides what the writer is told.
 */
async function readFolderCopy(root: DirectoryHandleLike): Promise<FolderCopy> {
  const fs = folderArtifactFs(root);
  try {
    return { fs, load: await loadCoherence(fs) };
  } catch (error) {
    throw new Error(`coherence.json in the project folder could not be read: ${messageOf(error)}. The folder's copy is left as it is.`, {
      cause: error,
    });
  }
}

/**
 * Loads a project's coherence file and attaches it to the session. Called once when the project is opened, before the
 * session is shown, so the findings tab and the scene declarations read the file from their first render.
 */
export async function attachCoherence(session: ProjectSession, store: RuntimeStore, folder: DirectoryHandleLike | null = null): Promise<void> {
  const db = activeAppDb();
  const mirror = await openMirror(store, db, session.projectId, session.state);
  const mirrorLoad = await loadCoherence(mirror.fs);

  let load: LoadResult = mirrorLoad;
  let folderTarget: FolderCopy | null = null;
  const notices: string[] = mirror.notice === null ? [] : [mirror.notice];
  if (folder !== null) {
    try {
      folderTarget = await readFolderCopy(folder);
      // A folder that holds a file is the copy the writer put there, so it wins over the browser's copy.
      if (folderTarget.load.status !== 'absent') load = folderTarget.load;
    } catch (error) {
      // The folder stays out of the saves for this session; the browser's copy is what is shown and saved.
      notices.push(`${messageOf(error)} Findings are kept in this browser.`);
    }
  }

  // Saves are refused for a file that cannot be written, which is a newer file or an unreadable stored set.
  const writable = load.writable && mirror.readable;
  const reconciled = reconcileCoherence(load.file, session.state);
  const messages = [...notices, ...load.notices.map((notice) => notice.message), ...reconciled.notices.map((notice) => notice.message)];
  const port: CoherencePort = {
    save: async (file: CoherenceFile): Promise<void> => {
      if (!mirror.readable) {
        throw new Error('the findings file could not be read when the project opened, so it is not saved over. Reopen the project to save again.');
      }
      await saveCoherence(mirror.fs, mirrorLoad, file);
      if (folderTarget !== null) await saveCoherence(folderTarget.fs, folderTarget.load, file);
    },
    attachFolder: async (root: DirectoryHandleLike, file: CoherenceFile): Promise<void> => {
      // The folder is written only after its own copy has been read, so a copy that cannot be read is never overwritten.
      const copy = await readFolderCopy(root);
      await saveCoherence(copy.fs, copy.load, file);
      folderTarget = copy;
    },
  };
  session.attachCoherence({ file: reconciled.file, writable, notices: messages }, port);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
