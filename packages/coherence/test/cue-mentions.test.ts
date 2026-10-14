/**
 * A screenplay's cues in the scan's mention counts (screenplay.md §4, codex.md §4). The detector counts a cue's spelling with the
 * body, so the scan no longer takes a larger count from a separate cue count: a detector that counts no cue spellings leaves a cue
 * unmentioned, and one that is given the cue terms counts it once.
 */

import { describe, expect, it } from 'vitest';

import { compileCodex, countMentions } from '@caotang/codex';
import type { CodexEntry } from '@caotang/store';

import { assembleInput, emptyCoherenceFile, type MentionDetector } from '../src/index.js';
import { buildState, entry } from './fixtures.js';

const SCENE = 'sc_SCRIPT0001';
const SMITH = 'c_SMITHAAAAA';
const SCRIPT = ['INT. KITCHEN - DAY', '', 'MR. SMITH', 'Where were you?', ''].join('\n');

/** A scan's input over one screenplay scene, with the detector the test names. */
function inputWith(detector: MentionDetector, entries: readonly CodexEntry[] = [entry(SMITH, 'Mr Smith')]) {
  const state = buildState({ scenes: [{ id: SCENE, title: 'Kitchen', body: SCRIPT }], entries });
  const node = state.manifest.tree.find((candidate) => candidate.id === SCENE);
  if (node !== undefined) Object.assign(node, { kind: 'screenplay' });
  return assembleInput(state, emptyCoherenceFile(), { detector }).input;
}

describe('a screenplay cue in the scan’s counts (screenplay.md §4)', () => {
  it('is not counted by a detector that does not read cue spellings, because no count is merged in afterwards', () => {
    const plain: MentionDetector = (body, entries) => countMentions(body, compileCodex(entries));
    const input = inputWith(plain);
    expect(input.hits.get(SCENE)?.get(SMITH) ?? 0).toBe(0);
  });

  it('is counted once, by the detector, when it is given the cue terms of the document', () => {
    const withCues: MentionDetector = (body, entries, terms) => countMentions(body, compileCodex(entries), terms);
    const input = inputWith(withCues);
    expect(input.hits.get(SCENE)?.get(SMITH)).toBe(1);
  });

  it('is not given cue terms to a prose document, so prose is counted as it always was', () => {
    const seen: number[] = [];
    const spy: MentionDetector = (body, entries, terms) => {
      seen.push(terms?.length ?? -1);
      return countMentions(body, compileCodex(entries), terms);
    };
    const state = buildState({ scenes: [{ id: SCENE, title: 'Kitchen', body: SCRIPT }], entries: [entry(SMITH, 'Mr Smith')] });
    assembleInput(state, emptyCoherenceFile(), { detector: spy });
    expect(seen).toEqual([0]);
  });
});
