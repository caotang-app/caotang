/**
 * The IndexedDB runtime store — [project-format.md §4](docs/architecture/project-format.md)
 * and [§8](docs/architecture/project-format.md).
 *
 * Every test here is written against a claim a spec sentence makes, and each
 * one names the sentence it is defending. A test that would still pass with the
 * feature deleted is worse than no test, so where a claim is "this must be ONE
 * transaction", the test *fails the transaction* and looks for survivors rather
 * than asserting a success path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryArtifactFs,
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  exportProjectZip,
  getBody,
  getRevision,
  importProjectZip,
  moveNode,
  nodeById,
  readProject,
  setBody,
  writeProject,
  type ProjectState,
} from '../src/index.js';
import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import {
  DOCUMENT_STORE,
  PROJECT_STORE,
  DocumentExistsError,
  ProjectNotFoundError,
  RevisionConflictError,
  commitProject,
  deleteProject,
  guarded,
  isAbortEcho,
  listProjectIds,
  openRuntimeStore,
  readProjectState,
  writeDocumentBody,
  writeProjectState,
  type RuntimeStore,
} from '../src/runtime/store.js';

const OPENED = new Date('2026-09-30T02:00:00.000Z');
const EDITED = new Date('2026-09-30T02:15:00.000Z');

const DB = 'caotang-test';

/** A project: the three fixed roots, plus two scenes under `manuscript`. */
function fixtureProject(): ProjectState {
  const manifest = createEmptyManifest('The Lighthouse Keeper', OPENED);
  // Fixture-stable ids: the manifest mints a random project id, and these
  // tests assert on stored keys, so the id is pinned here.
  manifest.project.id = 'p_9XK2M4Q7RZ';
  const state = createProjectState(manifest);
  addDocument(state, {
    parentId: 'manuscript',
    title: 'The Landing',
    body: 'The ferry was late, as always.',
    now: OPENED,
    id: 'n_7K2QX9M4A1',
  });
  addDocument(state, {
    parentId: 'manuscript',
    title: 'The Keeper',
    body: 'He counted the ships.',
    now: OPENED,
    id: 'n_3W8RN2TQ6C',
  });
  return state;
}

/** An open store over a private in-memory database, torn down after the test. */
async function openStore(): Promise<{ factory: MemoryIndexedDb; store: RuntimeStore }> {
  const factory = new MemoryIndexedDb();
  const store = await openRuntimeStore(factory, DB);
  return { factory, store };
}

const opened: RuntimeStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function freshStore(): Promise<{
  factory: MemoryIndexedDb;
  store: RuntimeStore;
}> {
  const pair = await openStore();
  opened.push(pair.store);
  return pair;
}

// ---------------------------------------------------------------------------

describe('§4 — every mutation is one IndexedDB transaction', () => {
  it('a commit that fails part-way leaves nothing behind', async () => {
    // §4: "every mutation is one IndexedDB transaction (atomic by construction)".
    // The claim is about what survives a *failure*, so the test fails one
    // instead of exercising the happy path. A commit writes the manifest row,
    // creates one document and removes another — three writes, one mutation.
    // Aborting after the first must undo all three.
    const { factory, store } = await freshStore();
    const state = fixtureProject();

    await writeProjectState(store, state, { now: OPENED });

    const before = {
      projects: factory.rawRecords(DB, PROJECT_STORE),
      documents: factory.rawRecords(DB, DOCUMENT_STORE),
    };
    expect(before.documents).toHaveLength(2);

    // A new scene in the tree, and an old one removed: still one logical change.
    const next = fixtureProject();
    addDocument(next, {
      parentId: 'manuscript',
      title: 'The Storm',
      body: 'Weather.',
      now: EDITED,
      id: 'n_5T4WQ8JR2M',
    });
    moveNode(next, 'n_5T4WQ8JR2M', { parentId: 'manuscript', order: 5 });

    // Fail *after* the manifest write has been staged, so a store that split the
    // mutation into two transactions would commit the manifest and abort the
    // documents — a torn mutation, which is the whole thing §4 says cannot
    // happen. Both stores are asserted, so a tear in either direction fails.
    factory.abortAfterWrites(1);
    await expect(commitProject(store, {
      projectId: state.manifest.project.id,
      manifest: next.manifest,
      createDocuments: [{ id: 'n_5T4WQ8JR2M', body: 'Weather.' }],
      removeDocumentIds: ['n_3W8RN2TQ6C'],
      now: EDITED,
    })).rejects.toThrow(/failed|abort/i);

    // Nothing at all: not the manifest swap, not the new row, not the deletion.
    expect(factory.rawRecords(DB, PROJECT_STORE)).toEqual(before.projects);
    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(before.documents);

    // And the store still reads the project it had before the failed mutation.
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(reloaded.manifest.tree).toHaveLength(5);
    expect(getBody(reloaded, 'n_3W8RN2TQ6C')).toBe('He counted the ships.');
    expect(reloaded.documents.has('n_5T4WQ8JR2M')).toBe(false);
  });

  it('a commit that fails after one write of two also rolls the first back', async () => {
    // The same claim, tested at the other boundary: the fault lands *after* a
    // write has already been staged, which is the case a hand-rolled
    // "undo on error" gets wrong and a transaction gets right for free.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    const before = factory.rawRecords(DB, DOCUMENT_STORE);
    const projectsBefore = factory.rawRecords(DB, PROJECT_STORE);

    const next = fixtureProject();
    addDocument(next, {
      parentId: 'manuscript',
      title: 'The Storm',
      body: 'Weather.',
      now: EDITED,
      id: 'n_5T4WQ8JR2M',
    });

    factory.abortAfterWrites(1);
    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: next.manifest,
        createDocuments: [{ id: 'n_5T4WQ8JR2M' }],
        now: EDITED,
      }),
    ).rejects.toThrow();

    // Both stores, not just the document one: a store that split the mutation
    // would leave the manifest swapped in while the document write rolled back.
    expect(factory.rawRecords(DB, PROJECT_STORE)).toEqual(projectsBefore);
    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(before);
  });

  it('a failed document write leaves the body and the revision exactly as they were', async () => {
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_7K2QX9M4A1',
      body: 'The ferry was early.',
    });

    const before = factory.rawRecords(DB, DOCUMENT_STORE);
    expect(before).toHaveLength(2);

    factory.abortAfterWrites(0);
    await expect(
      writeDocumentBody(store, {
        projectId: state.manifest.project.id,
        docId: 'n_7K2QX9M4A1',
        body: 'The ferry was three hours early.',
      }),
    ).rejects.toThrow();

    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(before);
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_7K2QX9M4A1')).toBe('The ferry was early.');
    expect(getRevision(reloaded, 'n_7K2QX9M4A1')).toBe(1);
  });
});

