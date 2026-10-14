/**
 * The Fountain parser — [screenplay.md §2.3](../../../docs/architecture/screenplay.md),
 * under fountain.io's lenient philosophy: every line is read, and a line that matches no
 * rule is action. Nothing here throws on malformed input.
 *
 * It runs in two passes. The first reads the lines into blanks, annotations and text. A
 * boneyard (slash-star to star-slash) or a note (double brackets) that stands alone on its
 * lines is an annotation, and an annotation is transparent: it neither ends a block nor starts
 * one, so it never changes how the lines around it render (screenplay.md §2.1). The second
 * pass classifies the text lines, with the next text line in view, so a cue is known to have
 * dialogue after it.
 *
 * Every element carries the source range it was read from, so the editor can decorate spans
 * and the scene navigator can jump to them. An element keeps its text as written, annotations
 * included; printing removes them (`printedText`, classify.ts).
 */

import {
  PARENTHETICAL_RE,
  TITLE_KEY_RE,
  cueOf,
  isSceneHeadingText,
  isTransitionText,
  sceneNumberOf,
  stripSceneNumber,
} from './classify.js';
import type { LocatedElement, ScreenplayElement, TextRange } from './types.js';

/** One scene heading, in document order: the scene navigator's list (screenplay.md §3). */
export interface SceneSpan {
  /** Position among the scene headings, from zero. */
  readonly index: number;
  /** The heading as written, without its forcing character and scene number. */
  readonly heading: string;
  readonly sceneNumber: string | null;
  /** Index into `elements` of the heading element. */
  readonly elementIndex: number;
  readonly range: TextRange;
}

export interface ParsedScreenplay {
  readonly elements: readonly LocatedElement[];
  readonly scenes: readonly SceneSpan[];
  /** The title page's entries, or null when the source has none. */
  readonly titlePage: Readonly<Record<string, string>> | null;
  /** What the lenient reader could not close, in order. Empty for well-formed input. */
  readonly notices: readonly string[];
}

/**
 * Strips a leading byte-order mark and reads CRLF line endings as LF, so a Windows file parses
 * and exports like its Unix twin. Ranges from a parse index the normalised text.
 */
export function normaliseSource(input: string): string {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  return text.replace(/\r\n/g, '\n');
}

interface Line {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const breaks = /\r?\n/g;
  let from = 0;
  for (let m = breaks.exec(source); m !== null; m = breaks.exec(source)) {
    lines.push({ text: source.slice(from, m.index), from, to: m.index });
    from = m.index + m[0].length;
  }
  lines.push({ text: source.slice(from), from, to: source.length });
  return lines;
}

function locate(element: ScreenplayElement, from: number, to: number): LocatedElement {
  return { ...element, range: { from, to } } as LocatedElement;
}

function characterElement(raw: string, forced: boolean): ScreenplayElement {
  let name = raw.trim();
  let dual = false;
  if (name.endsWith('^')) {
    dual = true;
    name = name.slice(0, -1).trimEnd();
  }
  return {
    type: 'character',
    text: name,
    ...(dual ? { dual: true } : {}),
    ...(forced ? { forced: true } : {}),
  };
}

/** Title-page entries run from the first line to the first blank line; indented lines continue a value. */
function readTitlePage(lines: readonly Line[]): { entries: Record<string, string>; end: number; next: number } {
  const entries: Record<string, string> = {};
  let key: string | null = null;
  let end = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i] as Line;
    if (line.text.trim() === '') break;
    end = line.to;
    const m = /^([A-Za-z][A-Za-z ]*):\s?(.*)$/.exec(line.text);
    if (m !== null && !/^(?: {3}|\t)/.test(line.text)) {
      key = (m[1] ?? '').trim();
      entries[key] = (m[2] ?? '').trim();
    } else if (key !== null) {
      entries[key] = `${entries[key] ?? ''}\n${line.text.trim()}`.replace(/^\n/, '');
    }
  }
  return { entries, end, next: i + 1 };
}

/** The two annotation kinds, and the closer each one ends at. */
type Comment = 'boneyard' | 'note';

const CLOSER: Readonly<Record<Comment, string>> = { boneyard: '*/', note: ']]' };

/** A line after the first pass: a blank, an annotation, or text (trimmed) to classify. */
type Logical =
  | { readonly kind: 'blank'; readonly from: number; readonly to: number }
  | { readonly kind: 'comment'; readonly comment: Comment; readonly text: string; readonly from: number; readonly to: number }
  | { readonly kind: 'text'; readonly text: string; readonly from: number; readonly to: number };

/** An annotation still open at the end of a line, with its text so far, one part per line. */
interface OpenComment {
  readonly comment: Comment;
  readonly from: number;
  readonly parts: string[];
}

function commentOf(t: string): Comment | null {
  return t.startsWith('/*') ? 'boneyard' : t.startsWith('[[') ? 'note' : null;
}

