/**
 * The single-writer lock: one live writer per folder, a stale lock taken over, and a
 * lock never removed by a process that does not hold it.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { acquireProjectLock, LOCK_FILE, ProjectLockedError } from '../src/index.js';
import { removeDir, tempDir } from './support.js';

/** A pid that belonged to a process which has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  await new Promise<void>((done) => child.once('exit', () => done()));
  if (pid === undefined) throw new Error('could not start a child process');
  return pid;
}

describe('the project lock', () => {
  let root: string;

  beforeAll(() => {
    root = tempDir('lock');
  });

  afterAll(() => {
    removeDir(root);
  });

  it('is created while held, and removed on release', async () => {
    const lock = await acquireProjectLock(root);
    expect(existsSync(join(root, LOCK_FILE))).toBe(true);
    const holder = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')) as { pid: number };
    expect(holder.pid).toBe(process.pid);
    await lock.release();
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  });

  it('refuses a second writer while the first is alive, and names the holder', async () => {
    const first = await acquireProjectLock(root);
    try {
      const error = await acquireProjectLock(root).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ProjectLockedError);
      expect((error as ProjectLockedError).holderPid).toBe(process.pid);
    } finally {
      await first.release();
    }
  });

  it('takes over a lock whose holder has exited', async () => {
    const pid = await deadPid();
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid, token: 'gone', startedAt: new Date().toISOString() }));
    const lock = await acquireProjectLock(root);
    const holder = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8')) as { pid: number };
    expect(holder.pid).toBe(process.pid);
    await lock.release();
  });

  it('does not remove a lock it no longer holds', async () => {
    const lock = await acquireProjectLock(root);
    writeFileSync(join(root, LOCK_FILE), JSON.stringify({ pid: process.pid, token: 'someone-else', startedAt: 'x' }));
    await lock.release();
    expect(existsSync(join(root, LOCK_FILE))).toBe(true);
    lock.releaseSync();
    expect(existsSync(join(root, LOCK_FILE))).toBe(true);
    writeFileSync(join(root, LOCK_FILE), '');
  });

  it('treats an unreadable lock that was just written as a write in progress, and an old one as stale', async () => {
    const recent = join(root, LOCK_FILE);
    writeFileSync(recent, '{"pid":');
    await expect(acquireProjectLock(root)).rejects.toBeInstanceOf(ProjectLockedError);

    const old = new Date(Date.now() - 60_000);
    utimesSync(recent, old, old);
    const lock = await acquireProjectLock(root);
    await lock.release();
    expect(existsSync(recent)).toBe(false);
  });
});
