/**
 * The shot list as CSV — storyboard.md §6. The expected text is written out literally, so the quoting and
 * the line endings are checked against the bytes, not against the renderer's own helper.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { addFolder, removeNode } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import {
  SHOT_LIST_COLUMNS,
  ShotListCsvRenderer,
  addShotNode,
  addStoryboardFolder,
  csvCell,
  guardFormula,
  importImage,
  renderShotListCsv,
  setStoredMeta,
  shotFieldOf,
  storedOf,
} from '../src/index.js';

import { CountingFs, NOW, SCENE_BODY, buildFixture, pngBytes } from './fixtures.js';

const spec = readFileSync(resolve(__dirname, '../../../docs/architecture/storyboard.md'), 'utf8');

/** The shot-list columns as storyboard.md §6 names them, read from the file, so the header is checked against the spec. */
const SPEC_COLUMNS: readonly string[] =
  (spec.split('\n').find((text) => text.includes('columns = shotNumber')) ?? '')
    .split('columns = ')[1]
    ?.split(' (StudioBinder')[0]
    ?.replace(/\s*\([^)]*\)/g, '')
    .split(', ') ?? [];

const HEADER = `${SPEC_COLUMNS.join(',')}\r\n`;
const ASSET = 'a_7K2QX9M4A1';

/**
 * A small RFC 4180 reader, for the round trip. It undoes the quoting `csvCell` writes, so a test asserts on
 * the cell's text and not on the bytes around it.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    } else if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
    } else if (ch === '\r' && text.charAt(i + 1) === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 2;
    } else {
      cell += ch;
      i += 1;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A fixture with two storyboards: the first holds two shots, the second one whose shot size the load kept as unknown. */
function project() {
  const fixture = buildFixture();
  const { state } = fixture;
  const quote = 'Elena crosses the empty quay. Gulls circle.';
  const from = SCENE_BODY.indexOf(quote);
  addShotNode(state, {
    parentId: 'board1',
    title: 'one',
    stored: {
      image: ASSET,
      shotSize: 'WS',
      cameraAngle: 'eye',
      cameraMovement: 'static',
      lens: '35mm',
      action: 'Elena crosses, slowly.',
      dialogue: [
        { kind: 'fountain-element', docId: 'scene1', anchor: { from, to: from + quote.length, exact: quote, prefix: '', suffix: '', capturedRevision: 0 } },
      ],
      durationSec: 2.5,
      transition: 'cut',
    },
    id: 'n_SHOTONE001',
    now: NOW,
  });
  addShotNode(state, {
    parentId: 'board1',
    title: 'two',
    stored: { action: 'Line "quoted"\nand a second line', durationSec: 3 },
    id: 'n_SHOTTWO001',
    now: NOW,
  });
  addStoryboardFolder(state, { parentId: 'manuscript', title: 'Later — Shots', id: 'n_BOARDLATER', now: NOW });
  addShotNode(state, { parentId: 'n_BOARDLATER', title: 'three', stored: { shotSize: 'XXL' }, id: 'n_SHOTLATE01', now: NOW });
  return { state };
}

const FILE_NAMES = new Map([[ASSET, `${ASSET}.png`]]);

describe('the header and the column order', () => {
  it('has the spec’s ten columns in the spec’s order, under the spec’s own header names', () => {
    expect(SPEC_COLUMNS).toHaveLength(10);
    expect(SPEC_COLUMNS[1]).toBe('image filename');
    expect([...SHOT_LIST_COLUMNS]).toEqual([...SPEC_COLUMNS]);
  });

  it('writes the header line first, as UTF-8 text terminated by CRLF (RFC 4180)', () => {
    expect(renderShotListCsv(project().state, [], FILE_NAMES).csv).toBe(HEADER);
  });
});

