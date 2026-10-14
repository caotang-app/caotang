/**
 * A provenance citation whose offsets or timestamp are the wrong type. Before the
 * loader checked them, `from: "zero"` loaded silently and the next save wrote it back
 * as `from: zero`, which is not JSON, so the project could not be opened again. The
 * loader now drops such a citation with a notice, and the writer encodes the offsets
 * as JSON numbers, so a file it writes always parses.
 */
import { describe, expect, it } from 'vitest';

import {
  addDocument,
  createEmptyManifest,
  createProjectState,
  MemoryArtifactFs,
  readProject,
  writeProject,
} from '../src/index.js';

const NOW = new Date('2026-10-02T15:00:00.000Z');
const STAMP = '2026-10-01T00:00:00.000Z';

type Citation = Record<string, unknown>;

/** A project whose one codex entry cites the document's first sentence. */
async function projectCitingBody(): Promise<{ fs: MemoryArtifactFs; docId: string }> {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', NOW), { now: NOW });
  const node = addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late.', now: NOW });
  const citation = { docId: node.id, quote: 'The ferry was late.', from: 0, to: 19, extractedAt: STAMP };
  state.manifest.codex = [
    {
      id: 'c_5H8QK2M9RT',
      name: 'Elena Voss',
      aliases: [],
      type: 'character',
      description: 'The keeper.',
      includePolicy: 'detected',
      caseSensitive: false,
      exclude: [],
      attachments: [],
      keywords: [],
      origin: 'agent',
      sources: [citation],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  ];
  const fs = new MemoryArtifactFs();
  await writeProject(fs, state, { now: NOW });
  return { fs, docId: node.id };
}

/** Rewrite the saved `caotang.json`'s citation, the way a hand-edit or a foreign writer would. */
async function editCitation(fs: MemoryArtifactFs, edit: (citation: Citation) => void): Promise<void> {
  const manifest = JSON.parse(fs.snapshot()['caotang.json']!) as { codex: Array<{ sources: Citation[] }> };
  edit(manifest.codex[0]!.sources[0]!);
  await fs.writeAtomic('caotang.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('a citation with a wrong-typed offset or timestamp (validate.ts, manifest-json.ts)', () => {
  it('drops a citation whose from is a string, with a notice, and the next save is a file that parses', async () => {
    const { fs } = await projectCitingBody();
    await editCitation(fs, (citation) => {
      citation['from'] = 'zero';
    });

    const loaded = await readProject(fs);

    const notice = loaded.notices.find((n) => n.message.includes('citation dropped'));
    expect(notice?.message).toContain('from must be a whole offset');
    expect(loaded.state.manifest.codex?.[0]?.sources).toEqual([]);

    await writeProject(fs, loaded.state, { now: NOW });
    const saved = fs.snapshot()['caotang.json']!;
    expect(() => JSON.parse(saved)).not.toThrow();
    expect(saved).not.toContain('zero');
  });

  it('drops a citation whose to runs before its from, and one whose extractedAt is not a time', async () => {
    const backwards = await projectCitingBody();
    await editCitation(backwards.fs, (citation) => {
      citation['from'] = 9;
      citation['to'] = 3;
    });
    const backwardsLoaded = await readProject(backwards.fs);
    expect(backwardsLoaded.notices.some((n) => n.message.includes('to must be a whole offset ≥ 9'))).toBe(true);
    expect(backwardsLoaded.state.manifest.codex?.[0]?.sources).toEqual([]);

    const stamp = await projectCitingBody();
    await editCitation(stamp.fs, (citation) => {
      citation['extractedAt'] = 'yesterday';
    });
    const stampLoaded = await readProject(stamp.fs);
    expect(stampLoaded.notices.some((n) => n.message.includes('extractedAt must be an ISO-8601 time'))).toBe(true);
    expect(stampLoaded.state.manifest.codex?.[0]?.sources).toEqual([]);
  });

  it('keeps a citation that has no offsets or timestamp at all, as manifests written before they were kept do', async () => {
    const { fs } = await projectCitingBody();
    await editCitation(fs, (citation) => {
      delete citation['from'];
      delete citation['to'];
      delete citation['extractedAt'];
    });

    const loaded = await readProject(fs);

    expect(loaded.notices.some((n) => n.message.includes('citation dropped'))).toBe(false);
    expect(loaded.state.manifest.codex?.[0]?.sources).toEqual([
      expect.objectContaining({ quote: 'The ferry was late.' }),
    ]);
  });

  it('a citation the loader kept still writes its numbers as JSON numbers', async () => {
    const { fs } = await projectCitingBody();
    const loaded = await readProject(fs);
    await writeProject(fs, loaded.state, { now: NOW });

    const saved = JSON.parse(fs.snapshot()['caotang.json']!) as { codex: Array<{ sources: Citation[] }> };
    expect(saved.codex[0]!.sources[0]).toMatchObject({ from: 0, to: 19, extractedAt: STAMP });
  });
});
