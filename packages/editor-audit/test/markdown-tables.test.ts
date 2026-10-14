/**
 * Every markdown table in `docs/` still renders.
 *
 * It parses `docs/` with the GFM parser this workspace already pins
 * (`remark-gfm` 4.0.1, exact) and compares each row against **the table's own
 * column count**. There is no hand-written splitter in this file, and that is
 * the whole design: a line splitter has to re-derive the line ending (many of
 * these files are CRLF), trailing-pipe tolerance, indentation, backslash
 * escapes, code spans **and** GFM's table-formation rules, and each is a silent
 * wrong direction. The question is "does this render", so the instrument is the
 * renderer.
 *
 * ## Why it lives here and not in `test/`
 *
 * `remark-gfm` does not resolve from the repo root: `pnpm-workspace.yaml` gives
 * this package `remark-gfm@4.0.1` exactly and gives the root nothing, so a
 * root-level guard cannot import the parser without adding a dependency.
 * `vitest.config.ts` collects `packages/*\/test/**\/*.test.ts`, so a test here
 * is in `pnpm verify`.
 *
 * ## What it checks
 *
 * For every `table` node: **every row's cell count against `table.align.length`**
 * — the delimiter row, which is where GFM takes the column count from. Derived
 * from the document, per table, so a 3-column table next to a 5-column one is
 * checked against its own header and a single hardcoded number cannot serve.
 *
 * Over-wide is the expensive direction: **GFM discards the excess cells**, so
 * every character past the header is text no reader will ever see. Under-wide
 * loses nothing and pads an empty cell, which reads as a rendering bug because
 * it is one.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes, Table, TableCell, TableRow } from 'mdast';

const repoRoot = resolve(__dirname, '../../..');

const parser = unified().use(remarkParse).use(remarkGfm);

interface Misfit {
  /** `file:line`, as a reader would be told. */
  where: string;
  /** The table's own column count — from its delimiter row. */
  width: number;
  /** What the row actually carries. */
  cells: number;
  /** Characters GFM drops on the floor. Zero for an under-wide row. */
  lost: number;
}

interface Report {
  tables: number;
  rows: number;
  misfits: Misfit[];
}

/** Every `table` node, at any depth. */
function tablesIn(node: Nodes): Table[] {
  if (node.type === 'table') return [node];
  if (!('children' in node) || !Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => tablesIn(child as Nodes));
}

const rowCells = (row: TableRow): TableCell[] => row.children.filter((c) => c.type === 'tableCell');

/** A cell's rendered text, which is what the discarded cells take with them. */
const cellText = (cell: TableCell): string =>
  cell.children.map((child) => ('value' in child ? child.value : '')).join('');

/**
 * Scan one markdown file.
 *
 * The same function runs the corpus and every control below, so a control
 * cannot pass against a different code path than the one it is a control for.
 */
function scan(path: string, display: string): Report {
  const tree = parser.parse(readFileSync(path, 'utf8'));
  const misfits: Misfit[] = [];
  let tables = 0;
  let rows = 0;

  for (const table of tablesIn(tree)) {
    tables += 1;
    // GFM takes the column count from the delimiter row, and micromark exposes
    // it as `align`. Using the header row instead would accept a header that
    // disagrees with its own delimiter — a different defect, and one this row
    // must not silently absorb.
    const width = (table.align ?? []).length;
    for (const row of table.children.filter((r): r is TableRow => r.type === 'tableRow')) {
      rows += 1;
      const cells = rowCells(row);
      if (cells.length === width) continue;
      const lost =
        cells.length > width
          ? cells.slice(width).reduce((sum, cell) => sum + cellText(cell).length, 0)
          : 0;
      misfits.push({ where: `${display}:${row.position?.start.line ?? 0}`, width, cells: cells.length, lost });
    }
  }
  return { tables, rows, misfits };
}

/**
 * The corpus, enumerated by git rather than by `readdir`.
 *
 * `-c -o --exclude-standard` lists tracked **and** untracked-but-not-ignored
 * paths, which is what makes the guard see the current change's own edits —
 * `pnpm verify` runs before the commit, so a tracked-only listing would miss
 * exactly the rows most likely to be wrong. `-z` makes git emit NUL-separated,
 * unquoted, forward-slash paths; on Windows a newline split returns one entry
 * holding the whole listing, which reads as a single ENOENT.
 */
function corpus(): { path: string; display: string }[] {
  const out = execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', 'docs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter((p) => p.endsWith('.md'))
    .map((p) => ({ path: join(repoRoot, p), display: p }));
}

