/**
 * Provenance in the codex redundancy file (codex.md §10 K4). The file is what a
 * recovery restores an entry from when its manifest entry is lost, so it must carry
 * the origin and the citations. Before K4 it did not, and an agent-inferred entry
 * recovered from its file came back as hand-authored canon.
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
const ENTRY_FILE = 'codex/c_5H8QK2M9RT.md';

/** A project whose one codex entry is agent-inferred and cites the document's first sentence. */
async function projectWithAgentEntry(): Promise<{ fs: MemoryArtifactFs; citation: Record<string, unknown> }> {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', NOW), { now: NOW });
  const node = addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late, as always.', now: NOW });
  const citation = { docId: node.id, quote: 'The ferry was late,', from: 0, to: 19, extractedAt: '2026-10-01T00:00:00.000Z' };
  state.manifest.codex = [
    {
      id: 'c_5H8QK2M9RT',
      name: 'Elena Voss',
      aliases: ['Lena'],
      type: 'character',
      description: 'The lighthouse keeper’s daughter.',
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
  return { fs, citation };
}

/** Drop the entry from the manifest, as a corrupted or hand-cut `caotang.json` would. */
async function forgetEntryInManifest(fs: MemoryArtifactFs): Promise<void> {
  const manifest = JSON.parse(fs.snapshot()['caotang.json']!) as { codex: unknown[] };
  manifest.codex = [];
  await fs.writeAtomic('caotang.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('codex redundancy file provenance (codex.md §10 K4)', () => {
  it('writes the origin and the citations into the entry file, not only into the manifest', async () => {
    const { fs } = await projectWithAgentEntry();
    const file = fs.snapshot()[ENTRY_FILE]!;
    expect(file).toContain('origin: agent\n');
    expect(file).toMatch(/^sources: ".*"$/m);
    expect(file).toContain('The ferry was late,');
  });

  it('recovers an agent entry from its file with origin agent and its citation intact', async () => {
    const { fs, citation } = await projectWithAgentEntry();
    await forgetEntryInManifest(fs);

    const loaded = await readProject(fs);

    const recovered = loaded.state.manifest.codex?.find((e) => e.id === 'c_5H8QK2M9RT');
    expect(recovered?.origin).toBe('agent');
    expect(recovered?.sources).toEqual([citation]);
    expect(loaded.notices.some((n) => n.path === ENTRY_FILE && n.message.includes('imported codex entry'))).toBe(true);
  });

  it('reads a file written before K4, with no origin key, as manual, without a note', async () => {
    const { fs } = await projectWithAgentEntry();
    // The pre-K4 shape: the same file with the two provenance keys removed.
    const current = fs.snapshot()[ENTRY_FILE]!;
    const preK4 = current.replace(/^origin: .*\n/m, '').replace(/^sources: .*\n/m, '');
    await fs.writeAtomic(ENTRY_FILE, preK4);
    await forgetEntryInManifest(fs);

    const loaded = await readProject(fs);

    const recovered = loaded.state.manifest.codex?.find((e) => e.id === 'c_5H8QK2M9RT');
    expect(recovered?.origin).toBe('manual');
    expect(recovered?.sources).toEqual([]);
    expect(loaded.notices.some((n) => n.message.includes('origin'))).toBe(false);
  });
});
