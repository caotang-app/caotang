import type { CodexEntry } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { DRAFT_BROKEN, LOOSE_AND_DEAD, SPEAKERS, STITCH_ONLY, TAVERN } from './fixtures.js';
import { BRANCH_SEVERITY, compileInk, validateContainer, exportInkJson, groupKey } from '../src/index.js';

const entry = (over: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'name' | 'type'>): CodexEntry => ({
  aliases: [],
  description: '',
  includePolicy: 'detected',
  caseSensitive: false,
  exclude: [],
  attachments: [],
  keywords: [],
  origin: 'manual',
  sources: [],
  ...over,
});

/** Alice is a character, reachable by alias too; Bob is in no entry; Lantern is an object, which never speaks. */
const CODEX: CodexEntry[] = [
  entry({ id: 'c_ALICE00001', name: 'Alice', type: 'character', aliases: ['Al'] }),
  entry({ id: 'c_LANTERN001', name: 'Lantern', type: 'object' }),
];

describe('the compile gate', () => {
  it('compiles the tavern to a story JSON with no errors', () => {
    const compiled = compileInk(TAVERN);
    expect(compiled.ok).toBe(true);
    expect(compiled.errors).toEqual([]);
    expect(JSON.parse(compiled.json ?? 'null')).toHaveProperty('inkVersion');
  });

  it('reports a loose end as a warning, with the body line it names', () => {
    const compiled = compileInk(LOOSE_AND_DEAD);
    expect(compiled.ok).toBe(true);
    expect(compiled.warnings).toHaveLength(1);
    expect(compiled.warnings[0]?.text).toMatch(/Apparent loose end/);
    expect(compiled.warnings[0]?.line).toBe(6);
  });

  it('refuses a body with an error, with the compiler message verbatim and no JSON', () => {
    const compiled = compileInk(DRAFT_BROKEN);
    expect(compiled.ok).toBe(false);
    expect(compiled.json).toBeNull();
    expect(compiled.errors[0]?.text).toMatch(/^ERROR: line 2: /);
    expect(compiled.errors[0]?.line).toBe(2);
  });

  it('reports an unresolvable INCLUDE as an error, not a throw', () => {
    const compiled = compileInk('INCLUDE other.ink\n-> END\n');
    expect(compiled.ok).toBe(false);
    expect(compiled.errors).toHaveLength(1);
  });
});

describe('the deterministic findings', () => {
  it('maps the loose end to the node it sits in, with coherence-shaped fields', () => {
    const report = validateContainer('d1', LOOSE_AND_DEAD, { entries: CODEX });
    const loose = report.findings.find((f) => f.checkId === 'branch.loose-end');
    expect(loose).toBeDefined();
    expect(loose?.severity).toBe('warning');
    expect(loose?.severity).toBe(BRANCH_SEVERITY['branch.loose-end']);
    expect(loose?.factGroup).toBe(groupKey('middle', 'loose-end'));
    expect(loose?.factGroup).toBe('middle|loose-end');
    expect(loose?.evidence).toHaveLength(1);
    const evidence = loose?.evidence[0];
    expect(evidence?.docId).toBe('d1');
    expect(LOOSE_AND_DEAD.slice(evidence?.from, evidence?.to)).toBe('The room is quiet.');
  });

  it('reports a knot that nothing diverts to as an unreachable node, at info', () => {
    const report = validateContainer('d1', LOOSE_AND_DEAD, { entries: CODEX });
    const dead = report.findings.filter((f) => f.checkId === 'branch.dead-end');
    expect(dead.map((f) => f.factGroup)).toEqual(['orphan|unreachable']);
    expect(dead[0]?.severity).toBe('info');
    expect(dead[0]?.type).toBe('unreachable');
  });

  it('does not flag a knot that a variable holds as its divert target, since the variable reaches it', () => {
    const body = '-> start\nVAR dest = -> vault\n=== start ===\nHi.\n-> dest\n=== vault ===\nDark.\n-> END\n';
    expect(compileInk(body).ok).toBe(true);
    const report = validateContainer('d1', body);
    expect(report.findings.filter((f) => f.checkId === 'branch.dead-end')).toEqual([]);
  });

  it('does not flag a knot whose stitch is the one named, since Ink enters the stitch by name', () => {
    const report = validateContainer('d1', STITCH_ONLY, { entries: CODEX });
    expect(report.findings.filter((f) => f.checkId === 'branch.dead-end')).toEqual([]);
  });

  it('flags a speaker that matches no codex character, once per name, and not a character that does match', () => {
    const report = validateContainer('d1', SPEAKERS, { entries: CODEX });
    const speakers = report.findings.filter((f) => f.checkId === 'dialogue.speaker-unknown');
    expect(speakers.map((f) => f.factGroup)).toEqual(['bob|speaker', 'lantern|speaker']);
    expect(speakers.every((f) => f.severity === 'info')).toBe(true);
    expect(speakers[1]?.message).toMatch(/matches no codex character/);
  });

  it('does not run the speaker check without a codex, since every cue would be unknown', () => {
    const report = validateContainer('d1', SPEAKERS);
    expect(report.findings.some((f) => f.checkId === 'dialogue.speaker-unknown')).toBe(false);
  });

  it('keeps compile errors out of the findings and returns them as the blocking list', () => {
    const report = validateContainer('d1', DRAFT_BROKEN, { entries: CODEX });
    expect(report.errors.map((e) => e.line)).toEqual([2]);
    // The only finding is the knot nothing names; the broken choice is a blocking error, not a finding.
    expect(report.findings.map((f) => f.checkId)).toEqual(['branch.dead-end']);
  });

  it('reports the tavern clean: no loose end, no dead end, no unknown speaker', () => {
    const report = validateContainer('d1', TAVERN, { entries: CODEX.concat(entry({ id: 'c_INNKEEP01', name: 'Innkeeper', type: 'character' })) });
    expect(report.findings).toEqual([]);
  });
});

describe('the ink-json export', () => {
  it('emits the compiled story as <id>.ink.json, with the warnings verbatim in the notes', () => {
    const out = exportInkJson('story-1', LOOSE_AND_DEAD);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fileName).toBe('story-1.ink.json');
    expect(out.mimeType).toBe('application/json');
    expect(JSON.parse(out.json)).toHaveProperty('inkVersion');
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toMatch(/^WARNING: line 6: Apparent loose end/);
  });

  it('refuses a body with compile errors, and gives the errors verbatim', () => {
    const out = exportInkJson('story-2', DRAFT_BROKEN);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0]?.text).toMatch(/^ERROR: line 2/);
  });
});
