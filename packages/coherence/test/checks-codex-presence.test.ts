import { describe, expect, it } from 'vitest';

import {
  assembleInput,
  emptyCoherenceFile,
  runChecks,
  type CoherenceFile,
  type SceneMeta,
} from '../src/index.js';

import { buildState, detect, entry } from './fixtures.js';

const ELENA = 'c_5H8QK2M9RT';

function withMeta(sceneMeta: Record<string, SceneMeta>): CoherenceFile {
  return { ...emptyCoherenceFile(), sceneMeta };
}

function run(state: ReturnType<typeof buildState>, file: CoherenceFile, ids: Parameters<typeof runChecks>[1], withDetector = true) {
  const { input, unavailable } = assembleInput(state, file, withDetector ? { detector: detect } : {});
  return { ...runChecks(input, ids), unavailable };
}

describe('codex.alias-collisions (§5.1)', () => {
  it('flags two entries that answer to the same surface string, naming both and the string', () => {
    const state = buildState({
      scenes: [{ id: 'sA', title: 'A', body: 'Lena came home.' }],
      entries: [
        entry('c_AAAAAAAAAA', 'Elena Voss', { aliases: ['Lena'] }),
        entry('c_BBBBBBBBBB', 'Lena Marsh', { aliases: ['Lena'] }),
      ],
    });
    const out = run(state, emptyCoherenceFile(), ['codex.alias-collisions']);
    expect(out.drafts).toHaveLength(1);
    const [finding] = out.drafts;
    expect(finding).toMatchObject({ checkId: 'codex.alias-collisions', type: 'alias-collision', severity: 'warning', evidence: [] });
    expect(finding?.message).toBe('"Elena Voss" and "Lena Marsh" both answer to "Lena"');
    expect(finding?.factGroup).toBe('c_aaaaaaaaaa+c_bbbbbbbbbb|alias:lena');
  });

  it('is silent when every term is distinct', () => {
    const state = buildState({
      scenes: [{ id: 'sA', title: 'A', body: 'Elena came home.' }],
      entries: [entry('c_AAAAAAAAAA', 'Elena Voss', { aliases: ['Lena'] }), entry('c_BBBBBBBBBB', 'Ansel Marsh')],
    });
    expect(run(state, emptyCoherenceFile(), ['codex.alias-collisions']).drafts).toEqual([]);
  });
});

describe('codex.never-mentioned (§5.1)', () => {
  const state = (): ReturnType<typeof buildState> =>
    buildState({
      scenes: [
        { id: 'shore', title: 'Shore', body: 'Elena watched the sea.' },
        { id: 'night', title: 'Night', body: 'Lena lit the lamp.' },
      ],
      entries: [
        entry(ELENA, 'Elena', { aliases: ['Lena'] }),
        entry('c_GHOSTGHOST', 'Ghost'),
        entry('c_ORACLEORCL', 'Oracle', { includePolicy: 'always' }),
        entry('c_LURKERLURK', 'Lurker', { includePolicy: 'manual' }),
      ],
    });

  it('flags an entry with no hit in any scanned document, and exempts always, manual and never', () => {
    const out = run(state(), emptyCoherenceFile(), ['codex.never-mentioned']);
    expect(out.drafts.map((d) => d.message)).toEqual(['"Ghost" is never named in the scanned manuscript']);
    expect(out.drafts[0]).toMatchObject({ severity: 'info', factGroup: 'c_ghostghost|never-mentioned' });
  });

  it('counts a hit on an alias, so Lena keeps Elena alive', () => {
    const out = run(state(), emptyCoherenceFile(), ['codex.never-mentioned']);
    expect(out.drafts.some((d) => d.message.includes('Elena'))).toBe(false);
  });

  it('does not judge the codex when some counts are unavailable, and says so', () => {
    const out = run(state(), emptyCoherenceFile(), ['codex.never-mentioned'], false);
    expect(out.drafts).toEqual([]);
    expect(out.notes[0]).toContain('“A codex entry is never named in the manuscript” not evaluated');
  });

  it('names the check by its label in the note, never by its id', () => {
    const out = run(state(), emptyCoherenceFile(), ['codex.never-mentioned'], false);
    expect(out.notes.join(' ')).not.toContain('never-mentioned');
  });
});

