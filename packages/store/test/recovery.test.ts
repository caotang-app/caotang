/**
 * The §5 recovery contract — [project-format.md §5](docs/architecture/project-format.md).
 *
 * §5 is the promise that makes the single-manifest design survivable, and it is
 * the part of the format that is only ever exercised when something has already
 * gone wrong. These tests are the standing evidence that it works, so each one
 * states which spec step it is proving and asserts the *distinguishing* fact —
 * that generation 2 wins when generation 1 is dead, that the rebuilt project
 * re-loads through the ordinary loader, that the corruption is preserved rather
 * than rotated into the ladder.
 *
 * Two properties are asserted repeatedly because they are the two ways a
 * recovery implementation can quietly destroy data:
 *
 *   - **Recovering must not write.** A loader that rewrites a manifest it
 *     disliked would turn a recoverable project into an unrecoverable one.
 *   - **Committing must not poison the ladder.** The corrupt bytes have to land
 *     in `caotang.json.corrupt-<ts>` and *not* be rotated to `bak.1`, which is the
 *     first rung the next open tries.
 */

import { describe, expect, it } from 'vitest';
import {
  LEGACY_SNAPSHOT_FILE,
  MANIFEST_FILE,
  MemoryArtifactFs,
  addDocument,
  commitRecovery,
  createEmptyManifest,
  createProjectState,
  readProject,
  recoverProject,
  serializeCodexFile,
  serializeManifest,
  writeProject,
  type ProjectState,
  type RecoveryOffer,
} from '../src/index.js';

const T0 = new Date('2026-09-29T02:00:00.000Z');
const T1 = new Date('2026-09-29T02:10:00.000Z');
const CORRUPT = '{"app": "caotang", "formatVersion": 1, "tree": [';

function projectNamed(name: string): ProjectState {
  const state = createProjectState(createEmptyManifest(name, T0));
  addDocument(state, {
    parentId: 'manuscript',
    title: 'The Landing',
    body: 'The ferry was late, as always.',
    now: T0,
    id: 'n_3W8RN2TQ6C',
  });
  return state;
}

/**
 * Write a project `times` under a different name each time, so every generation
 * on the ladder is distinguishable by name. Without that, a test asserting
 * "recovered from bak.2" would also pass if it had quietly read bak.1.
 */
async function ladder(times: number): Promise<MemoryArtifactFs> {
  const fs = new MemoryArtifactFs();
  for (let i = 0; i < times; i += 1) {
    await writeProject(fs, projectNamed(`Keeper v${i}`), { now: new Date(T0.getTime() + i * 1000) });
  }
  return fs;
}

const nameOf = (offer: RecoveryOffer): string => offer.state.manifest.project.name;

describe('§5 step 0 — a healthy manifest needs no recovery', () => {
  it('returns the loaded project and writes nothing at all', async () => {
    const fs = await ladder(1);
    const before = fs.snapshot();

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.recovered).toBe(false);
    expect(result.offer.requiresConsent).toBe(false);
    expect(result.offer.source).toEqual({ kind: 'manifest', path: MANIFEST_FILE });
    expect(nameOf(result.offer)).toBe('Keeper v0');
    // The whole point of separating "walk the ladder" from "commit": not one byte.
    expect(fs.snapshot()).toEqual(before);
  });
});

describe('§5 step 1 — the bak.1 → bak.2 → bak.3 scan-back ladder', () => {
  it('recovers from bak.1 and says which path won', async () => {
    const fs = await ladder(2);
    fs.putFile(MANIFEST_FILE, CORRUPT);

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source).toEqual({
      kind: 'snapshot',
      path: 'caotang.json.bak.1',
      generation: 1,
    });
    // bak.1 holds generation v0, not the v1 that was in caotang.json.
    expect(nameOf(result.offer)).toBe('Keeper v0');
    expect(result.offer.notices[0]?.path).toBe('caotang.json.bak.1');
    expect(result.offer.notices[0]?.message).toContain('newest snapshot generation');
  });

  it('falls through to bak.2 when bak.1 is itself unusable', async () => {
    const fs = await ladder(3);
    fs.putFile(MANIFEST_FILE, CORRUPT);
    fs.putFile('caotang.json.bak.1', 'not json either');

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source).toMatchObject({ generation: 2, path: 'caotang.json.bak.2' });
    expect(nameOf(result.offer)).toBe('Keeper v0');
  });

  it('reaches bak.3 when the first two generations are gone', async () => {
    const fs = await ladder(4);
    fs.putFile(MANIFEST_FILE, CORRUPT);
    fs.putFile('caotang.json.bak.1', 'not json either');
    fs.putFile('caotang.json.bak.2', '{"app": "something-else"}');

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source).toMatchObject({ generation: 3, path: 'caotang.json.bak.3' });
    expect(nameOf(result.offer)).toBe('Keeper v0');
  });

  it('treats a schema-invalid snapshot as dead, not as a loadable manifest', async () => {
    // §2: "Loader rejects unknown parents (or routes to recovery, §5)". A
    // generation that parses but fails validation has to fail the ladder too, or
    // the ladder would hand back a project the next load cannot open.
    const fs = await ladder(3);
    const broken = JSON.parse(await fs.read('caotang.json.bak.1')) as { tree: { parentId: string }[] };
    broken.tree[1]!.parentId = 'n_MISSING0001';
    fs.putFile(MANIFEST_FILE, CORRUPT);
    fs.putFile('caotang.json.bak.1', JSON.stringify(broken));

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source).toMatchObject({ generation: 2 });
  });

  it('falls back to the legacy single-generation name, last', async () => {
    const fs = await ladder(1);
    const good = await fs.read(MANIFEST_FILE);
    fs.putFile(LEGACY_SNAPSHOT_FILE, good);
    fs.putFile(MANIFEST_FILE, CORRUPT);

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source).toEqual({ kind: 'legacy-snapshot', path: LEGACY_SNAPSHOT_FILE });
    expect(nameOf(result.offer)).toBe('Keeper v0');
  });

  it('prefers a real generation over the legacy name when both exist', async () => {
    const fs = await ladder(2);
    fs.putFile(
      LEGACY_SNAPSHOT_FILE,
      serializeManifest(createEmptyManifest('Legacy copy', T0)),
    );
    fs.putFile(MANIFEST_FILE, CORRUPT);

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.offer.source.kind).toBe('snapshot');
    expect(nameOf(result.offer)).toBe('Keeper v0');
  });
});

