/**
 * Include-policy candidate selection (codex.md §5–§6), folder attachments over the
 * binder tree, and the deterministic order.
 */
import type { CodexEntry, CodexIncludePolicy, TreeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  expandAttachments,
  focusScope,
  selectCandidates,
  type CandidateInput,
  type DetectionHit,
} from '../src/index.js';
import { entry } from './fixtures/detection-corpus.js';

function node(id: string, parentId: string | null, type = 'document'): TreeNode {
  return {
    id,
    parentId,
    type,
    title: id,
    order: 10,
    status: null,
    label: null,
    keywords: [],
    synopsis: '',
    notes: '',
  };
}

/**
 * root
 * └─ manuscript
 *    ├─ act1 (folder)
 *    │  ├─ ch1
 *    │  └─ ch2
 *    └─ act2 (folder)
 *       ├─ ch3
 *       └─ sub (folder)
 *          └─ ch4
 */
const TREE: TreeNode[] = [
  node('root', null, 'root'),
  node('manuscript', 'root', 'folder'),
  node('act1', 'manuscript', 'folder'),
  node('ch1', 'act1'),
  node('ch2', 'act1'),
  node('act2', 'manuscript', 'folder'),
  node('ch3', 'act2'),
  node('sub', 'act2', 'folder'),
  node('ch4', 'sub'),
];

/** Mention hits keyed by entry id, each one mention in `ch1`. */
function mentioned(...ids: string[]): Map<string, DetectionHit> {
  return new Map(ids.map((id) => [id, { count: 1, where: ['ch1'] }]));
}

function select(overrides: Partial<CandidateInput> & Pick<CandidateInput, 'entries'>) {
  return selectCandidates({ tree: TREE, detected: new Map(), ...overrides });
}

function names(list: readonly { entry: CodexEntry }[]): string[] {
  return list.map((c) => c.entry.name);
}

