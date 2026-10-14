/**
 * The registry entries, checked against the spec they came from. The rows are read out of
 * dialogue-narrative.md §7 and not copied, for the reason `packages/harness/test/spec-parity.test.ts`
 * gives: a hand-copied table only proves the copy matches itself. The harness's own schema
 * derivation and validator are run over the declarations, so a parameter the harness cannot read
 * fails here and not at integration.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DIALOGUE_TOOL_ENTRIES } from '../src/index.js';

const specPath = resolve(__dirname, '../../../docs/architecture/dialogue-narrative.md');

interface SpecRow {
  readonly number: number;
  readonly name: string;
  readonly risk: string;
  readonly undo: string;
  readonly semantics: string;
}

function readSpecRows(): SpecRow[] {
  const spec = readFileSync(specPath, 'utf8');
  const start = spec.indexOf('## 7. Harness tools');
  const end = spec.indexOf('`export.compile` gains');
  expect(start, '§7 not found in dialogue-narrative.md').toBeGreaterThanOrEqual(0);
  expect(end, '§7 end marker not found').toBeGreaterThan(start);
  const rows: SpecRow[] = [];
  for (const line of spec.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    // Unescaped pipes only: the Params column contains `\|` alternatives.
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const number = Number(cells[1]);
    if (!Number.isInteger(number)) continue;
    rows.push({
      number,
      name: /`([a-z][a-zA-Z._]*)`/.exec(cells[2] ?? '')?.[1] ?? '',
      risk: (cells[3] ?? '').replace(/\*\*/g, ''),
      undo: cells[6] ?? '',
      semantics: cells[5] ?? '',
    });
  }
  return rows;
}

describe('§7 of dialogue-narrative.md, read from the file', () => {
  const rows = readSpecRows();

  it('has the two rows, numbered 22 and 23, which the media track adds to the registry', () => {
    expect(rows.map((row) => row.number)).toEqual([22, 23]);
  });

  it('names the same tools, in the same order, as the entries', () => {
    expect(rows.map((row) => row.name)).toEqual(DIALOGUE_TOOL_ENTRIES.map((entry) => entry.meta.name));
  });

  it('gives each entry the risk the spec names', () => {
    for (const row of rows) {
      const entry = DIALOGUE_TOOL_ENTRIES.find((e) => e.meta.name === row.name);
      expect(entry?.meta.risk, row.name).toBe(row.risk);
    }
  });

  it('gives each entry the undo the spec names: a named compensation is undoable, a dash is not', () => {
    for (const row of rows) {
      const entry = DIALOGUE_TOOL_ENTRIES.find((e) => e.meta.name === row.name);
      expect(entry?.meta.undoable, row.name).toBe(row.undo !== '—');
    }
  });

  it('states the table cap the entry carries: capped 8k tokens', () => {
    const table = rows.find((row) => row.name === 'dialogue.table');
    expect(table?.semantics).toMatch(/capped 8k tokens/);
    expect(DIALOGUE_TOOL_ENTRIES.find((e) => e.meta.name === 'dialogue.table')?.meta.response_token_cap).toBe(8000);
  });
});
