import { MemoryArtifactFs } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  COHERENCE_FILE,
  corruptCoherenceFile,
  coherenceSnapshotFile,
  emptyCoherenceFile,
  loadCoherence,
  parseCoherenceFile,
  saveCoherence,
  type CoherenceFile,
} from '../src/index.js';

import { LATER, NOW } from './fixtures.js';

/** A file whose only content is one manual rule, so each save can be told apart by its text. */
function generation(n: number): CoherenceFile {
  return {
    ...emptyCoherenceFile(),
    worldRules: [
      { id: `w_AAAAAAAAA${n}`, text: `Rule ${n}.`, origin: 'manual', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    ],
  };
}

/** The rule texts a serialized file holds, or the outcome kind when it is not readable. */
function rulesOf(text: string | undefined): string {
  const outcome = parseCoherenceFile(text ?? '');
  return outcome.kind === 'ok' ? outcome.file.worldRules.map((rule) => rule.text).join('|') : `<${outcome.kind}>`;
}

describe('coherence.json snapshots (project-format §4, applied to coherence.json)', () => {
  it('rotates the previous file into bak.1 on each changed save, and keeps three generations', async () => {
    const fs = new MemoryArtifactFs();
    const load = await loadCoherence(fs);
    for (let n = 1; n <= 5; n += 1) await saveCoherence(fs, load, generation(n));

    const files = fs.snapshot();
    expect(rulesOf(files[COHERENCE_FILE])).toBe('Rule 5.');
    expect(rulesOf(files[coherenceSnapshotFile(1)])).toBe('Rule 4.');
    expect(rulesOf(files[coherenceSnapshotFile(2)])).toBe('Rule 3.');
    expect(rulesOf(files[coherenceSnapshotFile(3)])).toBe('Rule 2.');
    expect(files[coherenceSnapshotFile(4)]).toBeUndefined();
  });

  it('does not rotate for a save that changes nothing', async () => {
    const fs = new MemoryArtifactFs();
    const load = await loadCoherence(fs);
    await saveCoherence(fs, load, generation(1));
    await saveCoherence(fs, load, generation(1));
    expect(fs.snapshot()[coherenceSnapshotFile(1)]).toBeUndefined();
  });

  it('restores the newest readable snapshot when the live file is unreadable, and keeps the damaged copy', async () => {
    const fs = new MemoryArtifactFs();
    const load = await loadCoherence(fs);
    await saveCoherence(fs, load, generation(1));
    await saveCoherence(fs, load, generation(2));
    const damaged = '{"formatVersion": 1, "findings": [';
    fs.putFile(COHERENCE_FILE, damaged);

    const recovered = await loadCoherence(fs, { now: LATER });
    expect(recovered.status).toBe('recovered');
    expect(recovered.file.worldRules.map((rule) => rule.text)).toEqual(['Rule 1.']);
    expect(recovered.preservedAs).toBe(corruptCoherenceFile(LATER));
    expect(fs.snapshot()[corruptCoherenceFile(LATER)]).toBe(damaged);
    expect(rulesOf(fs.snapshot()[COHERENCE_FILE])).toBe('Rule 1.');
    expect(recovered.notices.find((notice) => notice.code === 'restored-from-snapshot')?.message).toContain(coherenceSnapshotFile(1));
  });

  it('skips a damaged snapshot and restores the next readable one', async () => {
    const fs = new MemoryArtifactFs();
    const load = await loadCoherence(fs);
    for (let n = 1; n <= 3; n += 1) await saveCoherence(fs, load, generation(n));
    fs.putFile(COHERENCE_FILE, '{broken');
    fs.putFile(coherenceSnapshotFile(1), '{broken too');

    const recovered = await loadCoherence(fs, { now: LATER });
    expect(recovered.status).toBe('recovered');
    expect(recovered.file.worldRules.map((rule) => rule.text)).toEqual(['Rule 1.']);
    expect(recovered.notices.find((notice) => notice.code === 'restored-from-snapshot')?.message).toContain(coherenceSnapshotFile(2));
  });

  it('keeps the damaged live file when a save finds it damaged, rather than writing over it', async () => {
    const fs = new MemoryArtifactFs();
    const load = await loadCoherence(fs);
    await saveCoherence(fs, load, generation(1));
    fs.putFile(COHERENCE_FILE, '{damaged between load and save');

    await saveCoherence(fs, load, generation(2), { now: LATER });
    expect(fs.snapshot()[corruptCoherenceFile(LATER)]).toBe('{damaged between load and save');
    expect(rulesOf(fs.snapshot()[COHERENCE_FILE])).toBe('Rule 2.');
    // The damaged text is not rotated into the ladder, so every snapshot still reads.
    expect(fs.snapshot()[coherenceSnapshotFile(1)]).toBeUndefined();
  });
});
