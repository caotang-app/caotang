/**
 * L1 — the project summary — [context-assembly.md §2](../../../../docs/architecture/context-assembly.md).
 *
 * The fields of the `project.overview` response: title, a binder tree, vocabulary, word
 * counts, the session's progress, and the saved-filter and goal counts. The overview tool
 * is an implementation in the harness and is not exported, so the fields are written here
 * in the same order. Goal rows (name and target) are not rendered, only the count; see the
 * knownGaps for the packaging change that would share the harness's overview instead.
 *
 * L1 is never truncated. Its budget decides the shape instead: the two-level tree when it
 * fits, and the depth-one summary with document counts when it does not (§2: "larger
 * trees → depth-1 + doc count").
 */

import { countBody, getBody, type ProjectState, type TreeNode } from '@caotang/store';

import { estimateTokens } from '../tokens.js';
import { formatCount } from '../text.js';
import { ROOT_ID, type TreeIndex } from '../tree.js';
import { LAYER_NAMES, type AppSnapshot } from '../types.js';

export interface ProjectLayer {
  readonly text: string;
  readonly notes: readonly string[];
}

function wordsOf(state: ProjectState, node: TreeNode): number {
  return state.manifest.derived.wordCounts[node.id] ?? countBody(getBody(state, node.id)).words;
}

/** Every document under a node, counted recursively. */
function documentsUnder(tree: TreeIndex, node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (current: TreeNode): void => {
    if (current.type === 'document') out.push(current);
    for (const child of tree.children.get(current.id) ?? []) visit(child);
  };
  visit(node);
  return out;
}

function nodeLabel(node: TreeNode): string {
  const status = node.status === null ? '' : `, status ${node.status}`;
  return `${node.title} (${node.type}${status})`;
}

/** `1 item`, `2 items`: a count with its noun, singular for one. */
function counted(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

function binderLines(tree: TreeIndex, depth: 1 | 2): string[] {
  const parts = tree.children.get(ROOT_ID) ?? [];
  const lines: string[] = [];
  for (const part of parts) {
    if (depth === 1) {
      const children = tree.children.get(part.id) ?? [];
      const documents = documentsUnder(tree, part).length;
      lines.push(`- ${part.title} (${part.type}): ${counted(children.length, 'item')}, ${counted(documents, 'document')}`);
      continue;
    }
    lines.push(`- ${nodeLabel(part)}`);
    for (const child of tree.children.get(part.id) ?? []) lines.push(`  - ${nodeLabel(child)}`);
  }
  return lines.length === 0 ? ['- (no binder)'] : lines;
}

function vocabularyLine(terms: readonly { id: string; name: string }[]): string {
  return terms.length === 0 ? 'none' : terms.map((term) => `${term.id} (${term.name})`).join(', ');
}

export function projectLayer(
  tree: TreeIndex,
  app: AppSnapshot,
  budgetTokens: number,
): ProjectLayer {
  const { state } = app;
  const documents = [...tree.nodes.values()].filter((node) => node.type === 'document');
  const words = documents.reduce((sum, node) => sum + wordsOf(state, node), 0);
  const session =
    app.session === undefined
      ? 'Session: progress unavailable.'
      : app.session.target === undefined
        ? `Session: ${formatCount(app.session.todayWords)} words today; no target set.`
        : `Session: ${formatCount(app.session.todayWords)} words today, target ${formatCount(app.session.target)}.`;
  const filters = state.manifest.filters?.length ?? 0;
  const goals = state.manifest.goals?.length ?? 0;

  const header = [
    `# ${LAYER_NAMES.L1}`,
    `Title: ${state.manifest.project.name}`,
    `Documents: ${documents.length}. Words: ${formatCount(words)}.`,
    session,
    `Statuses: ${vocabularyLine(state.manifest.vocabulary.statuses)}.`,
    `Labels: ${vocabularyLine(state.manifest.vocabulary.labels)}.`,
    `Saved filters: ${filters}. Goals: ${goals}.`,
  ];
  const notes: string[] = [];
  if (documents.length === 0) {
    header.push('The project has no documents yet. Use binder.restructure to create chapters.');
  }

  const full = [...header, 'Binder:', ...binderLines(tree, 2)].join('\n');
  if (estimateTokens(full) <= budgetTokens) return { text: full, notes };

  notes.push('The binder is shown at depth one. binder.read_tree shows any part in full.');
  const shallow = [...header, 'Binder (depth one):', ...binderLines(tree, 1)].join('\n');
  return { text: shallow, notes };
}
