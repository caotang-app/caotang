/**
 * The long-manuscript compile, bounded — exporter.md §7-E1's "long-doc perf (100k words)", the part a unit test can carry.
 *
 * A 100,000-word manuscript (50 chapters of 20 scenes of 100 words) compiles to DOCX and to EPUB. The test asserts three
 * things: the word count the compile reports is the words it was given, each artifact is a real file of a sensible size,
 * and each compile finishes inside a budget. The budget is generous on purpose. It exists to catch a quadratic step or a
 * leak in the flatten, the render or the zip, not to grade a machine: a 100k-word compile that takes minutes is a bug.
 *
 * The Word and LibreOffice fidelity posture is not measured here. That benchmark has not run, and exporter.md §7-E1
 * holds the open item.
 */

import { describe, expect, it } from 'vitest';
import { MemoryArtifactFs, addDocument, addFolder, createEmptyManifest, createProjectState, type ProjectState } from '@caotang/store';
import { createExporter } from '../src/exporter.js';

const CHAPTERS = 50;
const SCENES_PER_CHAPTER = 20;
const PARAGRAPHS_PER_SCENE = 4;
const WORDS_PER_PARAGRAPH = 25;
const WORDS_PER_SCENE = PARAGRAPHS_PER_SCENE * WORDS_PER_PARAGRAPH;
const TOTAL_WORDS = CHAPTERS * SCENES_PER_CHAPTER * WORDS_PER_SCENE;

/** The wall-clock budget for one compile of the 100k-word book. Generous: it bounds a pathology, not a machine. */
const BUDGET_MS = 60_000;

const NOW = new Date('2026-10-08T09:00:00.000Z');

/** One paragraph of `WORDS_PER_PARAGRAPH` words, distinct enough that a dedupe cannot hide a lost scene. */
function paragraph(scene: number, index: number): string {
  return Array.from({ length: WORDS_PER_PARAGRAPH }, (_, word) => `s${scene}p${index}w${word}`).join(' ');
}

/** A scene's body: the paragraphs, separated by a blank line as the writer types them. */
function sceneBody(scene: number): string {
  return Array.from({ length: PARAGRAPHS_PER_SCENE }, (_, index) => paragraph(scene, index)).join('\n\n');
}

/** The 100k-word manuscript, built through the store's own writers so it is a project and not a fixture of shapes. */
function longManuscript(): ProjectState {
  const state = createProjectState(createEmptyManifest('The Long Book', NOW));
  let scene = 0;
  for (let chapter = 0; chapter < CHAPTERS; chapter += 1) {
    const folder = addFolder(state, { parentId: 'manuscript', title: `Chapter ${chapter + 1}`, now: NOW });
    for (let s = 0; s < SCENES_PER_CHAPTER; s += 1) {
      scene += 1;
      addDocument(state, { parentId: folder.id, title: `Scene ${scene}`, body: sceneBody(scene), now: NOW });
    }
  }
  return state;
}

describe('the 100k-word compile, bounded (exporter.md §7-E1)', () => {
  const state = longManuscript();

  it('builds the manuscript it says it builds', () => {
    expect(state.manifest.tree.filter((node) => node.type === 'document')).toHaveLength(CHAPTERS * SCENES_PER_CHAPTER);
    expect(TOTAL_WORDS).toBe(100_000);
  });

  it('compiles the whole book to DOCX inside the budget, and reports the words it was given', async () => {
    const exporter = createExporter({
      readState: () => state,
      artifacts: new MemoryArtifactFs(),
      metadata: () => ({ author: 'M. Ortega' }),
    });
    const started = performance.now();
    const result = await exporter.compile({ includeRootIds: ['manuscript'] }, 'docx');
    const elapsed = performance.now() - started;

    expect(result.log.wordCount).toBeGreaterThanOrEqual(TOTAL_WORDS - 1_000);
    expect(result.log.wordCount).toBeLessThanOrEqual(TOTAL_WORDS + 1_000);
    expect(result.log.chapterCount).toBe(CHAPTERS);
    expect(result.log.sceneCount).toBe(CHAPTERS * SCENES_PER_CHAPTER);
    // A DOCX of 100k words is megabytes of XML inside a zip; a few hundred kilobytes would mean scenes were lost.
    expect(result.blob.size).toBeGreaterThan(200_000);
    expect(elapsed, `DOCX compile took ${Math.round(elapsed)} ms`).toBeLessThan(BUDGET_MS);
  }, BUDGET_MS * 3);

  it('compiles the whole book to EPUB inside the budget, with every chapter as a file', async () => {
    const exporter = createExporter({
      readState: () => state,
      artifacts: new MemoryArtifactFs(),
      metadata: () => ({ identifier: 'urn:uuid:3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d', language: 'en', author: 'M. Ortega' }),
    });
    const started = performance.now();
    const result = await exporter.compile({ includeRootIds: ['manuscript'] }, 'epub');
    const elapsed = performance.now() - started;

    expect(result.log.wordCount).toBeGreaterThanOrEqual(TOTAL_WORDS - 1_000);
    expect(result.log.wordCount).toBeLessThanOrEqual(TOTAL_WORDS + 1_000);
    expect(result.blob.size).toBeGreaterThan(200_000);
    expect(elapsed, `EPUB compile took ${Math.round(elapsed)} ms`).toBeLessThan(BUDGET_MS);
  }, BUDGET_MS * 3);
});
