/**
 * A read-only index over the binder tree: binder order, ancestor chains, and the
 * subtree word sums that `minWords`/`maxWords` and goal progress both read.
 *
 * One accessor serves both features on purpose — binder-filters.md §2 and
 * goals-progress.md §2.2 each say "folders = descendant sum", and two sums would be
 * two rules that drift.
 */
import { isFixedRoot } from '@caotang/ids';
import type { TreeNode } from '@caotang/store';

export interface BinderIndex {
  /**
   * Every node reachable from a root, in binder order: depth-first, siblings by their
   * gap-encoded `order`, ties by manifest position. The project root comes first.
   */
  readonly order: readonly string[];
  node(id: string): TreeNode | undefined;
  has(id: string): boolean;
  /** Own count for a document; subtree sum for a folder. 0 for an unknown id. */
  wordsOf(id: string): number;
  /**
   * The same sum over `charCounts` (goals-progress §9.2): a document's characters, or a folder's subtree sum. 0 when no counts were
   * given, or for an unknown id. Summed as the words are, so the two cannot drift.
   */
  charsOf(id: string): number;
  /** goals-progress §2.2: a folder, or the manuscript root (which is a folder node). */
  isGoalTarget(id: string): boolean;
  /** The ancestors of a node, nearest first, up to and including the project root. */
  ancestorsOf(id: string): readonly string[];
}

/** The fixed roots and the project root: never matched, never hidden (binder-filters §3). */
export function isReservedRoot(node: TreeNode): boolean {
  return node.type === 'root' || isFixedRoot(node.id);
}

/**
 * Build the index. `wordCounts` is `derived.wordCounts` — allowed stale, and absent or
 * malformed entries count as zero (see {@link ownCount}). `charCounts` is the same for characters (goals-progress §9.2), and is
 * empty unless the caller measured them. A node whose parent is missing,
 * or who sits in a cycle, is unreachable: it has no place in the binder and is left out of `order`.
 */
export function createBinderIndex(
  tree: readonly TreeNode[],
  wordCounts: Readonly<Record<string, unknown>> = {},
  charCounts: Readonly<Record<string, unknown>> = {},
): BinderIndex {
  const byId = new Map<string, { node: TreeNode; position: number }>();
  tree.forEach((node, position) => {
    if (!byId.has(node.id)) byId.set(node.id, { node, position });
  });

  const childrenOf = new Map<string | null, TreeNode[]>();
  for (const { node } of byId.values()) {
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.order - b.order || byId.get(a.id)!.position - byId.get(b.id)!.position);
  }

  const order: string[] = [];
  const reached = new Set<string>();
  const visit = (node: TreeNode): void => {
    if (reached.has(node.id)) return;
    reached.add(node.id);
    order.push(node.id);
    for (const child of childrenOf.get(node.id) ?? []) visit(child);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root);

  // Children come after their parent in `order`, so a reverse walk sums each subtree
  // from already-finished children. Folders carry no count of their own.
  const totals = new Map<string, number>();
  const charTotals = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = byId.get(id)!.node;
    let total = ownCount(node, wordCounts);
    let chars = ownCount(node, charCounts);
    for (const child of childrenOf.get(id) ?? []) {
      total += totals.get(child.id) ?? 0;
      chars += charTotals.get(child.id) ?? 0;
    }
    totals.set(id, total);
    charTotals.set(id, chars);
  }

  return {
    order,
    node: (id) => byId.get(id)?.node,
    has: (id) => byId.has(id),
    wordsOf: (id) => totals.get(id) ?? 0,
    charsOf: (id) => charTotals.get(id) ?? 0,
    isGoalTarget: (id) => {
      const node = byId.get(id)?.node;
      return node !== undefined && (node.type === 'folder' || node.id === 'manuscript');
    },
    ancestorsOf: (id) => {
      const out: string[] = [];
      const seen = new Set<string>([id]);
      let parent = byId.get(id)?.node.parentId ?? null;
      while (parent !== null && !seen.has(parent)) {
        const entry = byId.get(parent);
        if (entry === undefined) break;
        out.push(entry.node.id);
        seen.add(parent);
        parent = entry.node.parentId;
      }
      return out;
    },
  };
}

/**
 * A document's own count, of words or of characters. The store checks only that `derived` is an object, so a count that
 * is not a non-negative finite number reads as zero here. Without this a string count would
 * turn a folder total into a string concatenation, and a NaN would make the total NaN.
 */
function ownCount(node: TreeNode, counts: Readonly<Record<string, unknown>>): number {
  if (node.type === 'folder' || node.type === 'root') return 0;
  if (!Object.hasOwn(counts, node.id)) return 0;
  const count = counts[node.id];
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
}
