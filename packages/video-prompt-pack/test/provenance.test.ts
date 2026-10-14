/**
 * Provenance (video-prompt-pack.md §3): the pack says which codex entry supplied which reference to each shot, and which entry
 * the shot names but withheld, and why. The JSON and the Markdown carry the same answer the references were resolved from.
 */

import { describe, expect, it } from 'vitest';

import { preparePack, renderPromptPack, type PackRun, type ShotNode } from '../src/index.js';
import { ASSETS, ELENA, HARBOUR, SHOTS, TREE, WOLF, codexEntry, refFor, storyboard, withRef } from './fixtures.js';

/** The shot with the given id, with one Runway record on it. */
function shotWith(id: string, overrides: Partial<Parameters<typeof refFor>[1]> = {}): ShotNode {
  const shot = SHOTS.find((candidate) => candidate.id === id);
  if (shot === undefined) throw new Error(`no fixture shot ${id}`);
  return withRef(shot, refFor('runway-gen4', { durationSec: 5, aspectRatio: '16:9', ...overrides }));
}

function run(shots: readonly ShotNode[], codex = [ELENA, HARBOUR, WOLF]): PackRun {
  return preparePack(storyboard({ shots, codex, assets: ASSETS, tree: TREE }), 'runway-gen4');
}

interface JsonProvenance {
  readonly source: string;
  readonly supplied: readonly unknown[];
  readonly withheld: readonly unknown[];
}

/** The JSON pack's record for one shot, read back from the rendered text. */
function jsonShot(pack: PackRun, shotId: string): { readonly provenance: JsonProvenance } {
  const rendered = renderPromptPack(pack, 'json');
  if (!rendered.ok) throw new Error('the JSON pack should render');
  const parsed = JSON.parse(rendered.text) as { shots: { shotId: string; provenance: JsonProvenance }[] };
  const shot = parsed.shots.find((candidate) => candidate.shotId === shotId);
  if (shot === undefined) throw new Error(`no shot ${shotId} in the JSON pack`);
  return shot;
}

describe('the provenance of a shot’s references', () => {
  it('names the entry that supplied the reference, where it was mentioned, and the files it sent', () => {
    const pack = run([shotWith('s1')]);
    const [shot] = pack.shots;
    expect(shot?.provenance.source).toBe('codex');
    expect(shot?.provenance.supplied).toEqual([
      expect.objectContaining({ entryId: 'c_elena', name: 'Elena', reason: 'mentioned', assetIds: ['a_elena'] }),
    ]);
    expect(shot?.provenance.supplied[0]?.where).toEqual(expect.arrayContaining(['action', 'covered']));
  });

  it('records a `never` entry the shot names as withheld, with the reason, and sends none of its files', () => {
    // The shot names the wolf and nothing else in this codex, so the wolf is the only entry the shot can be withheld from.
    const pack = run([shotWith('s4')], [WOLF]);
    const [shot] = pack.shots;
    expect(shot?.provenance.supplied).toEqual([]);
    expect(shot?.provenance.withheld).toEqual([expect.objectContaining({ entryId: 'c_wolf', reason: 'never' })]);
    expect(shot?.references).toEqual([]);
  });

  it('records an entry with no visual reference as withheld for that reason, not as supplying a file', () => {
    const bare = codexEntry('Harbour', { id: 'c_bare', description: 'A fog-bound port.', type: 'location' });
    const pack = run([shotWith('s2')], [bare]);
    expect(pack.shots[0]?.provenance.supplied).toEqual([]);
    expect(pack.shots[0]?.provenance.withheld).toEqual([expect.objectContaining({ entryId: 'c_bare', reason: 'no-visual-reference' })]);
  });

  it('names the shot as the source when the shot’s own record names the entry', () => {
    const shot = shotWith('s3', { references: [{ type: 'character', entryId: 'c_elena' }] });
    const [resolved] = run([shot]).shots;
    expect(resolved?.provenance.source).toBe('shot');
    expect(resolved?.provenance.supplied).toEqual([expect.objectContaining({ entryId: 'c_elena', reason: 'override', where: [] })]);
  });

  it('is empty, and says so, for a shot that names no entry', () => {
    const [shot] = run([shotWith('s3')]).shots;
    expect(shot?.provenance).toEqual({ shotId: 's3', source: 'none', supplied: [], withheld: [] });
  });
});

describe('the provenance in the exported packs', () => {
  it('carries the supplied and withheld entries in the JSON pack, per shot', () => {
    const pack = run([shotWith('s1'), shotWith('s4')]);
    const one = jsonShot(pack, 's1');
    expect(one.provenance.source).toBe('codex');
    expect(one.provenance.supplied).toEqual([expect.objectContaining({ entryId: 'c_elena', reason: 'mentioned', assetIds: ['a_elena'] })]);
    const four = jsonShot(pack, 's4');
    expect(four.provenance.withheld).toEqual([expect.objectContaining({ entryId: 'c_wolf', reason: 'never' })]);
  });

  it('writes a Consistency block to the Markdown pack, with the reason for each entry that sent nothing', () => {
    const pack = run([shotWith('s1'), shotWith('s4')]);
    const markdown = renderPromptPack(pack, 'markdown');
    if (!markdown.ok) throw new Error('the pack should render');
    expect(markdown.text).toContain('**Consistency**');
    expect(markdown.text).toContain('- Elena: mentioned in the action and the covered script, sends 1 reference');
    expect(markdown.text).toContain('- Wolf: not sent, because its entry is set to never be sent');
  });

  it('writes no Consistency block for a shot with no provenance to show', () => {
    const markdown = renderPromptPack(run([shotWith('s3')]), 'markdown');
    if (!markdown.ok) throw new Error('the pack should render');
    expect(markdown.text).not.toContain('**Consistency**');
  });
});
