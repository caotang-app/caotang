/**
 * The shot-scoped context a draft is written from — [video-prompt-pack.md §7](../../../docs/architecture/video-prompt-pack.md),
 * riding the standard stack of [context-assembly.md §2–§3](../../../docs/architecture/context-assembly.md).
 *
 * This module builds the four layers that are specific to a shot:
 *
 *  - **L2, codex.** The entries this shot's references come from: the codex entries whose visual
 *    references `resolveReferences` supplies (§3), mentioned or named by the override. The layer and the
 *    references are one list, so an entry is in the prompt exactly when its reference is sent. Never a
 *    `never` entry, never an empty description. Budget 1,000 tokens. Pruned from the lowest rank up: a manual
 *    entry that came in through its attachment goes first, then mentioned entries, and `always` entries go
 *    last. Whole entries only, never mid-body.
 *  - **L3, folder chain.** The shot's ancestor folders, title and synopsis. Budget 1,200 tokens. The
 *    nearest folder is kept first; the farthest is pruned first.
 *  - **L4, prior shots.** The one-line prompt of each earlier shot for this vendor, in storyboard order.
 *    Budget 1,000 tokens. The nearest shots are kept first.
 *  - **L5, focus.** The covered script, then the shot's action and image caption. Budget 2,000 tokens.
 *    The action and caption are kept whole. Covered script that does not fit is cut, and the cut is
 *    marked in the text and in the preview. Nothing is cut silently.
 *
 * L0 (system), L1 (project summary), L6 (conversation memory) and L7 (the task) belong to the harness
 * and the drafter. The assembly is a pure function of its inputs, so the same storyboard always yields
 * the same bytes, which is what the evals rely on.
 */

import { estimateTokens, sortCodex } from '@caotang/codex';

import { clean, joinWords, promptParts, sentence } from './compose.js';
import { resolveReferences, type SuppliedEntry } from './references.js';
import type { CodexEntryWithRefs, ShotNode, StoryboardSnapshot, VideoReference, VideoShotRef } from './model.js';
import { folderChain } from './shot.js';

/** The per-layer budgets, in tokens on the `ceil(chars / 4)` estimate (context-assembly §3). */
export const SHOT_CONTEXT_BUDGET = {
  codex: 1000,
  folders: 1200,
  priorShots: 1000,
  focus: 2000,
} as const;

const CUT_MARKER = '[... covered script cut to fit the budget; the rest is in the manuscript ...]';

export type ShotLayer = 'L2' | 'L3' | 'L4' | 'L5';

/** What one layer kept and what it cut, named so the plan card can show the writer. */
export interface LayerPreview {
  readonly layer: ShotLayer;
  readonly name: string;
  readonly budget: number;
  readonly tokens: number;
  /** The items the layer kept, by name, in the order the layer renders them. */
  readonly included: readonly string[];
  /** The whole items the layer cut, in the order they were cut. */
  readonly pruned: readonly string[];
  /** True when text inside an item was cut to fit (L5 only). */
  readonly truncated: boolean;
}

export interface ShotContext {
  readonly codex: string;
  readonly folders: string;
  readonly priorShots: string;
  readonly focus: string;
  readonly layers: readonly LayerPreview[];
  /** The codex entry ids L2 kept. The preview names them against the references they supplied. */
  readonly codexEntryIds: readonly string[];
}

export interface ContextInput {
  readonly shot: ShotNode;
  readonly storyboard: StoryboardSnapshot;
  readonly vendor: string;
  /** The shot numbers and storyboard order, from `shotNumbers` and `storyboardRank`. Computed once per call. */
  readonly shotNumbers: ReadonlyMap<string, number>;
  readonly storyboardRank: ReadonlyMap<string, number>;
  /** The prompt record each shot currently has for this vendor, including drafts staged in the same call. */
  readonly promptOf: (shotId: string) => VideoShotRef | undefined;
  /**
   * The shot's prompt record references for this vendor. Non-empty means an override (§3), and L2 follows
   * it exactly as the references do: an entry the override names is in L2 when it supplies a reference.
   */
  readonly override?: readonly VideoReference[];
}

/** The prefix of `costs` that fits in `budget`. A later item is never kept over an earlier one that was cut. */
function prefixFit(costs: readonly number[], budget: number): number {
  let used = 0;
  let count = 0;
  for (const cost of costs) {
    if (used + cost > budget) break;
    used += cost;
    count += 1;
  }
  return count;
}

