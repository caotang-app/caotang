/**
 * The spec is the contract, so this file reads the spec back and compares it with the code. The §6 tool
 * table is compared column by column for name, risk, undo and params. The §2 unions and the template ids
 * are compared as sets. A hand-copied constant would only prove the copy matches itself; a parse of the
 * spec proves the two agree.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NEGATIVE_PROMPT_PACK_CAP,
  PROMPT_PACK_TOOL_ENTRIES,
  SEED_MAX,
  SEED_MIN,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  VIDEO_TEMPLATE_IDS,
} from '../src/index.js';

const SPEC = readFileSync(fileURLToPath(new URL('../../../docs/architecture/video-prompt-pack.md', import.meta.url)), 'utf8');

/** A §6 table row, as its cells: `#`, `Tool`, `Risk`, `Params`, `Semantics`, `Undo`, `Errors`. Escaped pipes stay inside their cell. */
function specRow(number: number): string[] {
  const line = SPEC.split('\n').find((candidate) => candidate.startsWith(`| ${number} |`));
  if (line === undefined) throw new Error(`no row ${number} in the §6 table`);
  // A private-use character holds each escaped pipe while the row is split on the bare ones.
  const hold = '';
  const cells = line
    .replace(/\\\|/g, hold)
    .split('|')
    .map((cell) => cell.split(hold).join('|').trim());
  return cells.slice(1, -1);
}

/** The first line of the spec that starts with a given fragment, with any trailing comment removed. */
function specLine(fragment: string): string {
  const line = SPEC.split('\n').find((candidate) => candidate.includes(fragment));
  if (line === undefined) throw new Error(`no line with ${fragment} in the spec`);
  return (line.split('//')[0] ?? '').trim();
}

function entryNamed(name: string): (typeof PROMPT_PACK_TOOL_ENTRIES)[number] {
  const found = PROMPT_PACK_TOOL_ENTRIES.find((candidate) => candidate.meta.name === name);
  if (found === undefined) throw new Error(`no entry ${name}`);
  return found;
}

describe('the §6 tool table, column by column', () => {
  const rows = [
    { number: 20, name: 'prompt.draft' },
    { number: 21, name: 'prompt.variant' },
  ];

  for (const { number, name } of rows) {
    it(`row ${number} (${name}) matches its entry's name, risk and undo`, () => {
      const cells = specRow(number);
      const specName = (cells[1] ?? '').replace(/`/g, '');
      const specRisk = cells[2] ?? '';
      const specUndo = cells[5] ?? '';
      const meta = entryNamed(name).meta;
      expect(specName).toBe(name);
      expect(meta.name).toBe(specName);
      expect(meta.risk).toBe(specRisk);
      // §3's undo convention: `n/a` and a dash mean no undo, and anything else names a compensation.
      expect(meta.undoable).toBe(!/^(n\/a|—|-)/.test(specUndo));
    });
  }

  it('row 20 names the params the entry declares, and the shot cap the spec gives', () => {
    const params = specRow(20)[3] ?? '';
    const named = [...params.matchAll(/`(\w+)\??: /g)].map((match) => match[1] ?? '');
    expect(named.sort()).toEqual(Object.keys(entryNamed('prompt.draft').params.properties).sort());
    const shots = entryNamed('prompt.draft').params.properties.shots;
    const cap = /≤(\d+)/.exec(params);
    expect(shots?.kind).toBe('array');
    expect(Number(cap?.[1])).toBe(shots?.kind === 'array' ? shots.maxItems : -1);
  });

  it('row 21 names the params the entry declares', () => {
    const params = specRow(21)[3] ?? '';
    const named = [...params.matchAll(/`(\w+)\??: /g)].map((match) => match[1] ?? '');
    expect(named.sort()).toEqual(Object.keys(entryNamed('prompt.variant').params.properties).sort());
  });
});

describe('the §2 schema and the §5 template ids', () => {
  it('the duration union is the spec’s', () => {
    const union = specLine('durationSec?: 4 |').replace(/^.*durationSec\?:\s*/, '').replace(/;.*$/, '');
    const values = union.split('|').map((part) => Number(part.trim()));
    expect(values).toEqual([...VIDEO_DURATIONS]);
  });

  it('the aspect-ratio union is the spec’s', () => {
    const union = specLine("aspectRatio?: '16:9'").replace(/^.*aspectRatio\?:\s*/, '').replace(/;.*$/, '');
    const values = union.split('|').map((part) => part.trim().replace(/'/g, ''));
    expect(values).toEqual([...VIDEO_ASPECT_RATIOS]);
  });

  it('the resolution union is the spec’s', () => {
    const union = specLine("resolution?: '720p'").replace(/^.*resolution\?:\s*/, '').replace(/;.*$/, '');
    const values = union.split('|').map((part) => part.trim().replace(/'/g, ''));
    expect(values).toEqual([...VIDEO_RESOLUTIONS]);
  });

  it('the seed range and the pack-wide negative cap are the spec’s', () => {
    expect(SEED_MIN).toBe(1);
    expect(SEED_MAX).toBe(4294967294);
    expect(SPEC).toContain('1…4294967294');
    expect(NEGATIVE_PROMPT_PACK_CAP).toBe(500);
    expect(SPEC).toContain('≤500 chars pack-wide validation');
  });

  it('the template ids the spec names are the templates the package ships', () => {
    const named = new Set([...SPEC.matchAll(/'(runway-gen4|veo-3\.1|kling-2\.6|sora-2|wan-2\.6|seedance-2\.5)'/g)].map((match) => match[1] ?? ''));
    expect([...named].sort()).toEqual([...VIDEO_TEMPLATE_IDS].sort());
  });
});