describe('the rows', () => {
  it('lists the shots in binder order, one row each, numbered 1 to n across the storyboards', () => {
    const { csv, rowCount, notes } = renderShotListCsv(project().state, undefined, FILE_NAMES);
    expect(rowCount).toBe(3);
    expect(notes).toEqual([]);
    expect(csv).toBe(
      [
        HEADER.trimEnd(),
        `1,${ASSET}.png,WS,eye,static,35mm,"Elena crosses, slowly.",Harbour:Elena crosses the empty quay. Gulls circle.,2.5,cut`,
        `2,,,,,,"Line ""quoted""\nand a second line",,3,`,
        '3,,XXL,,,,,,,',
        '',
      ].join('\r\n'),
    );
  });

  it('quotes a cell with a comma, doubles an inner quote, and keeps a line break inside the quotes', () => {
    const lines = renderShotListCsv(project().state, undefined, FILE_NAMES).csv.split('\r\n');
    expect(lines[1]).toContain('"Elena crosses, slowly."');
    expect(lines[2]).toContain('"Line ""quoted""\nand a second line"');
  });

  it('lists only the subtree of a selection, and keeps the numbers that subtree gives', () => {
    const { csv, rowCount } = renderShotListCsv(project().state, ['n_BOARDLATER'], FILE_NAMES);
    expect(rowCount).toBe(1);
    expect(csv).toBe(`${HEADER}1,,XXL,,,,,,,\r\n`);
  });

  it('writes a value the load kept as unknown as typed, so the list shows what the writer wrote', () => {
    const { csv } = renderShotListCsv(project().state, ['n_BOARDLATER'], FILE_NAMES);
    expect(csv).toContain(',XXL,');
  });

  it('writes a header and no rows for an empty selection', () => {
    expect(renderShotListCsv(project().state, [])).toEqual({ csv: HEADER, rowCount: 0, notes: [] });
  });

  it('says so when a selection names a node the project does not hold, and lists nothing for it', () => {
    const result = renderShotListCsv(project().state, ['n_NOPE00001']);
    expect(result.notes).toEqual(['no node "n_NOPE00001" in the project, so nothing was listed for it']);
    expect(result.rowCount).toBe(0);
  });

  it('gives a blank image cell, and says so, when the image file is not in assets/', () => {
    const { csv, notes } = renderShotListCsv(project().state, ['board1'], new Map());
    expect(csv.split('\r\n')[1]?.startsWith('1,,WS')).toBe(true);
    expect(notes.join('\n')).toContain(`image ${ASSET} has no file in assets/`);
  });

  it('writes the dialogue as the scene’s title and the covered line, and names a scene that has gone', () => {
    const fixture = project();
    removeNode(fixture.state, 'scene1');
    const { csv } = renderShotListCsv(fixture.state, ['board1'], FILE_NAMES);
    expect(csv).toContain('(missing document scene1):Elena crosses the empty quay. Gulls circle.');
  });

  it('formats a whole-second duration with no decimal point', () => {
    const { csv } = renderShotListCsv(project().state, ['board1'], FILE_NAMES);
    expect(csv.split('\r\n')[2]).toContain(',3,');
  });
});

describe('csvCell: RFC 4180 quoting', () => {
  it('leaves a plain cell and an empty one unquoted', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('')).toBe('');
  });

  it('quotes a cell with a comma, a quote, a carriage return or a line feed, and doubles its quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"');
  });
});

