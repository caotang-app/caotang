/**
 * [editor-engine.md] §7 rule 1 — which part of the user's undo history an agent apply can reach.
 *
 * ## The failure this module exists for
 *
 * An agent apply is history-excluded, and `prosemirror-history` still maps the user's
 * recorded events through it: an excluded transaction appends its step maps to the
 * stack, so an undo's inverse steps are rebased over the agent's text. When the agent
 * replaces text the user typed, the rebased inverse deletes the agent's replacement.
 * Measured on the adapter: `insertAtSelection('Mine ')` on `Hello.`, then an agent
 * `replaceRange({0,5}, 'Ours ')`, then Ctrl+Z returns `Hello.`, which removes the agent's
 * text and makes that removal a user edit that autosave then writes.
 *
 * ## What the adapter does with this module
 *
 * It tracks one **scope**: the smallest span of the document that holds every text the
 * user's undo stack can still reach. An agent apply whose replaced range overlaps the
 * scope empties the user's undo history, because a rebased inverse could then touch the
 * agent's text. An agent apply that does not overlap the scope leaves the history alone,
 * which is the case §7's rule 1 actually describes: the user's earlier keystrokes stay
 * undoable past an edit elsewhere in the document.
 *
 * The scope is one span, not a list, so it is an over-approximation: an overlap with the
 * gap between two of the user's edits resets the history too. That is the cheap side of
 * the error. The expensive side, an undo that deletes agent text, is what the reset
 * prevents, and it is never allowed. An exact per-event rebase would need the stack's own
 * events, which `prosemirror-history` does not expose.
 *
 * The spans here are plain `{from, to}` pairs in document positions. Nothing in this
 * file imports the view, the DOM or the store, so the rules are tested headless.
 */
import type { Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

/** A document span, `from` to `to` exclusive. `from === to` is an insertion point. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/**
 * Whether an edit replacing `a` can change the text of `b`.
 *
 * Strict on both ends, which is the tight form of the rule and is right in both
 * directions. Touching at an end (`a.to === b.from`) is not an overlap: an edit adjacent to
 * the user's text leaves the user's inverse step pointing at the user's text. An insertion
 * point strictly inside `b` is an overlap, because the user's inverse would then delete
 * the inserted text along with its own.
 */
export const spansOverlap = (a: Span, b: Span): boolean => a.from < b.to && b.from < a.to;

/**
 * A span carried through an edit **without growing**.
 *
 * Text an edit inserts at either end of the scope is not the user's text, so the scope
 * must not stretch to cover it: the `from` end stays after an insertion at `from`, and
 * the `to` end stays before an insertion at `to`. A scope that grew would make every
 * later agent edit next to the user's text look like an overlap.
 *
 * A point the edit splits or swallows ends up empty at the first position it reached,
 * which is where the user's inverse of a deletion inserts the deleted text.
 */
export const shrinkSpan = (span: Span, mapping: Mapping): Span => {
  const from = mapping.map(span.from, 1);
  const to = mapping.map(span.to, -1);
  return to < from ? { from, to: from } : { from, to };
};

/** The smallest span holding both. `null` stands for "no scope yet". */
export const unionSpan = (scope: Span | null, span: Span): Span =>
  scope === null
    ? { from: span.from, to: span.to }
    : { from: Math.min(scope.from, span.from), to: Math.max(scope.to, span.to) };

/**
 * The spans a transaction **replaces**, in the document it was built on, or `'all'`.
 *
 * Only a single-step transaction is decomposed. Every agent apply the adapter makes is
 * one `ReplaceStep`, so the answer is exact for them. A multi-step transaction could only
 * be placed by mapping each step back through the ones before it, and rather than
 * implement that inverse for a case the adapter never produces, the answer is `'all'`,
 * which the caller treats as an overlap with any scope.
 */
export const replacedSpans = (tr: Transaction): readonly Span[] | 'all' => {
  const maps = tr.mapping.maps;
  if (maps.length > 1) return 'all';
  const spans: Span[] = [];
  for (const map of maps) {
    map.forEach((oldStart, oldEnd) => {
      spans.push({ from: oldStart, to: oldEnd });
    });
  }
  return spans;
};

/**
 * The spans a user transaction **inserts or replaces**, in the document after the
 * transaction and every transaction appended to it.
 *
 * Each step's new range is mapped forward through the steps after it, so a span stays
 * correct when a later step of the same transaction (or a plugin's appended one) moves
 * it. The mapping is growing on purpose: text the user typed belongs to the scope, and
 * a span that did not cover it would let a later agent edit slip past the overlap check.
 */
export const insertedSpans = (root: Transaction, later: readonly Transaction[]): Span[] => {
  const spans: Span[] = [];
  root.mapping.maps.forEach((map, index) => {
    // A fresh `Mapping` over a copied array. `Mapping.slice` shares its array with the
    // parent, so appending to it would extend the root transaction's own mapping.
    const rest = new Mapping(root.mapping.maps.slice(index + 1));
    for (const tr of later) rest.appendMapping(tr.mapping);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      spans.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
    });
  });
  return spans;
};

/**
 * Whether an agent edit replacing `replaced` can reach a scope.
 *
 * `'all'` answers yes for any scope, which is the conservative reading of a transaction
 * this module does not decompose. A `null` scope is no user history, so nothing can be
 * reached.
 */
export const reachesScope = (replaced: readonly Span[] | 'all', scope: Span | null): boolean => {
  if (scope === null) return false;
  if (replaced === 'all') return true;
  return replaced.some((span) => spansOverlap(span, scope));
};