describe('§4 — every mutation bumps a per-document revision', () => {
  it('bumps by one per content write and reports the new revision', async () => {
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    expect(getRevision(await readProjectState(store, state.manifest.project.id), 'n_3W8RN2TQ6C'))
      .toBe(0);

    const first = await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'He counted the ships twice.',
    });
    expect(first).toEqual({ revision: 1, changed: true });

    const second = await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'He counted the ships twice, and then again.',
    });
    expect(second).toEqual({ revision: 2, changed: true });
  });

  it('an identical write is not a mutation and does not burn a revision', async () => {
    // `state.ts` refuses a same-body write for the same reason (§4 counts
    // mutations, not keystrokes), and the store must not disagree with it: a
    // bumped revision with unchanged content would make the agent's
    // `expectedRevision` fail for no reason.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    const result = await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'He counted the ships.',
    });

    expect(result).toEqual({ revision: 0, changed: false });
    expect(getRevision(await readProjectState(store, state.manifest.project.id), 'n_3W8RN2TQ6C'))
      .toBe(0);
  });

  it('survives a reload, because the counter is runtime state and not manifest state', async () => {
    // The counter is not in `caotang.json` — that would make every save diff —
    // but a revision that restarted at 0 on reopen would let an
    // `expectedRevision` captured before the reload match a document that had
    // moved on, which is the one failure the counter exists to catch.
    //
    // The reload is a *new connection to the same database*, which is what a
    // tab reopen is: the binding's data lives on the factory, not the
    // connection, exactly as it does in a browser.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'He counted the ships twice.',
    });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'Three times.',
    });
    store.close();

    const reopened = await openRuntimeStore(factory, DB);
    opened.push(reopened);
    const reloaded = await readProjectState(reopened, state.manifest.project.id);
    expect(getRevision(reloaded, 'n_3W8RN2TQ6C')).toBe(2);
    expect(getBody(reloaded, 'n_3W8RN2TQ6C')).toBe('Three times.');

    // And the stored revision is still enforced against that captured value.
    await expect(
      writeDocumentBody(reopened, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'Four times.',
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
});

