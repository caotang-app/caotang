/**
 * Writes elements back to Fountain text — the inverse of `parseFountain` over the element
 * model ([screenplay.md §2.3](../../../docs/architecture/screenplay.md)).
 *
 * A line is forced (`.`, `!`, `@`, `>`) only where the parser would read it differently
 * at that position, and an element the writer forced stays forced. So
 * `parseFountain(serialiseFountain(x))` gives back the element types and texts of `x` for
 * every element the parser produces in that order. A dialogue line is the one exception the
 * parser makes: inside an open dialogue block a forcing character is text, so a dialogue line
 * is written raw and `!Get down!` stays dialogue (screenplay.md §2.3).
 *
 * This is the element path. An imported scene does not go through here: it keeps its own
 * source text, which is what makes Fountain export byte-identical (import.ts).
 */

import { cueOf, isSceneHeadingText, isTransitionText } from './classify.js';
import type { ScreenplayElement } from './types.js';

export function serialiseFountain(elements: readonly ScreenplayElement[]): string {
  let out = '';
  elements.forEach((el, i) => {
    // Annotations are transparent (screenplay.md §2.1), so the cue and its dialogue are read across them.
    const prev = contentBefore(elements, i);
    const next = contentAfter(elements, i);
    const followedByDialogue = next !== undefined && (next.type === 'dialogue' || next.type === 'parenthetical');
    const block = renderBlock(el, followedByDialogue);
    if (i === 0) out = block;
    else out += `${joinsBlock(prev, el, next) ? '\n' : '\n\n'}${block}`;
  });
  return out === '' ? '' : `${out}\n`;
}

function isAnnotation(el: ScreenplayElement | undefined): boolean {
  return el !== undefined && (el.type === 'note' || el.type === 'boneyard');
}

/** The nearest element before `i` that is not an annotation. */
function contentBefore(elements: readonly ScreenplayElement[], i: number): ScreenplayElement | undefined {
  for (let j = i - 1; j >= 0; j--) {
    const el = elements[j];
    if (!isAnnotation(el)) return el;
  }
  return undefined;
}

/** The nearest element after `i` that is not an annotation. */
function contentAfter(elements: readonly ScreenplayElement[], i: number): ScreenplayElement | undefined {
  for (let j = i + 1; j < elements.length; j++) {
    const el = elements[j];
    if (!isAnnotation(el)) return el;
  }
  return undefined;
}

/**
 * A parenthetical or dialogue line continues the cue's block, and so does an annotation that sits
 * between the cue and its dialogue. Neither starts a new block (screenplay.md §2.1, §2.3).
 */
function joinsBlock(prev: ScreenplayElement | undefined, el: ScreenplayElement, next: ScreenplayElement | undefined): boolean {
  if (prev === undefined) return false;
  const inBlock = prev.type === 'character' || prev.type === 'parenthetical' || prev.type === 'dialogue';
  if (el.type === 'dialogue' || el.type === 'parenthetical') return inBlock;
  if (isAnnotation(el)) return inBlock && next !== undefined && (next.type === 'dialogue' || next.type === 'parenthetical');
  return false;
}

/** Whether an action line would be read as something other than action, so the writer must force it. */
function forcesAction(line: string, first: boolean): boolean {
  if (/^[=#>!@.]/.test(line) || /^(?:\[\[|\/\*)/.test(line) || /^={3,}$/.test(line.trim())) return true;
  return first && (isSceneHeadingText(line) || isTransitionText(line) || cueOf(line) !== null);
}

function entryLines(key: string, value: string): string {
  const [first = '', ...rest] = value.split('\n');
  return [`${key}: ${first}`.trimEnd(), ...rest.map((line) => `   ${line}`)].join('\n');
}

function renderBlock(el: ScreenplayElement, followedByDialogue: boolean): string {
  switch (el.type) {
    case 'scene_heading':
      return `${el.forced || !isSceneHeadingText(el.text) ? '.' : ''}${el.text}`;
    case 'action':
      return el.text
        .split('\n')
        .map((line, i) => `${(el.forced === true && i === 0) || forcesAction(line, i === 0) ? '!' : ''}${line}`)
        .join('\n');
    case 'character': {
      const forced = el.forced === true || cueOf(el.text) === null || !followedByDialogue;
      return `${forced ? '@' : ''}${el.text}${el.dual === true ? ' ^' : ''}`;
    }
    case 'parenthetical':
      return el.text.startsWith('(') ? el.text : `(${el.text})`;
    case 'dialogue':
      return el.text;
    case 'transition':
      return `${el.forced || !isTransitionText(el.text) ? '>' : ''}${el.text}`;
    case 'centered':
      return `> ${el.text} <`;
    case 'page_break':
      return '===';
    case 'section':
      return `${'#'.repeat(el.depth)} ${el.text}`;
    case 'synopsis':
      return `= ${el.text}`;
    case 'note':
      return `[[${el.text}]]`;
    case 'boneyard':
      return `/*${el.text}*/`;
    case 'title_page':
      return Object.entries(el.entries)
        .map(([key, value]) => entryLines(key, value))
        .join('\n');
  }
}
