/**
 * The cuts (text.ts) and the focus cut that uses them. A cut never splits a surrogate pair, and a
 * cut next to a lone surrogate is clean. A cut at zero stays at zero, so a lone low surrogate at
 * the start of a body cannot make the focus loop stop shrinking (the hang this file guards).
 */
import { addDocument, createEmptyManifest, createProjectState } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';
import { headOf, tailOf } from '../src/text.js';

describe('headOf and tailOf never split a pair, and never reach past the text (text.ts)', () => {
  it('a cut at zero is the empty string, even when the text opens with a lone low surrogate', () => {
    expect(headOf('\uDC00abc', 0)).toBe('');
    expect(headOf('\uDC00abc', -4)).toBe('');
  });

  it('keeps a lone low surrogate in the text: it is not half of a pair', () => {
    expect(headOf('a\uDC00b', 1)).toBe('a');
    expect(headOf('a\uDC00b', 2)).toBe('a\uDC00');
    expect(tailOf('a\uDC00b', 2)).toBe('\uDC00b');
  });

  it('steps back over a pair that a head cut would split, and forward over one a tail cut would split', () => {
    const text = 'a\u{1F600}b';
    expect(headOf(text, 2)).toBe('a');
    expect(headOf(text, 3)).toBe('a\u{1F600}');
    expect(tailOf(text, 2)).toBe('b');
    expect(tailOf(text, 3)).toBe('\u{1F600}b');
  });

  it('gives the whole text for a cut past its length', () => {
    expect(headOf('\uDC00abc', 99)).toBe('\uDC00abc');
    expect(tailOf('\uDC00abc', 99)).toBe('\uDC00abc');
  });
});

describe('the focus cut ends on malformed text (focus.ts)', () => {
  it('synopsis.fill with a lone low surrogate at the start of the body and a tiny cap returns, and sends none of the body', () => {
    const state = createProjectState(createEmptyManifest('Malformed'));
    const body = `\uDC00${'Plain prose after the malformed unit. '.repeat(40)}`;
    addDocument(state, { parentId: 'manuscript', title: 'Chapter 1', body, synopsis: 'S', id: 'n_m1' });
    const assembled = assemble(
      { tool: 'synopsis.fill', instruction: 'Summarise.', focus: 'n_m1' },
      { state },
      { layerBudgets: { L3: 0, L5: 5 } },
    );
    expect(assembled.focus?.chars).toBe(0);
    expect(assembled.layers.find((layer) => layer.id === 'L5')?.included).toBe(true);
  });
});
