import { expect, test } from '@playwright/test';

import {
  MemoryArtifactFs,
  MemoryIndexedDb,
  commitProject,
  openRuntimeStore,
  readProjectState,
  setBody,
  writeDocumentBody,
  writeProject,
  writeProjectState,
  type RuntimeStore,
} from '../../packages/store/src/index.js';

import { Persistence, isStaleWrite } from '../../apps/desktop/src/app/persistence.js';
import { planPersistence, shadowOf } from '../../apps/desktop/src/app/persistence-plan.js';

import { IDS, project } from './fixtures.js';

test.describe('what the store must be told', () => {
  test('a project the store has never seen is written in full', () => {
    expect(planPersistence(null, project()).kind).toBe('full');
  });

  test('nothing changed means nothing to write', () => {
    const state = project();
    expect(planPersistence(shadowOf(state), state)).toEqual({ kind: 'none' });
  });

  test('a body that moved by one revision is an incremental body write, guarded by the revision it replaces', () => {
    const state = project();
    const shadow = shadowOf(state);
    // `setBody` is the path every body edit takes: it bumps the revision and the word count.
    setBody(state, IDS.sceneA, 'Four little words here, and one more');
    const plan = planPersistence(shadow, state);
    expect(plan.kind).toBe('incremental');
    if (plan.kind !== 'incremental') return;
    expect(plan.bodies).toEqual([
      { docId: IDS.sceneA, body: 'Four little words here, and one more', expectedRevision: 0 },
    ]);
    // The word count lives in the manifest, so the structure is written too.
    expect(plan.manifest).not.toBeNull();
    expect(plan.createDocuments).toEqual([]);
    expect(plan.removeDocumentIds).toEqual([]);
  });

  test('a new document at revision zero is created by the structural commit', () => {
    const state = project();
    const shadow = shadowOf(state);
    state.documents.set('n_NEWDOC0000', { id: 'n_NEWDOC0000', body: 'Fresh', revision: 0 });
    const plan = planPersistence(shadow, state);
    expect(plan.kind).toBe('incremental');
    if (plan.kind !== 'incremental') return;
    expect(plan.createDocuments).toEqual([{ id: 'n_NEWDOC0000', body: 'Fresh' }]);
    expect(plan.manifest).not.toBeNull();
  });

  test('a restored document, which carries a revision other than zero, needs the whole project written', () => {
    const state = project();
    const shadow = shadowOf(state);
    state.documents.set('n_RESTORED00', { id: 'n_RESTORED00', body: 'Back', revision: 4 });
    expect(planPersistence(shadow, state).kind).toBe('full');
  });

  test('a body whose revision moved by anything but one is written whole, because the planner cannot read it as a write', () => {
    const state = project();
    const shadow = shadowOf(state);
    // No undo moves the revision down any more (an undo is a write, command-bus §5), so this is a revision the planner
    // cannot account for; it is written whole rather than guessed at.
    const doc = state.documents.get(IDS.sceneA)!;
    doc.body = '';
    doc.revision = 0;
    expect(planPersistence(shadow, state).kind).toBe('full');
  });

  test('a removed document is named for removal, and the manifest goes with it', () => {
    const state = project();
    const shadow = shadowOf(state);
    state.documents.delete(IDS.sceneC);
    state.manifest.tree = state.manifest.tree.filter((node) => node.id !== IDS.sceneC);
    const plan = planPersistence(shadow, state);
    expect(plan.kind).toBe('incremental');
    if (plan.kind !== 'incremental') return;
    expect(plan.removeDocumentIds).toEqual([IDS.sceneC]);
    expect(plan.manifest).not.toBeNull();
  });

  test('the plan describes the state at planning time, so a later edit cannot leak into it', () => {
    const state = project();
    const shadow = shadowOf(state);
    setBody(state, IDS.sceneA, 'Changed once');
    const plan = planPersistence(shadow, state);
    setBody(state, IDS.sceneA, 'Changed again, after planning');
    if (plan.kind !== 'incremental') throw new Error('expected an incremental plan');
    expect(plan.bodies[0]?.body).toBe('Changed once');
    expect(plan.next.docs.get(IDS.sceneA)).toEqual({ body: 'Changed once', revision: 1 });
  });
});

/**
 * A store whose transactions are refused while `full` says the disk is full, and which works again once it says otherwise. Nothing
 * about the refusal is a revision, so the store's own guards have nothing to say about it.
 */
