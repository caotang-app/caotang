/**
 * The corkboard's scope and card order — pure, like the binder model.
 *
 * ui-modules §3 says the corkboard has **no commands of its own**: every gesture on
 * it is a binder command, and what it shows is a container's children in sibling
 * order. The only thing it owns is which container it shows (`view.setCorkboardScope`)
 * and how large its cards are, and the second of those is not project state at all.
 */

import type { ProjectState, TreeNode } from '@caotang/store';

import { childrenOf, isContainer, nodeById, planDrop, type DropPlan, type DropZone } from './binder-model.js';

/** The card sizes of §3.2. S = title, M = title and a two-line synopsis, L = everything. */
export const ZOOM_LEVELS = ['S', 'M', 'L'] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

/** ui-modules §4.1 and §3.2: the synopsis cap, shared by the card and the inspector field. */
export const SYNOPSIS_MAX_CHARS = 2000;

/**
 * The container the corkboard shows. An unresolved id — a deleted folder, or a
 * document that was once a scope — is **not** an error: the board falls back to the
 * manuscript, because the view state is allowed to outlive what it points at.
 */
export function resolveScope(state: ProjectState, scopeId: string | null): TreeNode {
  const requested = scopeId === null ? undefined : nodeById(state, scopeId);
  if (requested && isContainer(requested)) return requested;
  const manuscript = nodeById(state, 'manuscript');
  if (!manuscript) throw new Error('the project has no manuscript section');
  return manuscript;
}

/** The cards the board shows: the scope's children, in the order the binder shows them. */
export function cardsOf(state: ProjectState, scope: TreeNode): TreeNode[] {
  return childrenOf(state, scope.id);
}

/**
 * The drop a card gesture resolves to. A card is always a sibling of its neighbours,
 * so `before`/`after` go through the binder's own planner; an empty-area drop
 * appends (`into` the scope). Reusing `planDrop` is the point: the board cannot
 * disagree with the binder about what an index means.
 */
export function planCardDrop(
  state: ProjectState,
  movingId: string,
  target: { readonly cardId: string; readonly zone: DropZone } | { readonly scopeId: string },
): DropPlan {
  if ('scopeId' in target) return planDrop(state, movingId, { nodeId: target.scopeId, zone: 'into' });
  return planDrop(state, movingId, { nodeId: target.cardId, zone: target.zone });
}

/** Which half of a card the pointer is over, horizontally, for a grid's before/after. */
export function zoneForCard(fraction: number): DropZone {
  return fraction < 0.5 ? 'before' : 'after';
}

/**
 * The breadcrumb for a scope: the names from the manuscript down to the container.
 * Walks parents with a guard, so a malformed loop cannot hang the render.
 */
export function scopePath(state: ProjectState, scope: TreeNode): string[] {
  const names: string[] = [];
  let cursor: TreeNode | undefined = scope;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id) && cursor.type !== 'root') {
    seen.add(cursor.id);
    names.unshift(cursor.title);
    cursor = cursor.parentId === null ? undefined : nodeById(state, cursor.parentId);
  }
  return names;
}