/**
 * Reads one line's text. A span that opens and closes on the line, with nothing after it, is
 * an annotation. A span with text after it is text, and its span is left as written, so the
 * line prints without the span (screenplay.md §2.1). A span that does not close stays open.
 */
function startText(t: string, from: number, to: number, items: Logical[]): OpenComment | null {
  const comment = commentOf(t);
  if (comment === null) {
    items.push({ kind: 'text', text: t, from, to });
    return null;
  }
  const closer = CLOSER[comment];
  const body = t.slice(2);
  const at = body.indexOf(closer);
  if (at === -1) return { comment, from, parts: [body] };
  if (body.slice(at + closer.length).trim() === '') {
    items.push({ kind: 'comment', comment, text: body.slice(0, at).trim(), from, to });
  } else {
    items.push({ kind: 'text', text: t, from, to });
  }
  return null;
}

/** The first pass: every line becomes a blank, an annotation or text, in source order. */
function readLogical(lines: readonly Line[]): { items: Logical[]; open: OpenComment | null } {
  const items: Logical[] = [];
  let open: OpenComment | null = null;
  for (const line of lines) {
    if (open !== null) {
      const closer = CLOSER[open.comment];
      const at = line.text.indexOf(closer);
      if (at === -1) {
        open.parts.push(line.text);
        continue;
      }
      open.parts.push(line.text.slice(0, at));
      items.push({
        kind: 'comment',
        comment: open.comment,
        text: open.parts.join('\n').trim(),
        from: open.from,
        to: line.from + at + closer.length,
      });
      open = null;
      // Text after the closer is read as a line of its own, with the closing line's range (screenplay.md §2.3).
      const rest = line.text.slice(at + closer.length).trim();
      if (rest !== '') open = startText(rest, line.from, line.to, items);
      continue;
    }
    const t = line.text.trim();
    if (t === '') {
      items.push({ kind: 'blank', from: line.from, to: line.to });
      continue;
    }
    open = startText(t, line.from, line.to, items);
  }
  return { items, open };
}

/** Whether an element is an annotation, which prints nothing and does not split a paragraph. */
function isAnnotation(el: LocatedElement | undefined): boolean {
  return el !== undefined && (el.type === 'note' || el.type === 'boneyard');
}

/**
 * Whether the next line that is not an annotation is text. A cue needs dialogue after it
 * (screenplay.md §2.3), and a forced page break is not dialogue.
 */
function textFollows(items: readonly Logical[], k: number): boolean {
  for (let j = k + 1; j < items.length; j++) {
    const next = items[j] as Logical;
    if (next.kind !== 'comment') return next.kind === 'text' && !/^={3,}$/.test(next.text);
  }
  return false;
}

