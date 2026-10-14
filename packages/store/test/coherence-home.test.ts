/**
 * The per-project home of `coherence.json` (coherence.md §3): the runtime store keeps the file's artifact set on the
 * project row, the manifest writes leave it alone, and the zip bundle carries the live file at its root.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  addDocument,
  createEmptyManifest,
  createProjectState,
  exportProjectZip,
  importProjectZip,
  readCoherenceFiles,
  writeCoherenceFiles,
  type ProjectState,
  type RuntimeStore,
} from '../src/index.js';
import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import {
  ProjectNotFoundError,
  commitProject,
  openRuntimeStore,
  readProjectState,
  writeProjectState,
} from '../src/runtime/store.js';

const OPENED = new Date('2026-10-01T02:00:00.000Z');
const LATER = new Date('2026-10-02T02:00:00.000Z');
const DB = 'caotang-coherence-home';
const PROJECT = 'p_9XK2M4Q7RZ';
const SCENE = 'n_7K2QX9M4A1';

const COHERENCE_JSON = '{"formatVersion":1,"findings":[],"runs":[],"sceneMeta":{},"worldRules":[],"reviewState":{}}\n';
const BAK_ONE = '{"formatVersion":1,"findings":[{"id":"f_AAAAAAAAAA"}],"runs":[],"sceneMeta":{},"worldRules":[],"reviewState":{}}\n';

function fixtureProject(): ProjectState {
  const manifest = createEmptyManifest('The Lighthouse Keeper', OPENED);
  manifest.project.id = PROJECT;
  const state = createProjectState(manifest);
  addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late.', now: OPENED, id: SCENE });
  return state;
}

const opened: RuntimeStore[] = [];

async function openStore(factory: MemoryIndexedDb): Promise<RuntimeStore> {
  const store = await openRuntimeStore(factory, DB);
  opened.push(store);
  return store;
}

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

describe('the coherence file on the project row (coherence.md §3)', () => {
  it('reads as no set for a project that never ran a check, and refuses a project the store does not hold', async () => {
    const store = await openStore(new MemoryIndexedDb());
    await expect(readCoherenceFiles(store, PROJECT)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await commitProject(store, { projectId: PROJECT, manifest: fixtureProject().manifest, now: OPENED });
    expect(await readCoherenceFiles(store, PROJECT)).toEqual({});
  });

  it('writes the whole set and reads it back, and a later write replaces the set rather than adding to it', async () => {
    const store = await openStore(new MemoryIndexedDb());
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeCoherenceFiles(store, PROJECT, { 'coherence.json': COHERENCE_JSON, 'coherence.json.bak.1': BAK_ONE });
    expect(await readCoherenceFiles(store, PROJECT)).toEqual({ 'coherence.json': COHERENCE_JSON, 'coherence.json.bak.1': BAK_ONE });
    await writeCoherenceFiles(store, PROJECT, { 'coherence.json': BAK_ONE });
    expect(await readCoherenceFiles(store, PROJECT)).toEqual({ 'coherence.json': BAK_ONE });
  });

  it('keeps the set across a structural commit, a wholesale write and a reopen of the database', async () => {
    const factory = new MemoryIndexedDb();
    const store = await openStore(factory);
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    await writeCoherenceFiles(store, PROJECT, { 'coherence.json': COHERENCE_JSON });

    await commitProject(store, { projectId: PROJECT, manifest: state.manifest, now: LATER });
    expect(await readCoherenceFiles(store, PROJECT)).toEqual({ 'coherence.json': COHERENCE_JSON });

    await writeProjectState(store, state, { now: LATER });
    expect(await readCoherenceFiles(store, PROJECT)).toEqual({ 'coherence.json': COHERENCE_JSON });

    store.close();
    opened.splice(opened.indexOf(store), 1);
    const reopened = await openStore(factory);
    expect(await readCoherenceFiles(reopened, PROJECT)).toEqual({ 'coherence.json': COHERENCE_JSON });
  });

  it('leaves the manifest and the bodies as they were when the set is written', async () => {
    const store = await openStore(new MemoryIndexedDb());
    const state = fixtureProject();
    await writeProjectState(store, state, { now: OPENED });
    const before = await readProjectState(store, PROJECT);
    await writeCoherenceFiles(store, PROJECT, { 'coherence.json': COHERENCE_JSON });
    const after = await readProjectState(store, PROJECT);
    expect(after.manifest).toEqual(before.manifest);
    expect(after.documents.get(SCENE)).toEqual(before.documents.get(SCENE));
  });
});

describe('the zip bundle carries coherence.json (coherence.md §3, §7)', () => {
  it('writes the live file at the bundle root, byte for byte, and imports it back', async () => {
    const state = fixtureProject();
    const exported = await exportProjectZip(state, { now: OPENED, coherence: COHERENCE_JSON });
    expect(exported.entries).toContain('coherence.json');
    const imported = await importProjectZip(exported.bytes);
    expect(await imported.fs.read('coherence.json')).toBe(COHERENCE_JSON);
  });

  it('carries no coherence file when the project has none to give, and does not invent one', async () => {
    const exported = await exportProjectZip(fixtureProject(), { now: OPENED });
    expect(exported.entries).not.toContain('coherence.json');
    const imported = await importProjectZip(exported.bytes);
    expect(await imported.fs.exists('coherence.json')).toBe(false);
  });

  it('does not carry the recovery generations, which are copies of the file and not the file', async () => {
    const exported = await exportProjectZip(fixtureProject(), { now: OPENED, coherence: COHERENCE_JSON });
    expect(exported.entries.some((entry) => entry.startsWith('coherence.json.bak.'))).toBe(false);
  });
});
