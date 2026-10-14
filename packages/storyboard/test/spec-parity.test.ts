/**
 * The module's metadata and limits, checked against [storyboard.md](../../../docs/architecture/storyboard.md)
 * itself. The rows and the numbers are read out of the file, not copied, for the reason the harness's
 * spec-parity test gives: a hand-copied table only proves the copy matches itself.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ACTION_MAX_CHARS,
  ANNOTATE_MAX_SHOTS,
  DERIVE_MAX_SHOTS,
  SHOT_LIST_COLUMNS,
  STORYBOARD_TOOL_ENTRIES,
} from '../src/index.js';

const spec = readFileSync(resolve(__dirname, '../../../docs/architecture/storyboard.md'), 'utf8');

interface ToolRow {
  readonly number: number;
  readonly name: string;
  readonly risk: string;
  readonly undo: string;
  readonly text: string;
}

/** The §4 table's rows, split on unescaped pipes (the Params column carries `\|` alternatives). */
function toolRows(): ToolRow[] {
  const start = spec.indexOf('## 4. Harness tools');
  const end = spec.indexOf('`prompt.draft`', start);
  expect(start, '§4 not found in storyboard.md').toBeGreaterThanOrEqual(0);
  expect(end, '§4 end marker not found').toBeGreaterThan(start);
  const rows: ToolRow[] = [];
  for (const line of spec.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
    const number = Number(cells[1]);
    if (!Number.isInteger(number)) continue;
    rows.push({
      number,
      name: /`([a-z][a-zA-Z.]*)`/.exec(cells[2] ?? '')?.[1] ?? '',
      risk: (cells[3] ?? '').replace(/\*\*/g, ''),
      undo: cells[6] ?? '',
      text: line,
    });
  }
  return rows;
}

describe('§4 of storyboard.md, read from the file', () => {
  const rows = toolRows();

  it('has the two rows the track adds, numbered 18 and 19', () => {
    expect(rows.map((row) => row.number)).toEqual([18, 19]);
    expect(rows.map((row) => row.name)).toEqual(['shots.derive', 'shots.annotate']);
  });

  it('gives each entry the risk and the undo the spec’s row states', () => {
    for (const row of rows) {
      const entry = STORYBOARD_TOOL_ENTRIES.find((candidate) => candidate.meta.name === row.name);
      expect(entry, `no entry for ${row.name}`).toBeDefined();
      expect(entry?.meta.risk, `risk of ${row.name}`).toBe(row.risk);
      const undoable = !(row.undo.trim() === '—' || row.undo.trim() === 'n/a');
      expect(entry?.meta.undoable, `undoable of ${row.name}`).toBe(undoable);
    }
  });

  it('states the batch limit for annotate as ≤50, and the module’s constant matches it', () => {
    const annotate = rows.find((row) => row.name === 'shots.annotate');
    expect(annotate?.text).toContain('≤50');
    expect(ANNOTATE_MAX_SHOTS).toBe(50);
  });

  it('states the proposal limit for derive as more than 60, and the module’s constant matches it', () => {
    const derive = rows.find((row) => row.name === 'shots.derive');
    expect(derive?.text).toContain('>60');
    expect(DERIVE_MAX_SHOTS).toBe(60);
  });
});

describe('the limits and names the rest of the spec states in prose', () => {
  it('states the action limit as 1000 characters on the shot record', () => {
    expect(spec).toMatch(/action\?: string;\s+\/\/ ≤ 1000 chars/);
    expect(ACTION_MAX_CHARS).toBe(1000);
  });

  it('names the asset filename pattern the store writes', () => {
    expect(spec).toContain('a_XXXXXXXXXX.<ext>');
  });

  it('lists the shot-list columns in the order the CSV writes them, under the spec’s own header names', () => {
    const line = spec.split('\n').find((text) => text.includes('columns = shotNumber'));
    expect(line).toBeDefined();
    // Compared exactly: the header the CSV writes is the header the spec names, with no rename on the way.
    const listed = (line ?? '')
      .split('columns = ')[1]
      ?.split(' (StudioBinder')[0]
      ?.replace(/\s*\([^)]*\)/g, '')
      .split(', ');
    expect(listed).toEqual([...SHOT_LIST_COLUMNS]);
  });
});
