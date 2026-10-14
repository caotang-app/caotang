/**
 * The per-document mention cache: lazy, keyed by the document revision and the codex
 * revision, and never a different answer from a direct detect.
 */
import { describe, expect, it } from 'vitest';

import { createMentionIndex, detect, type IndexedDoc } from '../src/index.js';
import { entry } from './fixtures/detection-corpus.js';

const elena = entry('Elena');

function doc(id: string, revision: number, body: string): IndexedDoc {
  return { id, revision, body };
}

describe('MentionIndex — laziness and the document revision (codex.md §4)', () => {
  it('scans nothing until a count is asked for', () => {
    const index = createMentionIndex();
    expect(index.stats).toEqual({ documentPasses: 0, compilations: 0 });
  });

  it('scans a document once, then serves the cached counts while nothing has moved', () => {
    const index = createMentionIndex();
    const first = index.hits(doc('d1', 1, 'Elena walks. Elena talks.'), [elena]);
    expect(first.get('c_Elena')).toBe(2);
    const second = index.hits(doc('d1', 1, 'Elena walks. Elena talks.'), [elena]);
    expect(second).toBe(first);
    expect(index.stats.documentPasses).toBe(1);
  });

  it('rescans a document when its revision moves', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    const after = index.hits(doc('d1', 2, 'Elena and Elena'), [elena]);
    expect(after.get('c_Elena')).toBe(2);
    expect(index.stats.documentPasses).toBe(2);
  });

  it('rescans only the document that changed, since each document has its own cache', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    index.hits(doc('d2', 1, 'Elena Elena'), [elena]);
    index.hits(doc('d1', 2, 'Elena'), [elena]);
    expect(index.stats.documentPasses).toBe(3);
    index.hits(doc('d2', 1, 'Elena Elena'), [elena]);
    expect(index.stats.documentPasses).toBe(3);
  });

  it('compiles the codex once and reuses it for every document at one revision', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    index.hits(doc('d2', 1, 'Elena'), [elena]);
    index.hits(doc('d3', 1, 'Elena'), [elena]);
    expect(index.stats).toEqual({ documentPasses: 3, compilations: 1 });
  });

  it('forgets a deleted document, so its next request is a fresh scan', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    index.forget('d1');
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    expect(index.stats.documentPasses).toBe(2);
  });
});

describe('MentionIndex — the codex revision (codex.md §4 invalidation)', () => {
  it('starts at revision 0, and bump returns the new value', () => {
    const index = createMentionIndex();
    expect(index.codexRevision).toBe(0);
    expect(index.bumpCodexRevision()).toBe(1);
    expect(index.codexRevision).toBe(1);
  });

  it('invalidates every cached document when the codex changes, and the new codex is what gets scanned', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena Lena'), [elena]);
    index.hits(doc('d2', 1, 'Elena'), [elena]);

    index.bumpCodexRevision();
    // "Lena" is an alias added after d1 was cached. It has to show up in d1 without
    // d1's revision changing.
    const withAlias = [entry('Elena', { aliases: ['Lena'] })];
    expect(index.hits(doc('d1', 1, 'Elena Lena'), withAlias).get('c_Elena')).toBe(2);
    expect(index.stats).toEqual({ documentPasses: 3, compilations: 2 });
  });

  it('reports a document cached before the codex changed as absent from cached totals', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    expect(index.cachedTotals([{ id: 'd1', revision: 1 }]).get('c_Elena')).toBe(1);

    index.bumpCodexRevision();
    expect(index.cachedTotals([{ id: 'd1', revision: 1 }]).get('c_Elena')).toBeUndefined();
  });
});

describe('MentionIndex — detection results and totals', () => {
  it('attributes a document scan to that document as a detection', () => {
    const index = createMentionIndex();
    const found = index.detectionFor(doc('ch1', 1, 'Elena and Elena'), [elena]);
    expect(found.get('c_Elena')).toEqual({ count: 2, where: ['ch1'] });
  });

  it('reports no entry for a document without mentions', () => {
    const index = createMentionIndex();
    expect(index.detectionFor(doc('ch1', 1, 'nothing here'), [elena]).size).toBe(0);
  });

  it('gives the same counts as a direct detect over the same text', () => {
    // The cache is an optimisation and must never be a different answer.
    const text = 'Elena met Lena at the harbor. Elenas house. ELENA left.';
    const entries = [entry('Elena', { aliases: ['Lena'] }), entry('Harbor')];
    const index = createMentionIndex();
    const cached = Object.fromEntries(
      [...index.hits(doc('d', 1, text), entries)].map(([id, count]) => [id, count]),
    );
    const direct = Object.fromEntries(
      [...detect([{ id: 'd', text }], entries)].map(([id, hit]) => [id, hit.count]),
    );
    expect(cached).toEqual(direct);
  });

  it('sums cached counts across documents, and skips a document never scanned', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    index.hits(doc('d2', 1, 'Elena Elena'), [elena]);
    const totals = index.cachedTotals([
      { id: 'd1', revision: 1 },
      { id: 'd2', revision: 1 },
      { id: 'd3', revision: 1 },
    ]);
    expect(totals.get('c_Elena')).toBe(3);
  });

  it('ignores a cache whose document revision has moved on', () => {
    const index = createMentionIndex();
    index.hits(doc('d1', 1, 'Elena'), [elena]);
    expect(index.cachedTotals([{ id: 'd1', revision: 2 }]).get('c_Elena')).toBeUndefined();
  });

  it('reads totals without scanning anything', () => {
    const index = createMentionIndex();
    index.cachedTotals([{ id: 'd1', revision: 1 }]);
    expect(index.stats.documentPasses).toBe(0);
  });
});
