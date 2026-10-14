/**
 * The screenplay Source tab's keys, as plain functions (screenplay.md §3, "element palette / autocomplete"). Each takes the
 * text and the caret and returns the edit the key makes, or `null` when the key keeps its ordinary meaning. The view applies
 * the edit and prevents the key's default; nothing here touches the store, the session or the DOM.
 *
 * The three affordances read the parse, so a line is a cue because the parser says it is, not because it looks like one.
 */

import { parseFountain, type LocatedElement } from './engines.js';

/** The text after a key, and where the caret goes in it. */
export interface KeyEdit {
  readonly text: string;
  readonly caret: number;
}

/** The start and end offsets of the line the caret is on. The end is the offset of its newline, or the text's end. */
function lineAt(text: string, caret: number): { readonly start: number; readonly end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const newline = text.indexOf('\n', caret);
  return { start, end: newline === -1 ? text.length : newline };
}

/** The element whose span starts on the line at `start`, or the one that covers that offset. */
function elementAt(elements: readonly LocatedElement[], offset: number): LocatedElement | undefined {
  return elements.find((element) => element.range.from <= offset && offset < element.range.to);
}

/**
 * Enter at the end of a cue: the cue's dialogue is the next line, so the caret moves onto it, and no blank line is made
 * between the cue and what it says (screenplay.md §3). A cue with no dialogue under it gets a new line for its dialogue.
 * Enter anywhere else keeps its meaning.
 */
export function enterAfterCue(text: string, caret: number): KeyEdit | null {
  const line = lineAt(text, caret);
  if (caret !== line.end) return null;
  const elements = parseFountain(text).elements;
  const cue = elements.find((element) => element.type === 'character' && element.range.from === line.start);
  if (cue === undefined) return null;
  if (line.end < text.length) {
    const next = lineAt(text, line.end + 1);
    const following = elementAt(elements, next.start);
    if (next.start < next.end && (following?.type === 'parenthetical' || following?.type === 'dialogue')) {
      return { text, caret: next.start };
    }
  }
  return { text: `${text.slice(0, caret)}\n${text.slice(caret)}`, caret: caret + 1 };
}

/**
 * Enter on an empty line that follows dialogue: the blank line ends the block, so the line the caret moves to starts an
 * action paragraph, which is back to action (screenplay.md §3).
 */
export function enterOnEmptyDialogue(text: string, caret: number): KeyEdit | null {
  const line = lineAt(text, caret);
  if (line.start !== line.end || caret !== line.start || line.start === 0) return null;
  const previous = lineAt(text, line.start - 1);
  if (previous.start === previous.end) return null;
  const element = elementAt(parseFountain(text).elements, previous.start);
  if (element === undefined || (element.type !== 'dialogue' && element.type !== 'parenthetical')) return null;
  return { text: `${text.slice(0, caret)}\n${text.slice(caret)}`, caret: caret + 1 };
}

/**
 * The names a cue may complete to: the characters cued in the document, and the codex's characters with their names and
 * aliases. A codex entry of any other type (a location, an object, lore, a subplot, other) is not a speaker, so its names
 * never complete a cue. Each name is kept once, in capitals (a Fountain cue is written in capitals), in alphabetical order,
 * so the same completion is offered on every run.
 */
export function cueNames(
  cued: readonly string[],
  codex: readonly { readonly name: string; readonly type: string; readonly aliases: readonly string[] }[],
): string[] {
  const printed = new Set<string>();
  const characters = codex.filter((entry) => entry.type === 'character');
  for (const name of [...cued, ...characters.flatMap((entry) => [entry.name, ...entry.aliases])]) {
    const upper = name.trim().toUpperCase();
    if (upper !== '') printed.add(upper);
  }
  return [...printed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Tab on a half-typed cue completes it. The line must sit where a cue sits (after a blank line, or at the top), and what is
 * typed must be the start of a name in `names`. The completion is the first such name in alphabetical order, in capitals.
 * A name typed in full is already complete, so it has nothing to complete. Anything else keeps the Tab's meaning, which
 * moves focus.
 */
export function cueCompletion(text: string, caret: number, names: readonly string[]): KeyEdit | null {
  const line = lineAt(text, caret);
  if (caret !== line.end) return null;
  const raw = text.slice(line.start, caret);
  const typed = raw.trim();
  if (typed === '' || !/^[A-Za-z][A-Za-z .'-]*$/.test(typed)) return null;
  if (line.start > 0) {
    const previous = lineAt(text, line.start - 1);
    if (previous.start !== previous.end) return null;
  }
  const upper = typed.toUpperCase();
  // A name typed in full keeps Tab's meaning. Otherwise Tab would turn "ANNA" into "ANNABEL" when both are cued.
  if (names.includes(upper)) return null;
  const match = names.find((name) => name.startsWith(upper));
  if (match === undefined) return null;
  // Leading spaces the writer typed are kept, and only the name after them is replaced.
  const indent = raw.slice(0, raw.length - raw.trimStart().length);
  return {
    text: `${text.slice(0, line.start)}${indent}${match}${text.slice(line.end)}`,
    caret: line.start + indent.length + match.length,
  };
}
