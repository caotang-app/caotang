/**
 * A file whose bytes are not UTF-8 text. The state holds text only (state.ts), so the
 * loader holds such a file in place rather than decoding it lossily: the load keeps
 * the file, says which one it is, and no save writes over it (write.ts). Before this
 * the loader threw on the first one, so a Windows-1252 chapter stopped a project from
 * opening at all.
 */
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import {
  addDocument,
  createEmptyManifest,
  createProjectState,
  exportProjectZip,
  importProjectZip,
  MemoryArtifactFs,
  readProject,
  writeProject,
} from '../src/index.js';

const NOW = new Date('2026-10-02T15:00:00.000Z');
const ENC = new TextEncoder();
const BODY = 'The ferry was late.';

/** A project on disk, written by the real writer, with one document holding {@link BODY}. */
async function writtenProject(): Promise<{ fs: MemoryArtifactFs; docId: string }> {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', NOW), { now: NOW });
  const node = addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: BODY, now: NOW });
  const fs = new MemoryArtifactFs();
  await writeProject(fs, state, { now: NOW });
  return { fs, docId: node.id };
}

/**
 * The file the writer left, with {@link BODY} replaced by Windows-1252 bytes: `é` is
 * 0xE9 there, and 0xE9 on its own is not UTF-8. The front matter stays as written.
 */
function withWindows1252Body(text: string): Uint8Array {
  const at = text.indexOf(BODY);
  if (at < 0) throw new Error('the fixture body is not in the file');
  return Buffer.concat([
    Buffer.from(text.slice(0, at), 'utf8'),
    Buffer.from('Caf', 'utf8'),
    Buffer.from([0xe9]),
    Buffer.from(' au lait.', 'utf8'),
    Buffer.from(text.slice(at + BODY.length), 'utf8'),
  ]);
}

describe('a body that is not UTF-8 text is held in place (read.ts readUtf8)', () => {
  it('opens a project whose manuscript body is Windows-1252, holds the document, and says which file', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    await fs.writeBytesAtomic(path, withWindows1252Body(fs.snapshot()[path]!));

    const loaded = await readProject(fs);

    const notice = loaded.notices.find((n) => n.path === path);
    expect(notice?.message).toContain('not UTF-8');
    // The node stays in the tree, with no body record: the state holds no text for it.
    expect(loaded.state.manifest.tree.some((n) => n.id === docId)).toBe(true);
    expect(loaded.state.documents.has(docId)).toBe(false);
    expect(loaded.state.declinedDocFiles.has(`${docId}.md`)).toBe(true);
  });

  it('saves in place without touching the held file, and refuses to write an empty document anywhere else', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const original = withWindows1252Body(fs.snapshot()[path]!);
    await fs.writeBytesAtomic(path, original);
    const loaded = await readProject(fs);

    await writeProject(fs, loaded.state, { now: NOW });
    expect(Buffer.from(fs.snapshotBytes()[path]!).equals(Buffer.from(original))).toBe(true);

    // A target that does not hold the file cannot be given the empty body the state
    // would otherwise write, so both an export and a copy into a new folder refuse.
    await expect(writeProject(new MemoryArtifactFs(), loaded.state, { now: NOW })).rejects.toThrow(
      'it will not write an empty document in its place',
    );
    await expect(exportProjectZip(loaded.state, { now: NOW })).rejects.toThrow('it will not write an empty document in its place');
  });

  it('imports a zip whose manuscript body is not UTF-8, and the project opens with the notice naming the file', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const zip = zipSync({
      'caotang.json': ENC.encode(fs.snapshot()['caotang.json']!),
      [path]: withWindows1252Body(fs.snapshot()[path]!),
    });

    const imported = await importProjectZip(zip);
    const loaded = await readProject(imported.fs);

    expect(loaded.notices.some((n) => n.path === path && n.message.includes('not UTF-8'))).toBe(true);
    expect(loaded.state.manifest.tree.some((n) => n.id === docId)).toBe(true);
  });

  it('holds an orphan document whose bytes are not UTF-8 as a recovered node, and leaves its file in place', async () => {
    const { fs } = await writtenProject();
    const orphan = 'n_9Z8Y7X6W5V';
    const path = `docs/${orphan}.md`;
    const bytes = Buffer.from([0x23, 0x20, 0xe9, 0x0a]); // "# é" in Windows-1252
    await fs.writeBytesAtomic(path, bytes);

    const loaded = await readProject(fs);

    expect(loaded.notices.find((n) => n.path === path)?.message).toContain('not UTF-8');
    expect(loaded.state.manifest.tree.some((n) => n.id === orphan)).toBe(true);
    expect(loaded.state.documents.has(orphan)).toBe(false);

    await writeProject(fs, loaded.state, { now: NOW });
    expect(Buffer.from(fs.snapshotBytes()[path]!).equals(bytes)).toBe(true);
  });

  it('declines a codex file whose bytes are not UTF-8, and the next save keeps it', async () => {
    const { fs } = await writtenProject();
    const path = 'codex/c_5H8QK2M9RT.md';
    const bytes = Buffer.from('---\nid: c_5H8QK2M9RT\nname: Elenaé\n---\n', 'latin1');
    await fs.writeBytesAtomic(path, bytes);

    const loaded = await readProject(fs);

    expect(loaded.notices.find((n) => n.path === path)?.message).toContain('not UTF-8');
    expect(loaded.state.manifest.codex ?? []).toHaveLength(0);
    expect(loaded.state.declinedCodexFiles.has('c_5H8QK2M9RT.md')).toBe(true);

    await writeProject(fs, loaded.state, { now: NOW });
    expect(Buffer.from(fs.snapshotBytes()[path]!).equals(bytes)).toBe(true);
  });
});

/**
 * A detached copy of a loaded state, as the desktop's save makes one before it writes (apps/desktop persistence-plan.ts `copyState`): the
 * manifest, the document text the load holds, and what the load declined. The store cannot import the desktop, so the contract is restated.
 */
function copyOf(state: Parameters<typeof writeProject>[1]): Parameters<typeof writeProject>[1] {
  const copy = createProjectState(structuredClone(state.manifest));
  for (const [id, record] of state.documents) copy.documents.set(id, { id, body: record.body, revision: record.revision });
  for (const name of state.declinedCodexFiles) copy.declinedCodexFiles.add(name);
  for (const name of state.declinedDocFiles) copy.declinedDocFiles.add(name);
  for (const [path, text] of state.declinedText) copy.declinedText.set(path, text);
  return copy;
}

describe('a document file that is not UTF-8 survives a copy and a write that prunes nothing (DS-1, probe B)', () => {
  it('the bytes are unchanged and the write does not throw, through readProject, a copy of the state, and writeProject', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const original = withWindows1252Body(fs.snapshot()[path]!);
    await fs.writeBytesAtomic(path, original);

    const loaded = await readProject(fs);
    const report = await writeProject(fs, copyOf(loaded.state), { now: NOW, pruneDocumentIds: [] });

    expect(report.pruned).toEqual([]);
    expect(Buffer.from(fs.snapshotBytes()[path]!).equals(Buffer.from(original))).toBe(true);
  });
});