describe('§5 step 2 — rebuild from front matter, with consent', () => {
  const orphanDoc = (id: string, title: string, body: string): string =>
    [
      '---',
      `id: ${id}`,
      `title: ${title}`,
      'status: draft',
      'label: null',
      'keywords: [sea]',
      'synopsis: >-',
      '  Elena returns to the island.',
      '---',
      '',
      body,
      '',
    ].join('\n');

  const elenaFile = serializeCodexFile(
    {
      id: 'c_5H8QK2M9RT',
      name: 'Elena Voss',
      type: 'character',
      includePolicy: 'always',
      caseSensitive: false,
      aliases: ['Lena'],
      exclude: ['Lena said'],
      attachments: ['n_ZZPHAN0001', 'n_VANSHED001'],
      keywords: ['protagonist'],
    },
    "The lighthouse keeper's daughter.",
  );

  async function rebuildable(): Promise<MemoryArtifactFs> {
    const fs = new MemoryArtifactFs();
    await fs.ensureDir('docs');
    await fs.ensureDir('codex');
    fs.putFile('docs/n_ZZPHAN0001.md', orphanDoc('n_ZZPHAN0001', 'The Landing', 'The ferry was late.'));
    fs.putFile('docs/n_ZZPHAN0002.md', orphanDoc('n_ZZPHAN0002', 'The Return', 'She came back.'));
    fs.putFile('codex/c_5H8QK2M9RT.md', elenaFile);
    fs.putFile(MANIFEST_FILE, CORRUPT);
    return fs;
  }

  it('offers a rebuild rather than doing one, and states what is lost', async () => {
    const fs = await rebuildable();

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('needs-consent');
    if (result.status !== 'needs-consent') return;
    expect(result.offer.requiresConsent).toBe(true);
    expect(result.offer.source).toEqual({ kind: 'rebuild' });
    // §5.2: "Folder structure and vocabulary are lost … the report says exactly
    // that." The loss list is part of the result, not something a UI must know
    // to compose.
    expect(result.offer.loss.join(' ')).toContain('Folder structure');
    expect(result.offer.loss.join(' ')).toContain('Vocabulary');
    expect(result.offer.recoveredDocuments).toEqual(['n_ZZPHAN0001.md', 'n_ZZPHAN0002.md']);
    // Still nothing written.
    expect(await fs.read(MANIFEST_FILE)).toBe(CORRUPT);
  });

  it('rebuilds documents flat under a Recovered folder, bodies intact', async () => {
    const fs = await rebuildable();

    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'needs-consent') throw new Error('expected a rebuild offer');
    const { state } = result.offer;

    const folder = state.manifest.tree.find((n) => n.title === 'Recovered');
    expect(folder?.type).toBe('folder');
    const children = state.manifest.tree.filter((n) => n.parentId === folder?.id);
    expect(children.map((c) => c.title)).toEqual(['The Landing', 'The Return']);
    expect(state.documents.get('n_ZZPHAN0001')?.body).toBe('The ferry was late.');
    expect(children[0]?.status).toBe('draft');
    expect(children[0]?.keywords).toEqual(['sea']);
    expect(children[0]?.synopsis).toBe('Elena returns to the island.');
  });

  it('restores codex entries from their redundancy files, dropping dangling ids (§5.4)', async () => {
    const fs = await rebuildable();

    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'needs-consent') throw new Error('expected a rebuild offer');
    const entry = result.offer.state.manifest.codex?.find((c) => c.id === 'c_5H8QK2M9RT');

    expect(entry?.name).toBe('Elena Voss');
    expect(entry?.description).toBe("The lighthouse keeper's daughter.");
    expect(entry?.aliases).toEqual(['Lena']);
    expect(entry?.exclude).toEqual(['Lena said']);
    expect(entry?.includePolicy).toBe('always');
    expect(entry?.keywords).toEqual(['protagonist']);
    // n_ZZPHAN0001 resolved against the rebuilt tree; n_VANSHED001 did not exist.
    expect(entry?.attachments).toEqual(['n_ZZPHAN0001']);
  });

  it('starts from an empty vocabulary, because the manifest held the terms', async () => {
    const fs = await rebuildable();

    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'needs-consent') throw new Error('expected a rebuild offer');

    expect(result.offer.state.manifest.vocabulary).toEqual({ statuses: [], labels: [] });
  });

  it('produces a project that the ordinary loader opens with nothing left over', async () => {
    const fs = await rebuildable();
    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'needs-consent') throw new Error('expected a rebuild offer');

    await commitRecovery(fs, result.offer, { now: T1 });
    const reloaded = await readProject(fs, { now: T1 });

    // The round-trip property that makes a rebuild usable rather than a one-off:
    // what the rebuild produced is indistinguishable from a project that was
    // simply written, so the next open takes the ordinary path.
    expect(reloaded.orphans).toEqual([]);
    expect(reloaded.orphanCodex).toEqual([]);
    expect(reloaded.state.documents.get('n_ZZPHAN0001')?.body).toBe('The ferry was late.');
    expect(reloaded.state.manifest.codex).toHaveLength(1);
  });

  it('reports unrecoverable rather than inventing a project from nothing', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(MANIFEST_FILE, CORRUPT);

    const result = await recoverProject(fs, { now: T1 });

    expect(result.status).toBe('unrecoverable');
    if (result.status !== 'unrecoverable') return;
    expect(result.attempts.join(' ')).toContain(MANIFEST_FILE);
    expect(result.attempts.join(' ')).toContain('no redundancy data');
  });
});

