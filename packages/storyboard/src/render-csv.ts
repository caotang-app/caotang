/**
 * The shot list as CSV — [storyboard.md](../../../docs/architecture/storyboard.md) §6, `ShotListCsvRenderer`.
 *
 * The columns are the spec's, in the spec's order: shotNumber, image filename, shotSize, cameraAngle,
 * cameraMovement, lens, action, dialogue, durationSec, transition. The convention is StudioBinder's
 * column set (§6), so a shot list reads the way a production person expects.
 *
 * Format: UTF-8, one row per shot in binder order, RFC 4180 quoting (a cell with a comma, a double
 * quote or a line break is wrapped in double quotes, with each inner quote doubled), and CRLF line
 * endings as RFC 4180 specifies. The numbers come from {@link exportNumbers}, the same function the
 * contact sheet uses, so a shot is numbered the same in both.
 *
 * A dialogue cell reads `DOC:cue` per covered range, joined by `; `: the scene's title and the first
 * line of the covered text. A range whose scene has gone is written with the id it had, so the row
 * still says what it covered.
 *
 * Every text cell is written through {@link guardFormula}: a cell a spreadsheet would evaluate as a
 * formula opens with an apostrophe. The numbers (shotNumber, durationSec) are generated and are not guarded.
 */

import { nodeById, type ArtifactFs, type ProjectState, type TreeNode } from '@caotang/store';

import { listAssets } from './assets.js';
import { durationText, type DialogueCoverage, type ShotEnumField } from './model.js';
import { shotFieldOf } from './nodes.js';
import { exportNumbers, shotsInBinderOrder } from './ordering.js';
import { readShotMeta } from './shot-meta.js';

/** The columns, in the order the spec gives them, under the header names the spec gives (storyboard.md §6). */
export const SHOT_LIST_COLUMNS = [
  'shotNumber',
  'image filename',
  'shotSize',
  'cameraAngle',
  'cameraMovement',
  'lens',
  'action',
  'dialogue',
  'durationSec',
  'transition',
] as const;

export type ShotListColumn = (typeof SHOT_LIST_COLUMNS)[number];

export type ShotListRow = Readonly<Record<ShotListColumn, string>>;

export const SHOT_LIST_MIME = 'text/csv';

/** RFC 4180 record terminator. */
export const CSV_NEWLINE = '\r\n';

/** The longest first line of a covered range the dialogue cell shows. */
const CUE_CHARS = 60;

/**
 * The first characters a spreadsheet reads as the start of a formula or a value it will evaluate (the OWASP
 * CSV-injection list). RFC 4180 quoting does not stop the evaluation, so a text cell that opens with one of
 * these is written with an apostrophe in front.
 */
const FORMULA_TRIGGERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

/**
 * A text cell made safe to open in a spreadsheet: a leading trigger gets an apostrophe. Applied to text only,
 * never to the generated numbers, which cannot start with a trigger.
 */
export function guardFormula(value: string): string {
  return FORMULA_TRIGGERS.includes(value.charAt(0)) ? `'${value}` : value;
}

/** One CSV cell, quoted only when it has to be. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(cells: readonly string[]): string {
  return cells.map((cell) => csvCell(cell)).join(',') + CSV_NEWLINE;
}

function firstLineOf(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  if (line === undefined) return '';
  const chars = [...line];
  return chars.length <= CUE_CHARS ? line : `${chars.slice(0, CUE_CHARS - 1).join('')}…`;
}

/** The `DOC:cue` references a shot's dialogue coverage renders as, one per covered range. */
export function dialogueRefs(state: ProjectState, dialogue: readonly DialogueCoverage[]): string[] {
  return dialogue.map((coverage) => {
    const doc = nodeById(state, coverage.docId);
    const title = doc !== undefined && doc.type === 'document' ? doc.title : `(missing document ${coverage.docId})`;
    const cue = firstLineOf(coverage.anchor.exact);
    return cue === '' ? title : `${title}:${cue}`;
  });
}

/** One shot's row. A value the load kept as unknown is written as typed, so the list shows what the writer wrote. */
function rowOf(
  state: ProjectState,
  node: TreeNode,
  shotNumber: number,
  fileNames: ReadonlyMap<string, string>,
  notes: string[],
): ShotListRow {
  const read = readShotMeta(shotFieldOf(node));
  // Every text cell goes through the formula guard; the numbers (shotNumber, durationSec) are generated.
  const enumCell = (field: ShotEnumField): string => {
    const value = read.meta[field] ?? read.unknownValues[field];
    return value === undefined ? '' : guardFormula(String(value));
  };

  let image = '';
  const assetId = read.meta.image;
  if (assetId !== undefined) {
    const fileName = fileNames.get(assetId);
    if (fileName === undefined) notes.push(`shot ${shotNumber}: image ${assetId} has no file in assets/, so the image column is blank`);
    else image = guardFormula(fileName);
  }

  return {
    shotNumber: String(shotNumber),
    'image filename': image,
    shotSize: enumCell('shotSize'),
    cameraAngle: enumCell('cameraAngle'),
    cameraMovement: enumCell('cameraMovement'),
    lens: guardFormula(read.meta.lens ?? ''),
    action: guardFormula(read.meta.action ?? ''),
    dialogue: guardFormula(dialogueRefs(state, read.meta.dialogue ?? []).join('; ')),
    durationSec: read.meta.durationSec === undefined ? '' : durationText(read.meta.durationSec),
    transition: enumCell('transition'),
  };
}

/** The shot list as text, with the notes the build raised. */
export interface ShotListCsv {
  readonly csv: string;
  readonly rowCount: number;
  readonly notes: readonly string[];
}

/**
 * Renders the shot list for `selection` (node ids whose subtree is listed), or for the whole
 * project when there is no selection. `fileNames` maps an asset id to its file name in `assets/`;
 * the class below lists the folder for the caller.
 */
export function renderShotListCsv(
  state: ProjectState,
  selection?: readonly string[],
  fileNames: ReadonlyMap<string, string> = new Map(),
): ShotListCsv {
  const notes: string[] = [];
  for (const id of selection ?? []) {
    if (nodeById(state, id) === undefined) notes.push(`no node "${id}" in the project, so nothing was listed for it`);
  }
  const shots = shotsInBinderOrder(state, selection);
  const numbers = exportNumbers(shots);
  let csv = csvLine(SHOT_LIST_COLUMNS);
  for (const node of shots) {
    const row = rowOf(state, node, numbers.get(node.id) ?? 0, fileNames, notes);
    csv += csvLine(SHOT_LIST_COLUMNS.map((column) => row[column]));
  }
  return { csv, rowCount: shots.length, notes };
}

/** The shot-list renderer, as the exporter's recipe names it. */
export class ShotListCsvRenderer {
  readonly id = 'shot-list-csv';
  readonly mime = SHOT_LIST_MIME;

  /** Lists `assets/` first, so the image column carries the file name the card points at. */
  async render(fs: ArtifactFs, state: ProjectState, selection?: readonly string[]): Promise<ShotListCsv> {
    const fileNames = new Map((await listAssets(fs)).map((asset) => [asset.assetId, asset.fileName] as const));
    return renderShotListCsv(state, selection, fileNames);
  }
}