/** Parses Fountain source into located elements, scene spans and the title page. */
export function parseFountain(input: string): ParsedScreenplay {
  const source = normaliseSource(input);
  const lines = splitLines(source);
  const elements: LocatedElement[] = [];
  const notices: string[] = [];
  let titlePage: Record<string, string> | null = null;
  let start = 0;

  if (lines.length > 0 && TITLE_KEY_RE.test((lines[0] as Line).text)) {
    const page = readTitlePage(lines);
    titlePage = page.entries;
    elements.push(locate({ type: 'title_page', entries: page.entries }, 0, page.end));
    start = page.next;
  }

  const read = readLogical(lines.slice(start));
  const items = read.items;
  if (read.open !== null) {
    // An annotation that never closes runs to the end of the source, and is not printed (screenplay.md §2.1).
    items.push({
      kind: 'comment',
      comment: read.open.comment,
      text: read.open.parts.join('\n').trim(),
      from: read.open.from,
      to: source.length,
    });
    notices.push(
      read.open.comment === 'boneyard'
        ? 'An unclosed boneyard runs to the end of the source; it is not printed.'
        : 'An unclosed note runs to the end of the source; it is not printed.',
    );
  }

  let prevBlank = true;
  let inDialogue = false;

  // Action and dialogue lines that continue the same paragraph join the element before them. An
  // annotation inside the paragraph does not split it, so the join looks past annotations.
  const addText = (
    type: 'action' | 'dialogue',
    text: string,
    from: number,
    to: number,
    continues: boolean,
    forced: boolean,
  ): void => {
    let at = elements.length - 1;
    while (at >= 0 && isAnnotation(elements[at])) at -= 1;
    const last = at >= 0 ? elements[at] : undefined;
    if (continues && last !== undefined && (last.type === 'action' || last.type === 'dialogue') && last.type === type) {
      elements[at] = {
        ...last,
        text: `${last.text}\n${text}`,
        range: { from: last.range.from, to },
      } as LocatedElement;
      return;
    }
    const element: ScreenplayElement =
      type === 'action' ? (forced ? { type, text, forced: true } : { type, text }) : { type, text };
    elements.push(locate(element, from, to));
  };

  for (let k = 0; k < items.length; k++) {
    const item = items[k] as Logical;

    if (item.kind === 'blank') {
      prevBlank = true;
      inDialogue = false;
      continue;
    }
    if (item.kind === 'comment') {
      // Transparent: the block state is left as it was, on both sides of the annotation.
      elements.push(locate({ type: item.comment, text: item.text }, item.from, item.to));
      continue;
    }

    const t = item.text;
    const continues = !prevBlank;
    const nextIsText = textFollows(items, k);

    if (/^={3,}$/.test(t)) {
      elements.push(locate({ type: 'page_break' }, item.from, item.to));
      prevBlank = true;
      inDialogue = false;
      continue;
    }

    // Inside an open dialogue block a line is dialogue or a parenthetical, whatever its first
    // character. A forcing character there is text, so `!Get down!` keeps its punctuation
    // (screenplay.md §2.3). A line of `===` still breaks the page, above.
    if (inDialogue) {
      if (PARENTHETICAL_RE.test(t)) elements.push(locate({ type: 'parenthetical', text: t }, item.from, item.to));
      else addText('dialogue', t, item.from, item.to, continues, false);
      prevBlank = false;
      continue;
    }

    // A section marker of any depth is a section; depths past three are tolerated as three (screenplay.md A2).
    const section = /^(#+)\s*(.*)$/.exec(t);
    if (section !== null) {
      const depth = Math.min((section[1] ?? '#').length, 3) as 1 | 2 | 3;
      elements.push(locate({ type: 'section', depth, text: (section[2] ?? '').trim() }, item.from, item.to));
      prevBlank = true;
      inDialogue = false;
      continue;
    }

    const synopsis = /^=(?!=)\s*(.*)$/.exec(t);
    if (synopsis !== null) {
      elements.push(locate({ type: 'synopsis', text: (synopsis[1] ?? '').trim() }, item.from, item.to));
      prevBlank = true;
      inDialogue = false;
      continue;
    }

    const centered = /^>(.*)<$/.exec(t);
    if (centered !== null) {
      elements.push(locate({ type: 'centered', text: (centered[1] ?? '').trim() }, item.from, item.to));
      prevBlank = true;
      inDialogue = false;
      continue;
    }

    // Forcing characters: `.` heading, `>` transition, `!` action, `@` cue. The character is stripped.
    const forcedScene = /^\.(?!\.)(.*)$/.exec(t);
    if (forcedScene !== null && (forcedScene[1] ?? '').trim() !== '') {
      elements.push(locate({ type: 'scene_heading', text: (forcedScene[1] ?? '').trim(), forced: true }, item.from, item.to));
      prevBlank = false;
      inDialogue = false;
      continue;
    }
    const forcedTransition = /^>(.*)$/.exec(t);
    if (forcedTransition !== null && (forcedTransition[1] ?? '').trim() !== '') {
      elements.push(
        locate({ type: 'transition', text: (forcedTransition[1] ?? '').trim(), forced: true }, item.from, item.to),
      );
      prevBlank = false;
      inDialogue = false;
      continue;
    }
    const forcedAction = /^!(.*)$/.exec(t);
    if (forcedAction !== null) {
      addText('action', (forcedAction[1] ?? '').trim(), item.from, item.to, continues, true);
      prevBlank = false;
      inDialogue = false;
      continue;
    }
    const forcedCue = /^@(.*)$/.exec(t);
    if (forcedCue !== null && (forcedCue[1] ?? '').trim() !== '') {
      elements.push(locate(characterElement(forcedCue[1] ?? '', true), item.from, item.to));
      prevBlank = false;
      inDialogue = true;
      continue;
    }

    // Inferred elements: a heading or transition only at the start of a block, a cue only when
    // the next text line is dialogue. Anything else is action.
    if (prevBlank && isSceneHeadingText(t)) {
      elements.push(locate({ type: 'scene_heading', text: t, forced: false }, item.from, item.to));
      prevBlank = false;
      inDialogue = false;
      continue;
    }
    if (prevBlank && isTransitionText(t)) {
      elements.push(locate({ type: 'transition', text: t, forced: false }, item.from, item.to));
      prevBlank = false;
      inDialogue = false;
      continue;
    }
    if (prevBlank && nextIsText && cueOf(t) !== null) {
      elements.push(locate(characterElement(t, false), item.from, item.to));
      prevBlank = false;
      inDialogue = true;
      continue;
    }

    addText('action', t, item.from, item.to, continues, false);
    prevBlank = false;
    inDialogue = false;
  }

  const scenes: SceneSpan[] = [];
  elements.forEach((el, elementIndex) => {
    if (el.type !== 'scene_heading') return;
    scenes.push({
      index: scenes.length,
      heading: stripSceneNumber(el.text),
      sceneNumber: sceneNumberOf(el.text),
      elementIndex,
      range: el.range,
    });
  });

  return { elements, scenes, titlePage, notices };
}
