/**
 * The one IndexedDB connection the app uses (project-format §8: the runtime store is
 * the browser's working copy).
 *
 * Opened on first use and shared by every session. A failed open is not cached, so a
 * later attempt (a reload, or the user retrying) gets a fresh chance rather than the
 * same rejected promise.
 */

import { openRuntimeStore, type RuntimeStore } from '@caotang/store';

let pending: Promise<RuntimeStore> | null = null;

export function runtimeStore(): Promise<RuntimeStore> {
  if (pending === null) {
    pending = (async () => {
      if (typeof indexedDB === 'undefined') {
        throw new Error('This browser has no IndexedDB, so projects cannot be stored here.');
      }
      return openRuntimeStore(indexedDB);
    })();
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
