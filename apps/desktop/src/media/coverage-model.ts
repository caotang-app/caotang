/**
 * The dialogue coverage picker's model (storyboard.md §3.2): which script a shot covers, captured as a `TextAnchor` from text the
 * writer selected in that script, and the `shot.setMeta` that records it. Nothing here applies anything.
 *
 * The anchor is captured fresh, against the stored body as it stands when the writer covers the text (edit-anchors.md §2), and
 * never stored as the raw offsets of a view. A selection the body cannot place exactly is refused, rather than guessed at.
 */

import { getBody, getRevision, nodeById, type ProjectState, type TreeNode } from '@caotang/store';

import {
  captureTextAnchor,
  isShotNode,
  locateQuote,
  readShotMeta,
  shotFieldOf,
  storedValueOf,
  type DialogueCoverage,
  type ShotCommand,
  type StoryboardResult,
  type TextAnchor,
} from './engines.js';

/** A document the picker can cover text in: a screenplay scene, or a prose document. */
export interface ScriptChoice {
  readonly id: string;
  readonly title: string;
  readonly kind: 'screenplay' | 'prose';
}

/** The documents a shot can cover, in the binder's tree order. A dialogue container is not a script the picker offers. */
export function scriptChoicesOf(state: ProjectState): ScriptChoice[] {
  return state.manifest.tree.flatMap((node: TreeNode): ScriptChoice[] => {
    if (node.type !== 'document') return [];
    if (node.kind === 'screenplay') return [{ id: node.id, title: node.title, kind: 'screenplay' }];
    if (node.kind === undefined) return [{ id: node.id, title: node.title, kind: 'prose' }];
    return [];
  });
}

/** The text the writer selected in the picker, with where it sits in the text the picker shows. */
export interface SelectedText {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

type Captured = { readonly ok: true; readonly anchor: TextAnchor } | { readonly ok: false; readonly message: string };

/**
 * The anchor for the writer's selection in one document, captured against the stored body now. The offsets are used as the
 * picker showed them when the stored text has no carriage returns, because then the shown text and the stored text are the same
 * string. Otherwise the selected words are located in the stored text, and only a single place is accepted.
 */
export function captureSelection(state: ProjectState, docId: string, selected: SelectedText): Captured {
  const node = nodeById(state, docId);
  if (node === undefined || node.type !== 'document') return { ok: false, message: 'that document is no longer in the project' };
  if (selected.text.trim() === '') return { ok: false, message: 'select the words the shot covers in the text above, then cover them' };
  const body = getBody(state, docId);
  const revision = getRevision(state, docId);
  if (!body.includes('\r')) {
    if (body.slice(selected.from, selected.to) !== selected.text) {
      return { ok: false, message: 'the text changed since it was selected, so select it again' };
    }
    return anchorOf(body, selected.from, selected.to, revision);
  }
  const located = locateQuote(body, selected.text);
  if (located.status === 'many') return { ok: false, message: 'that text appears more than once in the document; select a longer passage' };
  if (located.status === 'none') return { ok: false, message: 'the selected text could not be found in the stored text, so select it again' };
  return anchorOf(body, located.from, located.to, revision);
}

function anchorOf(body: string, from: number, to: number, revision: number): Captured {
  const anchor = captureTextAnchor(body, from, to, revision);
  if (anchor === undefined) return { ok: false, message: 'the selection is longer than the 2000 characters a coverage can hold, so cover a shorter passage' };
  return { ok: true, anchor };
}

/** The coverage a shot holds, read back into the words the picker lists: the document, the covered text, and its index. */
export interface CoverageRow {
  readonly index: number;
  readonly docId: string;
  readonly title: string;
  readonly text: string;
}

export function coverageRowsOf(state: ProjectState, shotId: string): CoverageRow[] {
  const node = nodeById(state, shotId);
  if (node === undefined || !isShotNode(node)) return [];
  const entries = readShotMeta(shotFieldOf(node)).meta.dialogue ?? [];
  return entries.map((entry: DialogueCoverage, index) => ({
    index,
    docId: entry.docId,
    title: nodeById(state, entry.docId)?.title ?? 'A document that is no longer in the project',
    text: entry.anchor.exact,
  }));
}

/** The `shot.setMeta` that adds one coverage to a shot, after the coverage it already holds. */
export function coverCommand(state: ProjectState, shotId: string, docId: string, anchor: TextAnchor): StoryboardResult<ShotCommand> {
  return rewriteCoverage(state, shotId, (current) => [...current, { kind: 'fountain-element', docId, anchor }]);
}

/** The `shot.setMeta` that removes one coverage from a shot, by its position in the list. */
export function uncoverCommand(state: ProjectState, shotId: string, index: number): StoryboardResult<ShotCommand> {
  return rewriteCoverage(state, shotId, (current) => current.filter((_, at) => at !== index));
}

function rewriteCoverage(
  state: ProjectState,
  shotId: string,
  next: (current: readonly DialogueCoverage[]) => readonly DialogueCoverage[],
): StoryboardResult<ShotCommand> {
  const node = nodeById(state, shotId);
  if (node === undefined || !isShotNode(node)) return { ok: false, refusal: { code: 'not-a-shot', message: `no shot "${shotId}" to cover` } };
  const raw = shotFieldOf(node);
  const base: Record<string, unknown> = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const current = readShotMeta(raw).meta.dialogue ?? [];
  base.dialogue = next(current);
  const stored = storedValueOf(readShotMeta(base));
  const empty = stored === null || typeof stored !== 'object' || Object.keys(stored).length === 0;
  return {
    ok: true,
    value: {
      name: 'shot.setMeta',
      params: { nodeId: shotId, stored: empty ? null : (stored as Readonly<Record<string, unknown>>), expect: raw === undefined ? null : raw },
    },
  };
}
