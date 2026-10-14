/**
 * Screenplay cue names as mention terms (screenplay.md §4, codex.md §4): a cue is a mention of the entry it names, the detector
 * counts a cue spelled differently from the entry's name, and the per-document index does the same with the document's kind.
 */

import { describe, expect, it } from 'vitest';

import type { CodexEntry } from '@caotang/store';

import { compileCodex, countMentions, createMentionIndex, cueTermsOf, entryForCue } from '../src/index.js';

const SMITH = 'c_SMITHAAAAA';
const JONES = 'c_JONESAAAAA';

function entry(id: string, name: string, extra: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id,
    name,
    type: 'character',
    aliases: [],
    description: '',
    includePolicy: 'matched',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    ...extra,
  } as CodexEntry;
}

const ENTRIES = [entry(SMITH, 'Mr Smith'), entry(JONES, 'Jones')];
const SCRIPT = ['INT. KITCHEN - DAY', '', 'MR. SMITH', 'Where were you?', '', 'JONES', 'At the sink.', ''].join('\n');

describe('a screenplay cue as a mention (screenplay.md §4)', () => {
  it('resolves each cue to the entry it names, in the spelling the cue uses', () => {
    const terms = cueTermsOf('screenplay', SCRIPT, ENTRIES);
    expect(terms).toEqual([
      { entryId: SMITH, text: 'MR. SMITH', caseSensitive: false },
      { entryId: JONES, text: 'JONES', caseSensitive: false },
    ]);
  });

  it('adds nothing for a document that is not a screenplay, so every other document is detected as it was', () => {
    expect(cueTermsOf('prose', SCRIPT, ENTRIES)).toEqual([]);
    expect(cueTermsOf(undefined, SCRIPT, ENTRIES)).toEqual([]);
  });

  it('names no entry for an ambiguous cue, which the cue-collision check reports instead', () => {
    // Two entries that spell a name the same way: the cue could be either, so it names neither.
    const two = [entry(SMITH, 'Mr Smith'), entry(JONES, 'mr smith')];
    expect(entryForCue(two, 'MR SMITH')).toBeUndefined();
    expect(cueTermsOf('screenplay', 'MR SMITH\nHi.\n', two)).toEqual([]);
  });

  it('is counted by the detector itself, where the entry’s own name does not match the cue’s spelling', () => {
    const compiled = compileCodex(ENTRIES);
    const withoutCues = countMentions(SCRIPT, compiled);
    expect(withoutCues.get(SMITH) ?? 0).toBe(0);
    const withCues = countMentions(SCRIPT, compiled, cueTermsOf('screenplay', SCRIPT, ENTRIES));
    expect(withCues.get(SMITH)).toBe(1);
    expect(withCues.get(JONES)).toBe(1);
  });

  it('counts a cue once when its spelling is the entry’s own name, so nothing is double-counted', () => {
    const body = 'JONES\nSpeaking.\n';
    const compiled = compileCodex([entry(JONES, 'Jones')]);
    expect(countMentions(body, compiled).get(JONES)).toBe(1);
    expect(countMentions(body, compiled, cueTermsOf('screenplay', body, [entry(JONES, 'Jones')])).get(JONES)).toBe(1);
  });

  it('gives the per-document index the same count, when the document says it is a screenplay', () => {
    const index = createMentionIndex();
    const screenplay = index.hits({ id: 'd1', revision: 1, body: SCRIPT, kind: 'screenplay' }, ENTRIES);
    expect(screenplay.get(SMITH)).toBe(1);
    const prose = createMentionIndex().hits({ id: 'd1', revision: 1, body: SCRIPT, kind: 'prose' }, ENTRIES);
    expect(prose.get(SMITH) ?? 0).toBe(0);
  });
});
