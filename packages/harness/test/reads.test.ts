/**
 * The four read tools, and the disambiguation rule their document references share.
 * Reads dispatch nothing, so every case also checks that the snapshot is unchanged.
 */

import { countBody, createEmptyManifest, createProjectState, addDocument, addFolder } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  CHAPTER_ONE,
  CHAPTER_TWO,
  LANDING,
  LANDING_BODY,
  OPENED,
  STORM,
  makeHarness,
  makeState,
  refusalOf,
  run,
  snapshotOf,
  valueOf,
} from './fixtures.js';

const STORM_BODY = 'Rain.\n\n***\n\nThe lamp failed.';

interface OverviewData {
  readonly title: string;
  readonly empty: boolean;
  readonly tree: { readonly id: string; readonly children: { readonly id: string }[] }[];
  readonly vocabulary: { readonly statuses: { readonly id: string }[] };
  readonly totalWords: number;
}

describe('project.overview', () => {
  it('reports the title, the two-level tree, the vocabulary and the word total', () => {
    const state = makeState();
    const harness = makeHarness({}, state);
    const data = valueOf(run(harness, 'project.overview', {})).data as unknown as OverviewData;
    expect(data['title']).toBe('The Lighthouse Keeper');
    expect(data['empty']).toBe(false);
    // Root's children (manuscript, research), then their children (the chapters). Documents sit deeper.
    const manuscript = data.tree.find((node) => node.id === 'manuscript');
    expect(manuscript?.children.map((node) => node.id)).toEqual([CHAPTER_ONE, CHAPTER_TWO]);
    expect(JSON.stringify(data['tree'])).not.toContain(LANDING);
    expect(data['vocabulary'].statuses.map((term: { id: string }) => term.id)).toEqual(['draft', 'revised', 'final']);
    const expected = countBody(LANDING_BODY).words + countBody(STORM_BODY).words + countBody('').words;
    expect(data['totalWords']).toBe(expected);
  });

  it('reports the session as null when the app supplies no session progress', () => {
    const data = valueOf(run(makeHarness(), 'project.overview', {})).data as Record<string, unknown>;
    expect(data['session']).toBeNull();
  });

  it('reports the session progress the app supplies, and the target when there is one', () => {
    const harness = makeHarness({ session: () => ({ todayWords: 420, target: 1000 }) });
    const data = valueOf(run(harness, 'project.overview', {})).data as Record<string, unknown>;
    expect(data['session']).toEqual({ todayWords: 420, target: 1000 });
  });

  it('returns a skeleton with the next step when the project has no documents', () => {
    const state = createProjectState(createEmptyManifest('Empty', OPENED));
    const outcome = valueOf(run(makeHarness({}, state), 'project.overview', {}));
    expect(outcome.data['empty']).toBe(true);
    expect(outcome.notes?.join(' ')).toContain('binder.restructure');
  });

  it('reports goals as name and target, and says that progress is not yet computed', () => {
    const state = makeState();
    // A goal has no name of its own (goals-progress §2.2): the name the overview gives is its target's title.
    state.manifest.goals = [
      {
        id: 'g_GRANT00001',
        nodeId: 'manuscript',
        metric: 'words',
        comparator: 'at-least',
        target: 40000,
        createdAt: OPENED.toISOString(),
        updatedAt: OPENED.toISOString(),
      },
    ];
    const outcome = valueOf(run(makeHarness({}, state), 'project.overview', {}));
    const manuscriptTitle = state.manifest.tree.find((node) => node.id === 'manuscript')?.title;
    expect(outcome.data['goals']).toEqual([{ id: 'g_GRANT00001', name: manuscriptTitle, target: 40000 }]);
    expect(outcome.notes?.join(' ')).toContain('Progress and pace');
  });

  it('counts saved filters from the manifest', () => {
    const state = makeState();
    state.manifest.filters = [{ id: 'f_1', name: 'Drafts', criteria: {}, createdAt: OPENED.toISOString(), updatedAt: OPENED.toISOString() }];
    const data = valueOf(run(makeHarness({}, state), 'project.overview', {})).data as Record<string, unknown>;
    expect(data['savedFilters']).toBe(1);
  });

  it('reads without changing the project', () => {
    const state = makeState();
    const before = snapshotOf(state);
    run(makeHarness({}, state), 'project.overview', {});
    expect(snapshotOf(state)).toBe(before);
  });
});

