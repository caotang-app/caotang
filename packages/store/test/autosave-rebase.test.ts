/**
 * A rebase onto a lower revision (editor-engine §9). A store that reports a revision below the one the scheduler holds
 * must have its base follow it down, or the next write is sent against a revision the store no longer holds and is
 * refused on every flush.
 *
 * An undo no longer produces one: it writes the body back as a write, so the revision rises (commands.ts
 * `compensateBody`, project-format §4). The contract here is the scheduler's own, for any store that reports a lower
 * revision.
 *
 * `open` re-seeds a quiet slot to the revision it is given, even a lower one. `reseat` only raises the base
 * (autosave.ts, `Math.max`), so it is the wrong call for a rebase onto a lower revision. The second test pins that, so a
 * view that reaches for `reseat` there fails here rather than in the app.
 */

import { describe, expect, it } from 'vitest';

import { RevisionConflictError, createAutosave } from '../src/index.js';

const DOC = 'n_3W8RN2TQ6C';

/** A store that keeps one body and one revision, and refuses a write whose expected revision is not the one it holds. */
function storeOf(body: string, revision: number) {
  const stored = { body, revision };
  const requests: { body: string; expectedRevision: number }[] = [];
  const write = async (request: { docId: string; body: string; expectedRevision: number }) => {
    requests.push({ body: request.body, expectedRevision: request.expectedRevision });
    if (request.expectedRevision !== stored.revision) {
      throw new RevisionConflictError(request.docId, request.expectedRevision, stored.revision);
    }
    if (request.body === stored.body) return { revision: stored.revision, changed: false };
    stored.revision += 1;
    stored.body = request.body;
    return { revision: stored.revision, changed: true };
  };
  return { stored, requests, write };
}

describe('a rebase after an undo moves the base down with the store', () => {
  it('a quiet open at a lower revision re-seeds the base, so the next write is based on the revision the store holds', async () => {
    const { stored, requests, write } = storeOf('AAA', 1);
    const autosave = createAutosave({ projectId: 'p_9XK2M4Q7RZ', source: 'write', write });
    autosave.open(DOC, { body: 'AAA', revision: 1 });

    // The store moves to '' at a lower revision than the scheduler's base: the rebase this file is about.
    stored.body = '';
    stored.revision = 0;
    await autosave.flush(DOC);
    autosave.open(DOC, { body: '', revision: 0 });

    autosave.noteEdit(DOC, 'BBB');
    const reports = await autosave.flush(DOC);

    expect(reports.map((report) => report.outcome)).toEqual(['saved']);
    expect(requests.at(-1)).toEqual({ body: 'BBB', expectedRevision: 0 });
    expect(stored).toEqual({ body: 'BBB', revision: 1 });
    autosave.dispose();
  });

  it('a reseat to a lower revision keeps the higher base, so the next write is refused as a conflict', async () => {
    const { stored, requests, write } = storeOf('AAA', 1);
    const autosave = createAutosave({ projectId: 'p_9XK2M4Q7RZ', source: 'write', write });
    autosave.open(DOC, { body: 'AAA', revision: 1 });
    stored.body = '';
    stored.revision = 0;

    await autosave.reseat(DOC, { body: '', revision: 0 });
    autosave.noteEdit(DOC, 'BBB');
    const reports = await autosave.flush(DOC);

    expect(reports.map((report) => report.outcome)).toEqual(['conflict']);
    expect(requests.at(-1)?.expectedRevision).toBe(1);
    expect(stored.body).toBe('');
    autosave.dispose();
  });
});
