/**
 * Dialogue anchors, captured against a body — edit-anchors §2's shape and bounds — and asset ids
 * (storyboard §2.2's `a_` family). Both are pure, so the tests read the offsets back against the body.
 */

import { describe, expect, it } from 'vitest';

import {
  ANCHOR_CONTEXT_CHARS,
  ANCHOR_MAX_EXACT_CHARS,
  captureTextAnchor,
  isAssetId,
  locateQuote,
  mintAssetId,
} from '../src/index.js';

import { seqRandom } from './fixtures.js';

const BODY = 'ELENA\nI was gone nine years.\n\nThe keeper does not look up.';

describe('captureTextAnchor', () => {
  it('captures the exact text at the offsets, with the context on either side', () => {
    const from = BODY.indexOf('I was');
    const to = from + 'I was gone nine years.'.length;
    const anchor = captureTextAnchor(BODY, from, to, 4);
    expect(anchor).toBeDefined();
    expect(BODY.slice(anchor?.from, anchor?.to)).toBe(anchor?.exact);
    expect(anchor).toMatchObject({ exact: 'I was gone nine years.', capturedRevision: 4 });
    expect(anchor?.prefix).toBe('ELENA\n');
    expect(anchor?.suffix).toBe('\n\nThe keeper does not look up.');
  });

  it('caps the prefix and suffix at the spec’s 32 characters', () => {
    const body = `${'a'.repeat(50)}TARGET${'b'.repeat(50)}`;
    const from = body.indexOf('TARGET');
    const anchor = captureTextAnchor(body, from, from + 6, 0);
    expect(anchor?.prefix).toHaveLength(ANCHOR_CONTEXT_CHARS);
    expect(anchor?.suffix).toHaveLength(ANCHOR_CONTEXT_CHARS);
    expect(anchor?.prefix).toBe('a'.repeat(ANCHOR_CONTEXT_CHARS));
  });

  it('leaves the prefix empty at the start of the body and the suffix empty at its end', () => {
    expect(captureTextAnchor(BODY, 0, 5, 0)?.prefix).toBe('');
    expect(captureTextAnchor(BODY, BODY.length - 4, BODY.length, 0)?.suffix).toBe('');
  });

  it('refuses a range that cannot be an anchor: out of bounds, empty, reversed or fractional', () => {
    expect(captureTextAnchor(BODY, -1, 3, 0)).toBeUndefined();
    expect(captureTextAnchor(BODY, 5, 5, 0)).toBeUndefined();
    expect(captureTextAnchor(BODY, 9, 4, 0)).toBeUndefined();
    expect(captureTextAnchor(BODY, 0, BODY.length + 1, 0)).toBeUndefined();
    expect(captureTextAnchor(BODY, 0.5, 3, 0)).toBeUndefined();
  });

  it('accepts exactly the 2000-unit bound and refuses one more', () => {
    const body = 'x'.repeat(ANCHOR_MAX_EXACT_CHARS + 1);
    expect(captureTextAnchor(body, 0, ANCHOR_MAX_EXACT_CHARS, 0)?.exact).toHaveLength(ANCHOR_MAX_EXACT_CHARS);
    expect(captureTextAnchor(body, 0, ANCHOR_MAX_EXACT_CHARS + 1, 0)).toBeUndefined();
  });
});

describe('locateQuote', () => {
  it('finds a quote that occurs once, at its offsets', () => {
    const found = locateQuote(BODY, 'The keeper does not look up.');
    expect(found.status).toBe('one');
    if (found.status === 'one') expect(BODY.slice(found.from, found.to)).toBe('The keeper does not look up.');
  });

  it('refuses to choose between occurrences: a repeated quote is ambiguous, never a guess', () => {
    const repeated = 'ELENA\nI was gone nine years.\n\nELENA\nI was gone nine years.';
    expect(locateQuote(repeated, 'I was gone nine years.')).toEqual({ status: 'many', count: 2 });
  });

  it('reports a quote that is absent, including one that differs only in case', () => {
    expect(locateQuote(BODY, 'never said')).toEqual({ status: 'none' });
    expect(locateQuote(BODY, 'the keeper does not look up.')).toEqual({ status: 'none' });
    expect(locateQuote(BODY, '')).toEqual({ status: 'none' });
  });

  it('counts overlapping occurrences, so a quote inside a repeated run is still ambiguous', () => {
    expect(locateQuote('aaaa', 'aa')).toEqual({ status: 'many', count: 3 });
  });
});

describe('asset ids', () => {
  it('accepts a-prefixed ten-character Crockford ids and nothing else', () => {
    expect(isAssetId('a_7K2QX9M4A1')).toBe(true);
    expect(isAssetId('a_7K2QX9M4A')).toBe(false);
    expect(isAssetId('n_7K2QX9M4A1')).toBe(false);
    expect(isAssetId('a_7K2QX9M4AI')).toBe(false);
    expect(isAssetId('a_7K2QX9M4AL')).toBe(false);
    expect(isAssetId('a_7K2QX9M4AO')).toBe(false);
    expect(isAssetId('a_7K2QX9M4AU')).toBe(false);
    expect(isAssetId('a_../../etc')).toBe(false);
    expect(isAssetId(undefined)).toBe(false);
  });

  it('mints an id that is well formed and not already taken', () => {
    const id = mintAssetId(new Set(), seqRandom(3));
    expect(isAssetId(id)).toBe(true);
  });

  it('re-rolls past an id that is taken', () => {
    const first = mintAssetId(new Set(), seqRandom(3));
    const second = mintAssetId(new Set([first]), seqRandom(3));
    expect(second).not.toBe(first);
    expect(isAssetId(second)).toBe(true);
  });

  it('throws rather than return a duplicate when the randomness keeps repeating', () => {
    const repeating = (n: number): Uint8Array => new Uint8Array(n).fill(9);
    const taken = new Set<string>();
    const only = mintAssetId(taken, repeating);
    taken.add(only);
    expect(() => mintAssetId(taken, repeating)).toThrow('could not mint a unique a_ id');
  });
});
