/**
 * The app-level IndexedDB database: the settings, the non-secret provider profile records, the usage ledger's day rows
 * and the request log (ui-modules §5, provider-gateway §4 and §6).
 *
 * It is a database of its own, apart from the project store and the key vault, on purpose. Nothing a project export
 * carries comes from here, and nothing here can carry a credential: the key lives only in the vault (provider-gateway
 * §7), and a profile record has no key field. Every value is one JSON-shaped record under one key, so a reader never
 * sees half of a save.
 *
 * Opening is the only call that can fail for a reason the caller must report. Every later call either returns what is
 * stored or throws, and the caller decides what the writer is told; the app keeps working on defaults when it cannot
 * read or write here.
 */

/** The database name. No project uses it, and the project store has its own. */
export const APP_DB_NAME = 'caotang-app';
const APP_DB_VERSION = 1;
const STORE_KV = 'kv';

/** The record keys. One value per key, so a save replaces a whole record at once. */
export const APP_KEYS = {
  settings: 'settings',
  profiles: 'profiles',
  usage: 'usage',
  requests: 'requests',
} as const;

export interface AppDb {
  /** The value stored under `key`, or `undefined` when nothing has been stored there. */
  get<T>(key: string): Promise<T | undefined>;
  /** Replaces the value under `key`. Resolves when the transaction has committed. */
  put(key: string, value: unknown): Promise<void>;
  close(): void;
}

/** Runs one IDB request inside its own transaction and resolves with its result once the transaction commits. */
function requestOf<T>(request: IDBRequest<T>, tx: IDBTransaction): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error ?? new Error('The app database transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('The app database transaction was aborted.'));
  });
}

/**
 * Opens the app database. `factory` is the browser's `indexedDB`, or a stand-in in a test. Rejects when the open fails,
 * which the caller turns into a notice and an app that runs on defaults.
 */
export function openAppDb(factory: IDBFactory, name: string = APP_DB_NAME): Promise<AppDb> {
  return new Promise<AppDb>((resolve, reject) => {
    const request = factory.open(name, APP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      resolve({
        async get<T>(key: string): Promise<T | undefined> {
          const tx = db.transaction(STORE_KV, 'readonly');
          const row = await requestOf(tx.objectStore(STORE_KV).get(key) as IDBRequest<{ key: string; value: T } | undefined>, tx);
          return row?.value;
        },
        async put(key: string, value: unknown): Promise<void> {
          const tx = db.transaction(STORE_KV, 'readwrite');
          await requestOf(tx.objectStore(STORE_KV).put({ key, value }) as IDBRequest<IDBValidKey>, tx);
        },
        close(): void {
          db.close();
        },
      });
    };
    request.onerror = () => reject(request.error ?? new Error('The app database could not be opened.'));
    request.onblocked = () => reject(new Error('The app database is open in another tab, so it cannot be upgraded here.'));
  });
}

/**
 * The app database this session uses, for the records that belong to a project but are kept here until the store can hold
 * them (the coherence file and the saved furniture; see `coherence-io.ts` and `furniture-store.ts`). Set once the services
 * are open. `null` means no database, and those records are then kept for the session only.
 */
let activeDb: AppDb | null = null;

export function setActiveAppDb(db: AppDb | null): void {
  activeDb = db;
}

export function activeAppDb(): AppDb | null {
  return activeDb;
}
