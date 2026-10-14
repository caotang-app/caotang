/**
 * The binder index: binder order, subtree sums, ancestor chains and the goal-target
 * rule — the one accessor both binder-filters §2 and goals-progress §2.2 read.
 */
import type { TreeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { BINDER, INDEX, WORD_COUNTS } from './fixtures/binder.js';
import { createBinderIndex, isReservedRoot } from '../src/index.js';

function node(id: string, parentId: string | null, order: number, type = 'document'): TreeNode {
  return {
    id,
    parentId,
    type,
    title: id,
    order,
    status: null,
    label: null,
    keywords: [],
    synopsis: '',
    notes: '',
  };
}

describe('binder order (ui-modules §2.2: siblings by their gap-encoded order)', () => {
  it('walks depth-first from the project root, whatever order the manifest array is in', () => {
    expect(INDEX.order).toEqual([
      'root',
      'manuscript',
      'act1',
      'ch1',
      's1',
      's2',
      'ch2',
      's3',
      'act2',
      's4',
      'research',
      'r1',
    ]);
  });

  it('breaks an order tie by manifest position, so the result is total and stable', () => {
    const tree = [node('root', null, 0, 'root'), node('b', 'root', 10), node('a', 'root', 10)];
    expect(createBinderIndex(tree).order).toEqual(['root', 'b', 'a']);
  });

  it('leaves out a node whose parent is missing, because it has no place in the binder', () => {
    const tree = [node('root', null, 0, 'root'), node('orphan', 'ghost', 10)];
    const index = createBinderIndex(tree);
    expect(index.order).toEqual(['root']);
    expect(index.has('orphan')).toBe(true);
  });

  it('leaves out a cycle, and terminates when asked for ancestors', () => {
    const tree = [node('root', null, 0, 'root'), node('p', 'q', 10, 'folder'), node('q', 'p', 10, 'folder')];
    const index = createBinderIndex(tree);
    expect(index.order).toEqual(['root']);
    expect(index.ancestorsOf('p')).toEqual(['q']);
  });

  it('keeps the first of two nodes that share an id', () => {
    const tree = [node('root', null, 0, 'root'), node('x', 'root', 10), { ...node('x', 'root', 20), title: 'second' }];
    expect(createBinderIndex(tree).node('x')?.title).toBe('x');
  });
});

describe('subtree word sums (binder-filters §2, goals-progress §2.2)', () => {
  it('counts a document as its own entry', () => {
    expect(INDEX.wordsOf('s1')).toBe(WORD_COUNTS.s1);
  });

  it('sums a folder over its descendants', () => {
    expect(INDEX.wordsOf('ch1')).toBe(2623);
    expect(INDEX.wordsOf('act1')).toBe(2743);
    expect(INDEX.wordsOf('manuscript')).toBe(3643);
  });

  it('gives the project root the sum of everything under it', () => {
    expect(INDEX.wordsOf('root')).toBe(3943);
  });

  it('reads zero for an unknown id, a missing count, and an unreached node', () => {
    expect(INDEX.wordsOf('nope')).toBe(0);
    const bare = createBinderIndex([node('root', null, 0, 'root'), node('d', 'root', 10)]);
    expect(bare.wordsOf('d')).toBe(0);
    expect(createBinderIndex([node('root', null, 0, 'root'), node('o', 'ghost', 10)]).wordsOf('o')).toBe(0);
  });

  it('never counts a folder entry of its own, only the descendants', () => {
    const tree = [node('root', null, 0, 'root'), node('f', 'root', 10, 'folder'), node('d', 'f', 10)];
    const index = createBinderIndex(tree, { f: 999, d: 40 });
    expect(index.wordsOf('f')).toBe(40);
  });
});

describe('ancestorsOf and node lookup', () => {
  it('lists ancestors nearest first, up to and including the project root', () => {
    expect(INDEX.ancestorsOf('s1')).toEqual(['ch1', 'act1', 'manuscript', 'root']);
  });

  it('lists nothing for the project root or an unknown id', () => {
    expect(INDEX.ancestorsOf('root')).toEqual([]);
    expect(INDEX.ancestorsOf('nope')).toEqual([]);
  });

  it('finds nodes by id and reports membership', () => {
    expect(INDEX.node('s3')?.title).toBe('Ledger');
    expect(INDEX.has('s3')).toBe(true);
    expect(INDEX.has('nope')).toBe(false);
  });
});

describe('goal targets (goals-progress §2.2): the manuscript root or any folder', () => {
  it('accepts folders, including the manuscript and research roots', () => {
    expect(INDEX.isGoalTarget('manuscript')).toBe(true);
    expect(INDEX.isGoalTarget('act1')).toBe(true);
    expect(INDEX.isGoalTarget('research')).toBe(true);
  });

  it('refuses documents, the project root and a missing node', () => {
    expect(INDEX.isGoalTarget('s1')).toBe(false);
    expect(INDEX.isGoalTarget('root')).toBe(false);
    expect(INDEX.isGoalTarget('gone')).toBe(false);
  });
});

describe('reserved roots (binder-filters §3)', () => {
  it('names the project root and the two fixed roots, and nothing else', () => {
    const reserved = BINDER.filter((n) => isReservedRoot(n)).map((n) => n.id);
    expect(reserved.sort()).toEqual(['manuscript', 'research', 'root']);
  });
});

describe('malformed derived counts (the store checks only that derived is an object)', () => {
  const tree = [
    node('root', null, 0, 'root'),
    node('f', 'root', 10, 'folder'),
    node('a', 'f', 10),
    node('b', 'f', 20),
    node('c', 'f', 30),
    node('d', 'f', 40),
  ];

  it('counts a string count as zero, so a folder total is never a string concatenation', () => {
    const index = createBinderIndex(tree, { a: '2143', d: 480 });
    expect(index.wordsOf('a')).toBe(0);
    expect(index.wordsOf('f')).toBe(480);
  });

  it('counts a NaN or a negative count as zero, so no total is NaN or short', () => {
    const index = createBinderIndex(tree, { b: Number.NaN, c: -5, d: 480 });
    expect(index.wordsOf('b')).toBe(0);
    expect(index.wordsOf('c')).toBe(0);
    expect(index.wordsOf('f')).toBe(480);
  });

  it('truncates a fractional count to a whole number', () => {
    expect(createBinderIndex(tree, { d: 12.9 }).wordsOf('d')).toBe(12);
  });
});
