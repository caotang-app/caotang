import { expect, test } from '@playwright/test';

import { ArtifactNotFoundError, EXPORTS_DIR } from '../../packages/store/src/index.js';

import { ExportStore } from '../../apps/desktop/src/app/exports.js';

import { filesIn, memoryFolder, textOf, type Entry } from './memory-folder.js';

/**
 * The export store (app/exports.ts): what the exporter writes through. The session's copy answers reads; a folder
 * the session has open receives every write and removal, and what the folder already holds is never lost.
 */

test('text artifacts are kept for the session and written into an attached folder, and an undo removes them from both', async () => {
  const store = new ExportStore();
  const { handle, tree } = memoryFolder();
  await store.attach(handle);

  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/Book.md`, '# Book\n');
  expect(await store.artifacts.read(`${EXPORTS_DIR}/Book.md`)).toBe('# Book\n');
  expect(textOf(filesIn(tree).get(`${EXPORTS_DIR}/Book.md`))).toBe('# Book\n');

  // A compile's undo: the same removal the emitter queues (exporter.md §5).
  await store.artifacts.remove(`${EXPORTS_DIR}/Book.md`);
  expect(filesIn(tree).has(`${EXPORTS_DIR}/Book.md`)).toBe(false);
  await expect(store.artifacts.read(`${EXPORTS_DIR}/Book.md`)).rejects.toBeInstanceOf(ArtifactNotFoundError);
});

test('binary artifacts are mirrored into the folder as bytes, and a download reads back the same bytes', async () => {
  const store = new ExportStore();
  const { handle, tree } = memoryFolder();
  await store.attach(handle);
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);

  // The store copies what it is given, so a caller that reuses its buffer cannot change the artifact.
  await store.bytes.writeBytes(`${EXPORTS_DIR}/Book.docx`, docx);
  docx.fill(0);

  const expected = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  expect(await store.read(`${EXPORTS_DIR}/Book.docx`)).toEqual(expected);
  expect(filesIn(tree).get(`${EXPORTS_DIR}/Book.docx`)).toEqual(expected);

  await store.bytes.removeBytes(`${EXPORTS_DIR}/Book.docx`);
  expect(filesIn(tree).has(`${EXPORTS_DIR}/Book.docx`)).toBe(false);
  expect(await store.read(`${EXPORTS_DIR}/Book.docx`)).toBeNull();
});

test('a folder attached after a compile receives what the session already made', async () => {
  const store = new ExportStore();
  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/Notes.txt`, 'before the folder');
  await store.bytes.writeBytes(`${EXPORTS_DIR}/Notes.epub`, new Uint8Array([1, 2, 3]));
  const { handle, tree } = memoryFolder();

  await store.attach(handle);

  expect(textOf(filesIn(tree).get(`${EXPORTS_DIR}/Notes.txt`))).toBe('before the folder');
  expect(filesIn(tree).get(`${EXPORTS_DIR}/Notes.epub`)).toEqual(new Uint8Array([1, 2, 3]));
});

test('the names the exporter reserves include the folder’s own files, so an export cannot overwrite one', async () => {
  const store = new ExportStore();
  const { handle, tree } = memoryFolder();
  // A file from an earlier session, already in the folder before anything is attached.
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([['Book.docx', { kind: 'file', bytes: new Uint8Array([9]) }]]),
  });
  await store.attach(handle);

  expect(await store.bytes.listFiles?.(EXPORTS_DIR)).toContain('Book.docx');
  expect(await store.artifacts.listFiles(EXPORTS_DIR)).toContain('Book.docx');
});

