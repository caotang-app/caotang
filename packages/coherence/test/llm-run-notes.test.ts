/**
 * The run notes a model review writes (coherence.md §5.3). The Findings tab shows them as they are, so a note names a scene by
 * its title and a pair by its number in the run, never by a document id or a pair id.
 */

import { describe, expect, it } from 'vitest';

import { parseExtraction, parseVerification } from '../src/llm/parse.js';
import { SPANS_PER_DOCUMENT } from '../src/llm/prompts.js';

const BODY = 'Elena returned.';
const SCENE = { docId: 'n_SCA0000001', body: BODY, title: 'Scene A' };

describe('the notes a review’s extraction reply leaves name the scene by its title', () => {
  it('says how many spans a scene returned past the cap, by its title, and keeps no document id in the note', () => {
    const spans = Array.from({ length: SPANS_PER_DOCUMENT + 1 }, () => ({}));
    const { notes } = parseExtraction(JSON.stringify({ spans }), SCENE);
    expect(notes).toContain(`"Scene A" returned ${SPANS_PER_DOCUMENT + 1} spans; only the first ${SPANS_PER_DOCUMENT} are kept`);
    expect(notes.join(' ')).not.toContain(SCENE.docId);
  });

  it('names a span that points at another document by the scene it was asked about, not by the id it gave', () => {
    const reply = JSON.stringify({ spans: [{ docId: 'n_OTHER00001', quote: 'Elena', from: 0, to: 5, category: 'factual', note: '' }] });
    const { notes, spans } = parseExtraction(reply, SCENE);
    expect(spans).toEqual([]);
    expect(notes).toEqual(['span 0 names another document, not "Scene A"; dropped']);
  });

  it('falls back to a plain phrase for a scene the run was not given a title for', () => {
    const reply = JSON.stringify({ spans: [{ docId: 'n_OTHER00001', quote: 'Elena', from: 0, to: 5, category: 'factual', note: '' }] });
    const { notes } = parseExtraction(reply, { docId: SCENE.docId, body: BODY });
    expect(notes).toEqual(['span 0 names another document, not the scene; dropped']);
  });
});

describe('the notes a review’s verification reply leaves name a pair by its number in the run', () => {
  const known = {
    bodies: new Map([[SCENE.docId, BODY]]),
    pairs: new Map([
      [
        'p3',
        {
          a: { docId: SCENE.docId, from: 0, to: 6 },
          b: { docId: SCENE.docId, from: 7, to: 15 },
          ordinal: 3,
        },
      ],
    ]),
  };

  it('names a pair with a verdict outside the enum as pair N, with no pair id', () => {
    const reply = JSON.stringify({ verdicts: [{ pairId: 'p3', verdict: 'maybe' }] });
    const { notes, verdicts } = parseVerification(reply, known);
    expect(verdicts).toEqual([]);
    expect(notes).toEqual(['pair 3 has a verdict outside the enum; dropped']);
  });

  it('names a verdict for a pair that is not in its batch without repeating the id it gave', () => {
    const reply = JSON.stringify({ verdicts: [{ pairId: 'p9', verdict: 'consistent' }] });
    const { notes } = parseVerification(reply, known);
    expect(notes).toEqual(['a verdict names a pair that is not in its batch; dropped']);
    expect(notes.join(' ')).not.toContain('p9');
  });

  it('keeps the pair number for a contradiction whose passages are not verbatim', () => {
    const reply = JSON.stringify({
      verdicts: [
        {
          pairId: 'p3',
          verdict: 'contradictory',
          reasoning: 'They disagree.',
          factGroup: { entity: 'elena', attribute: 'lamp' },
          evidence: [
            { docId: SCENE.docId, quote: 'Not in the text.', from: 0, to: 16 },
            { docId: SCENE.docId, quote: 'Elena', from: 0, to: 5 },
          ],
        },
      ],
    });
    const { notes } = parseVerification(reply, known);
    expect(notes).toEqual(["pair 3: the model's passages were not verbatim; the pair's own passages are used"]);
  });
});
