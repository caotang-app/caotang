/**
 * Each project's folder, remembered. When a project is
 * saved to a folder, or opened from one as its own project, the folder's handle is kept in the app database under the project's id, so
 * the projects list can reopen the folder with one click. The handle is the browser's own `FileSystemDirectoryHandle`, which IndexedDB
 * stores as it is (a structured clone). The browser may ask the writer for permission again when the folder is reopened. The record holds
 * no path and no file: the browser alone can turn it back into the folder.
 *
 * Two small records sit beside the handle, under the project's id: the folder copy Caotang last opened or saved there (`folder-copy:`), so a
 * save after a reload is checked against it rather than asked about, and, for a separate copy, the project it was copied from
 * (`copied-from:`), so the copy is still refused in that project's folder after a reload (lifecycle `saveFolder`).
 *
 * Every call is best effort. A browser without folder access never reaches here, no database means nothing is remembered, and a failed
 * read or write leaves the writer with the folder picker, which is how a folder was opened before.
 */

import { activeAppDb, type AppDb } from './app-db.js';
import type { DirectoryHandleLike } from './fs-access.js';

/** The key a project's folder is kept under. */
export function folderKey(projectId: string): string {
  return `folder:${projectId}`;
}

/**
 * Whether a folder lives in the origin's private file system (`navigator.storage.getDirectory()`), rather than on the writer's disk. No
 * folder picker hands one out; the end-to-end suite's stand-in picker does. Such a folder is not remembered: Chromium closes the page when
 * it reads one of these handles back from IndexedDB in a private (off-the-record) profile, which is what a test browser runs in (measured
 * on Chromium 153, build 1243; a handle read back in an ordinary profile works). The suite turns the guard off, in an ordinary
 * profile, with `caotangRememberPrivateFolders` on the page.
 */
async function inPrivateFileSystem(folder: DirectoryHandleLike): Promise<boolean> {
  if ((globalThis as { caotangRememberPrivateFolders?: unknown }).caotangRememberPrivateFolders === true) return false;
  const storage = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<unknown> } } }).navigator?.storage;
  if (typeof storage?.getDirectory !== 'function') return false;
  try {
    const root = (await storage.getDirectory()) as { resolve?: (handle: unknown) => Promise<readonly string[] | null> };
    return typeof root.resolve === 'function' && (await root.resolve(folder)) !== null;
  } catch {
    return false;
  }
}

/** Keeps the folder for the project. A failure is swallowed: the folder is still saved or open, and only the shortcut is missing. */
export async function rememberFolder(projectId: string, folder: DirectoryHandleLike, db: AppDb | null = activeAppDb()): Promise<void> {
  if (db === null) return;
  if (await inPrivateFileSystem(folder)) return;
  try {
    await db.put(folderKey(projectId), folder);
  } catch {
    // A handle this browser cannot store (a stand-in in a test) leaves no shortcut, and nothing else changes.
  }
}

