/**
 * The block engine (block.ts) and the drop-reason text (drops.ts). The budget checks run on the
 * character table, so the table must equal the rendered text for every kept count, and the fit
 * must keep the longest rank prefix that fits. Both are checked on generated blocks, with a
 * fixed generator so the cases are the same on every run.
 */
import { describe, expect, it } from 'vitest';

import { charsAt, charTable, cheapestKept, fitBlock, newBlock, renderBlock, type BlockItem } from '../src/block.js';
import { describeDrop } from '../src/drops.js';
import { tokensForChars } from '../src/tokens.js';
import type { DropReason } from '../src/types.js';

/** A small linear congruential generator: the same sequence on every run, no Math.random. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * A block of `count` entries with lengths drawn from the generator. Each body starts with a
 * unique marker, `<rank>`, so a test can find an entry in the rendered text. The display order
 * is the reverse of the rank order, so the two orders really differ.
 */
function generatedBlock(seed: number, count: number) {
  const next = generator(seed);
  const items: BlockItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = 1 + Math.floor(next() * 400);
    items.push({
      label: `item ${index}`,
      reason: 'generated',
      body: `<${index}>${'x'.repeat(length)}`,
      protected: index === 0,
      group: 'generated',
    });
  }
  const display = items.map((_, index) => count - 1 - index);
  return newBlock({ id: 'L4', header: '# Story so far', empty: '(none)', items, display });
}

describe('the character table is the rendered length (block.ts)', () => {
  it('equals the length of the rendered text for every kept count, in every generated block', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const block = generatedBlock(seed, 1 + (seed % 9));
      for (let kept = 0; kept <= block.items.length; kept += 1) {
        expect(renderBlock(block, kept).length, `seed ${seed}, kept ${kept}`).toBe(charsAt(block, kept));
      }
      expect(charTable(block)).toHaveLength(block.items.length + 1);
    }
  });

  it('renders the kept entries in display order, whatever their rank', () => {
    const block = generatedBlock(3, 4);
    const text = renderBlock(block, block.items.length);
    // The display is the reverse of the rank: the last-ranked entry is written first.
    expect(text.indexOf('<3>')).toBeLessThan(text.indexOf('<2>'));
    expect(text.indexOf('<2>')).toBeLessThan(text.indexOf('<1>'));
    expect(text.indexOf('<1>')).toBeLessThan(text.indexOf('<0>'));
    expect(text.startsWith('# Story so far\n\n<3>')).toBe(true);
  });

  it('keeps a prefix of the rank order: the first ranks survive, the rest do not', () => {
    const block = generatedBlock(4, 5);
    const text = renderBlock(block, 2);
    expect(text).toContain('<0>');
    expect(text).toContain('<1>');
    expect(text).not.toContain('<2>');
    expect(text).not.toContain('<4>');
  });
});

describe('the fit keeps the longest rank prefix that fits (block.ts)', () => {
  it('keeps the largest prefix whose text is within the budget, and no more', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const block = generatedBlock(seed, 2 + (seed % 7));
      for (const budget of [0, 1, 5, 40, 120, 400]) {
        const kept = fitBlock(block, budget);
        if (kept > 0) {
          expect(tokensForChars(renderBlock(block, kept).length), `seed ${seed}, budget ${budget}`).toBeLessThanOrEqual(budget);
        }
        if (kept < block.items.length) {
          expect(tokensForChars(renderBlock(block, kept + 1).length), `seed ${seed}, budget ${budget}`).toBeGreaterThan(budget);
        }
      }
    }
  });

  it('records a budget cut for every dropped rank, naming the layer, its budget and the rank', () => {
    const block = generatedBlock(5, 6);
    const kept = fitBlock(block, 60);
    const cuts = [...block.cuts.entries()].sort(([a], [b]) => a - b);
    expect(cuts.map(([rank]) => rank)).toEqual(
      Array.from({ length: block.items.length - kept }, (_, index) => kept + index),
    );
    for (const [rank, reason] of cuts) {
      expect(reason).toEqual({ kind: 'budget', layer: 'L4', budget: 60, rank: rank + 1 });
    }
  });

  it('keeps nothing and says so when even the header overruns the budget', () => {
    const block = generatedBlock(2, 3);
    expect(fitBlock(block, 0)).toBe(0);
    expect(renderBlock(block)).toBe('# Story so far\n\n(none)');
  });
});

describe('the cheapest count (block.ts)', () => {
  /** A block of one-character bodies, so each entry's size is known: `<n>` plus its two-unit separator. */
  function blockWith(bodies: readonly string[], cut: string) {
    const items: BlockItem[] = bodies.map((body, index) => ({
      label: `item ${index}`,
      reason: 'generated',
      body,
      protected: false,
      group: 'generated',
    }));
    return newBlock({ id: 'L3', header: '# Structure', empty: '(none)', cut, items, display: items.map((_, index) => index) });
  }

  it('is the all-cut state when every entry is longer than the cut text', () => {
    const block = blockWith(['a'.repeat(40), 'b'.repeat(40)], '(cut)');
    expect(cheapestKept(block, 0)).toBe(0);
  });

  it('keeps the nearest entry when it renders fewer characters than the cut text that replaces it', () => {
    // The cut line is 40 characters; the nearest entry is 3. Keeping it is the smaller prompt.
    const block = blockWith(['abc', 'd'.repeat(200)], 'c'.repeat(40));
    expect(charsAt(block, 0)).toBeGreaterThan(charsAt(block, 1));
    expect(cheapestKept(block, 0)).toBe(1);
  });

  it('never goes below the floor', () => {
    const block = blockWith(['abc', 'abc'], 'c'.repeat(40));
    expect(cheapestKept(block, 2)).toBe(2);
  });

  it('keeps more entries on a tie, since the cut text is no smaller than the entry it replaces', () => {
    // The cut line and the one entry are both three characters, so the two states render alike.
    const block = blockWith(['xyz'], 'c'.repeat(3));
    expect(charsAt(block, 0)).toBe(charsAt(block, 1));
    expect(cheapestKept(block, 0)).toBe(1);
  });
});

describe('the drop-reason text (drops.ts)', () => {
  it('states each reason in the words the preview shows', () => {
    const cases: readonly [DropReason, string][] = [
      [{ kind: 'never' }, 'disabled by include policy (never)'],
      [{ kind: 'empty-description' }, 'empty description'],
      [{ kind: 'manual-unattached' }, 'manual policy, not attached to the focus'],
      [{ kind: 'forward-outline' }, 'forward outline withheld (includeForwardOutline is off)'],
      [{ kind: 'scope-limit', limit: 20 }, 'beyond the 20-document scope limit; split the scope'],
      [{ kind: 'budget', layer: 'L4', budget: 2000, rank: 7 }, 'dropped budget (L4, 2000 tokens, rank 7)'],
      [
        { kind: 'total-budget', layer: 'L2', total: 12000, rank: 3 },
        'dropped total budget (12000 tokens, L2, rank 3)',
      ],
    ];
    for (const [reason, text] of cases) expect(describeDrop(reason)).toBe(text);
  });
});
