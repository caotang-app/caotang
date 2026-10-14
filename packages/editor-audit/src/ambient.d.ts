/**
 * Ambient types for the two dependencies the §2 pin table brings that ship no
 * types of their own.
 *
 * `diff-match-patch` 1.0.5 is a 2012-era CommonJS module with no bundled
 * declarations, and `@types/diff-match-patch` is a separate package. Adding a
 * dev dependency to type one lazy import is a worse trade than 20 lines here,
 * and the surface actually used is a handful of functions wide. If M5 grows the
 * anchor ladder, this file is the thing to delete in favour of the real types.
 *
 * **Corrected 2026-10-06, and the correction is the reason it is
 * worth reading.** This file previously declared
 * `constructor(options?: DiffMatchPatchOptions)` with `readonly Match_Threshold`
 * / `readonly Match_Distance`. **The pinned constructor takes no arguments at
 * all** — `diff_match_patch` is `function () { … }`, and its own comment says
 * *"Redefine these in your program to override the defaults"* — so the declaration
 * typed a configuration call that **silently does nothing**: no type error, no
 * runtime error, and a search left at the 1 000-character default. The audit's
 * bundle entry never configured anything and so never noticed; the anchor ladder
 * did, in the form of a ±2000 window that behaved like ±500. The fields are
 * mutable below for the same reason the constructor is parameterless: the knobs
 * are assignments.
 *
 * `packages/editor/src/ambient.d.ts` declares the same module for its own
 * TypeScript program. The two are kept in step deliberately — **two ambient
 * declarations of one module in one program would be a duplicate-identifier
 * error**, which is why they live in separate packages' `include` globs rather
 * than in a shared `types/` folder this repo does not have.
 */
declare module 'diff-match-patch' {
  export interface DiffMatchPatchOptions {
    Match_Threshold?: number;
    Match_Distance?: number;
    Patch_DeleteThreshold?: number;
    Patch_InsertThreshold?: number;
    Patch_Margin?: number;
  }

  export class diff_match_patch {
    /** **No parameters** — measured on 1.0.5 (see the header). */
    constructor();
    Match_Threshold: number;
    Match_Distance: number;
    Patch_DeleteThreshold: number;
    Patch_InsertThreshold: number;
    Patch_Margin: number;
    /** "Pattern too long for this browser." above this value: a throw, not a `-1`. */
    readonly Match_MaxBits: number;
    diff_main(text1: string, text2: string): void;
    diff_cleanupSemantic(diffs: unknown[]): void;
    patch_make(text1: string, diffs: unknown[]): unknown[];
    patch_apply(patches: unknown[], text: string): [string, boolean[]];
    match_main(text: string, pattern: string, loc: number): number;
  }

  const patch: diff_match_patch;
  export default patch;
}
