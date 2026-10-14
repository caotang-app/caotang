/**
 * The media track's storage contract (screenplay.md §2.1, storyboard.md §2.1-2.2, dialogue-narrative.md §2.1-2.2,
 * project-format.md §2-§3): a node's kind, a shot's metadata and a dialogue container's metadata survive a save and
 * a load; a body is named for its kind (`.fountain`, `.ink`, `.md`); a `.md` body from before the kind had its own
 * file still loads; and a file no node owns is recovered under the name its extension gives it.
 */

import { describe, expect, it } from 'vitest';

import {
  FOUNTAIN_BODY_EXT,
  INK_BODY_EXT,
  MANIFEST_FILE,
  MemoryArtifactFs,
  RECOVERED_TITLE,
  addDocument,
  addNode,
  createBinderNode,
  createEmptyManifest,
  createProjectState,
  getBody,
  readProject,
  removeNode,
  serializeManifest,
  validateManifest,
  writeProject,
  type ProjectState,
} from '../src/index.js';

const T0 = new Date('2026-10-08T09:00:00.000Z');
const T1 = new Date('2026-10-08T09:10:00.000Z');

// Node ids are "n_" and ten Crockford base32 characters, which leave out I, L, O and U (project-format.md §2).
const PROSE = 'n_3W8RN2TQ6C';
const SCENE = 'n_5T4RW9KZB2';
const BOARD = 'n_7K2QX9M4A1';
const SHOT = 'n_A1B2C3D4E5';
const DUET = 'n_HJKMNPQRST';

const INK_BODY = '=== start ===\nAlice: Hello.\n* [Wave] -> wave\n* [Leave] -> END\n\n=== wave ===\nAlice: Bye.\n-> END\n';
const SCENE_BODY = 'INT. LIGHTHOUSE - NIGHT\n\nThe lamp turns.\n';

/** A project with a prose document, a screenplay scene, a storyboard holding one shot, and a dialogue container. */
function mediaProject(): ProjectState {
  const state = createProjectState(createEmptyManifest('Keeper', T0));
  addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late.', now: T0, id: PROSE });
  addDocument(state, {
    parentId: 'manuscript',
    title: 'Night Lamp',
    body: SCENE_BODY,
    kind: 'screenplay',
    now: T0,
    id: SCENE,
  });
  const board = addNode(state, { parentId: 'manuscript', title: 'Board', kind: 'storyboard', now: T0, id: BOARD });
  expect(board.type).toBe('folder');
  const shot = addNode(state, { parentId: BOARD, title: 'Shot 1', type: 'shot', now: T0, id: SHOT });
  shot.shot = {
    shotSize: 'MCU',
    cameraAngle: 'low',
    durationSec: 4,
    dialogue: [{ kind: 'fountain-element', docId: SCENE, anchor: { from: 0, to: 3, exact: 'The', prefix: '', suffix: '', capturedRevision: 0 } }],
  };
  addDocument(state, { parentId: 'manuscript', title: 'Duel', body: INK_BODY, type: 'dialogue', kind: 'branching', now: T0, id: DUET });
  const duet = state.manifest.tree.find((n) => n.id === DUET);
  if (duet === undefined) throw new Error('the dialogue container was not added');
  duet.dialogue = { speaker: 'alice', engineTarget: 'ink-json', autoLineIds: true };
  return state;
}

/** The manifest's own JSON, parsed, so a test can edit one node the way a hand edit or a lost entry would. */
async function manifestOf(fs: MemoryArtifactFs): Promise<{ tree: Record<string, unknown>[] } & Record<string, unknown>> {
  return JSON.parse(await fs.read(MANIFEST_FILE)) as { tree: Record<string, unknown>[] } & Record<string, unknown>;
}

