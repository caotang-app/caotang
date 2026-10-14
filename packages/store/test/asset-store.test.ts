/**
 * The browser's asset store (runtime/asset-store.ts): a project's images survive a close and reopen of the database, which
 * is what a reload does, and each project sees only its own files.
 */

import { describe, expect, it } from 'vitest';

import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import {
  deleteProjectAssets,
  getAssetBytes,
  listAssetPaths,
  openAssetStore,
  putAssetBytes,
  type AssetStore,
} from '../src/runtime/asset-store.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9]);

async function open(factory: MemoryIndexedDb): Promise<AssetStore> {
  return openAssetStore(factory, 'caotang-assets-test');
}

describe('the browser asset store', () => {
  it('reads back a file after the database is closed and opened again, as a reload does', async () => {
    const factory = new MemoryIndexedDb();
    const first = await open(factory);
    await putAssetBytes(first, 'p_ONE', 'assets/a_SHOTONE001.png', PNG);
    first.close();

    const second = await open(factory);
    expect(await getAssetBytes(second, 'p_ONE', 'assets/a_SHOTONE001.png')).toEqual(PNG);
    expect(await listAssetPaths(second, 'p_ONE')).toEqual(['assets/a_SHOTONE001.png']);
    second.close();
  });

  it('keeps each project’s files apart, so one project never lists or reads another’s', async () => {
    const store = await open(new MemoryIndexedDb());
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png', PNG);
    await putAssetBytes(store, 'p_TWO', 'assets/a_SHOTTWO001.jpg', JPEG);

    expect(await listAssetPaths(store, 'p_ONE')).toEqual(['assets/a_SHOTONE001.png']);
    expect(await listAssetPaths(store, 'p_TWO')).toEqual(['assets/a_SHOTTWO001.jpg']);
    expect(await getAssetBytes(store, 'p_TWO', 'assets/a_SHOTONE001.png')).toBeUndefined();
    store.close();
  });

  it('replaces the file at a path, and reports nothing for a path that was never written', async () => {
    const store = await open(new MemoryIndexedDb());
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png', PNG);
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png', JPEG);

    expect(await getAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png')).toEqual(JPEG);
    expect(await getAssetBytes(store, 'p_ONE', 'assets/a_MISSING001.png')).toBeUndefined();
    expect(await listAssetPaths(store, 'p_ONE')).toEqual(['assets/a_SHOTONE001.png']);
    store.close();
  });

  it('stores a copy, so a later change to the caller’s buffer does not change the file', async () => {
    const store = await open(new MemoryIndexedDb());
    const bytes = PNG.slice();
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png', bytes);
    bytes[0] = 0;

    expect((await getAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png'))?.[0]).toBe(0x89);
    store.close();
  });

  it('deletes one project’s files and leaves every other project’s alone', async () => {
    const store = await open(new MemoryIndexedDb());
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE001.png', PNG);
    await putAssetBytes(store, 'p_ONE', 'assets/a_SHOTONE002.png', PNG);
    await putAssetBytes(store, 'p_TWO', 'assets/a_SHOTTWO001.jpg', JPEG);

    expect(await deleteProjectAssets(store, 'p_ONE')).toBe(2);
    expect(await listAssetPaths(store, 'p_ONE')).toEqual([]);
    expect(await listAssetPaths(store, 'p_TWO')).toEqual(['assets/a_SHOTTWO001.jpg']);
    store.close();
  });
});
