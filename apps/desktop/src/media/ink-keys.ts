/**
 * The Ink source's Tab completion, as a plain function (dialogue-narrative.md §3). After a divert arrow, Tab completes the
 * knot or stitch name that the writer has started. Nothing here touches the store, the session or the DOM: the view applies
 * the edit and prevents the Tab.
 */

import type { KeyEdit } from './screenplay-keys.js';

/**
 * The completion for the divert target the caret ends. `knots` are the names the parse found, in any order. When more than
 * one name starts with what is typed, the first in alphabetical order is taken, so the same completion is offered each time.
 * `null` when the caret does not end a divert target, when what is typed is already a whole name (a divert to "wave" stays
 * a divert to "wave" even when "wave_two" exists), or when no name starts with what is typed.
 */
export function knotCompletion(text: string, caret: number, knots: readonly string[]): KeyEdit | null {
  const typed = /->[ \t]*([A-Za-z_][\w.]*)$/.exec(text.slice(0, caret));
  if (typed === null) return null;
  const prefix = typed[1] ?? '';
  if (knots.includes(prefix)) return null;
  const match = [...knots].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).find((name) => name.startsWith(prefix));
  if (match === undefined) return null;
  const start = caret - prefix.length;
  return { text: `${text.slice(0, start)}${match}${text.slice(caret)}`, caret: start + match.length };
}
