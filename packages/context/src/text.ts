/**
 * Text helpers for the layers. Every cut in this package goes through here, so the rule
 * for a cut that would split a surrogate pair is written once.
 *
 * Lengths are UTF-16 code units, the unit the estimator counts. A cut never leaves half
 * a code point behind, so the estimate of a cut text is the estimate the layer reports.
 */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Whether a cut at `at` would fall inside a pair: a high surrogate before it and a low one
 * after it. A lone surrogate is not a pair, so a cut next to one is clean. The check reads
 * both neighbours, so it never looks before the start or past the end of the text.
 */
function splitsPair(text: string, at: number): boolean {
  return at > 0 && at < text.length && isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at));
}

/** The first `n` characters of `text`, or fewer when the cut would split a pair. */
export function headOf(text: string, n: number): string {
  let end = Math.min(text.length, Math.max(0, n));
  if (splitsPair(text, end)) end -= 1;
  return text.slice(0, end);
}

/** The last `n` characters of `text`, or fewer when the cut would split a pair. */
export function tailOf(text: string, n: number): string {
  let start = Math.max(0, text.length - Math.max(0, n));
  if (splitsPair(text, start)) start += 1;
  return text.slice(start);
}

/**
 * A one-line rendering of free text for a log-style line: whitespace collapsed, then
 * clipped to `max` characters with an ellipsis. Used for the turn memory's intent and
 * outcome lines (context-assembly §2, L6: "compressed to intent + outcome lines").
 */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${headOf(flat, max - 1)}…`;
}

/** An integer with thousands separators. Written by hand, so it never depends on the locale. */
export function formatCount(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The distinct values of `items`, in first-seen order. */
export function unique<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Code-unit order. Every ordering in this package uses it, so no result depends on a locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
