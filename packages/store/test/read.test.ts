/**
 * Orphan import — project-format.md §2 validation step 4 and codex.md §3.
 *
 * Step 4 is not a diagnostic, it is an action: "orphan `docs/*.md` files (no
 * tree entry) are imported as 'Recovered' documents, never deleted", and
 * codex.md §3 gives orphan `codex/*.md` the same treatment. This is the class
 * of file a crash between the document write and the manifest write leaves
 * behind — the reason the write path puts documents first.
 *
 * The load → write → load property is the one that matters most: an imported
 * file must produce a manifest that this same loader accepts, or the import
 * would trade one damaged project for another.
 */

import { describe, expect, it } from 'vitest';
import {
  MemoryArtifactFs,
  RECOVERED_TITLE,
  addDocument,
  createEmptyManifest,
  createProjectState,
  readProject,
  serializeCodexFile,
  writeProject,
  type ProjectState,
} from '../src/index.js';

const T0 = new Date('2026-09-29T02:00:00.000Z');
const T1 = new Date('2026-09-29T02:10:00.000Z');

async function seeded(): Promise<{ fs: MemoryArtifactFs; state: ProjectState }> {
  const state = createProjectState(createEmptyManifest('Keeper', T0));
  addDocument(state, {
    parentId: 'manuscript',
    title: 'The Landing',
    body: 'The ferry was late, as always.',
    now: T0,
    id: 'n_3W8RN2TQ6C',
  });
  const fs = new MemoryArtifactFs();
  await writeProject(fs, state, { now: T0 });
  return { fs, state };
}

function docFile(
  id: string,
  title: string,
  body: string,
  extra = '',
): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'status: draft',
    'label: null',
    'keywords: [sea, grief]',
    'synopsis: >-',
    '  Elena returns to the island after nine years.',
    extra,
    '---',
    '',
    body,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const recoveredFolderOf = (state: ProjectState): string => {
  const folder = state.manifest.tree.find((n) => n.title === RECOVERED_TITLE);
  if (!folder) throw new Error('no Recovered folder was created');
  return folder.id;
};

