/**
 * What the runtime store must be told, given what it already holds — pure.
 *
 * The bus is the only writer of the **in-memory** project. The IndexedDB store is a
 * mirror of it, and this module answers one question: from the last state the store
 * is known to hold (the *shadow*) to the current one, which store operation brings
 * them together? The three operations are the store's own:
 *
 *   - `writeDocumentBody` — one body, one transaction, revision + 1 (the ordinary
 *     typing path, project-format §4);
 *   - `commitProject` — the manifest plus the documents a change creates or removes,
 * in one transaction (the structural path, the `ProjectCommit`);
 *   - `writeProjectState` — the whole project, revisions taken from the state. Needed
 *     whenever a revision moved by anything other than +1. An undo of a body write
 *     moves it by +1 like any write (command `compensateBody`), so it takes the body
 *     path; an undo of a delete brings a document back at the revision it had, and
 *     that is the case this whole-project write is for.
 *
 * `commitProject` creates a document at revision 0, so a created document whose
 * in-memory revision is not 0 (a restored subtree) forces the full write too.
 *
 * Everything here is data in, data out, so a test can run any sequence of edits and
 * assert the plan without a database. The executor (`persistence.ts`) only runs it.
 */

import { createProjectState, type Manifest, type ProjectState } from '@caotang/store';

export interface DocumentShadow {
  readonly body: string;
  readonly revision: number;
}

/** What the store holds, as far as this session knows: the manifest's JSON and every document's body and revision. */
export interface Shadow {
  readonly manifestJson: string;
  readonly docs: ReadonlyMap<string, DocumentShadow>;
}

export interface CreatedDocument {
  readonly id: string;
  readonly body: string;
}

export interface BodyWrite {
  readonly docId: string;
  readonly body: string;
  /** The revision the store holds now — the guard the write carries (project-format §4). */
  readonly expectedRevision: number;
}

export type PersistPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'full';
      /** A detached copy of the state, so the write cannot observe a later edit. */
      readonly state: ProjectState;
      readonly next: Shadow;
    }
  | {
      readonly kind: 'incremental';
      /** A detached manifest, present only when the structure changed. */
      readonly manifest: Manifest | null;
      readonly createDocuments: readonly CreatedDocument[];
      readonly removeDocumentIds: readonly string[];
      readonly bodies: readonly BodyWrite[];
      readonly next: Shadow;
    };

/** The shadow of a state, copied so later edits to the state cannot change it. */
export function shadowOf(state: ProjectState): Shadow {
  const docs = new Map<string, DocumentShadow>();
  for (const [id, record] of state.documents) {
    docs.set(id, { body: record.body, revision: record.revision });
  }
  return { manifestJson: JSON.stringify(state.manifest), docs };
}

export function planPersistence(shadow: Shadow | null, state: ProjectState): PersistPlan {
  const next = shadowOf(state);
  if (shadow === null) return fullPlan(state, next);

  const createDocuments: CreatedDocument[] = [];
  const bodies: BodyWrite[] = [];
  for (const [id, record] of state.documents) {
    const before = shadow.docs.get(id);
    if (before === undefined) {
      // `commitProject` creates at revision 0. A restored document carries its old
      // revision, and only the whole-project write can say that to the store.
      if (record.revision !== 0) return fullPlan(state, next);
      createDocuments.push({ id, body: record.body });
      continue;
    }
    if (record.body !== before.body) {
      // A body write, or an undo of one, moves the revision by exactly one; anything else is written whole.
      if (record.revision !== before.revision + 1) return fullPlan(state, next);
      bodies.push({ docId: id, body: record.body, expectedRevision: before.revision });
    } else if (record.revision !== before.revision) {
      return fullPlan(state, next);
    }
  }

  const removeDocumentIds: string[] = [];
  for (const id of shadow.docs.keys()) {
    if (!state.documents.has(id)) removeDocumentIds.push(id);
  }

  const structural =
    next.manifestJson !== shadow.manifestJson || createDocuments.length > 0 || removeDocumentIds.length > 0;
  if (!structural && bodies.length === 0) return { kind: 'none' };

  return {
    kind: 'incremental',
    manifest: structural ? structuredClone(state.manifest) : null,
    createDocuments,
    removeDocumentIds,
    bodies,
    next,
  };
}

function fullPlan(state: ProjectState, next: Shadow): PersistPlan {
  return { kind: 'full', state: copyState(state), next };
}

/**
 * A detached `ProjectState` with the same content, built through the store's own
 * constructor so its `derived` block is the shape the store expects. What the load
 * declined is carried too: a writer that did not know a file was declined would
 * delete it as unowned, or refuse a document whose body it cannot hold.
 */
export function copyState(state: ProjectState): ProjectState {
  const copy = createProjectState(structuredClone(state.manifest));
  for (const [id, record] of state.documents) {
    copy.documents.set(id, { id, body: record.body, revision: record.revision });
  }
  for (const name of state.declinedCodexFiles) copy.declinedCodexFiles.add(name);
  for (const name of state.declinedDocFiles) copy.declinedDocFiles.add(name);
  for (const [path, text] of state.declinedText) copy.declinedText.set(path, text);
  return copy;
}