describe('pov.coverage (§5.1)', () => {
  it('flags a declared POV that is never named in the scene, as information', () => {
    const state = buildState({
      scenes: [
        { id: 'shore', title: 'Shore', body: 'Elena watched the sea.' },
        { id: 'night', title: 'Night', body: 'The gulls stopped.' },
      ],
      entries: [entry(ELENA, 'Elena')],
    });
    const file = withMeta({ shore: { pov: ELENA }, night: { pov: ELENA } });
    const out = run(state, file, ['pov.coverage']);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]).toMatchObject({ type: 'pov-not-named', severity: 'info', factGroup: 'c_5h8qk2m9rt|pov-coverage' });
    expect(out.drafts[0]?.evidence.map((p) => p.docId)).toEqual(['night']);
  });

  it('asks for a codex entry when the POV names no entry, since coverage cannot be checked without one', () => {
    const state = buildState({ scenes: [{ id: 'sA', title: 'A', body: 'Words.' }], entries: [entry(ELENA, 'Elena')] });
    const out = run(state, withMeta({ sA: { pov: 'The narrator' } }), ['pov.coverage']);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]?.type).toBe('pov-unresolved');
    expect(out.drafts[0]?.message).toContain('is not a codex entry');
  });

  it('resolves a POV written as an entry name', () => {
    const state = buildState({ scenes: [{ id: 'sA', title: 'A', body: 'The gulls stopped.' }], entries: [entry(ELENA, 'Elena')] });
    const out = run(state, withMeta({ sA: { pov: 'elena' } }), ['pov.coverage']);
    expect(out.drafts[0]?.type).toBe('pov-not-named');
  });
});

describe('presence.expected (§5.1)', () => {
  const state = (): ReturnType<typeof buildState> =>
    buildState({
      scenes: [
        { id: 'harbour', title: 'Harbour', body: 'Gulls only.' },
        { id: 'shore', title: 'Shore', body: 'Elena watched the sea.' },
      ],
      entries: [entry(ELENA, 'Elena')],
    });

  it('errors when a declared entry is never named in its scene', () => {
    const file = withMeta({ harbour: { expectedPresent: [ELENA] }, shore: { expectedPresent: [ELENA] } });
    const out = run(state(), file, ['presence.expected']);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]).toMatchObject({ checkId: 'presence.expected', type: 'expected-absent', severity: 'error' });
    expect(out.drafts[0]?.message).toBe('"Elena" is expected in "Harbour" but is never named there');
    expect(out.drafts[0]?.factGroup).toBe('c_5h8qk2m9rt|expected-present');
  });

  it('notes a declaration that names no codex entry, and checks nothing for it', () => {
    const file = withMeta({ harbour: { expectedPresent: ['c_GONEGONEGO'] } });
    const out = run(state(), file, ['presence.expected']);
    expect(out.drafts).toEqual([]);
    expect(out.notes[0]).toContain('is not a codex entry; not checked');
  });

  it('does not scan an empty scene, so its expectation has nothing to fail', () => {
    const empty = buildState({ scenes: [{ id: 'blank', title: 'Blank', body: '  ' }], entries: [entry(ELENA, 'Elena')] });
    const out = run(empty, withMeta({ blank: { expectedPresent: [ELENA] } }), ['presence.expected']);
    expect(out.drafts).toEqual([]);
  });

  it('draws nothing when the mention count for a scene is unavailable', () => {
    const file = withMeta({ harbour: { expectedPresent: [ELENA] } });
    const out = run(state(), file, ['presence.expected'], false);
    expect(out.drafts).toEqual([]);
    expect(out.unavailable).toEqual(['harbour', 'shore']);
  });
});
