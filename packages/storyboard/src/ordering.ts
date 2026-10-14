/**
 * Shot ordering and numbering — [storyboard.md](../../../docs/architecture/storyboard.md) §2.2 and §3.1.
 *
 * Three rules, each stated once here:
 *
 * 1. **Order is sibling order.** A storyboard folder's cards are its shot children sorted by
 *    `order`, with ties kept in manifest-array order: the same rule the store's `siblingIndex`
 *    applies, so the two never disagree about where a card sits.
 * 2. **Binder order is the depth-first walk** of the tree, children taken in sibling order. An
 *    export lists its shots in that order (§6), whatever the selection.
 * 3. **`shotNumber` is derived, never stored** (§2.2). A card's number is its 1-based position in
 *    its storyboard folder, which is the number the corkboard chips show. An export numbers the
 *    shots it lists from 1 in binder order, so a single-storyboard export and the corkboard agree,
 *    and a multi-storyboard export has no repeated numbers. Renumbering on a reorder costs nothing:
 *    nothing is written but the moved node's `order`.
 */

import { nodeById, type ProjectState, type TreeNode } from '@caotang/store';

import type { ShotCommand } from './commands.js';
import { isShotNode, isStoryboardFolder } from './model.js';
import { ok, refuse, type StoryboardResult } from './result.js';

/** A node's children in sibling order. Ties keep the manifest's array order, as the store's `siblingIndex` does. */
export function childrenOf(state: ProjectState, parentId: string): TreeNode[] {
  return state.manifest.tree.filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order);
}

/** One node reached by the binder walk: whether the selection includes it, and how deep it sits. */
export interface BinderEntry {
  readonly node: TreeNode;
  readonly selected: boolean;
  readonly depth: number;
}

/**
 * The binder walk: every node reachable from a parentless root, depth first, children in sibling
 * order. With a `selection`, each node is marked selected when it or an ancestor is named, so one
 * walk answers "what is under these roots, in binder order". A node is visited once, which keeps a
 * malformed tree with a cycle from looping.
 */
export function walkBinder(state: ProjectState, selection?: readonly string[]): BinderEntry[] {
  const chosen = selection === undefined ? undefined : new Set(selection);
  const out: BinderEntry[] = [];
  const seen = new Set<string>();

  const visit = (node: TreeNode, inherited: boolean, depth: number): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const selected = inherited || chosen === undefined || chosen.has(node.id);
    out.push({ node, selected, depth });
    for (const child of childrenOf(state, node.id)) visit(child, selected, depth + 1);
  };

  const roots = state.manifest.tree.filter((node) => node.parentId === null).sort((a, b) => a.order - b.order);
  for (const root of roots) visit(root, false, 0);
  return out;
}

/** Every storyboard folder, in binder order. */
export function storyboardFolders(state: ProjectState): TreeNode[] {
  return walkBinder(state)
    .map((entry) => entry.node)
    .filter((node) => isStoryboardFolder(node));
}

/** The shot children of a folder, in sibling order. A non-shot child is not a card and is not listed. */
export function shotsIn(state: ProjectState, folderId: string): TreeNode[] {
  return childrenOf(state, folderId).filter((node) => isShotNode(node));
}

/**
 * The shots under a selection (or the whole project), in binder order. Shots are listed wherever
 * they sit under the selection, whether or not their folder is a storyboard, because an export
 * should not silently drop a card a writer put in a plain folder.
 */
export function shotsInBinderOrder(state: ProjectState, selection?: readonly string[]): TreeNode[] {
  return walkBinder(state, selection)
    .filter((entry) => entry.selected && isShotNode(entry.node))
    .map((entry) => entry.node);
}

/** The corkboard's chip numbers for one storyboard: shot id to 1-based position among its shots. */
export function displayNumbers(state: ProjectState, folderId: string): Map<string, number> {
  return new Map(shotsIn(state, folderId).map((node, index) => [node.id, index + 1]));
}

/** The number a shot shows in its own storyboard, or `undefined` when the node is not a card in one. */
export function displayNumberOf(state: ProjectState, shotId: string): number | undefined {
  const node = nodeById(state, shotId);
  if (node === undefined || !isShotNode(node) || node.parentId === null) return undefined;
  return displayNumbers(state, node.parentId).get(shotId);
}

/** The numbers an export prints: 1 to n across the shots it lists, in the order it lists them. */
export function exportNumbers(shots: readonly TreeNode[]): Map<string, number> {
  return new Map(shots.map((node, index) => [node.id, index + 1]));
}

/**
 * Plans a move of a shot to a position among a storyboard's shots, possibly in another storyboard.
 * The plan is one `binder.move` command, and nothing is moved here.
 *
 * `target.index` counts shots only, excluding the moved one, because that is the number the corkboard
 * shows. The command's `index` counts every sibling except the moved node, which is the unit the bus's
 * `binder.move` takes: the bus maps it to a stored order with the store's `siblingOrderAt`, so this
 * converts the shot-index first and the order is never written from here.
 */
export function planMoveShot(
  state: ProjectState,
  shotId: string,
  target: { readonly folderId: string; readonly index: number },
): StoryboardResult<ShotCommand> {
  const node = nodeById(state, shotId);
  if (node === undefined || !isShotNode(node)) return refuse('not-a-shot', `no shot "${shotId}". Read the storyboards with binder.read_tree.`);
  const folder = nodeById(state, target.folderId);
  if (folder === undefined || !isStoryboardFolder(folder)) {
    return refuse('not-a-storyboard', `"${target.folderId}" is not a storyboard folder, so no shot can move into it.`);
  }
  if (!Number.isInteger(target.index) || target.index < 0) return refuse('invalid-params', 'shot index must be a whole number, at least zero.');

  const others = childrenOf(state, folder.id).filter((sibling) => sibling.id !== shotId);
  const otherShots = others.filter((sibling) => isShotNode(sibling));
  const anchor = otherShots[target.index];
  const index = anchor === undefined ? others.length : others.indexOf(anchor);
  return ok({ name: 'binder.move', params: { nodeId: shotId, newParentId: folder.id, index } });
}
