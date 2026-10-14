/**
 * The undo scope's rules (`src/tiptap/undo-scope.ts`, §7 rule 1), headless: the spans, the
 * mappings and the transactions they are read from are ProseMirror's own, so each expectation
 * is a position the document actually has.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { caotangSchema } from '../src/index.js';
import {
  insertedSpans,
  reachesScope,
  replacedSpans,
  shrinkSpan,
  spansOverlap,
  unionSpan,
} from '../src/tiptap/undo-scope.js';

/** A one-paragraph document, so position 1 is the start of its text. */
const stateOf = (text: string): EditorState =>
  EditorState.create({
    doc: caotangSchema.node('doc', null, [caotangSchema.node('paragraph', null, [caotangSchema.text(text)])]),
  });

describe('spansOverlap: an edit reaches the user’s text only when it changes a character of it', () => {
  it.each([
    ['the same span', { from: 1, to: 6 }, { from: 1, to: 6 }, true],
    ['an edit strictly inside the span', { from: 2, to: 2 }, { from: 1, to: 6 }, true],
    ['a replacement that covers part of the span', { from: 4, to: 9 }, { from: 1, to: 6 }, true],
    ['an edit touching the span at its end', { from: 6, to: 6 }, { from: 1, to: 6 }, false],
    ['an edit touching the span at its start', { from: 1, to: 1 }, { from: 1, to: 6 }, false],
    ['an edit that sits after the span', { from: 7, to: 9 }, { from: 1, to: 6 }, false],
    ['two insertion points at the same place', { from: 2, to: 2 }, { from: 2, to: 2 }, false],
  ])('%s', (_name, a, b, expected) => {
    expect(spansOverlap(a, b)).toBe(expected);
  });
});

describe('shrinkSpan: the scope follows the user’s text and does not grow to cover an agent’s', () => {
  it('an insertion at the scope’s start moves the start, so the inserted text is not the user’s', () => {
    const shrunk = shrinkSpan({ from: 1, to: 6 }, new Mapping([new StepMap([1, 0, 3])]));
    expect(shrunk).toEqual({ from: 4, to: 9 });
  });

  it('an insertion at the scope’s end leaves the end where it was', () => {
    const shrunk = shrinkSpan({ from: 1, to: 6 }, new Mapping([new StepMap([6, 0, 3])]));
    expect(shrunk).toEqual({ from: 1, to: 6 });
  });

  it('a deletion of the whole scope leaves an insertion point, where the user’s inverse inserts the text back', () => {
    const shrunk = shrinkSpan({ from: 1, to: 6 }, new Mapping([new StepMap([1, 5, 0])]));
    expect(shrunk).toEqual({ from: 1, to: 1 });
  });
});

describe('unionSpan', () => {
  it('starts from nothing, and covers both spans once there is something to cover', () => {
    expect(unionSpan(null, { from: 3, to: 5 })).toEqual({ from: 3, to: 5 });
    expect(unionSpan({ from: 3, to: 5 }, { from: 1, to: 2 })).toEqual({ from: 1, to: 5 });
  });
});

describe('replacedSpans and insertedSpans, read from transactions', () => {
  it('an insertion replaces the empty span at its position, and inserts the span of its text', () => {
    const tr = stateOf('Hello.').tr.insertText('Mine ', 1);
    expect(replacedSpans(tr)).toEqual([{ from: 1, to: 1 }]);
    expect(insertedSpans(tr, [])).toEqual([{ from: 1, to: 6 }]);
  });

  it('a replacement names the replaced range in the old document, and the new text’s span in the new one', () => {
    const tr = stateOf('Hello.').tr.insertText('Ours ', 1, 6);
    expect(replacedSpans(tr)).toEqual([{ from: 1, to: 6 }]);
    expect(insertedSpans(tr, [])).toEqual([{ from: 1, to: 6 }]);
  });

  it('a transaction with more than one step is not decomposed, so it reaches any scope', () => {
    const tr = stateOf('Hello.').tr.insertText('a', 1).insertText('b', 1);
    expect(replacedSpans(tr)).toBe('all');
    expect(reachesScope('all', { from: 90, to: 91 })).toBe(true);
  });

  it('a later transaction in the same batch moves the spans the first one inserted, and grows them over its own text', () => {
    // `ab` inserted at 1 spans 1..3. A later insertion of `X` at 2, inside it, is part of the
    // same user edit as far as the scope is concerned, so the span grows to cover it: 1..4.
    const root = stateOf('Hello.').tr.insertText('ab', 1);
    const later = stateOf('Hello.').tr.insertText('X', 2);
    expect(insertedSpans(root, [later])).toEqual([{ from: 1, to: 4 }]);
    // Reading the spans does not change the root transaction's mapping.
    expect(root.mapping.maps).toHaveLength(1);
  });
});

describe('reachesScope', () => {
  it('reaches nothing with no scope, and an overlap with a scope', () => {
    expect(reachesScope([{ from: 1, to: 6 }], null)).toBe(false);
    expect(reachesScope([{ from: 1, to: 6 }], { from: 2, to: 3 })).toBe(true);
    expect(reachesScope([{ from: 6, to: 9 }], { from: 1, to: 6 })).toBe(false);
  });
});
