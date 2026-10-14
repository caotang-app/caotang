/**
 * The lazy `diff-match-patch` seam — §2's "pin exact; **lazy-loaded**" row.
 *
 * §2 pins it at Apache-2.0 (permissive, so it composes with MIT) and requires
 * it to stay off the editor's critical path at ~30 KB gz. A static `import`
 * would put it in the main chunk, so the load goes through a dynamic
 * `import()` and the audit's Vite config splits it into its own chunk. That the
 * split actually produces a non-empty chunk is asserted in `bundle.test.ts`, so
 * "lazy" is a property of the emitted artifact rather than an intention.
 *
 * The first cut exported only the *string* `'diff-match-patch'`, which made the
 * chunk empty — a dynamic import that nothing calls is elided, so the audit
 * would have "passed" on a dependency that was not in the graph at all. The
 * function is exported and called by the entry so the specifier survives.
 */
import type * as DiffMatchPatchModule from 'diff-match-patch';

export type DiffMatchPatch = typeof DiffMatchPatchModule;

export const loadDiffMatchPatch = async (): Promise<DiffMatchPatch> =>
  import('diff-match-patch');

/** A resolved handle, for the bundle entry to reference without awaiting. */
export const diffMatchPatch = loadDiffMatchPatch;
