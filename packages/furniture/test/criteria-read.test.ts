/**
 * The criteria reader both the load path and the save path use — binder-filters §2's
 * "absent" rules, its limits, and the unknown-key and malformed findings the callers act on.
 */
import { describe, expect, it } from 'vitest';

import { readCriteria } from '../src/index.js';

describe('blank tags (binder-filters §2: an empty list is no constraint)', () => {
  it('reads keywordsAll [""] as no constraint at all', () => {
    expect(readCriteria({ keywordsAll: [''] })).toEqual({ criteria: {}, unknown: [], malformed: [], clamped: [] });
  });

  it('trims each tag, so the matcher sees the tag a writer meant', () => {
    expect(readCriteria({ keywordsAll: [' sea ', '   ', 'grief'] }).criteria).toEqual({ keywordsAll: ['sea', 'grief'] });
  });

  it('drops blanks before the 32-entry cap, so they do not use up a slot', () => {
    const tags = [...Array.from({ length: 30 }, () => ' '), 'a', 'b', 'c', 'd', 'e'];
    const reading = readCriteria({ keywordsAny: tags });
    expect(reading.criteria.keywordsAny).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(reading.clamped).toEqual([]);
  });
});

describe('limits (binder-filters §2): clamped on both paths, and each clamp is reported', () => {
  it('clamps a tag list over 32 entries, keeping the first 32', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const reading = readCriteria({ keywordsAny: tags });
    expect(reading.criteria.keywordsAny).toEqual(tags.slice(0, 32));
    expect(reading.clamped).toEqual(['keywordsAny clamped to 32 entries']);
  });

  it('clamps text over 200 code points, and counts an astral character as one', () => {
    const reading = readCriteria({ text: '😀'.repeat(205) });
    expect(reading.criteria.text).toBe('😀'.repeat(200));
    expect(reading.clamped).toEqual(['text clamped to 200 characters']);
  });
});

describe('unknown keys and malformed values', () => {
  it('names an unknown key and leaves it out of the criteria', () => {
    const reading = readCriteria({ statusId: 'draft', colour: 'red' });
    expect(reading.unknown).toEqual(['colour']);
    expect(reading.criteria).toEqual({ statusId: 'draft' });
    expect(reading.malformed).toEqual([]);
  });

  it('reports a tag that is not a string as malformed', () => {
    expect(readCriteria({ keywordsAny: ['sea', 3] }).malformed).toEqual(['keywordsAny must be a list of a tag']);
  });

  it('reports criteria that is not an object as malformed', () => {
    expect(readCriteria('statusId=draft').malformed).toEqual(['criteria must be an object']);
  });

  it('treats null and undefined as absent, with no finding', () => {
    expect(readCriteria({ statusId: null, minWords: undefined, text: '' })).toEqual({
      criteria: {},
      unknown: [],
      malformed: [],
      clamped: [],
    });
  });
});
