/**
 * Binder-tree reads for the layers: sibling order, manuscript order, the enclosing folders
 * and the earlier siblings of a focus. All of them are pure reads of `manifest.tree`.
 *
 * Two orders matter here, and they are different. Sibling order is `order` then id, and it
 * decides which siblings are "before" a focus. Manuscript order is the depth-first walk of
 * the manuscript subtree in sibling order, and it decides which documents are "before" a
 * focus for the story so far (§2 L4). A document in Research is never in manuscript order.
 */

import type { TreeNode } from '@caotang/store';

import { compareText } from './text.js';

/** The store's fixed root and manuscript ids (create.ts). */
export const ROOT_ID = 'root';
export const MANUSCRIPT_ID = 'manuscript';

export interface TreeIndex {
  readonly nodes: ReadonlyMap<string, TreeNode>;
  /** Each parent's children, in sibling order. */
  readonly children: ReadonlyMap<string, readonly TreeNode[]>;
}

function bySibling(a: TreeNode, b: TreeNode): number {
  return a.order - b.order || compareText(a.id, b.id);
}

export function indexTree(tree: readonly TreeNode[]): TreeIndex {
  const nodes = new Map<string, TreeNode>();
  const grouped = new Map<string, TreeNode[]>();
  for (const node of tree) {
    nodes.set(node.id, node);
    if (node.parentId === null) continue;
    const siblings = grouped.get(node.parentId) ?? [];
    siblings.push(node);
    grouped.set(node.parentId, siblings);
  }
  const children = new Map<string, readonly TreeNode[]>();
  for (const [parent, siblings] of grouped) children.set(parent, [...siblings].sort(bySibling));
  return { nodes, children };
}

/** Every document under the manuscript, in manuscript order. Research and other roots are not walked. */
export function manuscriptDocuments(tree: TreeIndex): TreeNode[] {
  const out: TreeNode[] = [];
  const visited = new Set<string>([MANUSCRIPT_ID]);
  const walk = (parent: string): void => {
    for (const child of tree.children.get(parent) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (child.type === 'document') out.push(child);
      walk(child.id);
    }
  };
  if (tree.nodes.has(MANUSCRIPT_ID)) walk(MANUSCRIPT_ID);
  return out;
}

/**
 * The folders that enclose a node, nearest first. The walk stops after the manuscript,
 * and before the project root, which L1 already names. A node outside the manuscript
 * stops at its own top-level folder.
 */
export function enclosingFolders(tree: TreeIndex, node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const visited = new Set<string>([node.id]);
  let cursor = node.parentId;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = tree.nodes.get(cursor);
    if (parent === undefined || parent.id === ROOT_ID || parent.type === 'root') break;
    out.push(parent);
    if (parent.id === MANUSCRIPT_ID) break;
    cursor = parent.parentId;
  }
  return out;
}

/** The siblings that sort before a node, nearest first. The node itself is not included. */
export function earlierSiblings(tree: TreeIndex, node: TreeNode): TreeNode[] {
  if (node.parentId === null) return [];
  const siblings = tree.children.get(node.parentId) ?? [];
  return siblings.filter((sibling) => sibling.id !== node.id && sibling.order < node.order).reverse();
}

/** A node's synopsis, or the §7 placeholder that names it, so an empty field is visible and not skipped. */
export function synopsisOf(node: TreeNode): string {
  const synopsis = node.synopsis.trim();
  return synopsis === '' ? `(no synopsis — ${node.title})` : synopsis;
}