test('the compile log of a folder is kept: its history comes first, and a row both hold is not written twice', async () => {
  const store = new ExportStore();
  const { handle, tree } = memoryFolder();
  const older = { at: '2026-10-07T09:00:00.000Z', format: 'md', output: 'exports/Older.md' };
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([
      ['compile-log.json', { kind: 'file', bytes: new TextEncoder().encode(JSON.stringify([older])) }],
    ]),
  });
  const newer = { at: '2026-10-08T09:00:00.000Z', format: 'txt', output: 'exports/Newer.txt' };
  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/compile-log.json`, JSON.stringify([newer]));

  await store.attach(handle);
  // Attaching again, to the same folder, must not repeat the rows the folder already has.
  await store.attach(handle);

  const log = JSON.parse(textOf(filesIn(tree).get(`${EXPORTS_DIR}/compile-log.json`))) as unknown[];
  expect(log).toEqual([older, newer]);
  expect(JSON.parse(await store.artifacts.read(`${EXPORTS_DIR}/compile-log.json`))).toEqual([older, newer]);
});

test('a folder whose compile log is not a JSON array is refused, and nothing is mirrored into it', async () => {
  const store = new ExportStore();
  const { handle, tree } = memoryFolder();
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([['compile-log.json', { kind: 'file', bytes: new TextEncoder().encode('{}') }]]),
  });

  await expect(store.attach(handle)).rejects.toThrow(/not a JSON array/);

  // Refused means refused: the corrupt log is evidence, and a later write stays in the session.
  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/Book.md`, '# Book');
  expect(filesIn(tree).has(`${EXPORTS_DIR}/Book.md`)).toBe(false);
  expect(store.hasFolder()).toBe(false);
  expect(textOf(filesIn(tree).get(`${EXPORTS_DIR}/compile-log.json`))).toBe('{}');
});

test('a path the session never wrote reads as absent, not as an error', async () => {
  const store = new ExportStore();
  expect(await store.read(`${EXPORTS_DIR}/Missing.docx`)).toBeNull();
  expect(await store.read(`${EXPORTS_DIR}/Missing.md`)).toBeNull();
});

test('an export compiled before the folder was attached is not overwritten by a folder file of the same name, and the attach is refused', async () => {
  const store = new ExportStore();
  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/Book.md`, '# The session copy');
  const { handle, tree } = memoryFolder();
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([['Book.md', { kind: 'file', bytes: new TextEncoder().encode('# An earlier export') }]]),
  });

  await expect(store.attach(handle)).rejects.toThrow(`${EXPORTS_DIR}/Book.md`);

  // A refused attach writes nothing: the folder keeps its file, the session keeps its copy, and nothing is mirrored.
  expect(textOf(filesIn(tree).get(`${EXPORTS_DIR}/Book.md`))).toBe('# An earlier export');
  expect(await store.artifacts.read(`${EXPORTS_DIR}/Book.md`)).toBe('# The session copy');
  expect(store.hasFolder()).toBe(false);
});

test('a Word or EPUB file made before the attach is kept the same way when the folder holds other bytes under its name', async () => {
  const store = new ExportStore();
  await store.bytes.writeBytes(`${EXPORTS_DIR}/Book.docx`, new Uint8Array([1, 2, 3]));
  const { handle, tree } = memoryFolder();
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([['Book.docx', { kind: 'file', bytes: new Uint8Array([9, 9]) }]]),
  });

  await expect(store.attach(handle)).rejects.toThrow(`${EXPORTS_DIR}/Book.docx`);

  expect(filesIn(tree).get(`${EXPORTS_DIR}/Book.docx`)).toEqual(new Uint8Array([9, 9]));
  expect(store.hasFolder()).toBe(false);
});

test('a folder file that already holds the same bytes as the session’s export does not refuse the attach', async () => {
  const store = new ExportStore();
  await store.artifacts.writeAtomic(`${EXPORTS_DIR}/Book.md`, '# Same');
  const { handle, tree } = memoryFolder();
  tree.children.set(EXPORTS_DIR, {
    kind: 'directory',
    children: new Map<string, Entry>([['Book.md', { kind: 'file', bytes: new TextEncoder().encode('# Same') }]]),
  });

  await store.attach(handle);

  expect(store.hasFolder()).toBe(true);
  expect(textOf(filesIn(tree).get(`${EXPORTS_DIR}/Book.md`))).toBe('# Same');
});
