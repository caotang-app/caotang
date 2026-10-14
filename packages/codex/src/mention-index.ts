/**
 * The per-document mention cache — [codex.md §4](../../../docs/architecture/codex.md),
 * "Implementation & performance".
 *
 * Scanning a manuscript is the expensive part of detection, and its result changes only
 * when something it depends on changes. So each document's counts are cached and
 * recomputed only when one of two revisions moves: the document's own (`docRevision`,
 * the store's per-document counter) or the codex's (`codexRevision`, bumped by the
 * owner after every codex write).
 *
 * The codex revision is a counter and not the spec's "max entry updatedAt". Deleting
 * the newest entry lowers a maximum, and a lowered value can equal one already cached,
 * which would serve a stale count. A counter only goes up.
 *
 * The index is built lazily. Nothing is scanned until a count is asked for, so a
 * document that is never assembled into a prompt is never scanned.
 */

import type { CodexEntry } from '@caotang/store';
import { cueTermsOf } from './cues.js';
import {
  compileCodex,
  scanMentions,
  type CompiledCodex,
  type DetectionHit,
  type DetectionResult,
} from './detect.js';

/** One document as the index sees it. The fields come from the store's state. */
export interface IndexedDoc {
  readonly id: string;
  /** `getRevision(state, id)`: bumped on every body mutation. */
  readonly revision: number;
  /** `getBody(state, id)`: the body projection, no front matter. */
  readonly body: string;
  /**
   * The document's kind (`node.kind`). A screenplay's character cues are mentions too (screenplay.md §4), so the index counts
   * their spellings with the document (cues.ts). Absent for any other document.
   */
  readonly kind?: string;
}

export interface MentionIndexStats {
  /** Document scans run since the index was created. A cache hit does not count. */
  readonly documentPasses: number;
  /** Codex compilations run since the index was created. One per codex revision in use. */
  readonly compilations: number;
}

export interface MentionIndex {
  /** The current codex revision. Starts at 0. */
  readonly codexRevision: number;
  readonly stats: MentionIndexStats;
  /**
   * Call after every codex write (`codex.write`, the codex panel). Every cached count
   * becomes stale and is recomputed on its next request. Returns the new revision.
   */
  bumpCodexRevision(): number;
  /**
   * Mention counts for one document. Scans on the first request, and again whenever
   * the document's revision or the codex revision has moved since the last scan.
   *
   * `entries` must be the codex as of the current codex revision. Changing the entries
   * without bumping the revision serves stale counts, and that is the caller's
   * contract to keep.
   */
  hits(doc: IndexedDoc, entries: readonly CodexEntry[]): ReadonlyMap<string, number>;
  /**
   * The body offset of each entry's first mention in one document, from the same scan that gave its
   * counts (codex-panels.md §1, `firstOffset`). An entry with no mention is absent. Cached with the counts,
   * so asking for it never scans a document twice, and it is invalidated exactly as the counts are.
   */
  firstOffsets(doc: IndexedDoc, entries: readonly CodexEntry[]): ReadonlyMap<string, number>;
  /** The cached counts as a `DetectionResult`, each hit attributed to `doc.id`. */
  detectionFor(doc: IndexedDoc, entries: readonly CodexEntry[]): DetectionResult;
  /**
   * The sum of cached counts over the given documents. A missing or stale cache adds
   * nothing, so a read never triggers a scan. It reports what is already known.
   */
  cachedTotals(docs: readonly Pick<IndexedDoc, 'id' | 'revision'>[]): Map<string, number>;
  /** Drop one document's cache, for a document that was deleted. */
  forget(docId: string): void;
}

interface CachedDoc {
  readonly docRevision: number;
  readonly codexRevision: number;
  readonly hits: ReadonlyMap<string, number>;
  readonly firstOffsets: ReadonlyMap<string, number>;
}

export function createMentionIndex(): MentionIndex {
  let codexRevision = 0;
  let compiled: CompiledCodex | undefined;
  let compiledAt = -1;
  let documentPasses = 0;
  let compilations = 0;
  const docs = new Map<string, CachedDoc>();

  const isFresh = (cached: CachedDoc, docRevision: number): boolean =>
    cached.docRevision === docRevision && cached.codexRevision === codexRevision;

  // Compile lazily and once per codex revision. The normalised terms are the same
  // for every document until the codex changes.
  const compile = (entries: readonly CodexEntry[]): CompiledCodex => {
    if (compiled === undefined || compiledAt !== codexRevision) {
      compiled = compileCodex(entries);
      compiledAt = codexRevision;
      compilations += 1;
    }
    return compiled;
  };

  // A named function, not a method that reads `this`, so a caller may destructure the
  // index without losing it.
  const scanned = (doc: IndexedDoc, entries: readonly CodexEntry[]): CachedDoc => {
    const cached = docs.get(doc.id);
    if (cached !== undefined && isFresh(cached, doc.revision)) return cached;
    // The cue spellings are derived from the body and the codex, both of which the cache's two revisions cover.
    const { counts, firstOffsets } = scanMentions(doc.body, compile(entries), cueTermsOf(doc.kind, doc.body, entries));
    documentPasses += 1;
    const fresh: CachedDoc = { docRevision: doc.revision, codexRevision, hits: counts, firstOffsets };
    docs.set(doc.id, fresh);
    return fresh;
  };

  const hitsFor = (doc: IndexedDoc, entries: readonly CodexEntry[]): ReadonlyMap<string, number> => scanned(doc, entries).hits;

  return {
    get codexRevision() {
      return codexRevision;
    },

    get stats(): MentionIndexStats {
      return { documentPasses, compilations };
    },

    bumpCodexRevision(): number {
      codexRevision += 1;
      return codexRevision;
    },

    hits: hitsFor,

    firstOffsets: (doc, entries) => scanned(doc, entries).firstOffsets,

    detectionFor(doc, entries) {
      const found = new Map<string, DetectionHit>();
      for (const [entryId, count] of hitsFor(doc, entries)) {
        found.set(entryId, { count, where: [doc.id] });
      }
      return found;
    },

    cachedTotals(refs) {
      const totals = new Map<string, number>();
      for (const ref of refs) {
        const cached = docs.get(ref.id);
        if (cached === undefined || !isFresh(cached, ref.revision)) continue;
        for (const [entryId, count] of cached.hits) {
          totals.set(entryId, (totals.get(entryId) ?? 0) + count);
        }
      }
      return totals;
    },

    forget(docId) {
      docs.delete(docId);
    },
  };
}
