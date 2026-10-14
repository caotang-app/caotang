/**
 * Mention detection, checked row by row against the fixture corpus, plus the behaviour
 * the corpus cannot express: attribution across texts, purity, and order independence.
 */
import { describe, expect, it } from 'vitest';

import { detect } from '../src/index.js';
import { DETECTION_ROWS, entry, type DetectionRow } from './fixtures/detection-corpus.js';

describe('detection fixture corpus (codex.md §9)', () => {
  it.each(DETECTION_ROWS.map((row): [string, DetectionRow] => [`${row.section}: ${row.label}`, row]))(
    '%s',
    (_title, row) => {
      const hits = detect([{ id: 'doc', text: row.text }], row.entries);
      const actual = Object.fromEntries(row.entries.map((e) => [e.name, hits.get(e.id)?.count ?? 0]));
      const expected = Object.fromEntries(row.entries.map((e) => [e.name, row.expect[e.name] ?? 0]));
      expect(actual).toEqual(expected);
    },
  );

  it('names only entries that exist in their own row', () => {
    // A typo in an expectation key would otherwise expect 0 of nothing and pass.
    for (const row of DETECTION_ROWS) {
      for (const name of Object.keys(row.expect)) {
        expect(row.entries.map((e) => e.name), row.label).toContain(name);
      }
    }
  });
});

describe('detect — attribution and purity', () => {
  it('sums counts across texts and records each text that held a hit, in input order', () => {
    const hits = detect(
      [
        { id: 'instruction', text: 'Elena speaks' },
        { id: 'doc-1', text: 'Elena and Elena' },
        { id: 'doc-2', text: 'nothing here' },
      ],
      [entry('Elena')],
    );
    expect(hits.get('c_Elena')).toEqual({ count: 3, where: ['instruction', 'doc-1'] });
  });

  it('omits entries with no surviving occurrence from the result', () => {
    const hits = detect([{ id: 'doc', text: 'Elena' }], [entry('Elena'), entry('Bob')]);
    expect([...hits.keys()]).toEqual(['c_Elena']);
  });

  it('detects entries of every include policy, since policy is applied later', () => {
    const hits = detect(
      [{ id: 'doc', text: 'Elena Oracle Mirror Gate' }],
      [
        entry('Elena', { includePolicy: 'never' }),
        entry('Oracle', { includePolicy: 'manual' }),
        entry('Mirror', { includePolicy: 'always' }),
        entry('Gate', { includePolicy: 'detected' }),
      ],
    );
    expect([...hits.keys()].sort()).toEqual(['c_Elena', 'c_Gate', 'c_Mirror', 'c_Oracle']);
  });

  it('is insensitive to the order of the entries it is given', () => {
    const forward = [entry('Ann'), entry('Ann Smith', { aliases: ['Smith'] }), entry('Bob')];
    const reverse = [...forward].reverse();
    const text = 'Ann Smith and Bob met Ann. Smith waved.';
    const counts = (entries: typeof forward) =>
      [...detect([{ id: 'd', text }], entries)].map(([id, hit]) => [id, hit.count] as const).sort();
    expect(counts(reverse)).toEqual(counts(forward));
  });

  it('does not mutate the entries it is given', () => {
    const entries = [entry('Will', { exclude: ['Will you'], aliases: ['Willy'] })];
    const before = structuredClone(entries);
    detect([{ id: 'd', text: 'Will you go. Willy came.' }], entries);
    expect(entries).toEqual(before);
  });

  it('applies K6 per document: an exclusion in one text does not reach a hit in another', () => {
    const hits = detect(
      [
        { id: 'dog', text: "Elena's dog barked." },
        { id: 'scene', text: 'Elena walked in.' },
      ],
      [entry('Elena', { exclude: ["Elena's dog"] })],
    );
    expect(hits.get('c_Elena')).toEqual({ count: 1, where: ['scene'] });
  });
});