describe('§4/command-bus §6 — the revision guard is inside the write transaction', () => {
  it('rejects a stale expectedRevision and leaves the document untouched', async () => {
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'First edit.',
    });

    await expect(
      writeDocumentBody(store, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'The agent\'s version.',
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ name: 'RevisionConflictError', expected: 0, actual: 1 });

    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_3W8RN2TQ6C')).toBe('First edit.');
    expect(getRevision(reloaded, 'n_3W8RN2TQ6C')).toBe(1);
  });

  it('accepts the current revision', async () => {
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    const result = await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'A write with a correct guard.',
      expectedRevision: 0,
    });
    expect(result).toEqual({ revision: 1, changed: true });
  });

  it('two connections writing at once both land — no lost update', async () => {
    // Two *unguarded* writers. Neither passes an `expectedRevision`, so this says
    // nothing about where the guard lives — it says that the binding serialises
    // overlapping readwrite transactions, so two tabs editing one document do not
    // interleave. The guard's own location is the next test, which is the one
    // that fails if the read moves out of the write transaction.
    const factory = new MemoryIndexedDb();
    const first = await openRuntimeStore(factory, DB);
    const second = await openRuntimeStore(factory, DB);
    opened.push(first, second);

    const state = fixtureProject();
    await writeProjectState(first, state, { now: OPENED });

    await Promise.all([
      writeDocumentBody(first, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'Edited in tab one.',
      }),
      writeDocumentBody(second, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'Edited in tab two.',
      }),
    ]);

    const reloaded = await readProjectState(first, state.manifest.project.id);
    expect(getRevision(reloaded, 'n_3W8RN2TQ6C')).toBe(2);
    expect(['Edited in tab one.', 'Edited in tab two.']).toContain(
      getBody(reloaded, 'n_3W8RN2TQ6C'),
    );
  });

  it('two connections guarding the same revision — one lands, one is refused', async () => {
    // The test that says where the guard *lives*. Both tabs captured revision 0
    // and both write, so the only thing that can refuse the second one is a guard
    // that reads the row **inside its own write transaction**: a check-then-act
    // guard pre-reads 0 in a readonly transaction, opens a second transaction to
    // write, and both edits land with no error anywhere — the lost update this
    // invariant exists to prevent, invisible in the body and obvious in the
    // counter.
    //
    // Mutation-checked: moving the comparison into a separate
    // pre-read transaction and deleting it from the write transaction leaves the
    // test above fully green. This one fails — both writes land. That asymmetry is
    // the point: the revision-reaching-2 assertion above proves serialization, not
    // the guard's location, and only this shape can tell the two apart.
    const factory = new MemoryIndexedDb();
    const first = await openRuntimeStore(factory, DB);
    const second = await openRuntimeStore(factory, DB);
    opened.push(first, second);

    const state = fixtureProject();
    await writeProjectState(first, state, { now: OPENED });

    const results = await Promise.allSettled([
      writeDocumentBody(first, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'Edited in tab one.',
        expectedRevision: 0,
      }),
      writeDocumentBody(second, {
        projectId: state.manifest.project.id,
        docId: 'n_3W8RN2TQ6C',
        body: 'Edited in tab two.',
        expectedRevision: 0,
      }),
    ]);

    const landed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // `actual: 1` is the half that says *why*: the second writer read the row the
    // first had already bumped. A guard that reported `actual: 0` would mean it
    // compared against a value it had read before the first write committed.
    expect(refused[0]!.reason).toBeInstanceOf(RevisionConflictError);
    expect(refused[0]!.reason).toMatchObject({ expected: 0, actual: 1 });

    // And the refusal changed nothing: one body, one revision.
    const reloaded = await readProjectState(first, state.manifest.project.id);
    expect(getRevision(reloaded, 'n_3W8RN2TQ6C')).toBe(1);
    expect(['Edited in tab one.', 'Edited in tab two.']).toContain(
      getBody(reloaded, 'n_3W8RN2TQ6C'),
    );
  });

  it('refuses a write to a document that has no row', async () => {
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    await expect(
      writeDocumentBody(store, {
        projectId: state.manifest.project.id,
        docId: 'n_NOTAREALID',
        body: 'A document that does not exist.',
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe('§4 — a structural commit creates documents; it never overwrites one', () => {
  it('refuses a createDocuments entry naming a document that already exists', async () => {
    // Reproduced rather than re-read: one `commitProject` naming
    // an existing id used to overwrite that document's body and restart its
    // revision at 0. The row here is at revision 1 with a written body, so both
    // halves of the damage are visible in the assertions below.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_7K2QX9M4A1',
      body: 'The ferry was early, for once.',
    });
    const before = factory.rawRecords(DB, DOCUMENT_STORE);

    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: state.manifest,
        createDocuments: [{ id: 'n_7K2QX9M4A1', body: 'Something else entirely.' }],
        now: EDITED,
      }),
    ).rejects.toBeInstanceOf(DocumentExistsError);

    // Storage first, then the read path: a write-path assertion alone could be
    // satisfied by a row that is correct on disk and wrong in the state.
    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(before);
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_7K2QX9M4A1')).toBe('The ferry was early, for once.');
    expect(getRevision(reloaded, 'n_7K2QX9M4A1')).toBe(1);
  });

  it('names the document in the refusal, because ConstraintError names no id', async () => {
    // One commit creates several rows, so "a key already exists" leaves the
    // caller unable to say *which* document collided — and command-bus.md §6
    // needs the fact before it can write the `CommandError` a user can act on.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    const refusal = await commitProject(store, {
      projectId: state.manifest.project.id,
      manifest: state.manifest,
      createDocuments: [{ id: 'n_3W8RN2TQ6C', body: 'A different Keeper.' }],
      now: EDITED,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(DocumentExistsError);
    const error = refusal as DocumentExistsError;
    expect(error.docId).toBe('n_3W8RN2TQ6C');
    expect(error.projectId).toBe(state.manifest.project.id);
    expect(error.message).toContain('n_3W8RN2TQ6C');
    // The binding's own exception is the cause, not the answer: a caller
    // switching on `name` must not meet the platform's spelling by accident.
    expect(error.name).not.toBe('ConstraintError');
  });

  it('a refused commit is atomic too — the manifest, the other creates and the removals all roll back', async () => {
    // §4: "every mutation is one IndexedDB transaction (atomic by construction)".
    // The claim is usually read as being about failures, and a refusal is a
    // failure. The new document is staged *before* the one that is refused on
    // purpose: an implementation that stopped the loop and returned, instead of
    // aborting, would commit that row and the deletion and leave the project
    // with a manifest naming a document that was never created.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    const projectsBefore = factory.rawRecords(DB, PROJECT_STORE);
    const documentsBefore = factory.rawRecords(DB, DOCUMENT_STORE);

    const next = fixtureProject();
    addDocument(next, {
      parentId: 'manuscript',
      title: 'The Storm',
      body: 'Weather.',
      now: EDITED,
      id: 'n_5T4WQ8JR2M',
    });
    moveNode(next, 'n_5T4WQ8JR2M', { parentId: 'manuscript', order: 5 });

    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: next.manifest,
        createDocuments: [
          { id: 'n_5T4WQ8JR2M', body: 'Weather.' },
          { id: 'n_7K2QX9M4A1', body: 'The Landing, rewritten.' },
        ],
        removeDocumentIds: ['n_3W8RN2TQ6C'],
        now: EDITED,
      }),
    ).rejects.toBeInstanceOf(DocumentExistsError);

    expect(factory.rawRecords(DB, PROJECT_STORE)).toEqual(projectsBefore);
    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(documentsBefore);
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_3W8RN2TQ6C')).toBe('He counted the ships.');
    expect(reloaded.documents.has('n_5T4WQ8JR2M')).toBe(false);
  });

  it('two entries in one commit for the same id are refused too', async () => {
    // This is the only case that can tell a **pre-transaction** read from the
    // store's own constraint: the second id is not in the store *yet* — it is in
    // this transaction's own writes — so a lookup taken before the transaction
    // waves it through, and the second entry overwrites the row the first one
    // just staged.
    //
    // What this test does **not** separate is narrower than the docs/decisions.md
    // claimed when it called the constraint and "a pre-read" opposites. Measured:
    // keeping `add` and adding a per-entry `documents.get` *inside* the same
    // transaction — an in-transaction read, which sees the transaction's own
    // writes — leaves all 467 tests green, including this one. The discriminator
    // is therefore **when** the lookup happens, not whether one happens, and the
    // reason `add` is still the right call is the one the code gives: a
    // constraint cannot be forgotten or reordered, where a check this function
    // performs can be. The test pins the outcome; it does not pin the mechanism.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    const projectsBefore = factory.rawRecords(DB, PROJECT_STORE);
    const before = factory.rawRecords(DB, DOCUMENT_STORE);

    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: state.manifest,
        createDocuments: [
          { id: 'n_5T4WQ8JR2M', body: 'The Storm.' },
          { id: 'n_5T4WQ8JR2M', body: 'The Storm, again.' },
        ],
        now: EDITED,
      }),
    ).rejects.toBeInstanceOf(DocumentExistsError);

    // Neither the manifest the commit carried nor the first entry: the abort is
    // the whole transaction, not the request that failed. `storedAt` is what
    // makes the project row a witness here — a commit at `EDITED` would have
    // moved it, so equality means the write did not land.
    expect(factory.rawRecords(DB, PROJECT_STORE)).toEqual(projectsBefore);
    expect(factory.rawRecords(DB, DOCUMENT_STORE)).toEqual(before);
    expect((projectsBefore[0] as { storedAt: string }).storedAt).not.toBe(
      EDITED.toISOString(),
    );
  });

  it('the counter is not poisoned — a later write still bumps from where it was', async () => {
    // A clobbered row does not merely lose a body: it takes the counter with
    // it, so every revision an agent captured before the refusal is now wrong
    // by one and the next guarded write refuses a document nobody touched. The
    // write below carries `expectedRevision: 1`, which is the number the
    // clobbering version would have made un-matchable.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_7K2QX9M4A1',
      body: 'The ferry was early, for once.',
    });

    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: state.manifest,
        createDocuments: [{ id: 'n_7K2QX9M4A1', body: 'Something else entirely.' }],
        now: EDITED,
      }),
    ).rejects.toBeInstanceOf(DocumentExistsError);

    await expect(
      writeDocumentBody(store, {
        projectId: state.manifest.project.id,
        docId: 'n_7K2QX9M4A1',
        body: 'The ferry was early twice.',
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ revision: 2, changed: true });
  });

  it('still creates the documents that are new, and still removes the ones that left the tree', async () => {
    // The over-correction, written down as a test because a guard that refuses
    // everything would pass every other assertion in this block: the refusal is
    // worthless if it is what a *correct* commit gets instead of a mistake.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    const next = fixtureProject();
    addDocument(next, {
      parentId: 'manuscript',
      title: 'The Storm',
      body: 'Weather.',
      now: EDITED,
      id: 'n_5T4WQ8JR2M',
    });
    moveNode(next, 'n_5T4WQ8JR2M', { parentId: 'manuscript', order: 5 });

    await commitProject(store, {
      projectId: state.manifest.project.id,
      manifest: next.manifest,
      createDocuments: [{ id: 'n_5T4WQ8JR2M', body: 'Weather.' }],
      removeDocumentIds: ['n_3W8RN2TQ6C'],
      now: EDITED,
    });

    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_5T4WQ8JR2M')).toBe('Weather.');
    // A created row starts at 0, and only `writeDocumentBody` moves it.
    expect(getRevision(reloaded, 'n_5T4WQ8JR2M')).toBe(0);
    expect(reloaded.documents.has('n_3W8RN2TQ6C')).toBe(false);
  });

  it('the same document id in another project is not a collision', async () => {
    // Documents are keyed `[projectId, id]`, so the refusal is per project. A
    // guard that compared the bare id would refuse the second project and make
    // a single store unable to hold two projects at all — the failure the
    // "keeps two projects apart" test in this file is already about. The second
    // project therefore starts empty, so the create below is the first write of
    // that id *in that project* while the first project already holds it.
    const { store } = await freshStore();
    const first = fixtureProject();
    await writeProjectState(store, first, { now: OPENED });

    const second = createEmptyManifest('Second', OPENED);
    second.project.id = 'p_2SECONDPROJ';
    await writeProjectState(store, createProjectState(second), { now: OPENED });

    const next = createProjectState(second);
    addDocument(next, {
      parentId: 'manuscript',
      title: 'The Keeper',
      body: 'Only the second project.',
      now: EDITED,
      id: 'n_3W8RN2TQ6C',
    });

    await expect(
      commitProject(store, {
        projectId: 'p_2SECONDPROJ',
        manifest: next.manifest,
        createDocuments: [{ id: 'n_3W8RN2TQ6C', body: 'Only the second project.' }],
        now: EDITED,
      }),
    ).resolves.toBeUndefined();

    const reloaded = await readProjectState(store, 'p_2SECONDPROJ');
    expect(getBody(reloaded, 'n_3W8RN2TQ6C')).toBe('Only the second project.');
    // And the project that already had it is untouched.
    const other = await readProjectState(store, first.manifest.project.id);
    expect(getBody(other, 'n_3W8RN2TQ6C')).toBe('He counted the ships.');
  });

  it('writeProjectState still overwrites — the wholesale-replace path is not this rule', async () => {
    // The boundary, pinned because it is a comment otherwise. Import and
    // export hand this function a whole `ProjectState` that *is* the truth
    // about what exists, so overwriting a row is its job. Only the two
    // functions that decide what a single commit means refuse to overwrite a
    // row somebody else wrote, and "both write paths now use add" would break
    // the artifact round-trip with a green suite.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: state.manifest.project.id,
      docId: 'n_7K2QX9M4A1',
      body: 'The ferry was early, for once.',
    });

    const reimported = fixtureProject();
    reimported.documents.set('n_7K2QX9M4A1', {
      id: 'n_7K2QX9M4A1',
      body: 'Replaced wholesale.',
      revision: 4,
    });
    await writeProjectState(store, reimported, { now: EDITED });

    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_7K2QX9M4A1')).toBe('Replaced wholesale.');
    // The state is the authority, and it carried 4 — an artifact has no
    // revision of its own, which is why an import may set one.
    expect(getRevision(reloaded, 'n_7K2QX9M4A1')).toBe(4);
  });
});