describe('selectCandidates — include policy (codex.md §5)', () => {
  it('includes an always entry without any mention', () => {
    const result = select({ entries: [entry('Harbor', { includePolicy: 'always' })], focusDocId: 'ch1' });
    expect(result.candidates.map((c) => c.reason)).toEqual([{ kind: 'always' }]);
  });

  it('includes a detected entry only when it is mentioned, and reports the mention', () => {
    const result = select({
      entries: [entry('Elena'), entry('Bob')],
      detected: new Map([['c_Elena', { count: 2, where: ['ch1'] }]]),
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([
      { entry: entry('Elena'), reason: { kind: 'detected', count: 2, where: ['ch1'] } },
    ]);
  });

  it('removes a never entry even when it is mentioned, and records the removal', () => {
    const result = select({
      entries: [entry('Oracle', { includePolicy: 'never' })],
      detected: mentioned('c_Oracle'),
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([]);
    expect(result.suppressed.map((s) => [s.entry.name, s.reason])).toEqual([['Oracle', 'never']]);
  });

  it('does not record a never entry that was not mentioned', () => {
    const result = select({ entries: [entry('Oracle', { includePolicy: 'never' })], focusDocId: 'ch1' });
    expect(result.suppressed).toEqual([]);
  });

  it('suppresses a manual entry that is mentioned but not attached to the focus scope', () => {
    const result = select({
      entries: [entry('Ghost', { includePolicy: 'manual' })],
      detected: mentioned('c_Ghost'),
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([]);
    expect(result.suppressed.map((s) => [s.entry.name, s.reason])).toEqual([['Ghost', 'manual-unattached']]);
  });

  it('includes a manual entry attached to the focus document, mentioned or not', () => {
    const result = select({
      entries: [entry('Mirror', { includePolicy: 'manual', attachments: ['ch1'] })],
      focusDocId: 'ch1',
    });
    expect(result.candidates.map((c) => c.reason)).toEqual([{ kind: 'attached', via: 'ch1' }]);
  });

  it('reaches every document under an attached folder, and names the folder as the route', () => {
    const entries = [entry('Gandalf', { includePolicy: 'manual', attachments: ['act1'] })];
    const fromCh1 = select({ entries, focusDocId: 'ch1' });
    const fromCh2 = select({ entries, focusDocId: 'ch2' });
    expect(fromCh1.candidates.map((c) => c.reason)).toEqual([{ kind: 'attached', via: 'act1' }]);
    expect(fromCh2.candidates.map((c) => c.reason)).toEqual([{ kind: 'attached', via: 'act1' }]);
  });

  it('expands a folder attachment through several levels of the tree', () => {
    const entries = [entry('Deep', { includePolicy: 'manual', attachments: ['act2'] })];
    const result = select({ entries, focusDocId: 'ch4' });
    expect(result.candidates.map((c) => c.reason)).toEqual([{ kind: 'attached', via: 'act2' }]);
  });

  it('routes through the nearest attachment when several reach the focus', () => {
    const result = select({
      entries: [entry('Nearest', { includePolicy: 'manual', attachments: ['act1', 'ch2'] })],
      focusDocId: 'ch2',
    });
    expect(result.candidates.map((c) => c.reason)).toEqual([{ kind: 'attached', via: 'ch2' }]);
  });

  it('does not reach a sibling folder, and records nothing for an unmentioned entry', () => {
    const result = select({
      entries: [entry('Sword', { includePolicy: 'manual', attachments: ['act2'] })],
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });

  it('does not let an attachment make a detected entry a candidate', () => {
    const result = select({
      entries: [entry('Wolf', { attachments: ['ch1'] })],
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([]);
  });

  it('attaches nothing without a focus document', () => {
    const result = select({
      entries: [entry('Mirror', { includePolicy: 'manual', attachments: ['ch1'] })],
      detected: mentioned('c_Mirror'),
    });
    expect(result.candidates).toEqual([]);
    expect(result.suppressed.map((s) => s.reason)).toEqual(['manual-unattached']);
  });

  it('treats an unknown policy as detected, the load-time coercion of §2', () => {
    const odd = entry('Odd', { includePolicy: 'sometimes' as CodexIncludePolicy });
    const result = select({ entries: [odd], detected: mentioned('c_Odd'), focusDocId: 'ch1' });
    expect(result.candidates.map((c) => c.reason.kind)).toEqual(['detected']);
  });
});

describe('selectCandidates — empty descriptions (codex.md §2)', () => {
  it('drops a matched entry whose description is blank, and records the drop', () => {
    const result = select({
      entries: [entry('Empty', { description: '   ' }), entry('Old', { description: '', includePolicy: 'always' })],
      detected: mentioned('c_Empty'),
      focusDocId: 'ch1',
    });
    expect(result.candidates).toEqual([]);
    // Suppressed entries are listed in codex order too, so `always` leads.
    expect(result.suppressed.map((s) => [s.entry.name, s.reason])).toEqual([
      ['Old', 'empty-description'],
      ['Empty', 'empty-description'],
    ]);
  });
});

describe('selectCandidates — an entry loaded without a description', () => {
  it('treats it as empty: the matched entry is dropped and the drop is recorded', () => {
    const gap = { ...entry('Gap'), description: undefined } as unknown as CodexEntry;
    const result = select({ entries: [gap], detected: mentioned('c_Gap'), focusDocId: 'ch1' });
    expect(result.candidates).toEqual([]);
    expect(result.suppressed.map((s) => s.reason)).toEqual(['empty-description']);
  });
});

describe('selectCandidates — order (codex.md §6 step 3)', () => {
  it('lists always first, then type in enum order, then name', () => {
    const result = select({
      entries: [
        entry('Zed', { type: 'other', includePolicy: 'always' }),
        entry('Brook', { type: 'location' }),
        entry('Ana', { type: 'character' }),
        entry('Mirror', { type: 'object' }),
        entry('Garden', { type: 'location', includePolicy: 'always' }),
      ],
      detected: mentioned('c_Zed', 'c_Brook', 'c_Ana', 'c_Mirror', 'c_Garden'),
    });
    expect(names(result.candidates)).toEqual(['Garden', 'Zed', 'Ana', 'Brook', 'Mirror']);
  });

  it('gives the same candidates whatever order the codex is supplied in', () => {
    const entries = [
      entry('Ana', { includePolicy: 'always' }),
      entry('Bo'),
      entry('Cy', { type: 'location' }),
      entry('Di', { includePolicy: 'manual', attachments: ['ch1'] }),
    ];
    const detected = mentioned('c_Bo', 'c_Cy', 'c_Di');
    const forward = select({ entries, detected, focusDocId: 'ch1' });
    const reverse = select({ entries: [...entries].reverse(), detected, focusDocId: 'ch1' });
    expect(names(reverse.candidates)).toEqual(names(forward.candidates));
  });
});

describe('focusScope', () => {
  it('lists the focus document and then its ancestors, nearest first', () => {
    expect(focusScope(TREE, 'ch2')).toEqual(['ch2', 'act1', 'manuscript', 'root']);
  });

  it('yields only the id when it is not in the tree', () => {
    expect(focusScope(TREE, 'ghost')).toEqual(['ghost']);
  });

  it('stops on a parent cycle instead of looping', () => {
    const cyclic = [node('a', 'b'), node('b', 'a')];
    expect(focusScope(cyclic, 'a')).toEqual(['a', 'b']);
  });
});

describe('expandAttachments', () => {
  it('reaches a folder and every descendant of it, and no sibling', () => {
    const reached = expandAttachments([entry('Deep', { attachments: ['act2'] })], TREE);
    for (const id of ['act2', 'ch3', 'sub', 'ch4']) {
      expect(reached.get(id)?.map((e) => e.name), id).toEqual(['Deep']);
    }
    expect(reached.get('ch1')).toBeUndefined();
  });

  it('agrees with candidate selection for every document in the tree', () => {
    // Two directions of one relation: expansion from the attachment, and selection from
    // the focus. If they ever disagree, the inspector's chips and the prompt disagree.
    const entries = [
      entry('Gandalf', { includePolicy: 'manual', attachments: ['act1'] }),
      entry('Mirror', { includePolicy: 'manual', attachments: ['ch3'] }),
      entry('Deep', { includePolicy: 'manual', attachments: ['sub'] }),
      entry('Sword', { includePolicy: 'manual', attachments: ['act2', 'ch1'] }),
      entry('Wolf', { attachments: ['manuscript'] }),
    ];
    const reached = expandAttachments(entries, TREE);
    for (const doc of TREE.filter((n) => n.type === 'document')) {
      const fromExpansion = (reached.get(doc.id) ?? [])
        .filter((e) => e.includePolicy === 'manual')
        .map((e) => e.name)
        .sort();
      const fromSelection = names(select({ entries, focusDocId: doc.id }).candidates)
        .filter((name) => entries.find((e) => e.name === name)?.includePolicy === 'manual')
        .sort();
      expect(fromSelection, doc.id).toEqual(fromExpansion);
    }
  });
});
