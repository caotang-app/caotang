/**
 * Mention counts for the presence and coverage checks — [codex.md §4](../../../docs/architecture/codex.md)
 * owns detection. This module reads the cache it keeps, and it rebuilds a stale
 * entry through a detector the caller injects.
 *
 * The spec's invalidation rule is applied exactly: a cache is usable only when
 * both its document revision and the codex revision match the current ones. When
 * neither the cache nor a detector is available, the check that needs the count
 * is skipped and the run report names the document. It is never guessed at.
 */

import { cueTermsOf, type DocumentTerm } from '@caotang/codex';
import type { CodexEntry } from '@caotang/store';

/** codex.md §4's `MentionIndex`, the fields coherence reads. */
export interface MentionCount {
  readonly docRevision: number;
  /** Monotonic: the newest `updatedAt` among entries, as epoch milliseconds. */
  readonly codexRevision: number;
  /** Entry id to mention count in this document. */
  readonly hits: ReadonlyMap<string, number>;
}

/** The cached index for one document, or `undefined` when none has been built. */
export type MentionCacheSource = (docId: string) => MentionCount | undefined;

/** Counts hits for one body against the codex. Detection is codex's job, so the caller supplies it. */
/**
 * Counts each entry's mentions in one body. `terms` are the spellings the body adds beyond the codex's own, a screenplay's cue
 * names (codex `cueTermsOf`), so the detector counts a cue itself and nothing merges it in afterwards.
 */
export type MentionDetector = (body: string, entries: readonly CodexEntry[], terms?: readonly DocumentTerm[]) => ReadonlyMap<string, number>;

/** The newest entry update, as the number codex.md §4 keys its cache on. */
export function codexRevisionOf(entries: readonly CodexEntry[]): number {
  let newest = 0;
  for (const entry of entries) {
    if (entry.updatedAt === undefined) continue;
    const stamp = Date.parse(entry.updatedAt);
    if (!Number.isNaN(stamp) && stamp > newest) newest = stamp;
  }
  return newest;
}

export interface ResolvedMentions {
  /** Hits per scanned document. A document with no usable count is absent. */
  readonly hits: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Documents with neither a current cache nor a detector to rebuild one. */
  readonly unavailable: readonly string[];
  /** Documents whose cache was stale and was recomputed for this run. */
  readonly rebuilt: readonly string[];
}

/**
 * Resolves per-document counts for a scan. A current cache is used as it stands.
 * A stale or missing one is recomputed when a detector is supplied, and is
 * otherwise reported as unavailable.
 */
export function resolveMentions(
  scenes: readonly { readonly docId: string; readonly body: string; readonly revision: number; readonly kind?: string }[],
  entries: readonly CodexEntry[],
  source: MentionCacheSource | undefined,
  detector: MentionDetector | undefined,
): ResolvedMentions {
  const hits = new Map<string, ReadonlyMap<string, number>>();
  const unavailable: string[] = [];
  const rebuilt: string[] = [];
  const codexRevision = codexRevisionOf(entries);

  for (const scene of scenes) {
    const cached = source?.(scene.docId);
    if (cached !== undefined && cached.docRevision === scene.revision && cached.codexRevision === codexRevision) {
      hits.set(scene.docId, cached.hits);
      continue;
    }
    if (detector === undefined) {
      unavailable.push(scene.docId);
      continue;
    }
    // A screenplay's cue spellings are mentions of their entries (screenplay.md §4), and the detector counts them with the body.
    hits.set(scene.docId, detector(scene.body, entries, cueTermsOf(scene.kind, scene.body, entries)));
    rebuilt.push(scene.docId);
  }
  return { hits, unavailable, rebuilt };
}
