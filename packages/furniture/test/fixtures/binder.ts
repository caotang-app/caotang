/**
 * One small binder shared by the furniture tests.
 *
 *   root
 *   ├─ manuscript (folder)
 *   │  ├─ act1 (folder)
 *   │  │  ├─ ch1 (folder)
 *   │  │  │  ├─ s1 "The Landing"  draft · act-1 · sea, grief · 2143 words
 *   │  │  │  └─ s2 "Storm"        final · Sea           · 480 words
 *   │  │  └─ ch2 (folder)
 *   │  │     └─ s3 "Ledger"       draft                 · 120 words
 *   │  └─ act2 (folder)
 *   │     └─ s4 "Morning"        (no status) · grief    · 900 words
 *   └─ research (folder)
 *      └─ r1 "Archive"           draft · archive        · 300 words
 *
 * The array below is deliberately NOT in binder order: ch2 sits before ch1 and s4
 * comes first of the documents, so ordering tests fail if the index trusts the array.
 */
import { createBinderIndex, vocabularyIds, type FilterProbe } from '../../src/index.js';
import type { TreeNode } from '@caotang/store';

export const NOW = new Date('2026-10-08T12:00:00.000Z');

export const DAY_MS = 86_400_000;

export const VOCABULARY = {
  statuses: [
    { id: 'draft', name: 'Draft', color: '#8a8a8a' },
    { id: 'final', name: 'Final', color: '#3fa66a' },
  ],
  labels: [{ id: 'act-1', name: 'Act 1', color: '#d9a44a' }],
};

export const VOCAB_IDS = vocabularyIds(VOCABULARY);

export const WORD_COUNTS: Record<string, number> = {
  s1: 2143,
  s2: 480,
  s3: 120,
  s4: 900,
  r1: 300,
};

export const BODIES: Record<string, string> = {
  s1: 'The ferry was late, as always. Elena Voss stepped onto the quay.',
  s2: 'Rain beat the shutters all night.',
  s3: 'A ledger of tides, column by column.',
  s4: 'Elena waited at the window for the boat.',
  r1: 'Archival notes on the lighthouse log.',
};

function node(
  id: string,
  parentId: string | null,
  type: string,
  order: number,
  extra: Partial<TreeNode> = {},
): TreeNode {
  return {
    id,
    parentId,
    type,
    title: id,
    order,
    status: null,
    label: null,
    keywords: [],
    synopsis: '',
    notes: '',
    ...extra,
  };
}

export const BINDER: TreeNode[] = [
  node('s4', 'act2', 'document', 10, {
    title: 'Morning',
    keywords: ['grief'],
    synopsis: 'Quiet morning.',
    createdAt: '2026-10-08T11:00:00.000Z',
    updatedAt: '2026-10-08T12:00:30.000Z', // 30 s after NOW: clock skew, still recent
  }),
  node('ch2', 'act1', 'folder', 20, { title: 'Chapter 2', createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }),
  node('r1', 'research', 'document', 10, {
    title: 'Archive',
    status: 'draft',
    keywords: ['archive'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z', // exactly 7 × 24 h before NOW
  }),
  node('root', null, 'root', 0, { title: 'The Lighthouse Keeper' }),
  node('act2', 'manuscript', 'folder', 20, { title: 'Act Two' }),
  node('s1', 'ch1', 'document', 10, {
    title: 'The Landing',
    status: 'draft',
    label: 'act-1',
    keywords: ['sea', 'grief'],
    synopsis: 'Elena returns to the island.',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-07T20:00:00.000Z',
  }),
  node('manuscript', 'root', 'folder', 10, { title: 'Manuscript' }),
  node('research', 'root', 'folder', 20, { title: 'Research' }),
  node('act1', 'manuscript', 'folder', 10, { title: 'Act One' }),
  node('s3', 'ch2', 'document', 10, { title: 'Ledger', status: 'draft' }),
  node('ch1', 'act1', 'folder', 10, {
    title: 'Chapter 1',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }),
  node('s2', 'ch1', 'document', 20, {
    title: 'Storm',
    status: 'final',
    keywords: ['Sea'],
    synopsis: 'Rain and a broken shutter.',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
  }),
];

export const INDEX = createBinderIndex(BINDER, WORD_COUNTS);

/** A probe at `NOW` whose body reader is the fixture bodies. */
export function probeAt(now: Date = NOW, bodyOf: (docId: string) => string = (id) => BODIES[id] ?? ''): Omit<FilterProbe, 'wordsOf'> {
  return { bodyOf, now, vocabulary: VOCAB_IDS };
}

export function full(bodyOf?: (docId: string) => string): FilterProbe {
  return { ...probeAt(NOW, bodyOf), wordsOf: (id) => INDEX.wordsOf(id) };
}

export function byId(id: string): TreeNode {
  const found = INDEX.node(id);
  if (found === undefined) throw new Error(`fixture has no node ${id}`);
  return found;
}
