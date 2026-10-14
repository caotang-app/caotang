/**
 * The source fields' decorations, as plain functions (screenplay.md §3, dialogue-narrative.md §3). A source field draws
 * its text over a layer of spans, and this file says which class each run of the text gets. Nothing here changes the
 * text: a decoration is styling only, and the input keeps the writer's characters (screenplay.md §3's rule).
 *
 * Each function returns segments that cover the whole text, in order, with no gaps and no overlaps, so the layer under
 * the input lines up with it character for character.
 */

import { parseFountain } from './engines.js';

/** One run of the text and the class it is drawn with. `cls` is `null` for a run that is drawn plain. */
export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly cls: string | null;
}

/** A run of the text a class is about to be applied to. Marks are built by the functions below and handed to `fillSegments`. */
export interface Mark {
  readonly from: number;
  readonly to: number;
  readonly cls: string;
}

/** The class each Fountain element is drawn with (screenplay.md §3). An element with no class is drawn plain. */
const FOUNTAIN_CLASS: Readonly<Record<string, string>> = {
  scene_heading: 'tok-heading',
  character: 'tok-cue',
  parenthetical: 'tok-paren',
  transition: 'tok-transition',
  centered: 'tok-centered',
  page_break: 'tok-break',
  section: 'tok-section',
  synopsis: 'tok-synopsis',
  note: 'tok-note',
  boneyard: 'tok-note',
};

/**
 * Turns marks into segments that cover `[0, length)`. Marks are taken in source order, longest first where they start
 * together, and a mark that starts inside an earlier one is clipped to what is left. So an outer mark wins over an inner
 * one, which keeps a knot header drawn as a header even where a divert sits in it.
 */
export function fillSegments(length: number, marks: readonly Mark[]): Segment[] {
  const sorted = [...marks].sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const out: Segment[] = [];
  let cursor = 0;
  for (const mark of sorted) {
    const from = Math.max(mark.from, cursor);
    const to = Math.min(mark.to, length);
    if (to <= from) continue;
    if (from > cursor) out.push({ from: cursor, to: from, cls: null });
    out.push({ from, to, cls: mark.cls });
    cursor = to;
  }
  if (cursor < length) out.push({ from: cursor, to: length, cls: null });
  return out;
}

/**
 * The Fountain source's decorations, from the parse: a scene heading, a cue, a parenthetical, a transition, a centred
 * line, a page break, a section, a synopsis and an annotation each get their class. The parse is the one the views read,
 * so a decoration and the formatted script never disagree about what an element is.
 */
export function fountainSegments(text: string): Segment[] {
  const marks: Mark[] = [];
  for (const element of parseFountain(text).elements) {
    const cls = FOUNTAIN_CLASS[element.type];
    if (cls === undefined) continue;
    marks.push({ from: element.range.from, to: element.range.to, cls });
  }
  return fillSegments(text.length, marks);
}

/**
 * The Ink source's decorations. Ink is read line by line by its own syntax (dialogue-narrative.md §2.2), so the marks come
 * from the same shapes the compiler reads: a knot header (`===`), a stitch (`=`), a choice bullet (`*` or `+`), a gather
 * (`-`), a divert (`->`), a declaration (`VAR`, `CONST`, `LIST`, `INCLUDE`, `EXTERNAL`), a comment, a condition in braces,
 * a line-id tag (`#`) and a speaker name before a colon. A marked run is styled and never changed.
 */
export function inkSegments(text: string): Segment[] {
  const marks: Mark[] = [];
  const add = (pattern: RegExp, cls: string): void => {
    for (const match of text.matchAll(pattern)) {
      const from = match.index ?? 0;
      marks.push({ from, to: from + match[0].length, cls });
    }
  };
  // Whole-line shapes first: they win over the inline marks inside them (see fillSegments).
  add(/^[ \t]*={2,}[^\n]*$/gm, 'tok-knot');
  add(/^[ \t]*=[ \t][^\n]*$/gm, 'tok-stitch');
  add(/^[ \t]*(?:VAR|CONST|LIST|INCLUDE|EXTERNAL)\b[^\n]*$/gm, 'tok-decl');
  add(/^[ \t]*\/\/[^\n]*$/gm, 'tok-comment');
  add(/\/\*[\s\S]*?\*\//g, 'tok-comment');
  add(/^[ \t]*[*+]+/gm, 'tok-choice');
  add(/^[ \t]*-(?=[ \t])/gm, 'tok-gather');
  add(/->[ \t]*(?:[A-Za-z_][\w.]*|END|DONE)?/g, 'tok-divert');
  add(/\{[^{}\n]*\}/g, 'tok-cond');
  add(/(?<=\s|^)#[^\n]*/gm, 'tok-tag');
  add(/^[ \t]*[A-Za-z][\w ]{0,40}(?=:)/gm, 'tok-speaker');
  return fillSegments(text.length, marks);
}
