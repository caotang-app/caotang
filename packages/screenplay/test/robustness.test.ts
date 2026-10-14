import type { FlatBlock } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import {
  LAYOUT,
  importFountainScript,
  paginate,
  parseFountain,
  renderFountain,
  renderPdf,
  serialiseFountain,
} from '../src/index.js';

/** The pieces a writer's text is made of, including the ones the reader must not trip over. */
const PIECES = [
  'INT. ', 'EXT. ', 'CUT TO:', 'ANNA', ' (V.O.)', ' ^', '(beat)', '@', '!', '.', '>', '<', '=', '#', '===',
  '/*', '*/', '[[', ']]', '\n', '\n', '\n\n', 'word ', 'Title: ', 'é', '—', '\t', '  ', '\r\n', 'MORE',
  "CONT'D", 'x'.repeat(70), 'Action sentence here.', '﻿', '\u0000',
];

/** A seeded document: the same seed always gives the same text, so a failure is reproducible. */
function documentFor(seed: number): string {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  let out = '';
  const length = 20 + Math.floor(next() * 200);
  for (let i = 0; i < length; i++) out += PIECES[Math.floor(next() * PIECES.length)] ?? '';
  return out;
}

describe('the reader is lenient and the layout stays inside the text area (screenplay.md §2.3, §5.3)', () => {
  it('reads, serialises, imports and paginates arbitrary input without throwing', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const source = documentFor(seed);
      const parsed = parseFountain(source);
      expect(() => serialiseFountain(parsed.elements), `seed ${seed}`).not.toThrow();
      expect(() => importFountainScript(source), `seed ${seed}`).not.toThrow();
      expect(() => paginate(parsed.elements), `seed ${seed}`).not.toThrow();
    }
  });

  it('keeps every printed line inside the page margins, one line of text per row', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const page of paginate(parseFountain(documentFor(seed)).elements, { sceneNumbers: 'both' })) {
        for (const line of page.lines) {
          const seeds = `seed ${seed}, page ${page.number}, "${line.text}"`;
          expect(line.text, seeds).not.toMatch(/\n/);
          expect(line.x, seeds).toBeGreaterThanOrEqual(0);
          expect(line.x + line.text.length * LAYOUT.charWidth, seeds).toBeLessThanOrEqual(LAYOUT.pageWidth + 0.001);
          expect(line.y, seeds).toBeGreaterThan(0);
          expect(line.y, seeds).toBeLessThanOrEqual(LAYOUT.pageHeight - LAYOUT.marginBottom + 10);
        }
      }
    }
  });

  it('renders arbitrary input to a PDF and to Fountain text without throwing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const blocks: FlatBlock[] = [{ kind: 'scene', docId: 'x', body: documentFor(seed), title: 'T', number: 1 }];
      expect(() => renderFountain(blocks, { title: 'T', synopses: { x: 'Synopsis.' } }), `seed ${seed}`).not.toThrow();
      const { bytes } = renderPdf(blocks, { title: 'T' });
      expect(new TextDecoder().decode(bytes).startsWith('%PDF-1.4'), `seed ${seed}`).toBe(true);
    }
  });
});