describe('binder.read_tree', () => {
  it('reads from the root two levels down by default, with word counts', () => {
    const data = valueOf(run(makeHarness(), 'binder.read_tree', {})).data as { nodes: { id: string; depth: number; words?: number }[] };
    // Depth-first in binder order: each folder's children follow it before its next sibling.
    expect(data.nodes.map((node) => [node.id, node.depth])).toEqual([
      ['root', 0],
      ['manuscript', 1],
      [CHAPTER_ONE, 2],
      [CHAPTER_TWO, 2],
      ['research', 1],
    ]);
    const chapterOne = data.nodes.find((node) => node.id === CHAPTER_ONE);
    expect(chapterOne?.words).toBe(countBody(LANDING_BODY).words + countBody(STORM_BODY).words);
  });

  it('starts from a named node and goes deeper when asked', () => {
    const data = valueOf(run(makeHarness(), 'binder.read_tree', { root: CHAPTER_ONE, depth: 3 })).data as { nodes: { id: string }[] };
    expect(data.nodes.map((node) => node.id)).toEqual([CHAPTER_ONE, LANDING, STORM]);
  });

  it('includes the synopsis and no counts when asked for the synopsis', () => {
    const data = valueOf(run(makeHarness(), 'binder.read_tree', { root: CHAPTER_ONE, depth: 1, include: 'synopsis' })).data as {
      nodes: Record<string, unknown>[];
    };
    const landing = data.nodes.find((node) => node['id'] === LANDING);
    expect(landing?.['synopsis']).toBe('Elena returns to the island.');
    expect('words' in (landing ?? {})).toBe(false);
  });

  it('refuses an unknown root and names project.overview as the place to look', () => {
    const error = refusalOf(run(makeHarness(), 'binder.read_tree', { root: 'n_MSSNG00001' }));
    expect(error.code).toBe('not-found');
    expect(error.correctiveHint).toContain('project.overview');
  });

  it('truncates a response over its cap, says so, and names a narrower root', () => {
    const state = createProjectState(createEmptyManifest('Long', OPENED));
    addFolder(state, { parentId: 'manuscript', title: 'Everything', now: OPENED, id: 'n_EVERYTHNG1' });
    for (let index = 0; index < 400; index += 1) {
      addDocument(state, {
        parentId: 'n_EVERYTHNG1',
        title: `Scene number ${index} with a long descriptive title that takes up room in every row`,
        now: OPENED,
      });
    }
    const outcome = valueOf(run(makeHarness({}, state), 'binder.read_tree', { root: 'n_EVERYTHNG1', depth: 1 }));
    expect(outcome.data['truncated']).toBe(true);
    expect(String(outcome.data['note'])).toContain('Narrow root');
    expect((outcome.data['nodes'] as unknown[]).length).toBeLessThan(Number(outcome.data['total']));
  });
});

