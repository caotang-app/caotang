/**
 * The normalisation and classification rules that detection and `codex.read` share.
 */
import { describe, expect, it } from 'vitest';

import { atWordBoundary, canonical, caseFold, estimateTokens, isLatinTerm, tokensForChars } from '../src/text.js';

describe('canonical', () => {
  it('composes decomposed characters to NFC', () => {
    expect(canonical('Elená')).toBe('Elená');
  });

  it('folds typographic apostrophes to the straight one', () => {
    expect(canonical('O’Brien ‘quoted’ OʼNeil')).toBe("O'Brien 'quoted' O'Neil");
  });
});

describe('caseFold', () => {
  it('lowercases ASCII and accented letters', () => {
    expect(caseFold('ÉLODIE Élodie')).toBe('élodie élodie');
  });

  it('folds final sigma to sigma, so the two spellings of a Greek word meet', () => {
    expect(caseFold('ΟΔΥΣΣΕΎΣ')).toBe(caseFold('Οδυσσεύς'));
  });

  it('folds long s to s', () => {
    expect(caseFold('ſ')).toBe('s');
  });

  it('keeps dotted capital I, which has no simple fold', () => {
    expect(caseFold('İ')).toBe('İ');
  });

  it('never changes the length of the string, so indices carry across', () => {
    for (const sample of ['İstanbul', 'ΟΔΥΣΣΕΎΣ', 'ßtraße', 'plain ASCII', '艾琳 Élodie 𝒜']) {
      expect(caseFold(sample).length, sample).toBe(sample.length);
    }
  });
});

describe('isLatinTerm', () => {
  it.each([
    ['Elena', true],
    ['Élodie', true],
    ['Dr. Who', true],
    ['Room 101', true],
    ['1984', true],
    ['AT&T', true],
    ['艾琳', false],
    ['Елена', false],
    ['Elena艾', false],
    ['!!!', false],
    ['', false],
  ])('classifies %j as Latin: %s', (term, expected) => {
    expect(isLatinTerm(term)).toBe(expected);
  });
});

describe('atWordBoundary', () => {
  it('treats a CJK or kana letter next to a Latin term as a letter, so it blocks the match', () => {
    // codex.md §4 rule 2: the neighbour must be a non-letter-or-digit. These are letters.
    expect(atWordBoundary('我用AI写作', 2, 4)).toBe(false);
    expect(atWordBoundary('Elenaは', 0, 5)).toBe(false);
    expect(atWordBoundary('Elena가', 0, 5)).toBe(false);
  });

  it('treats CJK punctuation on both sides of a Latin term as a boundary', () => {
    expect(atWordBoundary('「AI」', 1, 3)).toBe(true);
  });

  it('treats a combining mark as part of the letter next to it, so it blocks the match', () => {
    expect(atWordBoundary('Ann\u0331', 0, 3)).toBe(false);
    expect(atWordBoundary('\u0331Ann', 1, 4)).toBe(false);
  });

  it('treats a Latin letter as a word character', () => {
    expect(atWordBoundary('AIs', 0, 2)).toBe(false);
  });

  it('treats a letter outside the BMP as a word character', () => {
    // U+1D49C is MATHEMATICAL SCRIPT CAPITAL A, a letter in an astral plane.
    expect(atWordBoundary('Ann\u{1D49C}', 0, 3)).toBe(false);
  });

  it('treats both ends of the string as boundaries', () => {
    expect(atWordBoundary('Ann', 0, 3)).toBe(true);
  });
});

describe('token estimate (context-assembly §3)', () => {
  it('is ceil(chars / 4)', () => {
    expect(tokensForChars(0)).toBe(0);
    expect(tokensForChars(4)).toBe(1);
    expect(tokensForChars(5)).toBe(2);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