describe('orphan docs/*.md import (§2 step 4)', () => {
  it('imports an orphan as a document under a Recovered folder and keeps the file', async () => {
    const { fs } = await seeded();
    fs.putFile('docs/n_ZZPHAN0001.md', docFile('n_ZZPHAN0001', 'The Return', 'She came back.'));

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphans).toEqual(['n_ZZPHAN0001.md']);
    const node = loaded.state.manifest.tree.find((n) => n.id === 'n_ZZPHAN0001');
    expect(node).toBeDefined();
    expect(node?.type).toBe('document');
    expect(node?.title).toBe('The Return');
    expect(node?.parentId).toBe(recoveredFolderOf(loaded.state));
    expect(loaded.state.documents.get('n_ZZPHAN0001')?.body).toBe('She came back.');
    // "never deleted" is the load-bearing half of the rule.
    expect(await fs.exists('docs/n_ZZPHAN0001.md')).toBe(true);
    expect(loaded.notices.some((n) => n.message.includes('imported as a Recovered document'))).toBe(
      true,
    );
  });

  it('puts every orphan in one Recovered folder, in filename order', async () => {
    const { fs } = await seeded();
    // Filename order is the only order available: front matter holds no
    // structure, so §5.2's fallback is the filename itself. Titles are assigned
    // so that filename order and title order agree — the point of the assertion
    // is that the *file* decides, not the order they were written in.
    fs.putFile('docs/n_QQQQQQQQQQ.md', docFile('n_QQQQQQQQQQ', 'Third', 'c'));
    fs.putFile('docs/n_MMMMMMMMMM.md', docFile('n_MMMMMMMMMM', 'Second', 'b'));
    fs.putFile('docs/n_KKKKKKKKKK.md', docFile('n_KKKKKKKKKK', 'First', 'a'));

    const loaded = await readProject(fs, { now: T1 });
    const folder = recoveredFolderOf(loaded.state);
    const children = loaded.state.manifest.tree
      .filter((n) => n.parentId === folder)
      .sort((a, b) => a.order - b.order)
      .map((n) => n.title);

    expect(children).toEqual(['First', 'Second', 'Third']);
    expect(loaded.state.manifest.tree.filter((n) => n.title === RECOVERED_TITLE)).toHaveLength(1);
  });

  it('reuses the existing Recovered folder instead of adding a second one', async () => {
    const { fs } = await seeded();
    fs.putFile('docs/n_ZZPHAN0001.md', docFile('n_ZZPHAN0001', 'One', 'a'));
    const first = await readProject(fs, { now: T1 });
    await writeProject(fs, first.state, { now: T1 });

    fs.putFile('docs/n_ZZPHAN0002.md', docFile('n_ZZPHAN0002', 'Two', 'b'));
    const second = await readProject(fs, { now: T1 });

    expect(second.state.manifest.tree.filter((n) => n.title === RECOVERED_TITLE)).toHaveLength(1);
    expect(second.orphans).toEqual(['n_ZZPHAN0002.md']);
  });

  // The orphan rule asks only whether a document node owns the file, so a file
  // named for a *folder* was imported as a second node carrying the folder's id.
  // §2 step 3 refuses a duplicate id on the next open, so one load broke the
  // project it had just read. The file is declined, and the save keeps it: an
  // unknown file the loader did not import is not the writer's to delete.
  it('does not import an orphan named for a folder, and keeps that file through a save', async () => {
    const { fs, state } = await seeded();
    state.manifest.tree.push({
      id: 'n_CHAPTER001',
      parentId: 'manuscript',
      type: 'folder',
      title: 'Chapter 1',
      order: 20,
      status: null,
      label: null,
      keywords: [],
      synopsis: '',
      notes: '',
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    });
    await writeProject(fs, state, { now: T0 });
    fs.putFile('docs/n_CHAPTER001.md', docFile('n_CHAPTER001', 'Impostor', 'a second node?'));

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.tree.filter((n) => n.id === 'n_CHAPTER001')).toHaveLength(1);
    expect(loaded.state.manifest.tree.find((n) => n.id === 'n_CHAPTER001')?.type).toBe('folder');
    expect(loaded.notices.some((n) => n.path === 'docs/n_CHAPTER001.md' && n.message.includes('not a document'))).toBe(
      true,
    );

    await writeProject(fs, loaded.state, { now: T1 });
    expect(await fs.exists('docs/n_CHAPTER001.md')).toBe(true);
    const reloaded = await readProject(fs, { now: T1 });
    expect(reloaded.state.manifest.tree.filter((n) => n.id === 'n_CHAPTER001')).toHaveLength(1);
  });

  it('leaves a file that is not `<node-id>.md` alone as an unknown file', async () => {
    const { fs } = await seeded();
    fs.putFile('docs/chapter-one.md', 'a file the author dropped in\n');

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphans).toEqual(['chapter-one.md']);
    // Minting an id for it would make the tree point at a file that cannot exist.
    expect(loaded.state.manifest.tree.some((n) => n.id === 'chapter-one')).toBe(false);
    expect(await fs.exists('docs/chapter-one.md')).toBe(true);
    expect(loaded.notices.some((n) => n.message.includes('is not named as a document'))).toBe(true);
  });

  it('imports a file with no readable front matter, keeping the body whole', async () => {
    const { fs } = await seeded();
    const raw = 'Just prose, no fence at all.\n\nSecond paragraph.\n';
    fs.putFile('docs/n_ZZPHAN0001.md', raw);

    const loaded = await readProject(fs, { now: T1 });
    const node = loaded.state.manifest.tree.find((n) => n.id === 'n_ZZPHAN0001');

    expect(node?.title).toBe('n_ZZPHAN0001');
    expect(loaded.state.documents.get('n_ZZPHAN0001')?.body).toBe(raw);
    expect(loaded.notices.some((n) => n.message.includes('imported under its file name'))).toBe(true);
  });

  it('trims imported metadata to the §2 field contracts so the manifest re-loads', async () => {
    const { fs } = await seeded();
    const longSynopsis = 'x'.repeat(2500);
    fs.putFile(
      'docs/n_ZZPHAN0001.md',
      [
        '---',
        'id: n_ZZPHAN0001',
        'title: Too Much',
        'status: null',
        'label: null',
        'keywords: [a, b, c]',
        'synopsis: |-',
        ...longSynopsis.match(/.{1,100}/g)!.map((l) => `  ${l}`),
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );

    const loaded = await readProject(fs, { now: T1 });
    const node = loaded.state.manifest.tree.find((n) => n.id === 'n_ZZPHAN0001');
    expect(node?.synopsis.length).toBe(2000);

    // The property that makes this safe: the imported node survives a save and
    // a reload, instead of producing a manifest this loader rejects.
    await writeProject(fs, loaded.state, { now: T1 });
    const reloaded = await readProject(fs, { now: T1 });
    expect(reloaded.orphans).toEqual([]);
    expect(reloaded.state.manifest.tree.some((n) => n.id === 'n_ZZPHAN0001')).toBe(true);
  });
});

