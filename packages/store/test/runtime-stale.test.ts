/**
 * A runtime store whose connection another tab's upgrade has closed (DS-6). The browser fires `versionchange` on this tab's connection
 * when a newer build opens the database; from then on this tab's writes must say why they fail, and say what to do (reload), rather
 * than surface the browser's `InvalidStateError` from a closed connection.
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryIndexedDb,
  RuntimeStoreNewerError,
  RuntimeStoreStaleError,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  evictSnapshots,
  openRuntimeStore,
  readProjectState,
  writeProjectState,
  type RuntimeStore,
} from '../src/index.js';

const STAMP = new Date('2026-10-08T09:00:00.000Z');

/** Fires the event the browser fires on an open connection when another tab opens the database at a newer version. */
function upgradeFromAnotherTab(store: RuntimeStore): void {
  store.db.onversionchange?.call(store.db, new Event('versionchange') as IDBVersionChangeEvent);
}

function aProject() {
  const state = createProjectState(createEmptyManifest('Stale Book', STAMP));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: STAMP, id: 'n_CHAPTR0001' });
  addDocument(state, { parentId: 'n_CHAPTR0001', title: 'Kept', body: 'The ferry was late.', now: STAMP, id: 'n_KEEP000001' });
  return state;
}

describe('a runtime store another tab has upgraded', () => {
  it('a store that no other tab has upgraded keeps writing', async () => {
    const store = await openRuntimeStore(new MemoryIndexedDb());
    const state = aProject();
    await writeProjectState(store, state);
    expect((await readProjectState(store, state.manifest.project.id)).documents.get('n_KEEP000001')?.body).toBe(
      'The ferry was late.',
    );
  });

  it('the next write is refused with an error that names the reload, not the browser’s closed-connection error', async () => {
    const store = await openRuntimeStore(new MemoryIndexedDb());
    const state = aProject();
    await writeProjectState(store, state);

    upgradeFromAnotherTab(store);

    const refused = writeProjectState(store, state);
    await expect(refused).rejects.toBeInstanceOf(RuntimeStoreStaleError);
    await expect(refused).rejects.toThrow('Reload this tab');
  });

  it('a read on the upgraded store is refused the same way, so no screen shows a partly loaded project', async () => {
    const store = await openRuntimeStore(new MemoryIndexedDb());
    const state = aProject();
    await writeProjectState(store, state);

    upgradeFromAnotherTab(store);

    await expect(readProjectState(store, state.manifest.project.id)).rejects.toBeInstanceOf(RuntimeStoreStaleError);
  });

  it('the snapshot retention sweep is refused by the same name, not by the browser’s closed-connection error (DS-6)', async () => {
    const store = await openRuntimeStore(new MemoryIndexedDb());
    upgradeFromAnotherTab(store);

    await expect(evictSnapshots(store, 'p_upgraded')).rejects.toBeInstanceOf(RuntimeStoreStaleError);
  });
});

describe('a store a newer build has upgraded, opened by an older build', () => {
  it('the browser’s VersionError is said as what this tab must do: reload to get the updated version', async () => {
    // The browser refuses an older build's open of a store at a newer version with a VersionError (store.ts openRuntimeStore).
    const olderBuild = {
      open() {
        const request = { error: { name: 'VersionError', message: 'The requested version is less than the existing version.' } } as unknown as IDBOpenDBRequest;
        setTimeout(() => (request as unknown as { onerror: () => void }).onerror(), 0);
        return request;
      },
    } as unknown as IDBFactory;

    const opened = openRuntimeStore(olderBuild);

    await expect(opened).rejects.toBeInstanceOf(RuntimeStoreNewerError);
    await expect(opened).rejects.toThrow('Reload this tab to get the updated version');
  });
});