describe('§8 — lossless round-trip to the artifact, with the runtime store in the loop', () => {
  it('artifact → runtime store → artifact is byte-identical', async () => {
    // §8: "open artifact → mutate → export → diff against in-memory project
    // state = empty". The store header calls the round-trip the acceptance test
    // for *any* runtime store, and this is the slice where the store enters the
    // loop for the first time: the state that was read from files goes into
    // IndexedDB, comes back out, and is written to a second folder.
    const source = new MemoryArtifactFs();
    const original = fixtureProject();
    await writeProject(source, original, { now: OPENED });

    const store = (await freshStore()).store;
    const ingested = await readProject(source);
    await writeProjectState(store, ingested.state, { now: OPENED });
    const fromStore = await readProjectState(store, ingested.state.manifest.project.id);

    const target = new MemoryArtifactFs();
    await writeProject(target, fromStore, { now: OPENED });

    expect(target.snapshot()).toEqual(source.snapshot());
  });

  it('round-trips twice with a reorg in between, and the docs are identical', async () => {
    // §8's second clause: "round-trip twice with a reorg in between = identical
    // docs content". The reorg is the interesting part — §1 puts opaque-id
    // filenames on disk precisely so that a reparent never touches the files,
    // and a store that re-derived names from structure would break that.
    const first = new MemoryArtifactFs();
    const original = fixtureProject();
    await writeProject(first, original, { now: OPENED });

    const store = (await freshStore()).store;
    const state = (await readProject(first)).state;
    await writeProjectState(store, state, { now: OPENED });

    // Reorg: the two scenes move under a new folder, and one is renamed.
    const reorged = (await readProjectState(store, state.manifest.project.id));
    addFolder(reorged, { parentId: 'root', title: 'Part Two', now: EDITED, id: 'n_9PART2F01D' });
    moveNode(reorged, 'n_7K2QX9M4A1', { parentId: 'n_9PART2F01D', order: 10 });
    const keeper = nodeById(reorged, 'n_3W8RN2TQ6C');
    if (keeper) keeper.title = 'The Keeper of the Light';
    setBody(reorged, 'n_3W8RN2TQ6C', 'He counted the ships, and then the lights.');

    const second = new MemoryArtifactFs();
    await writeProject(second, reorged, { now: EDITED });
    await writeProjectState(store, reorged, { now: EDITED });

    const third = new MemoryArtifactFs();
    const roundTripped = await readProjectState(store, reorged.manifest.project.id);
    await writeProject(third, roundTripped, { now: EDITED });

    // Identical docs content between the two exports …
    expect(third.snapshot()).toEqual(second.snapshot());
    // … and the reorg survived, so the reparent really did travel through the
    // store rather than being flattened on the way in.
    const finalState = (await readProject(third)).state;
    expect(nodeById(finalState, 'n_7K2QX9M4A1')?.parentId).toBe('n_9PART2F01D');
    expect(nodeById(finalState, 'n_3W8RN2TQ6C')?.title).toBe('The Keeper of the Light');
    expect(getBody(finalState, 'n_3W8RN2TQ6C')).toBe('He counted the ships, and then the lights.');
  });

  it('a document removed from the tree loses its row, and says which', async () => {
    // The reconcile is exact on purpose: keeping the row would resurrect a
    // deleted document on the next export. The removed ids come back so the
    // caller can report it rather than discovering it later.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    const next = await readProjectState(store, state.manifest.project.id);
    next.manifest.tree = next.manifest.tree.filter((n) => n.id !== 'n_3W8RN2TQ6C');
    next.documents.delete('n_3W8RN2TQ6C');

    const result = await writeProjectState(store, next, { now: EDITED });
    expect(result.removedDocumentIds).toEqual(['n_3W8RN2TQ6C']);

    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(reloaded.documents.has('n_3W8RN2TQ6C')).toBe(false);
    expect(getBody(reloaded, 'n_7K2QX9M4A1')).toBe('The ferry was late, as always.');
  });
});