function fullDiskStore(store: RuntimeStore, full: () => boolean): RuntimeStore {
  const db = new Proxy(store.db, {
    get(target, property) {
      if (property === 'transaction') {
        return (storeNames: string | string[], mode?: IDBTransactionMode) => {
          if (full()) throw new Error('the disk is full');
          return target.transaction(storeNames, mode);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db, name: store.name, close: () => store.close() };
}

/** A store seeded with the fixture project, and a persistence queue for it, as a session holds them. */
async function seeded(): Promise<{ store: RuntimeStore; state: ReturnType<typeof project>; persistence: Persistence }> {
  const state = project();
  const store = await openRuntimeStore(new MemoryIndexedDb());
  await writeProjectState(store, state);
  const persistence = new Persistence(store, state.manifest.project.id, () => state, shadowOf(state));
  return { store, state, persistence };
}

test.describe('a stale tab stops, and does not overwrite newer text', () => {
  test('a body the store refuses because another writer moved it stops the session, and the newer text stays', async () => {
    const { store, state, persistence } = await seeded();
    const projectId = state.manifest.project.id;
    // This tab's edit (revision 0 → 1 in memory).
    setBody(state, IDS.sceneA, 'This tab, typed');
    // Another writer stores newer text for the same document, at the revision this tab expects.
    await writeDocumentBody(store, { projectId, docId: IDS.sceneA, body: 'Another tab, saved first', expectedRevision: 0 });

    await persistence.settle();
    expect(persistence.getStatus()).toBe('conflict');
    expect(isStaleWrite(persistence.getError())).toBe(true);

    // A later edit here is not written, and a structural change is not either: the store is not restated.
    setBody(state, IDS.sceneB, 'Later, here');
    persistence.schedule();
    await persistence.settle();
    const stored = await readProjectState(store, projectId);
    expect(stored.documents.get(IDS.sceneA)?.body).toBe('Another tab, saved first');
    expect(stored.documents.get(IDS.sceneB)?.body).toBe('Two words');
    expect(persistence.getStatus()).toBe('conflict');
  });

  test('a stale body stops the pass before the structure is written, so a stale tab cannot move the tree back', async () => {
    const { store, state, persistence } = await seeded();
    const projectId = state.manifest.project.id;
    // This tab renames a chapter and edits a scene in one pass: a structural change and a body change.
    const chapter = state.manifest.tree.find((node) => node.id === IDS.chapterOne);
    if (chapter === undefined) throw new Error('the fixture has no chapter one');
    chapter.title = 'Renamed here';
    setBody(state, IDS.sceneA, 'This tab, typed');
    // Another writer has moved the scene's text on.
    await writeDocumentBody(store, { projectId, docId: IDS.sceneA, body: 'Another tab, saved first', expectedRevision: 0 });

    await persistence.settle();
    expect(persistence.getStatus()).toBe('conflict');
    const stored = await readProjectState(store, projectId);
    expect(stored.manifest.tree.find((node) => node.id === IDS.chapterOne)?.title).toBe('Chapter 1');
  });

  test('a store that cannot be written is a failure, not a stop: the next change tries again', async () => {
    const { store, state } = await seeded();
    const projectId = state.manifest.project.id;
    // The store refuses every transaction while the disk is full. Nothing is refused by a revision, so the guard has nothing to say.
    let full = true;
    const persistence = new Persistence(fullDiskStore(store, () => full), projectId, () => state, shadowOf(state));
    setBody(state, IDS.sceneA, 'Written while the store is failing');
    persistence.schedule();

    await persistence.settle();
    expect(persistence.getStatus()).toBe('failed');
    expect(isStaleWrite(persistence.getError())).toBe(false);

    // The disk has room again. The next change is scheduled as a session schedules one, and it is written.
    full = false;
    setBody(state, IDS.sceneA, 'Written after the store recovered');
    persistence.schedule();
    await persistence.settle();
    expect(persistence.getStatus()).toBe('idle');
    expect((await readProjectState(store, projectId)).documents.get(IDS.sceneA)?.body).toBe('Written after the store recovered');
  });

  test('a document this tab creates, which another writer has already created, is a stale write too', async () => {
    const { store, state, persistence } = await seeded();
    const projectId = state.manifest.project.id;
    // Another writer creates the document this tab is about to create.
    await commitProject(store, {
      projectId,
      manifest: state.manifest,
      createDocuments: [{ id: 'n_NEWDOC0000', body: 'theirs' }],
    });
    // This tab creates the same id, at revision 0.
    state.documents.set('n_NEWDOC0000', { id: 'n_NEWDOC0000', body: 'Fresh', revision: 0 });

    await persistence.settle();
    expect(persistence.getStatus()).toBe('conflict');
    const stored = await readProjectState(store, projectId);
    expect(stored.documents.get('n_NEWDOC0000')?.body).toBe('theirs');
  });
});

test.describe('a save into a folder another writer may share', () => {
  test('removes only the documents the session names, and leaves a document file it never owned', async () => {
    const state = project();
    const fs = new MemoryArtifactFs();
    await writeProject(fs, state);
    // A document the session deleted, still in the folder, and a document another writer put there.
    await fs.writeAtomic('docs/n_ABCD000012.md', '---\nid: n_ABCD000012\n---\n\nold\n');
    await fs.writeAtomic('docs/n_B2C3D4E5F6.md', '---\nid: n_B2C3D4E5F6\n---\n\nnot ours\n');

    const report = await writeProject(fs, state, { pruneDocumentIds: ['n_ABCD000012'] });

    expect(await fs.exists('docs/n_ABCD000012.md')).toBe(false);
    expect(await fs.exists('docs/n_B2C3D4E5F6.md')).toBe(true);
    expect(report.pruned).toEqual(['docs/n_ABCD000012.md']);
  });

  test('without a list, every unowned document file is removed, which the exporter relies on', async () => {
    const state = project();
    const fs = new MemoryArtifactFs();
    await writeProject(fs, state);
    await fs.writeAtomic('docs/n_B2C3D4E5F6.md', '---\nid: n_B2C3D4E5F6\n---\n\nunowned\n');

    await writeProject(fs, state);

    expect(await fs.exists('docs/n_B2C3D4E5F6.md')).toBe(false);
  });
});