/** The estimated tokens of a rendered item, plus the newline that joins it to the next. */
function costOf(text: string): number {
  return estimateTokens(`${text}\n`);
}

/**
 * The prune rank of an L2 entry. The lowest rank is kept first, so the rank runs `always` (kept first, pruned
 * last), then the mentioned and overridden entries, then a `manual` entry that came in through its attachment
 * (codex.md §6 step 5: manual entries go before detected ones).
 */
function rankOf(entry: CodexEntryWithRefs, supplied: SuppliedEntry): number {
  if (entry.includePolicy === 'always') return 0;
  if (entry.includePolicy === 'manual' && supplied.reason === 'mentioned') return 2;
  return 1;
}

function renderEntry(entry: CodexEntryWithRefs): string {
  return `## ${entry.name} (${entry.type})\n${entry.description.trim()}`;
}

/**
 * L2: the codex entries the shot's references come from, pruned whole by rank and rendered in codex order.
 * The entries are the ones `resolveReferences` supplies, so an entry is in the prompt exactly when its
 * reference is sent, and the two cannot disagree.
 */
function codexLayer(input: ContextInput): { text: string; preview: LayerPreview; entryIds: string[] } {
  const { shot, storyboard } = input;
  const { provenance } = resolveReferences({ shot, override: input.override, storyboard });
  const supplied = new Map(provenance.supplied.map((item) => [item.entryId, item]));

  const items: { entry: CodexEntryWithRefs; rank: number }[] = [];
  for (const entry of sortCodex(storyboard.codex)) {
    const from = supplied.get(entry.id);
    if (from !== undefined) items.push({ entry, rank: rankOf(entry, from) });
  }

  const byRank = [...items].sort((a, b) => a.rank - b.rank);
  const kept = prefixFit(byRank.map((item) => costOf(renderEntry(item.entry))), SHOT_CONTEXT_BUDGET.codex);
  const keptIds = new Set(byRank.slice(0, kept).map((item) => item.entry.id));
  const inCodexOrder = items.filter((item) => keptIds.has(item.entry.id));
  const text = inCodexOrder.map((item) => renderEntry(item.entry)).join('\n\n');
  const included = inCodexOrder.map((item) => item.entry.name);
  const pruned = byRank.slice(kept).map((item) => item.entry.name);
  return {
    text,
    entryIds: inCodexOrder.map((item) => item.entry.id),
    preview: { layer: 'L2', name: 'codex', budget: SHOT_CONTEXT_BUDGET.codex, tokens: estimateTokens(text), included, pruned, truncated: false },
  };
}

/** L3: the ancestor folders, nearest first when deciding what to keep, and root first when rendering. */
function folderLayer(input: ContextInput): { text: string; preview: LayerPreview } {
  const chain = folderChain(input.shot.id, input.storyboard.tree);
  const lines = chain.map((link) => (link.synopsis.trim() === '' ? `- ${link.title}` : `- ${link.title}: ${clean(link.synopsis)}`));
  const kept = prefixFit(lines.map(costOf), SHOT_CONTEXT_BUDGET.folders);
  const text = lines.slice(0, kept).reverse().join('\n');
  return {
    text,
    preview: {
      layer: 'L3',
      name: 'folder chain',
      budget: SHOT_CONTEXT_BUDGET.folders,
      tokens: estimateTokens(text),
      included: chain.slice(0, kept).map((link) => link.title).reverse(),
      pruned: chain.slice(kept).map((link) => link.title),
      truncated: false,
    },
  };
}

/** One line of a prompt: camera, then subject and action, then style. Used for the story-so-far. */
export function promptLine(prompt: VideoShotRef['prompt']): string {
  const parts = promptParts(prompt);
  return [parts.camera, joinWords([parts.subject, parts.action]), parts.style].filter((part) => part !== '').join('; ');
}

