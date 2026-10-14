/**
 * Ambient types for `diff-match-patch`, which ships none of its own.
 *
 * **Same reasoning as `@caotang/editor-audit`'s copy, and the same trade:** 1.0.5 is
 * a 2012-era CommonJS module with no bundled declarations, and
 * `@types/diff-match-patch` is a separate package. Adding a dev dependency to type
 * one lazy import is a worse trade than the twenty lines here, and the surface the
 * ladder actually uses is one function wide — `match_main` — plus the two
 * constructor options the ladder sets. §4 of edit-anchors names `diff_main` for the
 * *future* drift-diff renderer, so it is deliberately **not** declared here: a
 * declaration is not an implementation, and declaring a function the ladder never
 * calls would be a promise the module does not keep.
 *
 * **`match_main` takes three arguments here, not four**, and the constructor takes
 * **no arguments at all** — both measured on the pinned library, and both recorded in
 * `edit-anchors.ts` and in docs/decisions.md. The
 * knobs are *fields*, which is why they are declared mutable below: a declaration
 * that made them `readonly` would type a constructor options object the library
 * silently ignores, and typecheck would be green while the configuration did nothing.
 */
declare module 'diff-match-patch' {
  /**
   * Only the two options the ladder sets. `match_bitap_` scores a candidate as
   * `errors / pattern.length + proximity / Match_Distance`, so these two *are* the
   * library's whole search-budget surface.
   */
  export interface DiffMatchPatchOptions {
    Match_Threshold?: number;
    Match_Distance?: number;
  }

  export class diff_match_patch {
    /** **No parameters.** `diff_match_patch` is `function () { … }` at 1.0.5. */
    constructor();
    /** "Redefine these in your program to override the defaults." */
    Match_Threshold: number;
    /** "How far to search for a match (0 = exact location, 1000+ = broad match)." */
    Match_Distance: number;
    /** "Pattern too long for this browser." above this — a **throw**, not a `-1`. */
    readonly Match_MaxBits: number;
    /** Best index of `pattern` in `text` near `loc`, or `-1`. Three parameters — measured. */
    match_main(text: string, pattern: string, loc: number): number;
  }

  const patch: diff_match_patch;
  export default patch;
}