/**
 * A decline is decided at load, so it has to survive everything between
 * that load and the write that acts on it. This store is what sits in between:
 * autosave writes here and an export reads the state back out, so a record that
 * lives only in memory protects the file for exactly one session.
 */
/**
 * A store whose transaction aborts as the first `get` on it succeeds, so the callback the store runs on that success finds the
 * transaction already aborted. A real browser can leave a callback in that state when a failure elsewhere in the transaction aborts
 * it under a request. The wrapper changes nothing else: every other call passes straight through to the fake.
 */
function abortingAfterFirstSuccess(store: RuntimeStore): RuntimeStore {
  const realDb = store.db;
  const db = new Proxy(realDb, {
    get(target, property) {
      if (property !== 'transaction') {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (names: string | string[], mode?: IDBTransactionMode): IDBTransaction => {
        const tx = target.transaction(names, mode);
        const objectStoreOf = tx.objectStore.bind(tx);
        tx.objectStore = (name: string): IDBObjectStore => {
          const real = objectStoreOf(name);
          return new Proxy(real, {
            get(inner, key) {
              if (key !== 'get') {
                const value: unknown = Reflect.get(inner, key, inner);
                return typeof value === 'function' ? value.bind(inner) : value;
              }
              return (...args: unknown[]): IDBRequest => {
                const request = (inner.get as (...rest: unknown[]) => IDBRequest).apply(inner, args);
                let handler: ((this: IDBRequest, event: Event) => unknown) | null = null;
                Object.defineProperty(request, 'onsuccess', {
                  configurable: true,
                  get: () => handler,
                  set: (next: ((this: IDBRequest, event: Event) => unknown) | null) => {
                    handler = function (this: IDBRequest, event: Event): unknown {
                      tx.abort();
                      return next?.call(this, event);
                    };
                  },
                });
                return request;
              };
            },
          });
        };
        return tx;
      };
    },
  });
  return { ...store, db } as RuntimeStore;
}

describe('§4 — a request whose transaction is aborted underneath it', () => {
  it('a read whose transaction is aborted under its callback rejects through the abort, and throws nothing out of the event loop', async () => {
    // The callback issues its next request after the transaction has aborted, which a browser reports as an uncaught exception. The
    // binding records any such exception that escapes a callback, so the outcome pinned is two things: the promise rejects through the
    // abort, and nothing escaped the guard, which the binding's record shows. The guard's own behaviour is pinned by the unit tests below.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    await expect(readProjectState(abortingAfterFirstSuccess(store), state.manifest.project.id)).rejects.toThrow(
      'the transaction was aborted',
    );
    expect(factory.handlerErrors(), 'a callback let an exception escape the guard').toEqual([]);

    // The store is not left unusable: the next read, on a transaction nothing aborted, returns the project.
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(getBody(reloaded, 'n_7K2QX9M4A1')).toBe('The ferry was late, as always.');
  });

  it('a commit whose callback throws rejects with that error, and writes nothing from the refused commit', async () => {
    // A manifest a structured clone cannot copy: the put inside the commit's callback throws, as a browser's would. The commit is refused
    // with that error, and the refusal writes nothing.
    const { factory, store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    const unclonable = {
      ...state.manifest,
      project: { ...state.manifest.project, name: 'Renamed By The Refused Commit' },
      unclonable: () => 'a function is not data',
    } as unknown as typeof state.manifest;

    const failure: unknown = await commitProject(store, {
      projectId: state.manifest.project.id,
      manifest: unclonable,
      now: EDITED,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as { name?: string } | undefined)?.name).toBe('DataCloneError');
    expect(factory.handlerErrors(), 'a callback let an exception escape the guard').toEqual([]);

    // The refused commit's manifest was never written: the project still holds the name it was created with.
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(reloaded.manifest.project.name).toBe(state.manifest.project.name);
  });

  it('a refusal names its own cause, not the abort that the refusal caused (the first cause is the one reported)', async () => {
    // The commit's first document collides, which aborts the transaction; the second document's request is then cut short by that abort.
    // The refusal the caller gets is the collision, and the abort does not replace it.
    const { store } = await freshStore();
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });

    await expect(
      commitProject(store, {
        projectId: state.manifest.project.id,
        manifest: state.manifest,
        createDocuments: [{ id: 'n_7K2QX9M4A1', body: 'Taken.' }, { id: 'n_NEWNEWNEW0', body: 'New.' }],
        now: EDITED,
      }),
    ).rejects.toBeInstanceOf(DocumentExistsError);
    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect(nodeById(reloaded, 'n_NEWNEWNEW0')).toBeUndefined();
  });
});

