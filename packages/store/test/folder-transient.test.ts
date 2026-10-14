/**
 * The digest read a folder save and the MCP server share (folder-digests.ts `digestOfFile`), and the words a change is named in. A brief
 * hold on a file by another program (EBUSY, EPERM, EACCES on Windows) is retried, so it is not read as a change or as a failed save.
 * Any other failure, and a hold that outlasts the retries, is passed on.
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryArtifactFs,
  changesInWords,
  createEmptyManifest,
  createProjectState,
  digestOfBytes,
  digestOfFile,
  driftOf,
  isTransientFileError,
  joinWords,
  projectFileDigests,
} from '../src/index.js';

const STAMP = new Date('2026-10-14T09:00:00.000Z');
const ENC = new TextEncoder();
const PATH = 'docs/n_KEEP000001.md';

/**
 * A memory folder whose first `failures` reads of `path` fail with `code`, as a file another program briefly holds does. The reads that
 * follow are the real ones. Returns how many failures are left to give.
 */
function briefHold(fs: MemoryArtifactFs, failures: number, code: string): () => number {
  let left = failures;
  const real = fs.readBytes.bind(fs);
  fs.readBytes = async (path: string): Promise<Uint8Array> => {
    if (path === PATH && left > 0) {
      left -= 1;
      throw Object.assign(new Error(`${code}: the file is held`), { code });
    }
    return real(path);
  };
  return () => left;
}

describe('a brief hold on a project file is retried, and is not read as a change', () => {
  it('reads the file once another program has let go of it, after a few transient failures', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(PATH, 'The ferry was late.');
    const left = briefHold(fs, 3, 'EBUSY');
    expect(await digestOfFile(fs, PATH)).toBe(await digestOfBytes(ENC.encode('The ferry was late.')));
    expect(left()).toBe(0);
  });

  it('gives up after the retries and passes the transient error on, so a hold that never ends is not read as a file that is gone', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(PATH, 'The ferry was late.');
    const left = briefHold(fs, 100, 'EPERM');
    await expect(digestOfFile(fs, PATH)).rejects.toMatchObject({ code: 'EPERM' });
    // Six attempts in all: the first and five retries.
    expect(left()).toBe(100 - 6);
  });

  it('passes any other read failure on at once, with no retry', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(PATH, 'The ferry was late.');
    const left = briefHold(fs, 100, 'ENOSPC');
    await expect(digestOfFile(fs, PATH)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(left()).toBe(99);
  });

  it('still reads a file the folder does not hold as absent, without a retry', async () => {
    const fs = new MemoryArtifactFs();
    expect(await digestOfFile(fs, 'docs/n_NONE000001.md')).toBeUndefined();
  });

  it('names the transient codes the retry and the MCP server’s read both use', () => {
    expect(isTransientFileError(Object.assign(new Error('x'), { code: 'EBUSY' }))).toBe(true);
    expect(isTransientFileError(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe(true);
    expect(isTransientFileError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(true);
    expect(isTransientFileError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
    expect(isTransientFileError(new Error('x'))).toBe(false);
    expect(isTransientFileError(undefined)).toBe(false);
  });
});

describe('a change is said in one set of words, shared by the folder question and the MCP server’s refusals', () => {
  it('joins items as a sentence does: one, two and three', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b'])).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('names each changed, removed and added file by its title, and joins them', async () => {
    const state = createProjectState(createEmptyManifest('Words Book', STAMP));
    const held = await projectFileDigests(new MemoryArtifactFs());
    expect(changesInWords(driftOf(held, new Map()), state, new Map(), 'this server')).toBe('');

    const before = new Map([
      ['docs/n_KEEP000001.md', 'aaa'],
      ['docs/n_GONE000001.md', 'bbb'],
    ]);
    const now = new Map([
      ['docs/n_KEEP000001.md', 'ccc'],
      ['docs/n_NEW0000001.md', 'ddd'],
    ]);
    // Neither file's id is in the state, so each is described by the holder, and no id or file name reaches the words.
    expect(changesInWords(driftOf(before, now), state, new Map(), 'this server')).toBe(
      'changed a document this server does not hold, removed a document this server does not hold and added a document this server does not hold',
    );
  });
});
