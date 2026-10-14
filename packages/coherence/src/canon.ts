/**
 * Which codex entries are the writer's canon, and which an agent inferred — the canon-outranking
 * rule of [codex.md §2](../../../docs/architecture/codex.md), consumed by
 * [coherence.md §4.3](../../../docs/architecture/coherence.md).
 *
 * When a finding names both a hand-authored entry and an agent-inferred one, the hand-authored entry
 * is canon. The rule is about who wrote the entry, not how it reached the project, so an
 * `import` entry ranks with `manual`: imported writing is
 * the writer's own canon, and an import that ranked below an agent entry would lose to the model's
 * guess about the writer's own worldbuilding. `agent` is the only origin an inference can carry.
 *
 * Pure functions over the origin string, so the rule is tested without a project.
 */

import type { CodexEntry } from '@caotang/store';

/** The codex entry's origin, as codex.md §2 closes it: `manual`, `agent` or `import`. */
export type CodexOrigin = CodexEntry['origin'];

/** The origins that are the writer's canon: hand-authored (`manual`) and imported writing (`import`). */
export const WRITER_CANON_ORIGINS = ['manual', 'import'] as const satisfies readonly CodexOrigin[];

/** True when an entry with this origin is the writer's canon. Only `agent` is an inference. */
export function isWriterCanonOrigin(origin: CodexOrigin): boolean {
  return (WRITER_CANON_ORIGINS as readonly CodexOrigin[]).includes(origin);
}

/** The canon rank of an origin: 0 for the writer's canon, 1 for an agent inference. Lower outranks higher. */
export function canonRank(origin: CodexOrigin): 0 | 1 {
  return isWriterCanonOrigin(origin) ? 0 : 1;
}

/**
 * Which of two conflicting entries is canon. `undefined` when they rank the same (both canon, or both
 * inferred): the rule decides nothing between them, and the caller must say so rather than pick one.
 */
export function canonOfPair<A extends { readonly origin: CodexOrigin }, B extends { readonly origin: CodexOrigin }>(
  a: A,
  b: B,
): A | B | undefined {
  const rankA = canonRank(a.origin);
  const rankB = canonRank(b.origin);
  if (rankA === rankB) return undefined;
  return rankA < rankB ? a : b;
}
