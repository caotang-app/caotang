/**
 * The bundle's contents list (`exports/ToC.md`, project-format §7) names each body node's file by its kind, the file a save writes
 * (paths.ts `bodyFile`): a screenplay's `.fountain`, a dialogue container's `.ink`, a prose document's `.md`. A folder, a storyboard
 * and a shot have no body, so their line ends in the em-dash. Commit be9357e made the list follow the kind; this pins it.
 */

import { describe, expect, it } from 'vitest';

import { addDocument, addNode, buildToc, createEmptyManifest, createProjectState, exportProjectZip } from '../src/index.js';

const NOW = new Date('2026-10-08T09:00:00.000Z');

// Node ids are "n_" and ten Crockford base32 characters (project-format.md §2).
const PROSE = 'n_3W8RN2TQ6C';
const SCENE = 'n_5T4RW9KZB2';
const BOARD = 'n_7K2QX9M4A1';
const SHOT = 'n_A1B2C3D4E5';
const DUET = 'n_HJKMNPQRST';

function project() {
  const state = createProjectState(createEmptyManifest('Keeper', NOW));
  addDocument(state, { parentId: 'manuscript', title: 'The Landing', body: 'The ferry was late.', now: NOW, id: PROSE });
  addDocument(state, { parentId: 'manuscript', title: 'Night Lamp', body: 'INT. LIGHTHOUSE - NIGHT\n', kind: 'screenplay', now: NOW, id: SCENE });
  addNode(state, { parentId: 'manuscript', title: 'Board', kind: 'storyboard', now: NOW, id: BOARD });
  addNode(state, { parentId: BOARD, title: 'Shot 1', type: 'shot', now: NOW, id: SHOT });
  addDocument(state, { parentId: 'manuscript', title: 'Duel', body: '=== start ===\n-> END\n', type: 'dialogue', kind: 'branching', now: NOW, id: DUET });
  return state;
}

function lineOf(toc: string, title: string): string {
  const line = toc.split('\n').find((text) => text.includes(` — ${title} — `));
  expect(line, `the contents list has a line for ${title}`).toBeDefined();
  return line ?? '';
}

describe('the bundle contents list names a body file by its kind', () => {
  it('names a screenplay’s .fountain, a dialogue container’s .ink and a prose document’s .md', () => {
    const toc = buildToc(project(), 'Keeper');
    expect(lineOf(toc, 'Night Lamp').endsWith(` — docs/${SCENE}.fountain`)).toBe(true);
    expect(lineOf(toc, 'Duel').endsWith(` — docs/${DUET}.ink`)).toBe(true);
    expect(lineOf(toc, 'The Landing').endsWith(` — docs/${PROSE}.md`)).toBe(true);
  });

  it('ends a storyboard’s and a shot’s line in the em-dash, since neither has a body file', () => {
    const toc = buildToc(project(), 'Keeper');
    expect(lineOf(toc, 'Board').endsWith(' — —')).toBe(true);
    expect(lineOf(toc, 'Shot 1').endsWith(' — —')).toBe(true);
  });

  it('names the same files the bundle carries', async () => {
    const state = project();
    const result = await exportProjectZip(state, { now: NOW });
    expect(result.entries).toContain(`docs/${SCENE}.fountain`);
    expect(result.entries).toContain(`docs/${DUET}.ink`);
    const toc = buildToc(state, 'Keeper');
    expect(toc).toContain(`docs/${SCENE}.fountain`);
    expect(toc).toContain(`docs/${DUET}.ink`);
  });
});