// The two helpers the transactions are built on. The fake binding turns an exception out of a handler into an abort of its own, so
// the integration tests above cannot tell a guarded callback from a bare one. These tests can: each fails if the guard or the echo rule
// is removed or inverted.
describe('the request guard and the abort echo', () => {
  it('a callback that throws is reported through fail, and nothing escapes it', () => {
    const boom = new Error('boom');
    const fail = vi.fn();
    expect(() =>
      guarded(fail, () => {
        throw boom;
      })(),
    ).not.toThrow();
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(boom);
  });

  it('a callback that does not throw runs once, and fail is not called', () => {
    let ran = 0;
    const fail = vi.fn();
    guarded(fail, () => {
      ran += 1;
    })();
    expect(ran).toBe(1);
    expect(fail).not.toHaveBeenCalled();
  });

  it('names the errors that say a transaction has ended, and no other error', () => {
    for (const name of ['TransactionInactiveError', 'InvalidStateError', 'AbortError']) {
      expect(isAbortEcho(Object.assign(new Error('x'), { name })), name).toBe(true);
    }
    for (const name of ['DataCloneError', 'ConstraintError', 'QuotaExceededError']) {
      expect(isAbortEcho(Object.assign(new Error('x'), { name })), name).toBe(false);
    }
    expect(isAbortEcho(new DocumentExistsError('p', 'n'))).toBe(false);
    expect(isAbortEcho(undefined)).toBe(false);
  });
});