describe('§5 step 3 — commit writes a new manifest and preserves the corrupt original', () => {
  it('keeps the corrupt bytes in caotang.json.corrupt-<timestamp>', async () => {
    const fs = await ladder(2);
    fs.putFile(MANIFEST_FILE, CORRUPT);

    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'ok') throw new Error('expected a snapshot recovery');
    const commit = await commitRecovery(fs, result.offer, { now: T1 });

    expect(commit.preservedAs).toBe('caotang.json.corrupt-2026-09-29T02-10-00-000Z');
    expect(await fs.read(commit.preservedAs!)).toBe(CORRUPT);
    expect(await fs.read(MANIFEST_FILE)).not.toBe(CORRUPT);
  });

  it('does not rotate the corruption into the ladder', async () => {
    const fs = await ladder(3);
    const goodGeneration = await fs.read('caotang.json.bak.2');
    fs.putFile(MANIFEST_FILE, CORRUPT);
    fs.putFile('caotang.json.bak.1', 'also broken');

    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'ok') throw new Error('expected a snapshot recovery');
    await commitRecovery(fs, result.offer, { now: T1 });

    // Had the write rotated the corrupt caotang.json before replacing it, the
    // corruption would now sit at bak.1 — the first rung the next open tries —
    // and the good generation would have been pushed down and off the end.
    for (const [path, contents] of Object.entries(fs.snapshot())) {
      if (!path.includes('.bak.')) continue;
      expect(contents, `${path} must not hold the corruption`).not.toContain(CORRUPT);
    }
    // The surviving generation is still where the ladder expects it.
    expect(await fs.read('caotang.json.bak.2')).toBe(goodGeneration);
  });

  it('re-running the ladder after a commit takes the healthy path, not another recovery', async () => {
    const fs = await ladder(2);
    fs.putFile(MANIFEST_FILE, CORRUPT);
    const first = await recoverProject(fs, { now: T1 });
    if (first.status !== 'ok') throw new Error('expected a snapshot recovery');
    await commitRecovery(fs, first.offer, { now: T1 });

    const second = await recoverProject(fs, { now: T1 });

    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.offer.recovered).toBe(false);
    expect(second.offer.source.kind).toBe('manifest');
  });

  it('preserves nothing when there was no corrupt manifest to preserve', async () => {
    const fs = await ladder(1);
    const result = await recoverProject(fs, { now: T1 });
    if (result.status !== 'ok') throw new Error('expected a healthy load');

    const commit = await commitRecovery(fs, result.offer, { now: T1 });

    expect(commit.preservedAs).toBeUndefined();
    expect(Object.keys(fs.snapshot()).filter((p) => p.includes('.corrupt-'))).toEqual([]);
  });
});
