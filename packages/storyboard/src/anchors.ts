/**
 * Capturing dialogue anchors for shots — [edit-anchors.md](../../../docs/architecture/edit-anchors.md) §2.
 *
 * `shots.derive` covers script text with shots, and each covered range is a `TextAnchor`
 * captured fresh against the scene as it stands. The offsets are UTF-16 code units into the
 * body projection (the stored body, no front matter), the same coordinate system `doc.read`
 * and the store's `DocumentRecord.body` use.
 *
 * Only capture lives here. Resolving an anchor at apply time is edit-anchors §3's ladder,
 * which the editor package owns and the harness calls. A storyboard plan never resolves an
 * anchor itself, so it cannot silently re-address text.
 */

import type { TextAnchor } from './model.js';

/** edit-anchors §2: the prefix and suffix are "up to 32 chars", the Hypothes.is convention. */
export const ANCHOR_CONTEXT_CHARS = 32;

/** edit-anchors §2: `exact` is "1–2000 chars" (the plan-card preview bound). */
export const ANCHOR_MAX_EXACT_CHARS = 2000;

/**
 * The anchor for `body[from, to)`, or `undefined` when the range cannot be an anchor: out of
 * bounds, empty, or longer than the preview bound. The caller then keeps no coverage for it.
 */
export function captureTextAnchor(
  body: string,
  from: number,
  to: number,
  capturedRevision: number,
): TextAnchor | undefined {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined;
  if (from < 0 || to <= from || to > body.length) return undefined;
  const exact = body.slice(from, to);
  if (exact.length === 0 || exact.length > ANCHOR_MAX_EXACT_CHARS) return undefined;
  return {
    from,
    to,
    exact,
    prefix: body.slice(Math.max(0, from - ANCHOR_CONTEXT_CHARS), from),
    suffix: body.slice(to, to + ANCHOR_CONTEXT_CHARS),
    capturedRevision,
  };
}

/**
 * Where a quote the model proposed sits in the scene. Exact and case-sensitive, because the
 * model is asked to copy the scene's text verbatim, and a near match is not a place to put an
 * anchor: "never a guess" is edit-anchors §3's rule and this is the capture-time half of it.
 * A quote that appears more than once is not anchored, since no single range is the one meant.
 */
export type QuoteLocation =
  | { readonly status: 'one'; readonly from: number; readonly to: number }
  | { readonly status: 'none' }
  | { readonly status: 'many'; readonly count: number };

export function locateQuote(body: string, quote: string): QuoteLocation {
  if (quote.length === 0) return { status: 'none' };
  let count = 0;
  let first = -1;
  let at = body.indexOf(quote);
  while (at !== -1) {
    count += 1;
    if (first === -1) first = at;
    at = body.indexOf(quote, at + 1);
  }
  if (count === 0) return { status: 'none' };
  if (count > 1) return { status: 'many', count };
  return { status: 'one', from: first, to: first + quote.length };
}