describe('the decline a load recorded survives the store round-trip', () => {
  const STRAY = 'codex/c_VANSHED002.md';
  const BROKEN = 'Elena keeps the light.\n';

  /** An artifact with a `codex/` file whose front matter does not parse. */
  async function folderWithStrayFile(): Promise<MemoryArtifactFs> {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, fixtureProject(), { now: OPENED });
    fs.putFile(STRAY, BROKEN);
    return fs;
  }

  it('a state read back out of the store still declines the file, so saving over the project keeps it', async () => {
    // Written back to the folder the load came from, which is the case that
    // loses data: the prune runs against files that are on disk there.
    //
    // **The export case is covered now.** Until that change this comment
    // said an export lost the declined file outright: `exportProjectZip` builds a
    // fresh folder from state, and the file's text was in neither the source folder
    // nor the state. The state now carries the text (`ProjectState.declinedText`),
    // the store persists it with the sets, and `writeProject` carries it into any
    // target that does not hold the file. Measured by the export tests below and in
    // `zip.test.ts`, "keeps a codex file the loader declined".
    const source = await folderWithStrayFile();
    const { store } = await freshStore();
    const loaded = await readProject(source, { now: OPENED });

    await writeProjectState(store, loaded.state, { now: OPENED });
    const fromStore = await readProjectState(store, loaded.state.manifest.project.id);

    expect([...fromStore.declinedCodexFiles]).toEqual(['c_VANSHED002.md']);

    const report = await writeProject(source, fromStore, { now: EDITED });

    expect(report.pruned).toEqual([]);
    expect(await source.read(STRAY)).toBe(BROKEN);
  });

  it('a structural commit does not clear it — the record belongs to the load, not the commit', async () => {
    // `commitProject` carries a manifest and nothing else. A blind `put` would
    // drop the field here, and the *next* export would prune the file: the same
    // data loss, one structural command later, which is how a fix like this
    // quietly stops holding.
    const source = await folderWithStrayFile();
    const { store } = await freshStore();
    const loaded = await readProject(source, { now: OPENED });
    await writeProjectState(store, loaded.state, { now: OPENED });

    await commitProject(store, {
      projectId: loaded.state.manifest.project.id,
      manifest: loaded.state.manifest,
      now: EDITED,
    });

    const afterCommit = await readProjectState(store, loaded.state.manifest.project.id);
    expect([...afterCommit.declinedCodexFiles]).toEqual(['c_VANSHED002.md']);
  });

  it('the text of a declined file survives the store, so an export from a rehydrated state carries it', async () => {
    // The export reads a state that was rehydrated from the store, not the folder
    // the load came from, so the text has to have survived the row — the sets alone
    // say which file to keep and not what it held.
    const source = await folderWithStrayFile();
    const { store } = await freshStore();
    const loaded = await readProject(source, { now: OPENED });
    await writeProjectState(store, loaded.state, { now: OPENED });

    const fromStore = await readProjectState(store, loaded.state.manifest.project.id);
    expect(fromStore.declinedText.get(STRAY)).toBe(BROKEN);

    const imported = await importProjectZip((await exportProjectZip(fromStore, { now: EDITED })).bytes);
    expect(await imported.fs.read(STRAY)).toBe(BROKEN);
  });

  it('a row written before the field existed declines nothing rather than everything', async () => {
    // Absent means "this row's load read every file", not "prune anything" —
    // the distinction is the difference between a missing column and a
    // destructive default.
    const { store } = await freshStore();
    const state = fixtureProject();

    await commitProject(store, { projectId: state.manifest.project.id, manifest: state.manifest });

    const reloaded = await readProjectState(store, state.manifest.project.id);
    expect([...reloaded.declinedCodexFiles]).toEqual([]);
  });
});