describe('orphan codex/*.md import (codex.md §3)', () => {
  const elenaFile = serializeCodexFile(
    {
      id: 'c_5H8QK2M9RT',
      name: 'Elena Voss',
      type: 'character',
      includePolicy: 'detected',
      caseSensitive: false,
      aliases: ['Lena'],
      exclude: [],
      attachments: ['n_3W8RN2TQ6C', 'n_VANSHED001'],
      keywords: ['protagonist'],
    },
    "The lighthouse keeper's daughter.",
  );

  it('imports a codex file with no manifest entry, dropping dangling attachments', async () => {
    const { fs } = await seeded();
    fs.putFile('codex/c_5H8QK2M9RT.md', elenaFile);

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphanCodex).toEqual(['c_5H8QK2M9RT.md']);
    const entry = loaded.state.manifest.codex?.find((c) => c.id === 'c_5H8QK2M9RT');
    expect(entry?.name).toBe('Elena Voss');
    expect(entry?.description).toBe("The lighthouse keeper's daughter.");
    expect(entry?.origin).toBe('manual');
    // codex.md §2: dangling attachment ids are dropped with a warning.
    expect(entry?.attachments).toEqual(['n_3W8RN2TQ6C']);
    expect(loaded.notices.some((n) => n.message.includes('do not resolve'))).toBe(true);
  });

  it('does not re-import a file that its own manifest entry already owns', async () => {
    const { fs, state } = await seeded();
    state.manifest.codex = [
      {
        id: 'c_5H8QK2M9RT',
        name: 'Elena Voss',
        aliases: ['Lena'],
        type: 'character',
        description: "The lighthouse keeper's daughter.",
        includePolicy: 'detected',
        caseSensitive: false,
        exclude: [],
        attachments: [],
        keywords: ['protagonist'],
        origin: 'manual',
        sources: [],
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
    ];
    await writeProject(fs, state, { now: T0 });

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphanCodex).toEqual([]);
    expect(loaded.state.manifest.codex).toHaveLength(1);
  });

  it('drops a dangling attachment from a manifest-loaded entry too', async () => {
    const { fs, state } = await seeded();
    state.manifest.codex = [
      {
        id: 'c_5H8QK2M9RT',
        name: 'Elena Voss',
        aliases: [],
        type: 'character',
        description: 'x',
        includePolicy: 'detected',
        caseSensitive: false,
        exclude: [],
        attachments: ['n_3W8RN2TQ6C', 'n_VANSHED002'],
        keywords: [],
        origin: 'manual',
        sources: [],
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
    ];
    await writeProject(fs, state, { now: T0 });

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.codex?.[0]?.attachments).toEqual(['n_3W8RN2TQ6C']);
  });

  // codex.md §3's conflict rule is "manifest wins", and the import used to apply
  // it to the filename only. A copy of an entry under a different file name had
  // no filename match, was parsed, and was pushed as a second entry with the
  // first one's id. Dedupe is by the id the front matter carries.
  it('dedupes an orphan codex file by the id its front matter carries, not by its filename', async () => {
    const { fs, state } = await seeded();
    state.manifest.codex = [
      {
        id: 'c_5H8QK2M9RT',
        name: 'Elena Voss',
        aliases: ['Lena'],
        type: 'character',
        description: "The lighthouse keeper's daughter.",
        includePolicy: 'detected',
        caseSensitive: false,
        exclude: [],
        attachments: [],
        keywords: ['protagonist'],
        origin: 'manual',
        sources: [],
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
    ];
    await writeProject(fs, state, { now: T0 });
    fs.putFile('codex/c_CPY0000001.md', elenaFile);

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphanCodex).toEqual([]);
    expect(loaded.state.manifest.codex?.map((c) => c.id)).toEqual(['c_5H8QK2M9RT']);
    expect(loaded.notices.some((n) => n.path === 'codex/c_CPY0000001.md' && n.message.includes('the manifest wins'))).toBe(
      true,
    );
    // Declined, not pruned: the copy may hold text the manifest does not.
    expect([...loaded.state.declinedCodexFiles]).toEqual(['c_CPY0000001.md']);
  });

  it('imports two orphan files that name one id once, and keeps the second', async () => {
    const { fs } = await seeded();
    fs.putFile('codex/c_AAAAAAAAAA.md', elenaFile);
    fs.putFile('codex/c_BBBBBBBBBB.md', elenaFile);

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.codex?.filter((c) => c.id === 'c_5H8QK2M9RT')).toHaveLength(1);
    expect(loaded.orphanCodex).toHaveLength(1);
    expect([...loaded.state.declinedCodexFiles]).toHaveLength(1);
  });

  // codex.md §2: an unknown `includePolicy` is coerced with a warning. The
  // manifest path warned; the redundancy-file path coerced silently, because the
  // codec had no notice channel and the caller never asked it for one.
  it('warns on an unknown includePolicy in an orphan codex file, as the manifest path does', async () => {
    const { fs } = await seeded();
    fs.putFile('codex/c_5H8QK2M9RT.md', elenaFile.replace('includePolicy: detected', 'includePolicy: sometimes'));

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.state.manifest.codex?.[0]?.includePolicy).toBe('detected');
    const note = loaded.notices.find((n) => n.path === 'codex/c_5H8QK2M9RT.md' && n.message.includes('includePolicy'));
    expect(note?.message).toContain('"sometimes"');
    expect(note?.message).toContain('read as "detected"');
  });

  it('reports an unreadable codex file and leaves it on disk — the load path only', async () => {
    const { fs } = await seeded();
    fs.putFile('codex/c_5H8QK2M9RT.md', 'not a codex file at all\n');

    const loaded = await readProject(fs, { now: T1 });

    expect(loaded.orphanCodex).toEqual([]);
    expect(await fs.exists('codex/c_5H8QK2M9RT.md')).toBe(true);
    expect(loaded.notices.some((n) => n.message.includes('unreadable codex front matter'))).toBe(
      true,
    );
    // ⚠ This test is about `readProject` alone, and its name says so: the file is
    // on disk under any implementation once the load is over. The property that
    // matters — that the *next save* keeps it — cannot be observed here, and the
    // test that used to read as a claim about it was green precisely because it
    // stopped at this boundary (found by a review).
    //
    // Both halves live in `write.test.ts` now, under "a file the loader declined
    // is not a file the writer owns": the load-then-save span, and the
    // assertion that the decline is recorded on `state.declinedCodexFiles` rather
    // than only said in a notice.
    expect([...loaded.state.declinedCodexFiles]).toEqual(['c_5H8QK2M9RT.md']);
  });
});
