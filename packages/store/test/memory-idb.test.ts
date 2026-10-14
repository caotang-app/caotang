/**
 * The IndexedDB binding's own contract.
 *
 * `memory-idb.ts` is 900+ lines of the one thing in this package that is *not*
 * the product: a test double standing in for a browser API. Its value is exactly
 * inverse to its line count — a binding that quietly agrees with whatever the
 * store happens to do makes the atomicity and concurrency tests prove nothing
 * about a browser. docs/decisions.md put it
 * plainly: "A test binding is only worth its lines if its bugs are findable this
 * way."
 *
 * So the properties below are tested the only way a double can be: by using the
 * real API in a way the real API refuses. Each one is mutation-checked — the
 * mutation that removes the behaviour, the test that catches it.
 */

import { describe, expect, it } from 'vitest';
import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import { DOCUMENT_STORE, PROJECT_STORE, SESSION_STORE, openRuntimeStore } from '../src/runtime/store.js';

const DB = 'caotang-binding-test';

async function opened(): Promise<{ factory: MemoryIndexedDb; store: Awaited<ReturnType<typeof openRuntimeStore>> }> {
  const factory = new MemoryIndexedDb();
  const store = await openRuntimeStore(factory, DB);
  return { factory, store };
}

describe('a transaction is scoped to the stores it was opened with', () => {
  it('refuses an object store outside its own scope, and allows the ones inside', async () => {
    // Real IndexedDB raises NotFoundError for a store the transaction does not
    // cover, and the consequence is the whole reason it matters: a mutation that
    // reached a store outside its own transaction would be a second mutation
    // wearing one name — the torn-write class §4 says cannot occur here.
    //
    // Mutation-checked: resolving the store regardless of scope
    // leaves the whole store suite green (190 tests), because every store list in
    // the package happens to be complete. This test is what makes the check
    // load-bearing rather than incidentally true.
    const { store } = await opened();

    const tx = store.db.transaction([PROJECT_STORE], 'readwrite');
    expect(() => tx.objectStore(PROJECT_STORE)).not.toThrow();
    expect(() => tx.objectStore(DOCUMENT_STORE)).toThrow(/no object store/i);
    expect(() => tx.objectStore(SESSION_STORE)).toThrow(/no object store/i);
  });

  it('names the stores it was opened with, so the refusal says which transaction', async () => {
    // The error is a diagnostic the store author reads in a failing test, and a
    // refusal that does not say what it *was* allowed to touch costs a debugging
    // round-trip to earn.
    const { store } = await opened();
    const tx = store.db.transaction([PROJECT_STORE, DOCUMENT_STORE], 'readwrite');
    expect(() => tx.objectStore(SESSION_STORE)).toThrow(
      /opened with \[projects, documents\]/,
    );
  });
});

// The binding reports what a browser would. An exception that escapes a success callback is kept, a request error the request's
// own handler deals with is not, and a request an abort cuts short fails with AbortError before the transaction's abort event.
describe('a request the binding fails: what it records, and the order of its events', () => {
  it('records a success callback that throws, and aborts its transaction as an uncaught exception does in a browser', async () => {
    const { factory, store } = await opened();
    const boom = new Error('boom');
    const tx = store.db.transaction([PROJECT_STORE], 'readonly');
    tx.objectStore(PROJECT_STORE).get('missing').onsuccess = () => {
      throw boom;
    };
    await new Promise<void>((resolve) => tx.addEventListener('abort', () => resolve()));
    expect(factory.handlerErrors()).toEqual([boom]);
  });

  it('does not record a request error: a constraint violation is the request failing, and it is not an exception out of a callback', async () => {
    const { factory, store } = await opened();
    const first = store.db.transaction([PROJECT_STORE], 'readwrite');
    first.objectStore(PROJECT_STORE).add({ id: 'taken' });
    await new Promise<void>((resolve) => first.addEventListener('complete', () => resolve()));

    const second = store.db.transaction([PROJECT_STORE], 'readwrite');
    const refused = second.objectStore(PROJECT_STORE).add({ id: 'taken' });
    refused.onerror = () => undefined;
    await new Promise<void>((resolve) => second.addEventListener('abort', () => resolve()));
    expect(refused.error?.name).toBe('ConstraintError');
    expect(factory.handlerErrors()).toEqual([]);
  });

  it('fails a request that an abort cuts short with AbortError, and does so before the transaction fires its abort event', async () => {
    const { store } = await opened();
    const order: string[] = [];
    const tx = store.db.transaction([PROJECT_STORE], 'readonly');
    const first = tx.objectStore(PROJECT_STORE).get('missing');
    const second = tx.objectStore(PROJECT_STORE).get('missing');
    first.onsuccess = () => {
      tx.abort();
    };
    second.onerror = () => {
      order.push(`error:${second.error?.name ?? 'none'}`);
    };
    await new Promise<void>((resolve) =>
      tx.addEventListener('abort', () => {
        order.push('abort');
        resolve();
      }),
    );
    expect(order).toEqual(['error:AbortError', 'abort']);
  });
});
