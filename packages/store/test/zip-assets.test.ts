/**
 * m9 (project export): the image files of a project survive the `.caotang` byte-for-byte (project-format.md §7,
 * storyboard.md §2.2). The old bundle decoded every entry as text, so a PNG came back changed and longer; this pins that
 * the bytes an asset was written with are the bytes an import reads back, including the bytes UTF-8 cannot carry.
 */

import { describe, expect, it } from 'vitest';
import { createEmptyManifest, createProjectState, exportProjectZip, importProjectZip } from '../src/index.js';

const NOW = new Date('2026-10-08T09:00:00.000Z');

/** Bytes a text decoder would damage: a lone continuation byte, a 0xFF, a NUL, and the PNG signature. */
const PNG_LIKE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x80, 0xff, 0xc3, 0x28, 0x00, 0x42]);
const ASSET = 'assets/a_ABCDEFGHJK.png';

describe('the bundle carries assets byte-exact', () => {
  it('writes an asset into the archive as its bytes, and reads it back unchanged on import', async () => {
    const state = createProjectState(createEmptyManifest('With Cover', NOW, { uuid: () => '3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d' }));
    const exported = await exportProjectZip(state, { now: NOW, assets: { [ASSET]: PNG_LIKE } });
    expect(exported.entries).toContain(ASSET);

    const imported = await importProjectZip(exported.bytes);
    expect(Array.from(await imported.fs.readBytes(ASSET))).toEqual(Array.from(PNG_LIKE));
    // The same bytes come back as a map too, which is what the project's asset store takes in on import (the cover).
    expect(Object.keys(imported.assets)).toEqual([ASSET]);
    expect(Array.from(imported.assets[ASSET] ?? [])).toEqual(Array.from(PNG_LIKE));
  });

  it('keeps the same bytes through two round trips, so an export of an unchanged project is stable', async () => {
    const state = createProjectState(createEmptyManifest('Stable', NOW, { uuid: () => '3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d' }));
    const first = await exportProjectZip(state, { now: NOW, assets: { [ASSET]: PNG_LIKE } });
    const again = await importProjectZip(first.bytes);
    expect(Array.from(await again.fs.readBytes(ASSET))).toEqual(Array.from(PNG_LIKE));
    const second = await exportProjectZip(state, { now: NOW, assets: { [ASSET]: PNG_LIKE } });
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
  });

  it('refuses a binary file outside assets/, since the bundle carries binaries by that route only', async () => {
    const state = createProjectState(createEmptyManifest('Refused', NOW));
    await expect(exportProjectZip(state, { now: NOW, assets: { 'docs/n_X.bin': PNG_LIKE } })).rejects.toThrow(
      /carries only assets\/ files as binary/,
    );
    await expect(exportProjectZip(state, { now: NOW, assets: { 'assets/../caotang.json': PNG_LIKE } })).rejects.toThrow(
      /carries only assets\/ files as binary/,
    );
  });

  it('writes no asset when none is given, so a bundle with no images is the bundle it was', async () => {
    const state = createProjectState(createEmptyManifest('Plain', NOW, { uuid: () => '3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d' }));
    const exported = await exportProjectZip(state, { now: NOW });
    expect(exported.entries.some((entry) => entry.startsWith('assets/'))).toBe(false);
  });
});
