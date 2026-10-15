/**
 * The encoding report a load carries for files whose bytes are not UTF-8 text
 * (read.ts `encodingIssues`, encoding.ts). Detection changes nothing the load
 * does — a non-UTF-8 file is still held or declined exactly as before — it adds
 * a structured record of which files were held and what their bytes look like,
 * so a caller can act on them (preview, convert) rather than dead-ending on a
 * notice. `decodeForPreview` is the decode half of that flow, exercised here on
 * its own.
 */
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import {
  MemoryArtifactFs,
  RECOVERED_TITLE,
  addDocument,
  createEmptyManifest,
  createProjectState,
  decodeForPreview,
  guessEncoding,
  importProjectZip,
  readProject,
  recoverProject,
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

/** UTF-16 for BMP text, little-endian or big-endian, with or without the byte-order mark. */
function utf16(text: string, endian: 'le' | 'be', bom: boolean): Uint8Array {
  const bytes: number[] = bom ? (endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (endian === 'le') bytes.push(code & 0xff, code >> 8);
    else bytes.push(code >> 8, code & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** A Windows-1252 file: ASCII with smart quotes 0x93/0x94 and an 0xE9 `é`, none of which are UTF-8. */
const CP1252 = Uint8Array.from([
  ...ENC.encode('He said '),
  0x93, 0x48, 0x69, 0x94, // “Hi”
  ...ENC.encode(' over caf'),
  0xe9, // é
  0x0a,
]);

/** Bytes that are no text encoding: a PNG-like header — NULs and C0 controls mixed with high bytes. */
const BINARY = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48]);

describe('guessEncoding names what a non-UTF-8 file plausibly is', () => {
  it('reads a UTF-16 byte-order mark, both endians, and UTF-16 without one by its NUL parity', () => {
    expect(guessEncoding(utf16('The ferry was late.', 'le', true))).toBe('utf-16le');
    expect(guessEncoding(utf16('The ferry was late.', 'be', true))).toBe('utf-16be');
    expect(guessEncoding(utf16('The ferry was late, as always, and the gulls were screaming.', 'le', false))).toBe(
      'utf-16le',
    );
    expect(guessEncoding(utf16('The ferry was late, as always, and the gulls were screaming.', 'be', false))).toBe(
      'utf-16be',
    );
  });

  it('calls high-byte text with no impossible bytes Windows-1252', () => {
    expect(guessEncoding(CP1252)).toBe('windows-1252');
    expect(guessEncoding(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe('windows-1252'); // café
  });

  it('declines to name binary bytes, and bytes cp1252 leaves undefined', () => {
    expect(guessEncoding(BINARY)).toBe('unknown');
    // 0x81 is one of the five code points cp1252 does not define; a file
    // carrying it is something else (another encoding, or not text at all).
    expect(guessEncoding(Uint8Array.from([0x66, 0x6f, 0x6f, 0x81, 0x62, 0x61, 0x72]))).toBe('unknown');
  });
});

describe('decodeForPreview decodes a file for the convert flow’s preview step', () => {
  it('decodes UTF-8 as UTF-8, with or without a byte-order mark', () => {
    expect(decodeForPreview(ENC.encode('plain ascii\n'))).toEqual({ encoding: 'utf-8', text: 'plain ascii\n' });
    expect(decodeForPreview(Uint8Array.from([0xef, 0xbb, 0xbf, ...ENC.encode('café')]))).toEqual({
      encoding: 'utf-8',
      text: 'café',
    });
    expect(decodeForPreview(new Uint8Array(0))).toEqual({ encoding: 'utf-8', text: '' });
  });

  it('honours the UTF-16 byte-order marks and guesses UTF-16 without one', () => {
    expect(decodeForPreview(utf16('The ferry.', 'le', true))).toEqual({ encoding: 'utf-16le', text: 'The ferry.' });
    expect(decodeForPreview(utf16('The ferry.', 'be', true))).toEqual({ encoding: 'utf-16be', text: 'The ferry.' });
    expect(decodeForPreview(utf16('The ferry was late, as always.', 'le', false))).toEqual({
      encoding: 'utf-16le',
      text: 'The ferry was late, as always.',
    });
  });

  it('decodes Windows-1252 through its mapping, smart quotes and all', () => {
    expect(decodeForPreview(CP1252)).toEqual({ encoding: 'windows-1252', text: 'He said “Hi” over café\n' });
  });

  it('still returns a best-effort preview for bytes it cannot name', () => {
    const preview = decodeForPreview(BINARY);
    expect(preview.encoding).toBe('unknown');
    expect(typeof preview.text).toBe('string');
  });
});

describe('the load reports each non-UTF-8 file it holds', () => {
  it('a UTF-16 document is held as before, reported with its guess, and named by its notice', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const bytes = utf16('---\nid: x\ntitle: The Landing\n---\n\nThe ferry was late.\n', 'le', true);
    await fs.writeBytesAtomic(path, bytes);

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: bytes.length, encoding: 'utf-16le' }]);
    const notice = loaded.notices.find((n) => n.path === path);
    expect(notice?.message).toContain('not UTF-8 text (its bytes look like UTF-16, little-endian)');
    // The hold is unchanged: kept node, no body record, declined file.
    expect(loaded.state.declinedDocFiles.has(`${docId}.md`)).toBe(true);
    expect(loaded.state.documents.has(docId)).toBe(false);
    expect(Buffer.from(fs.snapshotBytes()[path]!).equals(Buffer.from(bytes))).toBe(true);
  });

  it('a Windows-1252 document body is reported as windows-1252', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const original = fs.snapshot()[path]!;
    const at = original.indexOf(BODY);
    const bytes = Buffer.concat([Buffer.from(original.slice(0, at), 'utf8'), Buffer.from(CP1252)]);

    await fs.writeBytesAtomic(path, bytes);
    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: bytes.length, encoding: 'windows-1252' }]);
    expect(loaded.notices.find((n) => n.path === path)?.message).toContain('Windows-1252');
  });

  it('a document of binary garbage is reported with no guess', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    await fs.writeBytesAtomic(path, BINARY);

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: BINARY.length, encoding: 'unknown' }]);
    expect(loaded.notices.find((n) => n.path === path)?.message).toContain('not UTF-8 text');
  });

  it('an orphan document whose bytes are not UTF-8 is imported as a held node and reported', async () => {
    const { fs } = await writtenProject();
    const orphan = 'n_9Z8Y7X6W5V';
    const path = `docs/${orphan}.md`;
    await fs.writeBytesAtomic(path, CP1252);

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: CP1252.length, encoding: 'windows-1252' }]);
    const node = loaded.state.manifest.tree.find((n) => n.id === orphan);
    expect(node?.title).toBeDefined();
    expect(loaded.state.declinedDocFiles.has(`${orphan}.md`)).toBe(true);
    expect(loaded.state.documents.has(orphan)).toBe(false);
    expect(loaded.notices.find((n) => n.path === path)?.message).toContain(RECOVERED_TITLE);
  });

  it('a docs file named for a non-document node is declined and reported the same way', async () => {
    const { fs } = await writtenProject();
    const path = 'docs/n_CHAPTER001.md';
    await fs.writeBytesAtomic(path, CP1252);
    const manifest = JSON.parse(fs.snapshot()['caotang.json']!);
    manifest.tree.push({
      id: 'n_CHAPTER001',
      parentId: 'manuscript',
      type: 'folder',
      title: 'Chapter 1',
      order: 20,
      status: null,
      label: null,
      keywords: [],
      synopsis: '',
      notes: '',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    fs.putFile('caotang.json', JSON.stringify(manifest, null, 2));

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: CP1252.length, encoding: 'windows-1252' }]);
    const notice = loaded.notices.find((n) => n.path === path);
    expect(notice?.message).toContain('not a document');
    expect(notice?.message).toContain('its text is not UTF-8 (its bytes look like Windows-1252)');
    expect(loaded.state.declinedDocFiles.has('n_CHAPTER001.md')).toBe(true);
  });

  it('a codex file whose bytes are not UTF-8 is declined and reported as codex', async () => {
    const { fs } = await writtenProject();
    const path = 'codex/c_5H8QK2M9RT.md';
    const bytes = Buffer.from('---\nid: c_5H8QK2M9RT\nname: Elenaé\n---\n', 'latin1');
    await fs.writeBytesAtomic(path, bytes);

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'codex', size: bytes.length, encoding: 'windows-1252' }]);
    expect(loaded.state.declinedCodexFiles.has('c_5H8QK2M9RT.md')).toBe(true);
    expect(loaded.notices.find((n) => n.path === path)?.message).toContain('not UTF-8 text (its bytes look like Windows-1252)');
  });

  it('reports every problem file, in the order the load met them', async () => {
    const { fs, docId } = await writtenProject();
    const docPath = `docs/${docId}.md`;
    await fs.writeBytesAtomic(docPath, utf16('x'.repeat(40), 'le', true));
    const codexPath = 'codex/c_5H8QK2M9RT.md';
    await fs.writeBytesAtomic(codexPath, CP1252);

    const loaded = await readProject(fs);

    expect(loaded.encodingIssues.map((issue) => issue.path)).toEqual([docPath, codexPath]);
    expect(loaded.encodingIssues.map((issue) => issue.kind)).toEqual(['document', 'codex']);
  });

  it('a project whose files all decode reports nothing', async () => {
    const { fs } = await writtenProject();
    const loaded = await readProject(fs);
    expect(loaded.encodingIssues).toEqual([]);
  });

  it('the same report surfaces on a .caotang bundle import, not only a folder open', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const bytes = Buffer.concat([Buffer.from('---\nid: x\n---\n\nCaf', 'utf8'), Buffer.from([0xe9]), Buffer.from('\n', 'utf8')]);
    const zip = zipSync({
      'caotang.json': ENC.encode(fs.snapshot()['caotang.json']!),
      [path]: bytes,
    });

    const imported = await importProjectZip(zip);
    const loaded = await readProject(imported.fs);

    expect(loaded.encodingIssues).toEqual([{ path, kind: 'document', size: bytes.length, encoding: 'windows-1252' }]);
    expect(loaded.state.declinedDocFiles.has(`${docId}.md`)).toBe(true);
  });

  it('the report rides the recovery offer, whichever rung produced the state', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    const bytes = Buffer.concat([Buffer.from('---\nid: x\n---\n\nCaf', 'utf8'), Buffer.from([0xe9]), Buffer.from('\n', 'utf8')]);
    await fs.writeBytesAtomic(path, bytes);
    // A snapshot is a manifest read through the same loader; carry a good one beside a dead original.
    fs.putFile('caotang.json.bak.1', fs.snapshot()['caotang.json']!);
    fs.putFile('caotang.json', 'this is not the manifest {');

    const recovered = await recoverProject(fs, { now: NOW });
    expect(recovered.status).toBe('ok');
    if (recovered.status !== 'ok') return;
    expect(recovered.offer.encodingIssues).toEqual([
      { path, kind: 'document', size: bytes.length, encoding: 'windows-1252' },
    ]);
  });

  it('the rebuild arm of recovery reports it too', async () => {
    const { fs, docId } = await writtenProject();
    const path = `docs/${docId}.md`;
    await fs.writeBytesAtomic(path, CP1252);
    fs.putFile('caotang.json', 'this is not the manifest {');

    const recovered = await recoverProject(fs, { now: NOW });
    expect(recovered.status).toBe('needs-consent');
    if (recovered.status !== 'needs-consent') return;
    expect(recovered.offer.encodingIssues).toEqual([
      { path, kind: 'document', size: CP1252.length, encoding: 'windows-1252' },
    ]);
  });
});
