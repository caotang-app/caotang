/**
 * The one way this package measures a text limit — [coherence.md §7](../../../docs/architecture/coherence.md).
 *
 * A limit is counted in code points, the unit a JSON Schema `maxLength` counts and
 * the unit the harness enforces on a tool parameter. JavaScript's `.length` counts
 * UTF-16 units, so an emoji is two units. A check that counted those would refuse a
 * value the harness accepted, or accept one that a reload then drops. Offsets into a
 * body stay UTF-16, because that is what `String.prototype.slice` and the body
 * projection use. Only the length of a stored text is counted in code points.
 */

import { NOTE_LIMIT } from './model.js';

/** The length of `text` in code points (Unicode scalar values). */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** The longest prefix of `text` with at most `max` code points. It never splits a surrogate pair. */
export function codePointPrefix(text: string, max: number): string {
  if (codePointLength(text) <= max) return text;
  return [...text].slice(0, max).join('');
}

/** A note as it is stored: trimmed, and absent when nothing is left. */
export function trimNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined;
  const trimmed = note.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The count and the limit, when a note is over the limit; nothing when it fits. The
 * caller supplies the noun ("the note is …", "the dismissal note is …"). Every path
 * that stores a note asks this one function, so the limit cannot drift between the
 * writer's path, the agent's path, the dismissal and the tool parameter.
 */
export function noteLengthProblem(note: string | undefined): string | undefined {
  const kept = trimNote(note);
  if (kept === undefined) return undefined;
  const length = codePointLength(kept);
  return length > NOTE_LIMIT ? `${length} characters; the limit is ${NOTE_LIMIT}` : undefined;
}
