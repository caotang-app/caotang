/**
 * The store→bus structural contract.
 *
 * `packages/bus` declares `ValidationSnapshot` as the read-only view a
 * `validate` may read, and it declares it *itself* because the dependency runs
 * store → bus (the bus never depends on the store; the store depends on the
 * bus). That leaves the contract structural and therefore unpinned by
 * anything: if `ProjectState` stopped satisfying it, `tsc` would say so only in
 * the file that happened to pass a `ProjectState` to a bus function.
 *
 * So this test **uses** a real `ProjectState` as a bus snapshot and runs real
 * validators against it. A type-level assertion alone would be satisfied by a
 * shape that compiles and then finds nothing; these assertions fail at runtime
 * the moment the manifest, the tree or the documents map moves.
 */
import { describe, expect, it } from 'vitest';

import { lookupCommand, type ValidationSnapshot } from '@caotang/bus';
import { addDocument, createEmptyManifest, createProjectState } from '../src/index.js';

const OPENED = new Date('2026-10-01T04:00:00.000Z');
const DOC = 'n_3W8RN2TQ6C';

function realState() {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', OPENED));
  addDocument(state, {
    parentId: 'manuscript',
    title: 'The Landing',
    body: 'The ferry was late, as always.',
    now: OPENED,
    id: DOC,
  });
  return state;
}

function refusalOf(result: { ok: boolean; error?: { code: string; message: string; correctiveHint?: string } }): {
  code: string;
  message: string;
  correctiveHint?: string;
} {
  if (result.ok) throw new Error('expected a refusal');
  if (!result.error) throw new Error('a refusal must carry an error');
  return result.error;
}

describe('a real ProjectState is a ValidationSnapshot', () => {
  it('typechecks as one — the compile-time half of the contract', () => {
    const state = realState();
    // If this stops compiling, the bus's read-view and the store's state have
    // diverged structurally; the runtime assertions below are the other half.
    const asBusView: ValidationSnapshot = state;
    expect(asBusView.manifest.tree.length).toBeGreaterThan(3);
  });

  it('carries the tree, the vocabulary and the documents the bus reads', () => {
    const view: ValidationSnapshot = realState();
    expect(view.manifest.tree.map((n) => n.id)).toContain(DOC);
    expect(view.manifest.tree.find((n) => n.id === DOC)?.type).toBe('document');
    expect(view.documents.get(DOC)?.body).toBe('The ferry was late, as always.');
    expect(typeof view.documents.get(DOC)?.revision).toBe('number');
    expect(view.manifest.vocabulary.statuses).toBeInstanceOf(Array);
  });

  it('resolves a real node id through a real descriptor', () => {
    const state = realState();
    const found = lookupCommand('binder.setSynopsis');
    if (!found.ok) throw new Error('binder.setSynopsis must be registered');
    const accepted = found.value.descriptor.validate({ nodeId: DOC, synopsis: 'A short card.' }, state);
    expect(accepted.ok).toBe(true);
  });

  it('reads the real tree when refusing — not-found comes from the manifest, not a fixture', () => {
    const state = realState();
    const found = lookupCommand('binder.setSynopsis');
    if (!found.ok) throw new Error('binder.setSynopsis must be registered');
    const refused = refusalOf(found.value.descriptor.validate({ nodeId: 'n_NOTINTHETREE', synopsis: 'x' }, state));
    expect(refused.code).toBe('not-found');
    expect(refused.correctiveHint).toBe('use binder.read_tree to list valid ids');
  });

  it('reads the real document body when bounding an editor offset', () => {
    const state = realState();
    const found = lookupCommand('editor.insert');
    if (!found.ok) throw new Error('editor.insert must be registered');
    const length = state.documents.get(DOC)?.body.length ?? 0;
    expect(found.value.descriptor.validate({ docId: DOC, offset: length, text: '!' }, state).ok).toBe(true);
    expect(refusalOf(found.value.descriptor.validate({ docId: DOC, offset: length + 1, text: '!' }, state)).code)
      .toBe('invalid-params');
  });

  it('refuses the store\'s own reserved roots, from the store\'s own tree', () => {
    // `createEmptyManifest` builds root/manuscript/research; the bus's reserved-id
    // list is a separate declaration of the same three, and this is where the two
    // are checked against each other rather than against a fixture.
    const state = realState();
    const found = lookupCommand('project.deleteNode');
    if (!found.ok) throw new Error('project.deleteNode must be registered');
    const reserved = state.manifest.tree.filter((n) => n.parentId === null || ['manuscript', 'research'].includes(n.id));
    expect(reserved.length).toBeGreaterThanOrEqual(3);
    for (const node of reserved) {
      expect(refusalOf(found.value.descriptor.validate({ nodeId: node.id }, state)).message, node.id)
        .toContain('fixed root and cannot be deleted');
    }
  });
});