// ---------------------------------------------------------------------------
// Controls. Written to the OS temp dir, never into the repo: a fixture committed
// to `docs/` would be counted by the guard above and could mask a real row.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function fixture(name: string, body: string): { path: string; display: string } {
  const dir = mkdtempSync(join(tmpdir(), 'caotang-md-tables-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, body, 'utf8');
  return { path, display: name };
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('a markdown table in docs/ renders', () => {
  const files = corpus();
  const report: Report = { tables: 0, rows: 0, misfits: [] };
  for (const file of files) {
    const one = scan(file.path, file.display);
    report.tables += one.tables;
    report.rows += one.rows;
    report.misfits.push(...one.misfits);
  }

  it('finds the corpus at all — a scan that parsed nothing must not pass', () => {
    // The control this file most needs. A guard whose parser import breaks, or
    // whose glob matches nothing, produces zero misfits and a green run. A
    // checker that reports *no count* is indistinguishable from clean.
    expect(files.length, 'no markdown under docs/ was enumerated').toBeGreaterThan(20);
    expect(report.tables, 'no tables were parsed out of docs/').toBeGreaterThan(40);
    expect(report.rows, 'no table rows were parsed out of docs/').toBeGreaterThan(200);
  });

  it('has no row whose cell count contradicts its own table', () => {
    expect(
      report.misfits.map((m) => `${m.where} — ${m.cells} cells against a ${m.width}-column table`),
      'GFM discards cells past the header, so this text renders nowhere: escape the pipe (an escaped pipe is honoured inside a code span too) or close the row',
    ).toEqual([]);
  });

  it('finds a row it is told about — the corpus assertion above has a fire behind it', () => {
    // A guard proven only by a clean corpus has never been observed to fail.
    // This is that observation, on a real file on disk.
    const planted = fixture(
      'planted.md',
      [
        '| # | Item |',
        '|---|---|',
        '| X1 | the one that overflows the header | the verdict GFM drops |',
        '',
      ].join('\n'),
    );
    const found = scan(planted.path, planted.display);
    expect(found.misfits).toHaveLength(1);
    expect(found.misfits[0]).toMatchObject({ width: 2, cells: 3, lost: 21 });
  });
});

describe('the width is the table\'s own, and the escape is honoured', () => {
  it('honours an escaped pipe inside a code span — the naive-split failure', () => {
    // A planning decision measured 31 of its 36 "broken rows" here: a well-formed row whose
    // cell carries `\|`. A guard that flagged this would punish the corpus for
    // writing correct markdown, and the count would rise as the docs improve.
    const f = fixture(
      'escaped.md',
      ['| a | b |', '|---|---|', '| `x \\| y` | 2 |', '| p \\| q | 2 |', ''].join('\n'),
    );
    const found = scan(f.path, f.display);
    expect(found.tables).toBe(1);
    expect(found.misfits, 'an escaped pipe is a literal character, not a delimiter').toEqual([]);
  });

  it('flags the same row unescaped — so the arm above is not passing by ignoring pipes', () => {
    // The discriminating pair. If this one is clean, the previous test is green
    // for the wrong reason, and the guard would be a no-op with a reassuring name.
    const f = fixture('unescaped.md', ['| a | b |', '|---|---|', '| `x | y` | 2 |', ''].join('\n'));
    const found = scan(f.path, f.display);
    expect(found.misfits).toHaveLength(1);
    expect(found.misfits[0]).toMatchObject({ width: 2, cells: 3 });
  });

  it('flags an under-wide row as well as an over-wide one', () => {
    const f = fixture('under.md', ['| a | b |', '|---|---|', '| 1 |', ''].join('\n'));
    const found = scan(f.path, f.display);
    expect(found.misfits).toHaveLength(1);
    // GFM pads rather than discards, so the loss is zero — the row is still wrong
    // and still renders as an empty trailing cell.
    expect(found.misfits[0]).toMatchObject({ width: 2, cells: 1, lost: 0 });
  });

  it('takes each table\'s width from its own header, never a global number', () => {
    // `docs/` holds both shapes today (a 4-column queue, a 5-column scoreboard,
    // a 2-column board), so a single hardcoded width cannot serve. An earlier change recorded
    // the same requirement for the queue tables alone.
    const twoWidths = fixture(
      'widths.md',
      [
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '| a | b | c |',
        '|---|---|---|',
        '| 1 | 2 | 3 |',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 | 3 |',
        '',
      ].join('\n'),
    );
    const found = scan(twoWidths.path, twoWidths.display);
    expect(found.tables).toBe(3);
    // Only the third table's row is wrong, and it is measured against that
    // table's own 2-column header — not against the 3-column table above it.
    expect(found.misfits).toHaveLength(1);
    expect(found.misfits[0]).toMatchObject({ width: 2, cells: 3 });
  });

  it('does not treat a pipe-row stranded below a table as one of its rows', () => {
    // The shape, and the reason a walk-back header resolver is not enough: the
    // row is a well-formed row of *something*, and a blank line is the only
    // thing that says it is not a row of this.
    const f = fixture(
      'stranded.md',
      ['| a | b |', '|---|---|', '| 1 | 2 |', '', '| 1 | 2 | 3 |', ''].join('\n'),
    );
    const found = scan(f.path, f.display);
    expect(found.tables).toBe(1);
    expect(found.misfits).toEqual([]);
  });

  it('reads CRLF, which is 40 of this repo\'s 49 markdown files', () => {
    // The failure that produced the 20 phantom rows in the recipe table above.
    // A CRLF file is parsed, and a well-formed three-column row in it is clean —
    // where the line-splitting recipe called the very same row under-wide.
    const f = fixture(
      'crlf.md',
      ['| # | Item | Status |', '|---|---|---|', '| E1 | docx.js quality sufficient | answered |', ''].join('\r\n'),
    );
    const found = scan(f.path, f.display);
    expect(found.tables).toBe(1);
    expect(found.misfits, 'a CRLF table is not a short one').toEqual([]);
  });
});
