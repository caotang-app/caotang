/**
 * The first-mention offset per entry (codex-panels.md §1, `firstOffset`): the appearance view reveals the
 * mention at this offset, so it must point at the mention in the body the document holds, and it must come
 * from the same scan that gives the counts.
 */
import { describe, expect, it } from 'vitest';

import { compileCodex, countMentions, createMentionIndex, firstMentionOffsets, scanMentions, type IndexedDoc } from '../src/index.js';
import { entry } from './fixtures/detection-corpus.js';

const elena = entry('Elena');
const compiled = compileCodex([elena]);

function doc(id: string, revision: number, body: string): IndexedDoc {
  return { id, revision, body };
}

describe('first-mention offsets — the body coordinates the appearance view reveals', () => {
  it('reports the offset of the first surviving mention, in the body the caller holds', () => {
    const body = 'The hall was quiet. Elena walks in. Elena talks.';
    const offset = firstMentionOffsets(body, compiled).get('c_Elena');
    expect(offset).toBe(body.indexOf('Elena'));
    expect(body.slice(offset, (offset ?? 0) + 5)).toBe('Elena');
  });

  it('skips an occurrence that a word boundary rules out, as the count does', () => {
    const body = 'Elenaria walked alone. Later, Elena came back.';
    const offset = firstMentionOffsets(body, compiled).get('c_Elena');
    expect(offset).toBe(body.lastIndexOf('Elena'));
    expect(countMentions(body, compiled).get('c_Elena')).toBe(1);
  });

  it('maps the offset back across an NFC-composed prefix, which is shorter than its raw form', () => {
    // "Cafe" + U+0301 is five code units raw and four once NFC composes it, so an index taken from the
    // canonical text is one short of the raw text's. The mention must be found at its raw offset.
    const body = 'Café with Elena in it.';
    const offset = firstMentionOffsets(body, compiled).get('c_Elena');
    expect(offset).toBe(body.indexOf('Elena'));
    expect(body.slice(offset, (offset ?? 0) + 5)).toBe('Elena');
  });

  it('leaves an entry with no surviving mention out of the map, exactly as the counts do', () => {
    const body = 'Nobody by that name is here.';
    expect(firstMentionOffsets(body, compiled).has('c_Elena')).toBe(false);
    expect(countMentions(body, compiled).has('c_Elena')).toBe(false);
  });

  it('gives the same counts as countMentions, from one scan', () => {
    const body = 'Elena. Elena. Elenaria. Elena!';
    const scanned = scanMentions(body, compiled);
    expect([...scanned.counts]).toEqual([...countMentions(body, compiled)]);
    expect(scanned.firstOffsets.get('c_Elena')).toBe(body.indexOf('Elena'));
  });
});

describe('MentionIndex.firstOffsets — cached with the counts (codex.md §4)', () => {
  it('answers from the scan that gave the counts, without a second pass', () => {
    const index = createMentionIndex();
    const body = 'Quiet hall. Elena sits.';
    index.hits(doc('d1', 1, body), [elena]);
    const offsets = index.firstOffsets(doc('d1', 1, body), [elena]);
    expect(offsets.get('c_Elena')).toBe(body.indexOf('Elena'));
    expect(index.stats.documentPasses).toBe(1);
  });

  it('reports the new mention after the document changes, since the cache is keyed by its revision', () => {
    const index = createMentionIndex();
    index.firstOffsets(doc('d1', 1, 'Nothing here.'), [elena]);
    const after = index.firstOffsets(doc('d1', 2, 'Now Elena is here.'), [elena]);
    expect(after.get('c_Elena')).toBe('Now Elena is here.'.indexOf('Elena'));
    expect(index.stats.documentPasses).toBe(2);
  });
});
