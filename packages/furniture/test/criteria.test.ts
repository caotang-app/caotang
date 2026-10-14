/**
 * One fixture per criterion, and one for their conjunction — binder-filters.md §2, §3, §2.1, §6.
 */
import type { TreeNode } from '@caotang/store';
import { describe, expect, it, vi } from 'vitest';

import { DAY_MS, NOW, VOCAB_IDS, BODIES, byId, full, probeAt, INDEX } from './fixtures/binder.js';
import {
  createBinderIndex,
  evaluateFilter,
  foldText,
  matchNode,
  type FilterCriteria,
  type FilterProbe,
} from '../src/index.js';

function probeWith(bodyOf: (id: string) => string = (id) => BODIES[id] ?? '', now: Date = NOW): FilterProbe {
  return { ...probeAt(now, bodyOf), wordsOf: (id) => INDEX.wordsOf(id) };
}

function match(id: string, criteria: FilterCriteria, probe: FilterProbe = full()): boolean {
  return matchNode(byId(id), criteria, probe);
}

function docNode(overrides: Partial<TreeNode>): TreeNode {
  return {
    id: 'n_TEST000001',
    parentId: 'ch1',
    type: 'document',
    title: 'Untitled',
    order: 10,
    status: null,
    label: null,
    keywords: [],
    synopsis: '',
    notes: '',
    ...overrides,
  };
}

describe('empty criteria and reserved roots', () => {
  it('matches every node that is not a reserved root (the reset state)', () => {
    for (const id of ['act1', 'ch1', 's1', 's2', 'ch2', 's3', 'act2', 's4', 'r1']) {
      expect(match(id, {}), id).toBe(true);
    }
  });

  it('never matches the project root, the manuscript root or the research root (§3)', () => {
    for (const id of ['root', 'manuscript', 'research']) {
      expect(match(id, {}), id).toBe(false);
    }
  });
});