describe('a body is named for its kind', () => {
  it('writes a screenplay as .fountain, a dialogue container as .ink, and a prose document as .md', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });

    expect(await fs.exists(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);
    expect(await fs.exists(`docs/${DUET}.${INK_BODY_EXT}`)).toBe(true);
    expect(await fs.exists(`docs/${PROSE}.md`)).toBe(true);
    expect(await fs.exists(`docs/${SCENE}.md`)).toBe(false);
    expect(await fs.exists(`docs/${DUET}.md`)).toBe(false);
  });

  it('writes an Ink body whole, with no front matter, because Ink has no front matter to read', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });

    expect(await fs.read(`docs/${DUET}.${INK_BODY_EXT}`)).toBe(INK_BODY);
  });

  it('writes a screenplay with the front matter every document carries, and its Fountain body after it', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });

    const text = await fs.read(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`);
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain(`id: ${SCENE}`);
    // The envelope may end the file with its own line ending; the body itself is held whole (the round trip below).
    expect(text).toContain(SCENE_BODY);
  });
});

describe('the media fields survive a save and a load', () => {
  it('keeps each node\'s kind, a shot\'s metadata and a dialogue container\'s metadata', async () => {
    const fs = new MemoryArtifactFs();
    const saved = mediaProject();
    await writeProject(fs, saved, { now: T0 });

    const loaded = await readProject(fs, { now: T1 });
    const node = (id: string) => loaded.state.manifest.tree.find((n) => n.id === id);

    expect(node(SCENE)?.kind).toBe('screenplay');
    expect(node(BOARD)?.kind).toBe('storyboard');
    expect(node(SHOT)?.type).toBe('shot');
    expect(node(SHOT)?.shot).toEqual(saved.manifest.tree.find((n) => n.id === SHOT)?.shot);
    expect(node(DUET)?.type).toBe('dialogue');
    expect(node(DUET)?.kind).toBe('branching');
    expect(node(DUET)?.dialogue).toEqual({ speaker: 'alice', engineTarget: 'ink-json', autoLineIds: true });
    expect(getBody(loaded.state, DUET)).toBe(INK_BODY);
    expect(getBody(loaded.state, SCENE)).toBe(SCENE_BODY);
    // A shot holds no body, so the load gives it no record (storyboard.md §2.1).
    expect(loaded.state.documents.has(SHOT)).toBe(false);
  });

  it('writes each shot and container metadata on one line, so the tree keeps one node per line', () => {
    const text = serializeManifest(mediaProject().manifest);
    const shotLine = text.split('\n').find((line) => line.includes(`"id": "${SHOT}"`));
    expect(shotLine).toBeDefined();
    expect(shotLine).toContain('"type": "shot"');
    expect(shotLine).toContain('"shot": {"shotSize":"MCU"');
    expect(text.split('\n').find((line) => line.includes(`"id": "${PROSE}"`))).not.toContain('"kind"');
  });

  it('round-trips the manifest to the same bytes, so a load and a save change nothing', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });
    const first = await fs.read(MANIFEST_FILE);

    // The same clock on both sides: a save stamps `modifiedAt`, and that is the only field a clock change would move.
    const loaded = await readProject(fs, { now: T0 });
    await writeProject(fs, loaded.state, { now: T0 });

    expect(await fs.read(MANIFEST_FILE)).toBe(first);
  });
});

describe('a body saved before its kind had a file of its own', () => {
  it('still loads from its .md, and the next save writes the kind\'s own file', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });
    // The same bytes under the old name: what a save wrote before screenplay bodies had a `.fountain` file.
    const fountain = await fs.read(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`);
    fs.putFile(`docs/${SCENE}.md`, fountain);
    await fs.remove(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`);

    const loaded = await readProject(fs, { now: T1 });
    expect(getBody(loaded.state, SCENE)).toBe(SCENE_BODY);
    expect(loaded.state.manifest.tree.find((n) => n.id === SCENE)?.kind).toBe('screenplay');

    await writeProject(fs, loaded.state, { now: T1 });
    expect(await fs.exists(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);
    // The save wrote the kind's file, so the legacy `.md` it loaded from is gone (project-format.md §3).
    expect(await fs.exists(`docs/${SCENE}.md`)).toBe(false);
  });
});

describe('a body file no node owns is recovered under its extension\'s kind', () => {
  it('imports an orphan .ink file as a dialogue container and an orphan .fountain file as a screenplay', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });
    // Lose the two manifest entries, so their body files are orphans, as a torn write would leave them.
    const raw = await manifestOf(fs);
    raw.tree = raw.tree.filter((n) => n.id !== DUET && n.id !== SCENE);
    fs.putFile(MANIFEST_FILE, JSON.stringify(raw));

    const loaded = await readProject(fs, { now: T1 });
    const scene = loaded.state.manifest.tree.find((n) => n.id === SCENE);
    const duet = loaded.state.manifest.tree.find((n) => n.id === DUET);

    expect(scene).toMatchObject({ type: 'document', kind: 'screenplay', title: 'Night Lamp' });
    expect(getBody(loaded.state, SCENE)).toBe(SCENE_BODY);
    expect(duet).toMatchObject({ type: 'dialogue', kind: 'branching' });
    expect(getBody(loaded.state, DUET)).toBe(INK_BODY);
    expect(loaded.notices.some((n) => n.message.includes('a raw Ink file has no title'))).toBe(true);
  });

  it('declines a body under a name its node\'s kind does not use, and says why', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });
    // A `.fountain` next to a prose document that already has its `.md`: the node would get two bodies.
    fs.putFile(`docs/${PROSE}.${FOUNTAIN_BODY_EXT}`, 'INT. ELSEWHERE - DAY\n');

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.tree.filter((n) => n.id === PROSE)).toHaveLength(1);
    expect(loaded.state.declinedDocFiles.has(`${PROSE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);
    expect(loaded.notices.some((n) => n.message.includes('two bodies'))).toBe(true);
    expect(await fs.exists(`docs/${PROSE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);
  });
});

describe('an orphan is placed where the binder shows it', () => {
  it('lists a recovered screenplay and a recovered dialogue under the manuscript, and gives the Ink a readable title', async () => {
    const fs = new MemoryArtifactFs();
    await writeProject(fs, mediaProject(), { now: T0 });
    const raw = await manifestOf(fs);
    raw.tree = raw.tree.filter((n) => n.id !== DUET && n.id !== SCENE);
    fs.putFile(MANIFEST_FILE, JSON.stringify(raw));

    const loaded = await readProject(fs, { now: T1 });
    const folder = loaded.state.manifest.tree.find((n) => n.title === RECOVERED_TITLE);

    // The binder draws the manuscript and research, so a folder under the root would hide both documents.
    expect(folder).toMatchObject({ type: 'folder', parentId: 'manuscript' });
    expect(loaded.state.manifest.tree.find((n) => n.id === SCENE)?.parentId).toBe(folder?.id);
    expect(loaded.state.manifest.tree.find((n) => n.id === DUET)).toMatchObject({ title: 'Recovered dialogue', parentId: folder?.id });
  });

  it('moves a Recovered folder an earlier build left under the root under the manuscript, with its documents in it', async () => {
    const fs = new MemoryArtifactFs();
    const state = mediaProject();
    // An earlier build's layout: a Recovered folder under the root, holding the scene.
    const folder = addNode(state, { parentId: 'manuscript', title: RECOVERED_TITLE, now: T0, id: 'n_RCVR7T2K4H' });
    expect(folder.type).toBe('folder');
    folder.parentId = 'root';
    const scene = state.manifest.tree.find((n) => n.id === SCENE);
    if (scene === undefined) throw new Error('the scene was not added');
    scene.parentId = folder.id;
    await writeProject(fs, state, { now: T0 });

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.tree.find((n) => n.id === folder.id)?.parentId).toBe('manuscript');
    expect(loaded.state.manifest.tree.find((n) => n.id === SCENE)?.parentId).toBe(folder.id);
    expect(loaded.state.manifest.tree.filter((n) => n.title === RECOVERED_TITLE)).toHaveLength(1);
  });
});

describe('validation of the media fields', () => {
  it('fails a dialogue container whose body file is missing, naming the .ink it needs', () => {
    const manifest = JSON.parse(serializeManifest(mediaProject().manifest)) as Record<string, unknown>;
    const report = validateManifest(manifest, { docFiles: [`${PROSE}.md`, `${SCENE}.fountain`] });

    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.message)).toContain(`document "${DUET}" has no docs/${DUET}.ink`);
  });

  it('keeps an unknown kind string, and drops a kind or metadata value that is not the right shape', () => {
    const manifest = JSON.parse(serializeManifest(mediaProject().manifest)) as {
      tree: Record<string, unknown>[];
    } & Record<string, unknown>;
    manifest.tree.find((n) => n.id === SHOT)!.kind = 'hologram';
    manifest.tree.find((n) => n.id === DUET)!.dialogue = 'not an object';
    manifest.tree.find((n) => n.id === BOARD)!.kind = 7;

    const report = validateManifest(manifest, {
      docFiles: [`${PROSE}.md`, `${SCENE}.${FOUNTAIN_BODY_EXT}`, `${DUET}.${INK_BODY_EXT}`],
    });

    expect(report.ok).toBe(true);
    expect(report.manifest?.tree.find((n) => n.id === SHOT)?.kind).toBe('hologram');
    expect(report.manifest?.tree.find((n) => n.id === DUET)?.dialogue).toBeUndefined();
    expect(report.manifest?.tree.find((n) => n.id === BOARD)?.kind).toBeUndefined();
    expect(report.warnings.map((w) => w.path)).toEqual(
      expect.arrayContaining([`tree[${manifest.tree.findIndex((n) => n.id === DUET)}].dialogue`]),
    );
  });
});

describe('creating and removing the media nodes', () => {
  it('makes a shot with no body record, and a dialogue container with one and the branching kind', () => {
    const state = mediaProject();
    const shot = createBinderNode(state, { parentId: BOARD, type: 'shot', title: 'Shot 2' }, T0);
    const duet = createBinderNode(state, { parentId: 'manuscript', type: 'dialogue', title: 'Second' }, T0);

    expect(shot).toMatchObject({ type: 'shot', parentId: BOARD });
    expect(shot.kind).toBeUndefined();
    expect(state.documents.has(shot.id)).toBe(false);
    expect(duet).toMatchObject({ type: 'dialogue', kind: 'branching' });
    expect(state.documents.get(duet.id)?.body).toBe('');
  });

  it('removes a dialogue container\'s body record with the node, so the undo of a create leaves nothing behind', () => {
    const state = mediaProject();
    removeNode(state, DUET);

    expect(state.manifest.tree.some((n) => n.id === DUET)).toBe(false);
    expect(state.documents.has(DUET)).toBe(false);
  });

  // The round trips the prune pass exists for: a body the writer deleted must not come back on the next open. Before the
  // prune covered `.fountain` and `.ink`, each of these reloaded as a node under the root, where nothing could delete it.
  function sceneAndDialogue(): ProjectState {
    const state = createProjectState(createEmptyManifest('Keeper', T0));
    addDocument(state, { parentId: 'manuscript', title: 'Night Lamp', body: SCENE_BODY, kind: 'screenplay', now: T0, id: SCENE });
    addDocument(state, { parentId: 'manuscript', title: 'Duel', body: INK_BODY, type: 'dialogue', kind: 'branching', now: T0, id: DUET });
    return state;
  }

  it('a deleted screenplay scene leaves no node and no file after a save and a reload', async () => {
    const fs = new MemoryArtifactFs();
    const state = sceneAndDialogue();
    await writeProject(fs, state, { now: T0 });
    expect(await fs.exists(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);

    removeNode(state, SCENE);
    const saved = await writeProject(fs, state, { now: T1 });

    expect(saved.pruned).toEqual([`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`]);
    expect(await fs.exists(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`)).toBe(false);
    const loaded = await readProject(fs, { now: T1 });
    expect(loaded.state.manifest.tree.some((n) => n.id === SCENE)).toBe(false);
    expect(loaded.orphans).toEqual([]);
  });

  it('a deleted dialogue container leaves no node and no .ink file after a save and a reload', async () => {
    const fs = new MemoryArtifactFs();
    const state = sceneAndDialogue();
    await writeProject(fs, state, { now: T0 });
    expect(await fs.exists(`docs/${DUET}.${INK_BODY_EXT}`)).toBe(true);

    removeNode(state, DUET);
    const saved = await writeProject(fs, state, { now: T1 });

    expect(saved.pruned).toEqual([`docs/${DUET}.${INK_BODY_EXT}`]);
    expect(await fs.exists(`docs/${DUET}.${INK_BODY_EXT}`)).toBe(false);
    const loaded = await readProject(fs, { now: T1 });
    expect(loaded.state.manifest.tree.some((n) => n.id === DUET)).toBe(false);
    expect(loaded.orphans).toEqual([]);
  });

  it('removes the .md a screenplay had before its kind had a file of its own, once the save has written the kind\'s file', async () => {
    const fs = new MemoryArtifactFs();
    const state = sceneAndDialogue();
    await writeProject(fs, state, { now: T0 });
    // A legacy `.md` beside the kind's file: the load reads the kind's file first, so this name is only a second copy.
    fs.putFile(`docs/${SCENE}.md`, 'an older prose body\n');

    const loaded = await readProject(fs, { now: T1 });
    expect(getBody(loaded.state, SCENE)).toBe(SCENE_BODY);
    const report = await writeProject(fs, loaded.state, { now: T1 });

    expect(await fs.exists(`docs/${SCENE}.${FOUNTAIN_BODY_EXT}`)).toBe(true);
    expect(await fs.exists(`docs/${SCENE}.md`)).toBe(false);
    expect(report.pruned).toContain(`docs/${SCENE}.md`);
  });

  it('keeps a legacy name the load declined, because a file the writer did not read is the author\'s', async () => {
    const fs = new MemoryArtifactFs();
    const state = sceneAndDialogue();
    await writeProject(fs, state, { now: T0 });
    fs.putFile(`docs/${SCENE}.md`, 'an older body the load declined\n');
    state.declinedDocFiles.add(`${SCENE}.md`);

    await writeProject(fs, state, { now: T1 });

    expect(await fs.exists(`docs/${SCENE}.md`)).toBe(true);
  });
});