/** L4: the prompts of the shots before this one, nearest first when deciding, in storyboard order when rendering. */
function priorLayer(input: ContextInput): { text: string; preview: LayerPreview } {
  const { shot, storyboard, shotNumbers, storyboardRank, promptOf } = input;
  const nodes = new Map(storyboard.tree.map((node) => [node.id, node]));
  // Shot numbers restart in each storyboard folder, so a label names the folder as well.
  const labelOf = (id: string): string => {
    const folder = nodes.get(nodes.get(id)?.parentId ?? '')?.title ?? 'Storyboard';
    return `${folder}, shot ${shotNumbers.get(id) ?? '?'}`;
  };
  const here = storyboardRank.get(shot.id);
  const prior: { id: string; line: string }[] = [];
  if (here !== undefined) {
    for (const other of storyboard.shots) {
      const rank = storyboardRank.get(other.id);
      if (other.id === shot.id || rank === undefined || rank >= here) continue;
      const ref = promptOf(other.id);
      const line = ref === undefined ? '' : promptLine(ref.prompt);
      if (line !== '') prior.push({ id: other.id, line });
    }
  }
  prior.sort((a, b) => (storyboardRank.get(b.id) ?? 0) - (storyboardRank.get(a.id) ?? 0));
  const rendered = prior.map((item) => `${labelOf(item.id)}: ${sentence(item.line)}`);
  const kept = prefixFit(rendered.map(costOf), SHOT_CONTEXT_BUDGET.priorShots);
  const text = rendered.slice(0, kept).reverse().join('\n');
  return {
    text,
    preview: {
      layer: 'L4',
      name: 'prior shots',
      budget: SHOT_CONTEXT_BUDGET.priorShots,
      tokens: estimateTokens(text),
      included: prior.slice(0, kept).map((item) => labelOf(item.id)).reverse(),
      pruned: prior.slice(kept).map((item) => labelOf(item.id)),
      truncated: false,
    },
  };
}

/**
 * L5: the covered script, then the action and the image caption. The action and caption are kept
 * whole. Covered script that does not fit is cut at a line break where one is near, and the cut is
 * marked in the text.
 */
function focusLayer(shot: ShotNode): { text: string; preview: LayerPreview } {
  const action = clean(shot.action);
  const caption = clean(shot.imageAlt);
  const reserved = [action === '' ? '' : `Shot action: ${action}`, caption === '' ? '' : `Image caption: ${caption}`]
    .filter((line) => line !== '')
    .join('\n');
  const covered = shot.covered
    .filter((block) => block.text.trim() !== '')
    .map((block) => `[${block.label}]\n${block.text.trim()}`)
    .join('\n\n');
  const coveredBlock = covered === '' ? '' : `Covered script:\n${covered}`;
  const budgetChars = SHOT_CONTEXT_BUDGET.focus * 4;
  const whole = [coveredBlock, reserved].filter((part) => part !== '').join('\n\n');

  let text = whole;
  let truncated = false;
  if (whole.length > budgetChars) {
    truncated = true;
    const room = budgetChars - reserved.length - 2 - 'Covered script:\n'.length - CUT_MARKER.length - 1;
    if (room > 0 && covered !== '') {
      const head = covered.slice(0, room);
      const lineBreak = head.lastIndexOf('\n');
      const cut = lineBreak > room / 2 ? head.slice(0, lineBreak) : head;
      text = [`Covered script:\n${cut}\n${CUT_MARKER}`, reserved].filter((part) => part !== '').join('\n\n');
    } else {
      text = reserved.slice(0, budgetChars - CUT_MARKER.length - 1) + `\n${CUT_MARKER}`;
    }
  }

  return {
    text,
    preview: {
      layer: 'L5',
      name: 'focus',
      budget: SHOT_CONTEXT_BUDGET.focus,
      tokens: estimateTokens(text),
      included: [...shot.covered.filter((block) => block.text.trim() !== '').map((block) => block.label), ...(action === '' ? [] : ['action']), ...(caption === '' ? [] : ['caption'])],
      pruned: [],
      truncated,
    },
  };
}

/** Assembles the four shot-scoped layers for one shot and one vendor. Pure. */
export function assembleShotContext(input: ContextInput): ShotContext {
  const codex = codexLayer(input);
  const folders = folderLayer(input);
  const prior = priorLayer(input);
  const focus = focusLayer(input.shot);
  return {
    codex: codex.text,
    folders: folders.text,
    priorShots: prior.text,
    focus: focus.text,
    layers: [codex.preview, folders.preview, prior.preview, focus.preview],
    codexEntryIds: codex.entryIds,
  };
}
