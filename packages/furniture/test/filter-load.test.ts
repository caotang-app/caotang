/**
 * Load-time tolerance for `filters[]` — binder-filters §4: an unknown criteria key is
 * dropped with the notice, a malformed filter is dropped with a warning, and nothing
 * here can block a project load.
 */
import { describe, expect, it } from 'vitest';

import { parseSavedFilters } from '../src/index.js';

const VALID = {
  id: 'q_ABCDEFGHJK',
  name: 'Drafts about the sea',
  root: 'manuscript',
  criteria: { statusId: 'draft', keywordsAny: ['sea'], minWords: 500 },
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

describe('absence and shape', () => {
  it('treats an absent filters array as no saved filters, with no notice (the additive rule)', () => {
    expect(parseSavedFilters(undefined)).toEqual({ filters: [], notices: [] });
  });

  it('keeps a valid filter, round-tripped into the spec shape', () => {
    const { filters, notices } = parseSavedFilters([VALID]);
    expect(notices).toEqual([]);
    expect(filters).toEqual([
      {
        id: 'q_ABCDEFGHJK',
        name: 'Drafts about the sea',
        root: 'manuscript',
        criteria: { statusId: 'draft', keywordsAny: ['sea'], minWords: 500 },
        createdAt: '2026-09-13T10:00:00.000Z',
        updatedAt: '2026-09-13T10:00:00.000Z',
      },
    ]);
  });

  it('reports a filters value that is not a list, and loads nothing from it', () => {
    const { filters, notices } = parseSavedFilters({ not: 'a list' });
    expect(filters).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.path).toBe('filters');
  });

  it('keeps a filter with no root, meaning both roots are searched', () => {
    const { root: _root, ...rootless } = VALID;
    const { filters } = parseSavedFilters([rootless]);
    expect(filters[0]).not.toHaveProperty('root');
  });
});

describe('unknown criteria (§4: dropped with the one-time notice)', () => {
  it('drops an unknown criterion key, keeps the rest of the filter, and says where', () => {
    const entry = { ...VALID, criteria: { statusId: 'draft', colourBand: 'warm' } };
    const { filters, notices } = parseSavedFilters([entry]);
    expect(filters).toHaveLength(1);
    expect(filters[0]?.criteria).toEqual({ statusId: 'draft' });
    expect(notices).toEqual([
      expect.objectContaining({ path: 'filters[0].criteria.colourBand' }),
    ]);
    expect(notices[0]?.message).toContain('colourBand');
  });

  it('drops an unknown field on the filter itself with the unknown-field notice', () => {
    const { filters, notices } = parseSavedFilters([{ ...VALID, colour: 'red' }]);
    expect(filters).toHaveLength(1);
    expect(notices).toEqual([expect.objectContaining({ path: 'filters[0].colour' })]);
  });

  it('normalises a null criterion to absent, with no notice (§2: null value = criterion absent)', () => {
    const entry = { ...VALID, criteria: { statusId: null, minWords: null, text: 'elena' } };
    const { filters, notices } = parseSavedFilters([entry]);
    expect(filters[0]?.criteria).toEqual({ text: 'elena' });
    expect(notices).toEqual([]);
  });

  it('normalises an empty text, an empty tag list and an empty textIn to absent', () => {
    const entry = { ...VALID, criteria: { text: '', keywordsAll: [], textIn: [] } };
    expect(parseSavedFilters([entry]).filters[0]?.criteria).toEqual({});
  });

  it('clamps over-long text on load, and says the excess is not written back', () => {
    const entry = { ...VALID, criteria: { text: 'x'.repeat(250) } };
    const { filters, notices } = parseSavedFilters([entry]);
    expect(filters[0]?.criteria.text).toBe('x'.repeat(200));
    expect(notices).toEqual([expect.objectContaining({ path: 'filters[0].criteria' })]);
    expect(notices[0]?.message).toBe('text clamped to 200 characters on load; the excess is not written back');
  });

  it('clamps a tag list over 32 entries on load, keeping the first 32 and saying so', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const { filters, notices } = parseSavedFilters([{ ...VALID, criteria: { keywordsAny: tags } }]);
    expect(filters[0]?.criteria.keywordsAny).toEqual(tags.slice(0, 32));
    expect(notices[0]?.message).toBe('keywordsAny clamped to 32 entries on load; the excess is not written back');
  });
});

