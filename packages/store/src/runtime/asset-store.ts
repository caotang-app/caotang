/**
 * The browser's copy of a project's binary assets: the images under `assets/` (storyboard.md §2.2, epub-metadata.md).
 *
 * Without a project folder the runtime store has no home for a file it keeps as bytes, so a shot image or a cover
 * is lost on reload. This store keeps those bytes in IndexedDB, keyed by project and by the file's project-relative
 * path, so an image reads back after a reload with no folder attached.
 *
 * It is a separate database from the runtime store (`caotang`), on purpose: the runtime store's schema is versioned
 * with the documents it holds, and an image store is a second, independent concern that can be opened, tested and
 * abandoned on its own. The factory is a parameter, as it is for the runtime store, so the in-memory binding serves
 * the tests and the browser's `indexedDB` serves the app.
 *
 * The store knows nothing about which files are images. The caller (the desktop's `ProjectAssets`) decides what a
 * path means and what it validates; this file moves bytes and keeps them per project.
 */

/** The database name. Distinct from the runtime store's `caotang`, so the two never share a schema version. */
export const ASSET_DB_NAME = 'caotang-assets';

/** 1: the first build of the asset store. No earlier version exists to migrate from. */
export const ASSET_DB_VERSION = 1;

export const ASSET_STORE = 'assets';
export const ASSET_PROJECT_INDEX = 'byProject';

/** One stored file: a project, its path under the project folder (`assets/<name>`), and its bytes. */
export interface AssetRow {
  readonly projectId: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface AssetStore {
  readonly db: IDBDatabase;
  readonly name: string;
  close(): void;
}

/** Opens (and if necessary creates) the asset database. */
export function openAssetStore(factory: IDBFactory, name: string = ASSET_DB_NAME): Promise<AssetStore> {
  return new Promise<AssetStore>((resolve, reject) => {
    const request = factory.open(name, ASSET_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        // A compound key, so one project's files are one contiguous range, as the runtime store's documents are.
        const assets = db.createObjectStore(ASSET_STORE, { keyPath: ['projectId', 'path'] });
        assets.createIndex(ASSET_PROJECT_INDEX, 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab asking for a newer version must not wait on this connection, so it is closed on request.
      db.onversionchange = () => db.close();
      resolve({ db, name, close: () => db.close() });
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`could not open the asset store "${name}"`));
    };
  });
}

/**
 * Runs one request in a transaction over the asset store and resolves with its result once the transaction commits.
 * A failed or aborted transaction rejects, so a caller never treats an unwritten file as written.
 */
function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, mode);
    let value: T | undefined;
    const pending = request(tx.objectStore(ASSET_STORE));
    pending.onsuccess = () => {
      value = pending.result;
    };
    tx.oncomplete = () => resolve(value as T);
    tx.onerror = () => reject(tx.error ?? pending.error ?? new Error('the asset write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('the asset transaction was aborted, so nothing was written'));
  });
}

/** Stores one file's bytes under a project and path, replacing any earlier file at that path. */
export async function putAssetBytes(store: AssetStore, projectId: string, path: string, bytes: Uint8Array): Promise<void> {
  // A copy, so a later change to the caller's buffer cannot change what is stored.
  const row: AssetRow = { projectId, path, bytes: bytes.slice() };
  await transact(store.db, 'readwrite', (objects) => objects.put(row));
}

/** One stored file's bytes, or `undefined` when the project has no file at that path. */
export async function getAssetBytes(store: AssetStore, projectId: string, path: string): Promise<Uint8Array | undefined> {
  const row = await transact<AssetRow | undefined>(store.db, 'readonly', (objects) => objects.get([projectId, path]));
  return row?.bytes;
}

/** Every stored path of one project, sorted. */
export async function listAssetPaths(store: AssetStore, projectId: string): Promise<string[]> {
  const rows = await transact<AssetRow[]>(store.db, 'readonly', (objects) => objects.index(ASSET_PROJECT_INDEX).getAll(projectId));
  return rows.map((row) => row.path).sort();
}

/** Removes every stored file of one project, and returns how many were removed. Nothing else is touched. */
export async function deleteProjectAssets(store: AssetStore, projectId: string): Promise<number> {
  const paths = await listAssetPaths(store, projectId);
  for (const path of paths) {
    await transact(store.db, 'readwrite', (objects) => objects.delete([projectId, path]));
  }
  return paths.length;
}