describe('project bookkeeping', () => {
  it('lists, deletes and reports a missing project honestly', async () => {
    const { store } = await freshStore();
    const a = fixtureProject();
    await writeProjectState(store, a, { now: OPENED });

    const b = fixtureProject();
    b.manifest.project.id = 'p_2SECONDPROJ';
    b.manifest.project.name = 'Second';
    await writeProjectState(store, b, { now: OPENED });

    expect(await listProjectIds(store)).toEqual(['p_2SECONDPROJ', 'p_9XK2M4Q7RZ']);

    expect(await deleteProject(store, 'p_2SECONDPROJ')).toBe(true);
    expect(await listProjectIds(store)).toEqual(['p_9XK2M4Q7RZ']);
    // Deleting what is not there is a no-op that says so, rather than throwing
    // on a second delete of an already-deleted project.
    expect(await deleteProject(store, 'p_2SECONDPROJ')).toBe(false);

    await expect(readProjectState(store, 'p_9XK2M4Q7RZ')).resolves.toBeTruthy();
    await expect(readProjectState(store, 'p_MISSING0000')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('keeps two projects in one store apart', async () => {
    // Documents are keyed by `[projectId, id]`, so the same document id in two
    // projects must not collide — a single-store-per-project layout would make
    // this a schema migration the day a second project is opened.
    const { store } = await freshStore();
    const a = fixtureProject();
    const b = fixtureProject();
    b.manifest.project.id = 'p_2SECONDPROJ';

    await writeProjectState(store, a, { now: OPENED });
    await writeProjectState(store, b, { now: OPENED });
    await writeDocumentBody(store, {
      projectId: a.manifest.project.id,
      docId: 'n_3W8RN2TQ6C',
      body: 'Only in the first project.',
    });

    const first = await readProjectState(store, a.manifest.project.id);
    const second = await readProjectState(store, b.manifest.project.id);
    expect(getBody(first, 'n_3W8RN2TQ6C')).toBe('Only in the first project.');
    expect(getBody(second, 'n_3W8RN2TQ6C')).toBe('He counted the ships.');
    expect(getRevision(first, 'n_3W8RN2TQ6C')).toBe(1);
    expect(getRevision(second, 'n_3W8RN2TQ6C')).toBe(0);
  });
});