/** The folder kept for the project, or `null` when there is none or it cannot be read. */
export async function rememberedFolder(projectId: string, db: AppDb | null = activeAppDb()): Promise<DirectoryHandleLike | null> {
  if (db === null) return null;
  try {
    const value = await db.get<DirectoryHandleLike | null>(folderKey(projectId));
    return isDirectoryHandle(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Forgets the project's folder, as the project leaves this browser, with the folder copy and the copy-of record kept beside it. The records
 * are emptied, since the database keeps one value per key.
 */
export async function forgetFolder(projectId: string, db: AppDb | null = activeAppDb()): Promise<void> {
  if (db === null) return;
  for (const key of [folderKey(projectId), folderCopyKey(projectId), copiedFromKey(projectId)]) {
    try {
      await db.put(key, null);
    } catch {
      // Nothing to do: a record that stays names a folder the list offers only for a project that exists.
    }
  }
}

/** The key a project's last known folder copy is kept under (`rememberFolderCopy`). */
export function folderCopyKey(projectId: string): string {
  return `folder-copy:${projectId}`;
}

/** The key the project a copy was made from is kept under (`rememberCopiedFrom`). */
export function copiedFromKey(projectId: string): string {
  return `copied-from:${projectId}`;
}

/**
 * What a project's folder held when this browser last opened it as the project's own or saved to it: the folder's name, its `caotang.json`
 * text, the body nodes that copy named, and the digest and title of each document and codex file (lifecycle `FolderBaseline`). Kept as JSON
 * (pairs, not maps), so a save after a reload is still checked against the folder as Caotang last left it rather than asked about as unknown.
 */
export interface RememberedFolderCopy {
  readonly folderName: string;
  readonly manifestText: string;
  readonly documentIds: readonly string[];
  readonly digests: readonly (readonly [string, string])[];
  readonly titles: readonly (readonly [string, string])[];
}

/** Keeps the project's last known folder copy. Best effort, like the folder itself: a failure leaves a later save to ask instead. */
export async function rememberFolderCopy(projectId: string, copy: RememberedFolderCopy, db: AppDb | null = activeAppDb()): Promise<void> {
  if (db === null) return;
  try {
    await db.put(folderCopyKey(projectId), copy);
  } catch {
    // A later save after a reload asks about the folder, which is the safe side.
  }
}

/** The project's last known folder copy, or `null` when none is kept or it cannot be read. */
export async function rememberedFolderCopy(projectId: string, db: AppDb | null = activeAppDb()): Promise<RememberedFolderCopy | null> {
  if (db === null) return null;
  try {
    const value = await db.get<RememberedFolderCopy | null>(folderCopyKey(projectId));
    return isFolderCopy(value) ? value : null;
  } catch {
    return null;
  }
}

/** Records that `projectId` is a separate copy of `originalId` (lifecycle `adopt`), so the refusal to save it into the original's folder survives a reload. */
export async function rememberCopiedFrom(projectId: string, originalId: string, db: AppDb | null = activeAppDb()): Promise<void> {
  if (db === null) return;
  try {
    await db.put(copiedFromKey(projectId), originalId);
  } catch {
    // The session still knows it until the tab reloads.
  }
}

/** The project `projectId` was copied from, or `null` when it is no copy or the record cannot be read. */
export async function copiedFromOf(projectId: string, db: AppDb | null = activeAppDb()): Promise<string | null> {
  if (db === null) return null;
  try {
    const value = await db.get<string | null>(copiedFromKey(projectId));
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function isPairs(value: unknown): value is (readonly [string, string])[] {
  return Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string');
}

function isFolderCopy(value: unknown): value is RememberedFolderCopy {
  if (typeof value !== 'object' || value === null) return false;
  const copy = value as Partial<Record<keyof RememberedFolderCopy, unknown>>;
  return (
    typeof copy.folderName === 'string' &&
    typeof copy.manifestText === 'string' &&
    Array.isArray(copy.documentIds) &&
    copy.documentIds.every((id) => typeof id === 'string') &&
    isPairs(copy.digests) &&
    isPairs(copy.titles)
  );
}

function isDirectoryHandle(value: unknown): value is DirectoryHandleLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'directory' &&
    typeof (value as { entries?: unknown }).entries === 'function'
  );
}

/** What a handle answers about its permission, where the browser has the two calls (`FileSystemHandle.queryPermission`, `requestPermission`). */
interface PermissionHandle {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/**
 * The remembered folder, ready to read and write, or `null` when it is not: the writer refused the permission, or the folder is gone (it
 * was moved or deleted). `requestPermission` needs the click that asked for the reopen, so this is called straight from that click. The
 * folder is listed once, so a handle to a folder that no longer exists is found here rather than part way through the open.
 */
export async function folderWithPermission(folder: DirectoryHandleLike): Promise<DirectoryHandleLike | null> {
  const handle = folder as DirectoryHandleLike & PermissionHandle;
  try {
    const mode = { mode: 'readwrite' } as const;
    let state: PermissionState = (await handle.queryPermission?.(mode)) ?? 'granted';
    if (state !== 'granted') state = (await handle.requestPermission?.(mode)) ?? 'denied';
    if (state !== 'granted') return null;
    for await (const entry of folder.entries()) {
      void entry;
      break;
    }
    return folder;
  } catch {
    return null;
  }
}