describe('text (§2): case-insensitive substring over title, synopsis and body', () => {
  it('matches case-insensitively and without word boundaries', () => {
    expect(match('s1', { text: 'ELENA' })).toBe(true); // synopsis "Elena returns…"
    expect(match('s1', { text: 'Elen' })).toBe(true); // a prefix of the name, mid-word
    expect(match('s2', { text: 'elena' })).toBe(false);
  });

  it('searches all three surfaces by default: a body-only hit still matches', () => {
    // s4's title and synopsis do not say Elena; its body does.
    expect(match('s4', { text: 'elena' })).toBe(true);
    expect(match('s4', { text: 'elena', textIn: ['title', 'synopsis'] })).toBe(false);
  });

  it('restricts the search to the surfaces textIn names', () => {
    expect(match('s1', { text: 'elena', textIn: ['title'] })).toBe(false);
    expect(match('s1', { text: 'elena', textIn: ['synopsis'] })).toBe(true);
    expect(match('s1', { text: 'elena', textIn: ['body'] })).toBe(true);
  });

  it('treats an empty textIn as the default, all three surfaces', () => {
    expect(match('s4', { text: 'elena', textIn: [] })).toBe(true);
  });

  it('treats an empty text as no criterion at all', () => {
    expect(match('s2', { text: '' })).toBe(true);
  });

  it('applies canonical form, so a curly apostrophe matches a straight one (codex.md §4)', () => {
    const node = docNode({ synopsis: 'Elena’s boat is late.' });
    expect(matchNode(node, { text: "Elena's" }, probeWith())).toBe(true);
  });

  it('folds final sigma and long s to their base letters, as codex case folding does', () => {
    expect(foldText('ς')).toBe(foldText('Σ'));
    const node = docNode({ title: 'ſea', synopsis: '' });
    expect(matchNode(node, { text: 'sea', textIn: ['title'] }, probeWith())).toBe(true);
  });

  it('reads the body only for documents, never for a folder', () => {
    const spy = vi.fn((id: string) => BODIES[id] ?? '');
    expect(matchNode(byId('ch1'), { text: 'elena', textIn: ['body'] }, probeWith(spy))).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('never invokes bodyOf when text is absent or does not search the body (§3)', () => {
    const spy = vi.fn((id: string) => BODIES[id] ?? '');
    const probe = probeWith(spy);
    matchNode(byId('s1'), { statusId: 'draft' }, probe);
    matchNode(byId('s1'), { text: 'rain', textIn: ['title', 'synopsis'] }, probe);
    expect(spy).not.toHaveBeenCalled();
  });

  it('short-circuits: bodyOf is not read once an earlier criterion has failed', () => {
    const spy = vi.fn((id: string) => BODIES[id] ?? '');
    expect(matchNode(byId('s1'), { statusId: 'final', text: 'elena' }, probeWith(spy))).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('statusId and labelId (§2): exact vocabulary match', () => {
  it('matches the exact status and nothing else', () => {
    expect(match('s1', { statusId: 'draft' })).toBe(true);
    expect(match('s3', { statusId: 'draft' })).toBe(true);
    expect(match('s2', { statusId: 'draft' })).toBe(false);
  });

  it('never matches a node with no status', () => {
    expect(match('s4', { statusId: 'draft' })).toBe(false);
  });

  it('matches nothing for a since-deleted vocabulary id, even on a node that still carries it', () => {
    const orphaned = docNode({ status: 'retired' });
    expect(matchNode(orphaned, { statusId: 'retired' }, probeWith())).toBe(false);
  });

  it('matches labels by exact id, with the same vocabulary rule', () => {
    expect(match('s1', { labelId: 'act-1' })).toBe(true);
    expect(match('s2', { labelId: 'act-1' })).toBe(false);
    expect(matchNode(docNode({ label: 'act-9' }), { labelId: 'act-9' }, probeWith())).toBe(false);
  });
});

describe('keywordsAll and keywordsAny (§2): case-insensitive exact tag match', () => {
  it('keywordsAll requires every tag, matched case-insensitively', () => {
    expect(match('s1', { keywordsAll: ['SEA', 'grief'] })).toBe(true);
    expect(match('s2', { keywordsAll: ['sea', 'grief'] })).toBe(false); // s2 carries only "Sea"
    expect(match('s1', { keywordsAll: ['sea', 'missing'] })).toBe(false);
  });

  it('keywordsAny requires at least one tag', () => {
    expect(match('r1', { keywordsAny: ['archive', 'zzz'] })).toBe(true);
    expect(match('s1', { keywordsAny: ['zzz', 'yyy'] })).toBe(false);
  });

  it('matches tags exactly, not by substring', () => {
    expect(match('s1', { keywordsAll: ['se'] })).toBe(false);
  });

  it('holds both lists when both are present', () => {
    expect(match('s1', { keywordsAll: ['grief'], keywordsAny: ['sea'] })).toBe(true);
    expect(match('s4', { keywordsAll: ['grief'], keywordsAny: ['sea'] })).toBe(false);
  });

  it('treats an empty list as no constraint', () => {
    expect(match('s2', { keywordsAll: [], keywordsAny: [] })).toBe(true);
  });
});

describe('minWords and maxWords (§2): documents own count, folders subtree sum', () => {
  it('compares a document against its own count', () => {
    expect(match('s1', { minWords: 2000 })).toBe(true);
    expect(match('s2', { minWords: 2000 })).toBe(false);
    expect(match('s2', { maxWords: 500 })).toBe(true);
  });

  it('compares a folder against the sum of its descendant documents', () => {
    expect(INDEX.wordsOf('ch1')).toBe(2623); // s1 2143 + s2 480
    expect(INDEX.wordsOf('act1')).toBe(2743); // ch1 2623 + ch2 120
    expect(match('ch1', { minWords: 2600 })).toBe(true); // no single document reaches this
    expect(match('act1', { minWords: 2700 })).toBe(true);
    expect(match('ch2', { minWords: 200 })).toBe(false);
  });

  it('includes both bounds', () => {
    expect(match('s4', { minWords: 900, maxWords: 900 })).toBe(true);
    expect(match('s4', { minWords: 901 })).toBe(false);
    expect(match('s4', { maxWords: 899 })).toBe(false);
  });

  it('counts a document with no entry in derived.wordCounts as zero', () => {
    const unknown = docNode({ id: 'n_NOCOUNT000' });
    expect(matchNode(unknown, { maxWords: 0 }, probeWith())).toBe(true);
    expect(matchNode(unknown, { minWords: 1 }, probeWith())).toBe(false);
  });
});

describe('createdWithinDays and modifiedWithinDays (§2.1): a rolling window over injected now', () => {
  it('matches a node modified within the window', () => {
    // s1 was modified 2026-10-07T20:00 — 16 h before NOW — so a 1-day window holds it.
    expect(match('s1', { modifiedWithinDays: 1 })).toBe(true);
    expect(match('r1', { modifiedWithinDays: 1 })).toBe(false);
  });

  it('includes the window edge: a stamp exactly N × 24 h old still matches', () => {
    // r1 was modified 2026-10-01T12:00:00Z, exactly 7 × 24 h before NOW.
    expect(match('r1', { modifiedWithinDays: 7 })).toBe(true);
  });

  it('excludes a stamp one millisecond older than the edge', () => {
    const justOutside = docNode({ updatedAt: new Date(NOW.getTime() - 7 * DAY_MS - 1).toISOString() });
    expect(matchNode(justOutside, { modifiedWithinDays: 7 }, probeWith())).toBe(false);
  });

  it('counts a stamp later than now as recent (clock skew, or a now captured a moment early)', () => {
    // s4 was updated 30 s after NOW.
    expect(match('s4', { modifiedWithinDays: 1 })).toBe(true);
  });

  it('never matches a node with no timestamp (absent = never matches, §2.1)', () => {
    expect(match('s3', { modifiedWithinDays: 3650 })).toBe(false);
    expect(match('s3', { createdWithinDays: 3650 })).toBe(false);
  });

  it('never matches an unparseable timestamp', () => {
    const broken = docNode({ createdAt: 'yesterday, probably', updatedAt: 'yesterday, probably' });
    expect(matchNode(broken, { createdWithinDays: 3650, modifiedWithinDays: 3650 }, probeWith())).toBe(false);
  });

  it('evaluates a folder against its own node timestamps', () => {
    expect(match('ch1', { createdWithinDays: 7 })).toBe(true); // ch1 created 2026-10-02
    expect(match('ch1', { modifiedWithinDays: 7 })).toBe(false); // ch1 modified 2026-09-01
  });

  it('keys createdWithinDays on createdAt and modifiedWithinDays on updatedAt', () => {
    expect(match('s4', { createdWithinDays: 1 })).toBe(true);
    expect(match('s1', { createdWithinDays: 1 })).toBe(false); // s1 created 2026-09-01
  });

  it('depends on the injected now and nothing else', () => {
    const later = new Date(NOW.getTime() + 60 * DAY_MS);
    expect(matchNode(byId('s1'), { modifiedWithinDays: 1 }, probeWith(undefined, later))).toBe(false);
    expect(matchNode(byId('s1'), { modifiedWithinDays: 1 }, probeWith(undefined, NOW))).toBe(true);
  });
});

describe('conjunction (§3): every present criterion must hold', () => {
  it('requires all present criteria', () => {
    const criteria: FilterCriteria = { statusId: 'draft', labelId: 'act-1', keywordsAny: ['sea'] };
    expect(match('s1', criteria)).toBe(true);
    expect(match('s1', { ...criteria, keywordsAny: ['nope'] })).toBe(false);
    expect(match('s1', { ...criteria, statusId: 'final' })).toBe(false);
  });

  it('combines a word bound with a date window', () => {
    // s1 is long and was touched 16 h ago; s2 is short and was touched in September.
    expect(match('s1', { minWords: 2000, modifiedWithinDays: 1 })).toBe(true);
    expect(match('s2', { minWords: 2000, modifiedWithinDays: 1 })).toBe(false);
  });
});

describe('the fixture is the one the matcher is measured against', () => {
  it('reports the subtree sums the word criteria above rely on', () => {
    expect(INDEX.wordsOf('manuscript')).toBe(3643);
    expect(INDEX.wordsOf('research')).toBe(300);
  });

  it('carries the vocabulary the status and label criteria are checked against', () => {
    expect(VOCAB_IDS.statusIds.has('draft')).toBe(true);
    expect(VOCAB_IDS.labelIds.has('act-1')).toBe(true);
  });
});

describe('matching cost stays linear in nodes and tags (criteria are folded once per pass)', () => {
  it('matches 20 000 unclamped tags over 500 nodes in well under a second', () => {
    const keywords = Array.from({ length: 32 }, (_, i) => `keyword ${i}`);
    const tree: TreeNode[] = [
      { id: 'root', parentId: null, type: 'root', title: 'Root', order: 0, status: null, label: null, keywords: [], synopsis: '', notes: '' },
      { id: 'bulk', parentId: 'root', type: 'folder', title: 'Bulk', order: 10, status: null, label: null, keywords: [], synopsis: '', notes: '' },
      ...Array.from({ length: 500 }, (_, i) => docNode({ id: `n_BULK${String(i).padStart(5, '0')}`, parentId: 'bulk', order: (i + 1) * 10, keywords })),
    ];
    const index = createBinderIndex(tree);
    // Load clamps tag lists to 32 (binder-filters §2), so this bypasses the loader on purpose: it
    // measures the matcher's own cost, which must not grow as tags × nodes.
    const tags = Array.from({ length: 20_000 }, (_, i) => `missing ${i}`);

    const started = performance.now();
    const result = evaluateFilter({ criteria: { keywordsAny: tags } }, index, { bodyOf: () => '', now: NOW, vocabulary: VOCAB_IDS });
    const elapsed = performance.now() - started;

    expect(result.matched).toEqual([]);
    expect(elapsed).toBeLessThan(1000);
  });
});
