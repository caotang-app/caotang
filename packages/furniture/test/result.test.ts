/**
 * The result set of a filter over the binder — binder-filters §3: matches plus their
 * ancestor chain, non-matching siblings hidden, the fixed roots always shown, and the
 * whole thing in binder order.
 */
import { describe, expect, it, vi } from 'vitest';

import { BODIES, INDEX, probeAt } from './fixtures/binder.js';
import { evaluateFilter } from '../src/index.js';

function run(criteria: Record<string, unknown>, root?: 'manuscript' | 'research', bodyOf?: (id: string) => string) {
  return evaluateFilter(
    { criteria: criteria as never, ...(root !== undefined ? { root } : {}) },
    INDEX,
    probeAt(undefined, bodyOf),
  );
}

describe('result-set rule (binder-filters §3)', () => {
  it('shows a match with its ancestor chain and hides the non-matching siblings', () => {
    // Drafts are s1, s3 and r1. s2 (final) and s4 (no status) are not drafts.
    const result = run({ statusId: 'draft' });
    expect(result.matched).toEqual(['s1', 's3', 'r1']);
    expect(result.visible).toEqual(['manuscript', 'act1', 'ch1', 's1', 'ch2', 's3', 'research', 'r1']);
    expect(result.visible).not.toContain('s2');
    expect(result.visible).not.toContain('act2');
    expect(result.visible).not.toContain('s4');
  });

  it('reports the match count the filter row badge shows', () => {
    expect(run({ statusId: 'draft' }).matchCount).toBe(3);
  });

  it('never shows the project root, even though it is in the tree', () => {
    expect(run({ statusId: 'draft' }).visible).not.toContain('root');
    expect(run({}).visible).not.toContain('root');
  });

  it('always shows the two fixed roots, and nothing under them that does not match', () => {
    const result = run({ text: 'no such words anywhere' });
    expect(result.matched).toEqual([]);
    expect(result.matchCount).toBe(0);
    expect(result.visible).toEqual(['manuscript', 'research']);
  });

  it('shows the whole binder for an empty criteria set, the reset state', () => {
    const result = run({});
    expect(result.visible).toEqual(['manuscript', 'act1', 'ch1', 's1', 's2', 'ch2', 's3', 'act2', 's4', 'research', 'r1']);
    expect(result.matched).toEqual(['act1', 'ch1', 's1', 's2', 'ch2', 's3', 'act2', 's4', 'r1']);
  });
});

// binder-filters §3 states only the ancestor rule. Binder order is this build's choice, so these
// tests pin the choice, not a requirement of the spec. A spec line naming the order is requested.
describe('result ordering (binder order is this build’s choice; whatever order the manifest array is in)', () => {
  it('lists matches in binder order even though the manifest array lists s4 first', () => {
    expect(run({ keywordsAny: ['grief'] }).matched).toEqual(['s1', 's4']);
  });

  it('is a subsequence of the unfiltered binder, so filtering never reorders anything', () => {
    const everything = run({}).visible;
    const filtered = run({ modifiedWithinDays: 30 }).visible;
    const positions = filtered.map((id) => everything.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('gives the same result set for the same state, criteria and clock (eval-stable)', () => {
    const first = run({ text: 'elena' });
    const second = run({ text: 'elena' });
    expect(second).toEqual(first);
  });
});

describe('body projection and text (binder-filters §3)', () => {
  it('finds a body-only hit and shows it inside its chapter', () => {
    const result = run({ text: 'elena', textIn: ['body'] });
    expect(result.matched).toEqual(['s1', 's4']);
    expect(result.visible).toContain('act2');
  });

  it('does not read bodies when no body criterion is present', () => {
    const spy = vi.fn((id: string) => BODIES[id] ?? '');
    run({ statusId: 'draft' }, undefined, spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('scope restriction (binder-filters §2: root)', () => {
  it('matches only inside the named root, and still shows both fixed roots', () => {
    const result = run({}, 'research');
    expect(result.matched).toEqual(['r1']);
    expect(result.visible).toEqual(['manuscript', 'research', 'r1']);
  });

  it('applies the scope to a text search too', () => {
    const result = run({ text: 'archival' }, 'manuscript');
    expect(result.matched).toEqual([]);
  });
});