describe('doc.read', () => {
  it('reads the whole body by default, in the body projection the anchors use', () => {
    const data = valueOf(run(makeHarness(), 'doc.read', { doc: LANDING })).data as { text: string; format: string };
    expect(data.format).toBe('detailed');
    expect(data.text).toBe(LANDING_BODY);
  });

  it('reads a range, clamped to the end of the body, and says so', () => {
    const outcome = valueOf(run(makeHarness(), 'doc.read', { doc: LANDING, range: { from: 4, to: 999 } }));
    expect(outcome.data['text']).toBe(LANDING_BODY.slice(4));
    expect(outcome.notes?.join(' ')).toContain('clamped');
  });

  it('reads a range that starts past the end as empty, and says so', () => {
    const outcome = valueOf(run(makeHarness(), 'doc.read', { doc: LANDING, range: { from: 500, to: 600 } }));
    expect(outcome.data['text']).toBe('');
    expect(outcome.notes?.join(' ')).toContain('starts past the end');
  });

  it('refuses a range whose from is past its to', () => {
    const error = refusalOf(run(makeHarness(), 'doc.read', { doc: LANDING, range: { from: 9, to: 2 } }));
    expect(error.code).toBe('invalid-params');
    expect(error.correctiveHint).toContain('ranges run forward');
  });

  it('returns structure and a lead for a concise read, with scenes counted from the *** separators', () => {
    const data = valueOf(run(makeHarness(), 'doc.read', { doc: STORM, response_format: 'concise' })).data as {
      format: string;
      structure: { scenes: number; paragraphs: number };
      lead: string;
    };
    expect(data.format).toBe('concise');
    expect(data.structure.scenes).toBe(2);
    expect(data.structure.paragraphs).toBe(3);
    expect(data.lead.startsWith('Rain.')).toBe(true);
  });

  it('forces a concise read for a document over its cap, with a note', () => {
    const state = makeState();
    addDocument(state, { parentId: CHAPTER_TWO, title: 'Huge', now: OPENED, id: 'n_HEAVYDCK01', body: 'word '.repeat(30000) });
    const outcome = valueOf(run(makeHarness({}, state), 'doc.read', { doc: 'n_HEAVYDCK01' }));
    expect(outcome.data['format']).toBe('concise');
    expect(outcome.notes?.join(' ')).toContain('over the 25000-token cap');
  });

  it('finds a document by its title, case-insensitively', () => {
    expect(valueOf(run(makeHarness(), 'doc.read', { doc: 'the landing' })).data['doc']).toEqual({ id: LANDING, title: 'The Landing' });
  });

  it('finds a document by a unique title prefix', () => {
    expect(valueOf(run(makeHarness(), 'doc.read', { doc: 'The Sto' })).data['doc']).toEqual({ id: STORM, title: 'The Storm' });
  });

  it('prefers an exact title to a longer title it is a prefix of', () => {
    const state = makeState();
    addDocument(state, { parentId: CHAPTER_TWO, title: 'The Storm Returns', now: OPENED, id: 'n_TEMPESTRT1' });
    expect(valueOf(run(makeHarness({}, state), 'doc.read', { doc: 'The Storm' })).data['doc']).toEqual({ id: STORM, title: 'The Storm' });
  });

  it('lists every candidate when a prefix matches more than one document, and names binder.read_tree', () => {
    const state = makeState();
    addDocument(state, { parentId: CHAPTER_TWO, title: 'The Storm Returns', now: OPENED, id: 'n_TEMPESTRT1' });
    const error = refusalOf(run(makeHarness({}, state), 'doc.read', { doc: 'The S' }));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('"The Storm" (n_TEMPEST001)');
    expect(error.message).toContain('"The Storm Returns" (n_TEMPESTRT1)');
    expect(error.correctiveHint).toContain('binder.read_tree');
    expect((error.details?.['candidates'] as unknown[]).length).toBe(2);
  });

  it('refuses a folder where a document is required, and says what it is', () => {
    const error = refusalOf(run(makeHarness(), 'doc.read', { doc: CHAPTER_ONE }));
    expect(error.message).toBe(`"${CHAPTER_ONE}" is a folder, not a document`);
  });

  it('refuses an unknown document and names binder.read_tree', () => {
    const error = refusalOf(run(makeHarness(), 'doc.read', { doc: 'The Missing Chapter' }));
    expect(error.code).toBe('not-found');
    expect(error.correctiveHint).toContain('binder.read_tree');
  });

  it('refuses a blank reference', () => {
    const error = refusalOf(run(makeHarness(), 'doc.read', { doc: '   ' }));
    expect(error.code).toBe('invalid-params');
  });

  it('reads without changing the project', () => {
    const state = makeState();
    const before = snapshotOf(state);
    run(makeHarness({}, state), 'doc.read', { doc: LANDING });
    expect(snapshotOf(state)).toBe(before);
  });
});

describe('notes.read', () => {
  it('reads synopsis, notes and keywords by default', () => {
    const data = valueOf(run(makeHarness(), 'notes.read', { doc: LANDING })).data;
    expect(data).toEqual({
      doc: { id: LANDING, title: 'The Landing' },
      synopsis: 'Elena returns to the island.',
      notes: 'Fix pacing in the last three paragraphs.',
      keywords: ['sea', 'grief'],
    });
  });

  it('reads only the fields asked for, in the order asked', () => {
    const data = valueOf(run(makeHarness(), 'notes.read', { doc: LANDING, fields: ['keywords', 'synopsis'] })).data;
    expect(Object.keys(data)).toEqual(['doc', 'keywords', 'synopsis']);
  });

  it('reads every field when given "all"', () => {
    const data = valueOf(run(makeHarness(), 'notes.read', { doc: LANDING, fields: 'all' })).data;
    expect(Object.keys(data)).toEqual(['doc', 'synopsis', 'notes', 'keywords']);
  });

  it('refuses a field name it does not know, and lists the ones it does', () => {
    const error = refusalOf(run(makeHarness(), 'notes.read', { doc: LANDING, fields: ['colour'] }));
    expect(error.message).toContain('synopsis, notes, keywords');
  });

  it('applies the same disambiguation as doc.read to its document reference', () => {
    const error = refusalOf(run(makeHarness(), 'notes.read', { doc: CHAPTER_ONE }));
    expect(error.message).toContain('is a folder, not a document');
  });
});