describe('unknown fields and criteria are kept in memory until the next save (project-format §6)', () => {
  it('keeps an unknown field on the filter, with a notice that says it is dropped on save', () => {
    const { filters, notices } = parseSavedFilters([{ ...VALID, colour: 'red' }]);
    expect(filters[0]?.unknownFields).toEqual({ colour: 'red' });
    expect(notices[0]?.message).toBe('unknown field "colour" is kept in memory and dropped on next save');
  });

  it('keeps an unknown criterion with its value, and the rest of the filter', () => {
    const { filters } = parseSavedFilters([{ ...VALID, criteria: { statusId: 'draft', colourBand: 'warm' } }]);
    expect(filters[0]?.unknownCriteria).toEqual({ colourBand: 'warm' });
    expect(filters[0]?.criteria).toEqual({ statusId: 'draft' });
  });

  it('adds neither kept field to a filter that has no unknown keys', () => {
    const { filters } = parseSavedFilters([VALID]);
    expect(filters[0]).not.toHaveProperty('unknownFields');
    expect(filters[0]).not.toHaveProperty('unknownCriteria');
  });

  it('keeps a key whose name is the object prototype key as its own value', () => {
    const entry = JSON.parse(`{"id":"q_ABCDEFGHJK","name":"n","criteria":{},"createdAt":"2026-09-13T10:00:00.000Z","updatedAt":"2026-09-13T10:00:00.000Z","__proto__":"x"}`) as Record<string, unknown>;
    const { filters } = parseSavedFilters([entry]);
    expect(Object.getPrototypeOf(filters[0]?.unknownFields)).toBe(Object.prototype);
    expect(filters[0]?.unknownFields).toHaveProperty('__proto__', 'x');
  });
});

describe('notices are plain text and bounded, since a manifest controls every value in them', () => {
  it('cuts a long id to a short quote in the notice for a dropped filter', () => {
    const { notices } = parseSavedFilters([{ ...VALID, id: 'q'.repeat(5000), criteria: 'not an object' }]);
    expect(notices[0]?.message.length).toBeLessThan(200);
    expect(notices[0]?.message).toContain('…');
  });

  it('flattens control and bidi-override characters in a key name', () => {
    const key = 'colour\n‮evil';
    const { notices } = parseSavedFilters([{ ...VALID, [key]: 'red' }]);
    expect(notices[0]?.path).not.toMatch(/\p{Cc}|\p{Cf}/u);
    expect(notices[0]?.message).not.toMatch(/\p{Cc}|\p{Cf}/u);
    expect(notices[0]?.message).toContain('colour');
  });
});

describe('malformed filters (§4: dropped with a warning, load proceeds)', () => {
  it('drops a filter whose criteria is not an object, and keeps its neighbours', () => {
    const broken = { ...VALID, id: 'q_BROKEN0001', criteria: 'statusId=draft' };
    const { filters, notices } = parseSavedFilters([broken, VALID]);
    expect(filters.map((f) => f.id)).toEqual(['q_ABCDEFGHJK']);
    expect(notices).toEqual([expect.objectContaining({ path: 'filters[0]' })]);
    expect(notices[0]?.message).toContain('q_BROKEN0001');
  });

  it('drops a filter whose criterion has the wrong type or domain', () => {
    for (const criteria of [{ minWords: 'lots' }, { maxWords: -1 }, { createdWithinDays: 0 }, { textIn: ['footer'] }]) {
      const { filters, notices } = parseSavedFilters([{ ...VALID, criteria }]);
      expect(filters, JSON.stringify(criteria)).toEqual([]);
      expect(notices, JSON.stringify(criteria)).toHaveLength(1);
    }
  });

  it('drops a filter with an unknown root value', () => {
    const { filters, notices } = parseSavedFilters([{ ...VALID, root: 'appendix' }]);
    expect(filters).toEqual([]);
    expect(notices[0]?.message).toContain('root');
  });

  it('drops a filter with no id, no name, or a timestamp that is not a date', () => {
    expect(parseSavedFilters([{ ...VALID, id: '' }]).filters).toEqual([]);
    expect(parseSavedFilters([{ ...VALID, name: 7 }]).filters).toEqual([]);
    expect(parseSavedFilters([{ ...VALID, createdAt: 'last Tuesday' }]).filters).toEqual([]);
  });

  it('drops a non-object entry without throwing', () => {
    const { filters, notices } = parseSavedFilters(['not a filter', null, VALID]);
    expect(filters).toHaveLength(1);
    expect(notices.map((n) => n.path)).toEqual(['filters[0]', 'filters[1]']);
  });
});
