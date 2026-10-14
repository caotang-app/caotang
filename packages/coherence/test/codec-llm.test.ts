import { describe, expect, it } from 'vitest';

import { parseCoherenceFile, readFinding } from '../src/index.js';

import { NOW } from './fixtures.js';

const PASSAGE = { docId: 'sA', quote: 'Elena is thirty-four.', from: 0, to: 21 };

function llmFinding(evidence: unknown[]): Record<string, unknown> {
  return {
    id: 'f_AAAAAAAAAA',
    runId: 'r_BBBBBBBBBB',
    class: 'llm',
    checkId: 'llm:characterization',
    type: 'characterization',
    severity: 'warning',
    status: 'open',
    factGroup: 'c_5h8qk2m9rt|age',
    message: 'Ages disagree',
    evidence,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe('llm findings carry exactly two passages (§3)', () => {
  it('reads an llm finding with its two passages', () => {
    const read = readFinding(llmFinding([PASSAGE, { ...PASSAGE, docId: 'sB' }]));
    expect(read.ok).toBe(true);
  });

  it('refuses an llm finding with one passage, or with three', () => {
    expect(readFinding(llmFinding([PASSAGE])).ok).toBe(false);
    expect(readFinding(llmFinding([PASSAGE, PASSAGE, PASSAGE])).ok).toBe(false);
  });

  it('still reads a deterministic finding with a single passage, or none', () => {
    const deterministic = { ...llmFinding([PASSAGE]), class: 'deterministic', checkId: 'presence.expected', type: 'expected-absent' };
    expect(readFinding(deterministic).ok).toBe(true);
    expect(readFinding({ ...deterministic, evidence: [] }).ok).toBe(true);
  });

  it('drops the malformed llm finding from a file and says so', () => {
    const raw = { formatVersion: 1, findings: [llmFinding([PASSAGE])], runs: [], sceneMeta: {}, worldRules: [], reviewState: {} };
    const outcome = parseCoherenceFile(JSON.stringify(raw));
    expect(outcome.kind === 'ok' && outcome.file.findings).toEqual([]);
    expect(outcome.kind === 'ok' && outcome.notices.map((n) => n.code)).toEqual(['dropped-finding']);
  });
});
