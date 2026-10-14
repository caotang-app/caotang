/**
 * editor-engine.md [§9](docs/architecture/editor-engine.md)'s counting rule, in
 * exactly one place.
 *
 * **§9, quoted:** *"Word/char counts computed from the PM doc per revision
 * (words = block text split on whitespace; chars = body-projection length)"*.
 *
 * **Why this file exists rather than a `countWords` inside whichever module
 * happens to need it.** docs/decisions.md rejected a word count inside
 * `sessions.ts` on one ground and one only: *"two word-count rules is the drift
 * the corpus spends its §2 discipline preventing, and the wrong one would be the
 * one that shipped first."* That reasoning names the duplicate, not this
 * function — so the fix is a single exported rule that both the live producer
 * (`setBody`) and the loader's rebuild call, rather than each computing its own.
 *
 * **Why it lives in the store, where §9 says the ProseMirror document is.** The
 * direction is fixed by the manifests: `@caotang/store` does not depend on
 * `@caotang/editor`, and `@caotang/editor` depends on the store. A rule the loader
 * can reach therefore cannot live in the editor — and `project-format.md` §2's
 * *"loader recomputes on open if absent"* has no editor to ask, on load, at all.
 *
 * **What is counted is the body projection, and that is already decided rather
 * than open here.** docs/decisions.md measured and pinned the awkward half:
 * *"§9's word count counts a blockquote marker as a word. §9 says 'words = block
 * text split on whitespace', and the body projection's block text carries the
 * `>`. Measured (`> quoted` → 2 words) and pinned rather than quietly fixed,
 * because a count that excluded it is a different rule and §9 does not state
 * one."* This module is that rule, so the reading has one implementation instead
 * of one per caller.
 *
 * **The counts are a cache, and §2's own words are why that is safe.** "Derived,
 * rebuildable, allowed stale. Never a reason to reject a manifest."
 */

/** §9's two numbers for one body. */
export interface BodyCount {
  /** block text split on whitespace */
  readonly words: number;
  /** body-projection length */
  readonly chars: number;
}

/**
 * §9's rule over one body projection.
 *
 * A body of only whitespace is **0 words**, not 1: `''.split(/\s+/)` is `['']`,
 * so the empty case has to be named or an empty document counts as a word. The
 * same is true of a body of only a separator, which is why the trim comes before
 * the split rather than the split being filtered afterwards.
 */
export function countBody(body: string): BodyCount {
  const trimmed = body.trim();
  return {
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
    chars: body.length,
  };
}