describe('the renderer class reads the assets folder for the image column', () => {
  it('names the file a shot’s image is stored under', async () => {
    const fixture = project();
    const fs = new CountingFs();
    const imported = await importImage(fs, pngBytes(), {});
    if (!imported.ok) throw new Error('import failed');
    const shot = fixture.state.manifest.tree.find((node) => node.id === 'n_SHOTONE001');
    if (shot === undefined) throw new Error('fixture has no shot');
    setStoredMeta(shot, { ...(storedOf(shotFieldOf(shot)) ?? {}), image: imported.value.assetId });

    const result = await new ShotListCsvRenderer().render(fs, fixture.state, ['board1']);
    expect(result.csv.split('\r\n')[1]?.startsWith(`1,${imported.value.fileName},WS`)).toBe(true);
  });

  it('is the shot-list recipe the exporter will name', () => {
    expect(new ShotListCsvRenderer()).toMatchObject({ id: 'shot-list-csv', mime: 'text/csv' });
  });

  it('adds no rows for a plain folder that holds no shots', () => {
    const fixture = project();
    addFolder(fixture.state, { parentId: 'manuscript', title: 'Empty', id: 'n_EMPTYFOLD1', now: NOW });
    expect(renderShotListCsv(fixture.state).rowCount).toBe(3);
  });
});

describe('formula guard: a text cell a spreadsheet would evaluate is written as text', () => {
  it('prefixes an apostrophe to a text cell that opens with =, +, -, @, tab or CR, and to nothing else', () => {
    expect(guardFormula('=HYPERLINK("http://evil.example","open")')).toBe('\'=HYPERLINK("http://evil.example","open")');
    expect(guardFormula('+1')).toBe("'+1");
    expect(guardFormula('-1')).toBe("'-1");
    expect(guardFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(guardFormula('\t=1')).toBe("'\t=1");
    expect(guardFormula('\r=1')).toBe("'\r=1");
    expect(guardFormula('plain = not first')).toBe('plain = not first');
    expect(guardFormula('')).toBe('');
  });

  it('writes a formula in the action as text: it reads back with the apostrophe in front, and the quoting is intact', () => {
    const fixture = buildFixture();
    addShotNode(fixture.state, {
      parentId: 'board1',
      title: 'evil',
      stored: { action: '=HYPERLINK("http://evil.example","open")' },
      id: 'n_SHOTEVIL1',
      now: NOW,
    });
    const { csv } = renderShotListCsv(fixture.state, ['board1']);
    expect(parseCsv(csv)[1]?.[6]).toBe('\'=HYPERLINK("http://evil.example","open")');
    expect(csv).toContain('\'=HYPERLINK');
  });

  it('guards every text column, the enum cells included, and leaves the generated numbers alone', () => {
    const fixture = buildFixture();
    // An enum value the load keeps as unknown is written as typed, so it is text the writer could have typed as a formula.
    addShotNode(fixture.state, {
      parentId: 'board1',
      title: 'every column',
      stored: { shotSize: '=2+2', cameraAngle: '+eye', lens: '-lens', action: '@action', transition: '=cut', durationSec: 2.5 },
      id: 'n_SHOTEVERY',
      now: NOW,
    });
    const row = parseCsv(renderShotListCsv(fixture.state, ['board1']).csv)[1] ?? [];
    expect(row[0]).toBe('1');
    expect(row[2]).toBe("'=2+2");
    expect(row[3]).toBe("'+eye");
    expect(row[5]).toBe("'-lens");
    expect(row[6]).toBe("'@action");
    expect(row[8]).toBe('2.5');
    expect(row[9]).toBe("'=cut");
  });

  it('guards the dialogue cell, whose first character is the scene’s title', () => {
    const fixture = buildFixture();
    const scene = fixture.state.manifest.tree.find((node) => node.id === 'scene1');
    if (scene !== undefined) scene.title = '=SCENE';
    addShotNode(fixture.state, {
      parentId: 'board1',
      title: 'covers the scene',
      stored: {
        dialogue: [{ kind: 'fountain-element', docId: 'scene1', anchor: { from: 0, to: 4, exact: 'EXT.', prefix: '', suffix: '', capturedRevision: 0 } }],
      },
      id: 'n_SHOTCOVER',
      now: NOW,
    });
    const row = parseCsv(renderShotListCsv(fixture.state, ['board1']).csv)[1] ?? [];
    expect(row[7]).toBe("'=SCENE:EXT.");
  });
});
