/**
 * The writing-session log, end to end inside the store: an autosave flush that stores
 * a change is counted into the open session, the session ends, and the artifact's
 * `sessions.jsonl` is written and reads back as one line. Nothing here is a stand-in
 * for the session: the tracker, the autosave and the writer are the store's own.
 *
 * What this does not cover is the desktop app calling this path. apps/desktop does
 * not yet pass a tracker to `createAutosave` or begin and end a session around the
 * editor, so in the running app the log stays empty. That caller is out of this
 * package's scope and is listed in the workstream's known gaps.
 */
import { describe, expect, it } from 'vitest';

import {
  addDocument,
  createAutosave,
  createEmptyManifest,
  createProjectState,
  createSessionTracker,
  MemoryArtifactFs,
  parseSessionsLog,
  writeSessionsFile,
  type SessionRecord,
} from '../src/index.js';

const NOW = new Date('2026-10-02T15:00:00.000Z');

describe('a writing session reaches sessions.jsonl (end to end)', () => {
  it('counts a saved write into the session, ends it, and reads back as one line', async () => {
    const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', NOW), { now: NOW });
    const node = addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'one two three', now: NOW });
    const projectId = state.manifest.project.id;

    // The artifact's log is built from what the tracker appends, as the runtime store
    // would hand it over. Here the append is a plain array.
    const appended: SessionRecord[] = [];
    const tracker = createSessionTracker({
      projectId,
      append: ({ record }) => {
        appended.push(record);
        return Promise.resolve();
      },
      now: () => NOW,
    });

    // The document write path: store the body, bump the revision, and report whether
    // anything changed, which is what the tracker counts.
    const autosave = createAutosave({
      projectId,
      source: 'write',
      debounceMs: 0,
      sessions: tracker,
      write: ({ docId, body }) => {
        const record = state.documents.get(docId)!;
        const changed = record.body !== body;
        if (changed) {
          record.body = body;
          record.revision += 1;
        }
        return Promise.resolve({ revision: record.revision, changed });
      },
    });

    autosave.open(node.id, { body: 'one two three', revision: 0 });
    tracker.beginSession();
    autosave.noteEdit(node.id, 'one two three four five');
    await autosave.flush(node.id);

    const ended = await tracker.endSession();
    expect(ended?.wordsWritten).toBe(2);
    expect(ended?.docIds).toEqual([node.id]);
    expect(appended).toHaveLength(1);

    const fs = new MemoryArtifactFs();
    await writeSessionsFile(fs, appended);
    const text = fs.snapshot()['sessions.jsonl']!;
    expect(text.trimEnd().split('\n')).toHaveLength(1);
    expect(parseSessionsLog(text).records).toEqual([ended]);
  });

  it('counts nothing for a flush outside a session, so the log holds only sessions', async () => {
    const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', NOW), { now: NOW });
    const node = addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'steady', now: NOW });
    const projectId = state.manifest.project.id;
    const appended: SessionRecord[] = [];
    const tracker = createSessionTracker({
      projectId,
      append: ({ record }) => {
        appended.push(record);
        return Promise.resolve();
      },
      now: () => NOW,
    });
    const autosave = createAutosave({
      projectId,
      source: 'write',
      debounceMs: 0,
      sessions: tracker,
      write: ({ docId, body }) => {
        const record = state.documents.get(docId)!;
        const changed = record.body !== body;
        if (changed) {
          record.body = body;
          record.revision += 1;
        }
        return Promise.resolve({ revision: record.revision, changed });
      },
    });

    autosave.open(node.id, { body: 'steady', revision: 0 });
    autosave.noteEdit(node.id, 'steady and then some');
    await autosave.flush(node.id);

    expect(await tracker.endSession()).toBeNull();
    expect(appended).toHaveLength(0);
  });
});
