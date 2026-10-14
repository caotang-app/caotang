/**
 * Reference resolution — video-prompt-pack.md §3: the shot's override first, then the codex entries the
 * shot mentions, filtered by the include policy, then none. The provenance names every entry that supplied
 * a reference and every mentioned entry that did not, with the reason.
 */
import { describe, expect, it } from 'vitest';

import { resolveReferences, type ShotNode } from '../src/index.js';

import { CODEX, FERRY, HARBOUR, SHOTS, WOLF, codexEntry, storyboard } from './fixtures.js';

function shot(id: string): ShotNode {
  const found = SHOTS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no shot ${id}`);
  return found;
}

describe('the codex mention order (§3, step 2)', () => {
  it('resolves the visual references of the entries a shot names in its action and its covered script', () => {
    const resolution = resolveReferences({ shot: shot('s1'), storyboard: storyboard() });
    expect(resolution.provenance.source).toBe('codex');
    // Codex order: the character first, then the object.
    expect(resolution.references).toEqual([
      { type: 'character', source: 'codex', entryId: 'c_elena', assetId: 'a_elena', fileName: 'a_elena.png', label: 'Elena' },
      { type: 'image', source: 'codex', entryId: 'c_ferry', assetId: 'a_ferry', fileName: 'a_ferry.png', label: 'Ferry' },
    ]);
  });

  it('records which surfaces held each mention, so the preview can say where the name came from', () => {
    const { provenance } = resolveReferences({ shot: shot('s1'), storyboard: storyboard() });
    const elena = provenance.supplied.find((entry) => entry.entryId === 'c_elena');
    expect(elena).toMatchObject({ reason: 'mentioned', where: ['action', 'covered'], assetIds: ['a_elena'] });
  });

  it('matches a name only at a word boundary: "ferryman" does not mention "Ferry"', () => {
    const { provenance, references } = resolveReferences({ shot: shot('s2'), storyboard: storyboard() });
    expect(provenance.supplied.map((entry) => entry.entryId)).toEqual(['c_harbour']);
    expect(references.every((reference) => reference.entryId !== 'c_ferry')).toBe(true);
  });

  it('resolves nothing, and says so, for a shot that names no entry', () => {
    const resolution = resolveReferences({ shot: shot('s3'), storyboard: storyboard() });
    expect(resolution.references).toEqual([]);
    expect(resolution.provenance).toMatchObject({ source: 'none', supplied: [], withheld: [] });
  });
});

describe('the include policy filters the mention set (codex.md §5)', () => {
  it('withholds a `never` entry that is mentioned, and says why', () => {
    const { provenance, references } = resolveReferences({ shot: shot('s4'), storyboard: storyboard() });
    expect(provenance.withheld).toContainEqual({ entryId: 'c_wolf', name: 'Wolf', reason: 'never' });
    expect(references.some((reference) => reference.entryId === 'c_wolf')).toBe(false);
  });

  it('withholds a `manual` entry that is attached outside the shot’s own scope', () => {
    const outside = codexEntry('Ferry', { ...FERRY, attachments: ['board2'] });
    const codex = CODEX.map((entry) => (entry.id === FERRY.id ? outside : entry));
    const { provenance, references } = resolveReferences({ shot: shot('s1'), storyboard: storyboard({ codex }) });
    expect(provenance.withheld).toContainEqual({ entryId: 'c_ferry', name: 'Ferry', reason: 'manual-unattached' });
    expect(references.some((reference) => reference.entryId === 'c_ferry')).toBe(false);
  });

  it('supplies a `manual` entry attached to the shot’s folder', () => {
    const { provenance } = resolveReferences({ shot: shot('s1'), storyboard: storyboard() });
    expect(provenance.supplied.map((entry) => entry.entryId)).toContain('c_ferry');
  });

  it('supplies a `manual` entry attached to the project root, the top of every shot’s focus scope (codex.md §5)', () => {
    const rooted = codexEntry('Ferry', { ...FERRY, attachments: ['root'] });
    const codex = CODEX.map((entry) => (entry.id === FERRY.id ? rooted : entry));
    const { provenance } = resolveReferences({ shot: shot('s1'), storyboard: storyboard({ codex }) });
    expect(provenance.supplied.map((entry) => entry.entryId)).toContain('c_ferry');
  });

  it('withholds a mentioned entry that has no visual reference, and says so', () => {
    const bare = codexEntry('Harbour', { ...HARBOUR, visualRefs: undefined });
    const codex = CODEX.map((entry) => (entry.id === HARBOUR.id ? bare : entry));
    const { provenance } = resolveReferences({ shot: shot('s2'), storyboard: storyboard({ codex }) });
    expect(provenance.withheld).toContainEqual({ entryId: 'c_harbour', name: 'Harbour', reason: 'no-visual-reference' });
    expect(provenance.source).toBe('none');
  });
});

describe('the shot’s own override comes first (§3, step 1)', () => {
  it('uses an asset the override names, and ignores what the codex would have supplied', () => {
    const resolution = resolveReferences({
      shot: shot('s1'),
      override: [{ type: 'firstFrame', assetId: 'a_first' }],
      storyboard: storyboard(),
    });
    expect(resolution.provenance.source).toBe('shot');
    expect(resolution.references).toEqual([{ type: 'firstFrame', source: 'shot', assetId: 'a_first', fileName: 'a_first.png', label: undefined }]);
  });

  it('expands an entry the override names to every visual reference of that entry', () => {
    const resolution = resolveReferences({
      shot: shot('s3'),
      override: [{ type: 'character', entryId: 'c_elena' }],
      storyboard: storyboard(),
    });
    expect(resolution.references).toEqual([
      { type: 'character', source: 'shot', entryId: 'c_elena', assetId: 'a_elena', fileName: 'a_elena.png', label: 'Elena' },
    ]);
    expect(resolution.provenance.supplied).toEqual([
      { entryId: 'c_elena', name: 'Elena', reason: 'override', where: [], assetIds: ['a_elena'] },
    ]);
  });

  it('keeps a reference to an entry with no visual reference, with no file name, so the validator can report it', () => {
    const bare = codexEntry('Harbour', { ...HARBOUR, visualRefs: undefined });
    const codex = CODEX.map((entry) => (entry.id === HARBOUR.id ? bare : entry));
    const resolution = resolveReferences({
      shot: shot('s3'),
      override: [{ type: 'character', entryId: 'c_harbour' }],
      storyboard: storyboard({ codex }),
    });
    expect(resolution.references).toEqual([{ type: 'character', source: 'shot', entryId: 'c_harbour', label: 'Harbour' }]);
    expect(resolution.provenance.withheld).toEqual([{ entryId: 'c_harbour', name: 'Harbour', reason: 'no-visual-reference' }]);
  });

  it('keeps a reference to an id that names no entry, with no file name, so the validator can report it', () => {
    const resolution = resolveReferences({
      shot: shot('s3'),
      override: [{ type: 'character', entryId: 'c_gone' }],
      storyboard: storyboard(),
    });
    expect(resolution.references).toEqual([{ type: 'character', source: 'shot', entryId: 'c_gone' }]);
    expect(resolution.provenance.withheld).toEqual([]);
  });
});

describe('an override keeps the rules that forbid a send, and replaces the rules that bring an entry in (codex.md §2, §5)', () => {
  it('supplies a `manual` entry the override names, though the shot is not attached to it: the override is the writer’s choice', () => {
    const { provenance, references } = resolveReferences({
      shot: shot('s4'),
      override: [{ type: 'image', entryId: FERRY.id }],
      storyboard: storyboard(),
    });
    expect(references.map((reference) => reference.entryId)).toEqual(['c_ferry']);
    expect(provenance.supplied.map((entry) => entry.entryId)).toEqual(['c_ferry']);
  });

  it('withholds a `never` entry the override names: no reference is sent, and the provenance says why', () => {
    const { provenance, references } = resolveReferences({
      shot: shot('s3'),
      override: [{ type: 'character', entryId: WOLF.id }],
      storyboard: storyboard(),
    });
    expect(references).toEqual([]);
    expect(provenance.supplied).toEqual([]);
    expect(provenance.withheld).toEqual([{ entryId: 'c_wolf', name: 'Wolf', reason: 'never' }]);
  });

  it('withholds an entry with an empty description that the override names, even when it has a visual reference', () => {
    const blank = codexEntry('Harbour', { ...HARBOUR, description: '   ', visualRefs: ['a_wolf'] });
    const codex = CODEX.map((entry) => (entry.id === HARBOUR.id ? blank : entry));
    const { provenance, references } = resolveReferences({
      shot: shot('s3'),
      override: [{ type: 'image', entryId: 'c_harbour' }],
      storyboard: storyboard({ codex }),
    });
    expect(references).toEqual([]);
    expect(provenance.supplied).toEqual([]);
    expect(provenance.withheld).toEqual([{ entryId: 'c_harbour', name: 'Harbour', reason: 'empty-description' }]);
  });
});

describe('an empty description drops a mentioned entry, even when it has a visual reference (codex.md §2)', () => {
  it('supplies nothing for the entry, and the provenance names it as withheld', () => {
    const blank = codexEntry('Harbour', { ...HARBOUR, description: '   ', visualRefs: ['a_wolf'] });
    const codex = CODEX.map((entry) => (entry.id === HARBOUR.id ? blank : entry));
    const { provenance, references } = resolveReferences({ shot: shot('s2'), storyboard: storyboard({ codex }) });
    expect(references.some((reference) => reference.entryId === 'c_harbour')).toBe(false);
    expect(provenance.supplied.some((entry) => entry.entryId === 'c_harbour')).toBe(false);
    expect(provenance.withheld).toContainEqual({ entryId: 'c_harbour', name: 'Harbour', reason: 'empty-description' });
    expect(provenance.source).toBe('none');
  });
});

describe('references that name nothing and the deterministic order', () => {
  it('keeps a codex visual reference whose asset is gone, with no file name', () => {
    const missing = codexEntry('Harbour', { ...HARBOUR, visualRefs: ['a_gone'] });
    const codex = CODEX.map((entry) => (entry.id === HARBOUR.id ? missing : entry));
    const { references } = resolveReferences({ shot: shot('s2'), storyboard: storyboard({ codex }) });
    expect(references).toEqual([{ type: 'image', source: 'codex', entryId: 'c_harbour', assetId: 'a_gone', fileName: undefined, label: 'Harbour' }]);
  });

  it('gives the same answer whatever order the codex was loaded in', () => {
    const forward = resolveReferences({ shot: shot('s1'), storyboard: storyboard() });
    const reversed = resolveReferences({ shot: shot('s1'), storyboard: storyboard({ codex: [...CODEX].reverse() }) });
    expect(reversed.references).toEqual(forward.references);
    expect(reversed.provenance).toEqual(forward.provenance);
  });

  it('does not borrow the references of an entry the shot does not name', () => {
    const { references, provenance } = resolveReferences({ shot: shot('s3'), storyboard: storyboard() });
    expect(references).toEqual([]);
    expect(provenance.supplied).toEqual([]);
    expect(provenance.withheld).toEqual([]);
  });
});
