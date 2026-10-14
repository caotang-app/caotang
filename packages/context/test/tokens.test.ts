/**
 * The token estimate and the text helpers every layer cuts with. A budget is a character
 * count, so the inverse of the estimate has to hold exactly, or a layer would be held to a
 * different number than the report shows.
 */
import { describe, expect, it } from 'vitest';

import { stableStringify } from '../src/index.js';
import { CHARS_PER_TOKEN, charsFor, estimateTokens, tokensForChars } from '../src/index.js';
import { clip, formatCount, headOf, tailOf, unique } from '../src/text.js';

describe('the token estimate (context-assembly §3)', () => {
  it('is ceil(chars / 4) at every length', () => {
    for (let n = 0; n <= 64; n += 1) {
      expect(estimateTokens('x'.repeat(n))).toBe(Math.ceil(n / 4));
    }
  });

  it('counts UTF-16 code units, the unit the layers cut in', () => {
    // One astral code point is two code units, so it is half of a four-unit token.
    expect('𝔘'.length).toBe(2);
    expect(estimateTokens('𝔘')).toBe(1);
  });

  it('admits exactly the characters a token budget allows, in both directions', () => {
    for (let tokens = 0; tokens <= 50; tokens += 1) {
      expect(tokensForChars(charsFor(tokens))).toBe(tokens);
      expect(tokensForChars(charsFor(tokens) + 1)).toBe(tokens + 1);
    }
  });

  it('is the same rule as the codex estimate, so the two budgets agree', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(tokensForChars(10)).toBe(estimateTokens('x'.repeat(10)));
  });
});

describe('surrogate-safe cuts', () => {
  const pair = '𝔘𝔙𝔚'; // six code units, three code points

  it('never leaves half a code point at the end of a head', () => {
    expect(headOf(pair, 3)).toBe('𝔘');
    expect(headOf(pair, 4)).toBe('𝔘𝔙');
  });

  it('never leaves half a code point at the start of a tail', () => {
    // A cut that would start on a low surrogate moves forward past it, so the tail is at most n.
    expect(tailOf(pair, 3)).toBe('𝔚');
    expect(tailOf(pair, 4)).toBe('𝔙𝔚');
    expect(tailOf(pair, 5)).toBe('𝔙𝔚');
    expect(tailOf(pair, 6)).toBe(pair);
  });

  it('clips a line with an ellipsis and never past the limit', () => {
    expect(clip('a   b\n\nc', 20)).toBe('a b c');
    const clipped = clip('word '.repeat(50), 20);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(20);
  });

  it('formats counts with thousands separators, without a locale', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(3600)).toBe('3,600');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('keeps the first occurrence of each value, in order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});

describe('canonical parameters (L7)', () => {
  it('sorts keys at every depth, so writing order cannot change the bytes', () => {
    const a = { doc: 'n_ch3', mode: 'continue', nested: { z: 1, a: [{ y: 2, b: 3 }] } };
    const b = { nested: { a: [{ b: 3, y: 2 }], z: 1 }, mode: 'continue', doc: 'n_ch3' };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"doc":"n_ch3","mode":"continue","nested":{"a":[{"b":3,"y":2}],"z":1}}');
  });

  it('omits undefined members, and keeps array order', () => {
    expect(stableStringify({ keep: 1, drop: undefined, list: [3, 1, 2] })).toBe('{"keep":1,"list":[3,1,2]}');
  });

  it('writes an empty object for no parameters', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify(undefined)).toBe('null');
  });
});
