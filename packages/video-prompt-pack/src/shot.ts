/**
 * Reads the storyboard the pack works over: shot numbers, storyboard order, the folder
 * chain of a shot, and the per-vendor upsert of a shot's `vendorRefs`.
 *
 * Everything here is a pure function of the snapshot. Shot numbers and order come from
 * the binder tree, never from a stored counter (storyboard.md §2.2: `shotNumber` is
 * derived, so a reorder renumbers for free).
 */

import type { TreeNode } from '@caotang/store';

import type { FolderLink, ShotNode, StoryboardSnapshot, VideoShotRef } from './model.js';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The children of every parent, in binder order. A tie on `order` is broken by id. */
export function childrenOf(tree: readonly TreeNode[]): Map<string | null, TreeNode[]> {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of tree) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.order - b.order || compareText(a.id, b.id));
  }
  return children;
}

/**
 * Each shot's 1-based number among the shots that share its parent folder. A shot
 * that is not in the snapshot's list has no number.
 */
export function shotNumbers(storyboard: StoryboardSnapshot): Map<string, number> {
  const shotIds = new Set(storyboard.shots.map((shot) => shot.id));
  const numbers = new Map<string, number>();
  for (const siblings of childrenOf(storyboard.tree).values()) {
    let count = 0;
    for (const node of siblings) {
      if (shotIds.has(node.id)) numbers.set(node.id, ++count);
    }
  }
  return numbers;
}

/**
 * The storyboard order of every shot: the binder's depth-first walk, counting only shots.
 * It is the order the story-so-far layer reads prior shots in (video-prompt-pack.md §7).
 */
export function storyboardRank(storyboard: StoryboardSnapshot): Map<string, number> {
  const shotIds = new Set(storyboard.shots.map((shot) => shot.id));
  const children = childrenOf(storyboard.tree);
  const rank = new Map<string, number>();
  const seen = new Set<string>();
  const visit = (parentId: string | null): void => {
    for (const node of children.get(parentId) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (shotIds.has(node.id)) rank.set(node.id, rank.size);
      visit(node.id);
    }
  };
  visit(null);
  return rank;
}

/**
 * The folders above a shot, nearest first, without the project root. The root's title
 * and synopsis describe the project, not the place the shot is in, so it is left out.
 */
export function folderChain(shotId: string, tree: readonly TreeNode[]): FolderLink[] {
  const nodes = new Map(tree.map((node) => [node.id, node]));
  const chain: FolderLink[] = [];
  const seen = new Set<string>([shotId]);
  let cursor = nodes.get(shotId)?.parentId ?? null;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (node === undefined) break;
    if (node.type !== 'root') chain.push({ id: node.id, title: node.title, synopsis: node.synopsis });
    cursor = node.parentId;
  }
  return chain;
}

/** The shot itself and its folders: the focus scope a manual codex attachment applies to (codex.md §5). */
export function scopeIdsOf(shotId: string, tree: readonly TreeNode[]): Set<string> {
  return new Set([shotId, ...folderChain(shotId, tree).map((link) => link.id)]);
}

export function shotById(storyboard: StoryboardSnapshot, shotId: string): ShotNode | undefined {
  return storyboard.shots.find((shot) => shot.id === shotId);
}

/** The shot's prompt record for one vendor, when it has one (storyboard.md §2.2 `vendorRefs`). */
export function vendorRefOf(shot: ShotNode, vendor: string): VideoShotRef | undefined {
  return shot.vendorRefs?.find((ref) => ref.vendor === vendor);
}

/**
 * The shot's `vendorRefs` after one vendor's record is set. A record for the vendor is
 * replaced where it stands, and a new vendor's record is appended. The input is not mutated.
 */
export function withVendorRef(refs: readonly VideoShotRef[] | undefined, ref: VideoShotRef): VideoShotRef[] {
  const current = refs ?? [];
  if (current.some((existing) => existing.vendor === ref.vendor)) {
    return current.map((existing) => (existing.vendor === ref.vendor ? ref : existing));
  }
  return [...current, ref];
}
