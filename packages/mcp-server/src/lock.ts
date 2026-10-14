/**
 * The single-writer lock — one writer per project folder at a time.
 *
 * A project folder is written by Caotang's desktop app and by this server, and a
 * second writer on the same folder would interleave manifest rotations and lose
 * one side's edits. The lock is a file in the folder, created exclusively
 * (`wx`) and removed on exit. It records the holder's pid so that a lock left
 * by a process that died is recognised and taken over, not honoured forever:
 * the server never sleeps on a stale lock, and it never removes a lock whose
 * holder is still alive.
 *
 * The file is `.caotang-mcp.lock` at the folder root. It is not one of §1's
 * artifact files, so the loader ignores it, and it is not in `docs/` or `codex/`,
 * so no save prunes it.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const LOCK_FILE = '.caotang-mcp.lock';

/** A lock younger than this, with no readable holder, is a write in progress and not a stale lock. */
const FRESH_MS = 5_000;

export class ProjectLockedError extends Error {
  constructor(
    readonly root: string,
    readonly holderPid: number | undefined,
  ) {
    const holder = holderPid === undefined ? '' : ` (pid ${holderPid})`;
    super(`the project folder ${root} is in use by another writer${holder}; one writer at a time, so this process did not open it`);
    this.name = 'ProjectLockedError';
  }
}

export interface ProjectLock {
  readonly path: string;
  /** Removes the lock if this process still holds it. */
  release(): Promise<void>;
  /** The same, synchronously, for an `exit` handler, which cannot await. */
  releaseSync(): void;
}

interface LockBody {
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

/** Whether a pid names a live process. `EPERM` means it exists but belongs to someone else. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseBody(text: string): LockBody | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { pid, token, startedAt } = value as Record<string, unknown>;
    if (typeof pid !== 'number' || typeof token !== 'string' || typeof startedAt !== 'string') return undefined;
    return { pid, token, startedAt };
  } catch {
    return undefined;
  }
}

/** Creates the lock file exclusively. `false` when it already exists. */
async function createExclusive(path: string, body: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(body, 'utf8');
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Takes the project's lock. Throws {@link ProjectLockedError} when a live process
 * holds it. A lock whose holder is gone is removed and the lock is taken once more.
 */
export async function acquireProjectLock(root: string, now: Date = new Date()): Promise<ProjectLock> {
  const path = join(root, LOCK_FILE);
  const token = randomUUID();
  const body = `${JSON.stringify({ pid: process.pid, token, startedAt: now.toISOString() }, null, 2)}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await createExclusive(path, body)) {
      return {
        path,
        release: () => releaseOwned(path, token),
        releaseSync: () => releaseOwnedSync(path, token),
      };
    }
    const holder = parseBody(await readFile(path, 'utf8').catch(() => ''));
    if (holder !== undefined) {
      if (processAlive(holder.pid)) throw new ProjectLockedError(root, holder.pid);
    } else if (Date.now() - (await stat(path).then((info) => info.mtimeMs).catch(() => 0)) < FRESH_MS) {
      // Unreadable and recent: another writer is between creating the file and writing it.
      throw new ProjectLockedError(root, undefined);
    }
    await unlink(path).catch(() => undefined);
  }
  throw new ProjectLockedError(root, undefined);
}

async function releaseOwned(path: string, token: string): Promise<void> {
  const holder = parseBody(await readFile(path, 'utf8').catch(() => ''));
  if (holder?.token !== token) return;
  await unlink(path).catch(() => undefined);
}

function releaseOwnedSync(path: string, token: string): void {
  let holder: LockBody | undefined;
  try {
    holder = parseBody(readFileSync(path, 'utf8'));
  } catch {
    return;
  }
  if (holder?.token !== token) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or the folder is no longer there: nothing left to remove.
  }
}
