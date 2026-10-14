/**
 * The codex.md §6 ordering, and the one copy of the type enum this package keeps.
 */
import { describe, expect, it } from 'vitest';

import { CODEX_TYPES } from '@caotang/store';

import { CODEX_TYPE_ORDER, compareCodex, sortCodex } from '../src/index.js';
import { entry } from './fixtures/detection-corpus.js';

describe('CODEX_TYPE_ORDER', () => {
  it('equals the closed type enum in the store (codex.md §2), in the same order', () => {
    // `order.ts` cannot import the store at runtime without pulling its whole graph in,
    // so the list is a copy. This is the guard that keeps the copy honest.
    expect([...CODEX_TYPE_ORDER]).toEqual([...CODEX_TYPES]);
  });
});

describe('sortCodex (codex.md §6)', () => {
  it('puts always-include entries first, then by type in enum order, then by name', () => {
    const sorted = sortCodex([
      entry('Zed', { type: 'other' }),
      entry('Brook', { type: 'location' }),
      entry('Ana', { type: 'character' }),
      entry('Garden', { type: 'location', includePolicy: 'always' }),
      entry('Mirror', { type: 'object' }),
      entry('Ash', { type: 'lore', includePolicy: 'always' }),
      entry('Ben', { type: 'character' }),
    ]).map((e) => e.name);
    // `always` entries lead, and within them type still decides: location before lore.
    expect(sorted).toEqual(['Garden', 'Ash', 'Ana', 'Ben', 'Brook', 'Mirror', 'Zed']);
  });

  it('compares names case-insensitively', () => {
    const sorted = sortCodex([entry('beta'), entry('Alpha'), entry('GAMMA')]).map((e) => e.name);
    expect(sorted).toEqual(['Alpha', 'beta', 'GAMMA']);
  });

  it('orders an unknown type after every known type (kept, never coerced: §2)', () => {
    const sorted = sortCodex([entry('Faction', { type: 'faction' }), entry('Zed', { type: 'other' })]).map((e) => e.name);
    expect(sorted).toEqual(['Zed', 'Faction']);
  });

  it('is independent of input order, including when two entries share a name', () => {
    const a = entry('Twin', { id: 'c_aaa' });
    const b = entry('twin', { id: 'c_bbb' });
    expect(sortCodex([a, b]).map((e) => e.id)).toEqual(sortCodex([b, a]).map((e) => e.id));
  });

  it('does not mutate its input', () => {
    const input = [entry('Zed'), entry('Ana')];
    const before = input.map((e) => e.name);
    sortCodex(input);
    expect(input.map((e) => e.name)).toEqual(before);
  });
});

describe('compareCodex', () => {
  it('is negative when the first entry sorts first', () => {
    expect(compareCodex(entry('Ana'), entry('Bo'))).toBeLessThan(0);
    expect(compareCodex(entry('Bo'), entry('Ana'))).toBeGreaterThan(0);
    expect(compareCodex(entry('Ana'), entry('Ana', { id: 'c_Ana' }))).toBe(0);
  });
});
