/**
 * Where a shot's dialogue anchor sits in the body as it stands now — [storyboard.md §5](../../../docs/architecture/storyboard.md),
 * which reads [edit-anchors.md §3](../../../docs/architecture/edit-anchors.md).
 *
 * A shot captures its coverage against the scene when it is derived, so an edit above the covered line moves the text and
 * leaves the offsets where they were. The coverage and drift checks resolve each anchor against the body as it is now, so
 * ordinary editing does not read as lost coverage. The rules are edit-anchors §3's, taken in order, with three rungs:
 *
 *  1. exact: the text is still at its offsets (§3 step 1);
 *  2. search: the text occurs once in the body, and that occurrence is the passage (§3 steps 2 and 4);
 *  3. ties: the text occurs more than once, and exactly one occurrence has its context in place (§3's 80% rule).
 *
 * Otherwise the anchor does not resolve, and the check reports it as drift. Two differences from §3 are deliberate. The
 * fuzzy rung (§3 step 3) is not run: it needs the diff-match-patch locator, which the editor loads lazily, and a
 * deterministic scan must not change with whether that load has happened. So an anchor only the fuzzy rung could place is
 * reported as drift, and the writer re-anchors it. And rung 2 takes a unique occurrence without §3's context check. That
 * check serves apply, where it refuses to guess. A check only reports, and the context beside the text is exactly what an
 * edit next to the text changes (a new line above a cue), so here the context only chooses between several occurrences.
 */

import type { TextAnchor } from '@caotang/storyboard';

/** edit-anchors §3's context floor: at least this share of the prefix and suffix characters must match. */
const CONTEXT_FLOOR = 0.8;

/** A range in the body's own offsets. */
export interface BodyRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The range an anchor covers in the body as it stands, or `undefined` when it no longer resolves. An anchor with no `exact`
 * text has nothing to find, so it does not resolve.
 */
export function resolveAnchor(anchor: TextAnchor, body: string): BodyRange | undefined {
  const { from, to, exact } = anchor;
  if (exact.length === 0) return undefined;
  if (from >= 0 && to > from && to <= body.length && body.slice(from, to) === exact) return { from, to };

  const hits = occurrencesOf(body, exact);
  const [only] = hits;
  if (hits.length === 1 && only !== undefined) return only;
  const matching = hits.filter((hit) => contextMatches(anchor, body, hit));
  const [chosen] = matching;
  return matching.length === 1 ? chosen : undefined;
}

/**
 * The text with each UTF-16 unit lower-cased where that keeps it one unit. Lower-casing a whole string can change its length
 * (a few characters fold to two), which would move every offset after them, so the fold is made unit by unit and the offsets
 * of the folded body are the body's own. It is the case-insensitive search that §3 names for its steps 2 and 4.
 */
function folded(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charAt(i);
    const lower = unit.toLowerCase();
    out += lower.length === 1 ? lower : unit;
  }
  return out;
}

/** Every case-insensitive occurrence of `text`, overlapping ones included, in the order they sit in the body. */
function occurrencesOf(body: string, text: string): BodyRange[] {
  const haystack = folded(body);
  const needle = folded(text);
  const found: BodyRange[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push({ from: at, to: at + text.length });
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}

/** edit-anchors §3's context check for one occurrence: the prefix before it and the suffix after it. */
function contextMatches(anchor: TextAnchor, body: string, hit: BodyRange): boolean {
  const before = body.slice(Math.max(0, hit.from - anchor.prefix.length), hit.from);
  const after = body.slice(hit.to, hit.to + anchor.suffix.length);
  return sideMatches(anchor.prefix, before, 'end') && sideMatches(anchor.suffix, after, 'start');
}

/**
 * One side of the context check, compared case-insensitively. The characters that correspond are the ones nearest the
 * text: the end of a prefix and the start of a suffix. An empty side is skipped, as §3 says, and a side the body does not
 * have far enough is compared over the characters it does have.
 */
function sideMatches(expected: string, available: string, nearest: 'start' | 'end'): boolean {
  const compared = Math.min(expected.length, available.length);
  if (compared === 0) return true;
  const wanted = nearest === 'end' ? expected.slice(expected.length - compared) : expected.slice(0, compared);
  const seen = nearest === 'end' ? available.slice(available.length - compared) : available.slice(0, compared);
  let matched = 0;
  for (let i = 0; i < compared; i += 1) {
    if (wanted.charAt(i).toLowerCase() === seen.charAt(i).toLowerCase()) matched += 1;
  }
  return matched / compared >= CONTEXT_FLOOR;
}

/**
 * Maps an offset in the normalised text the screenplay parse reads to the body's own offset. The parse drops a leading
 * byte-order mark and turns each CRLF into LF, so an element's offset in that text is not the body's offset once either is
 * present. Anchors address the body, so an element's range is mapped back before any overlap is judged. A body with neither
 * is its own normalised text, and the mapping is the identity.
 */
export function bodyOffsetsOf(body: string): (normalised: number) => number {
  if (!body.includes('\r') && !body.startsWith('﻿')) return (offset) => offset;
  const bodyAt: number[] = [];
  for (let raw = body.startsWith('﻿') ? 1 : 0; raw < body.length; raw += 1) {
    if (body.charAt(raw) === '\r' && body.charAt(raw + 1) === '\n') continue;
    bodyAt.push(raw);
  }
  bodyAt.push(body.length);
  return (offset) => bodyAt[offset] ?? body.length;
}
