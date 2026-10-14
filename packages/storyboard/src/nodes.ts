/**
 * Creating and writing storyboard nodes. These are the only functions in this package that mutate a
 * `ProjectState`, and only `applyStoryboardCommand` (`commands.ts`) calls them, from the bus's apply step.
 * No planner or handler does. They sit on the store's own primitives (`addFolder`, `nextSiblingOrder`), so a
 * shot gets the same gap-encoded order and timestamps a document does.
 *
 * A shot is a tree node with no body record. That is deliberate, and the reason is in the store:
 * `write.ts` writes a body file only for a node of `type === 'document'`, so a record held against a
 * shot would be skipped on save without a word, and its word count would describe text nothing keeps.
 * A shot has no body (storyboard.md §2.1: its content is metadata and an image), so it has no record.
 */

import { newId, type RandomBytes } from '@caotang/ids';
import { addFolder, nextSiblingOrder, nodeById, type ProjectState, type TreeNode } from '@caotang/store';

import { SHOT_NODE_TYPE, STORYBOARD_KIND, isStoryboardFolder, type StoryboardFields } from './model.js';

export interface NodeOptions {
  readonly now?: Date;
  /** Fixture-stable ids for tests. Production omits it, and the id is minted collision-checked. */
  readonly id?: string;
  readonly randomBytes?: RandomBytes;
}

function mintNodeId(state: ProjectState, options: NodeOptions): string {
  const taken = new Set(state.manifest.tree.map((node) => node.id));
  const id = options.id ?? newId('n', { taken, ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}) });
  if (taken.has(id)) throw new Error(`node id "${id}" is already in use`);
  return id;
}

/** Sets the `kind` marker on a node. The store's type does not declare it, so it is written through the view. */
export function setNodeKind(node: TreeNode, kind: string): void {
  Object.assign(node, { kind });
}

/** The raw `shot` value of a node: its stored metadata, whatever shape it has. */
export function shotFieldOf(node: TreeNode): unknown {
  return (node as StoryboardFields).shot;
}

/**
 * Writes or removes a shot's stored metadata. `undefined` removes the key, which is how an undo
 * restores a shot that had no metadata before. A `now` stamps `updatedAt`, because a metadata edit
 * is a content change (binder-filters §2.1); structure moves do not stamp it, and nothing here moves.
 */
export function setStoredMeta(node: TreeNode, stored: unknown, now?: Date): void {
  if (stored === undefined) Reflect.deleteProperty(node, 'shot');
  else Object.assign(node, { shot: stored });
  if (now !== undefined) node.updatedAt = now.toISOString();
}

/** A folder marked `kind: 'storyboard'`, created under `parentId` after its last sibling. */
export function addStoryboardFolder(state: ProjectState, options: NodeOptions & { parentId: string; title: string }): TreeNode {
  const id = mintNodeId(state, options);
  const folder = addFolder(state, { parentId: options.parentId, title: options.title, id, now: options.now });
  setNodeKind(folder, STORYBOARD_KIND);
  return folder;
}

/**
 * A shot card under `parentId`, after its last sibling, carrying `stored` as its metadata. The parent
 * must be a storyboard folder: storyboard.md §2.1 adopts the sibling folder as the one container shots
 * live in, which keeps the three-tier binder intact.
 */
export function addShotNode(
  state: ProjectState,
  options: NodeOptions & { parentId: string; title: string; stored: unknown },
): TreeNode {
  const parent = nodeById(state, options.parentId);
  if (parent === undefined || !isStoryboardFolder(parent)) {
    throw new Error(`"${options.parentId}" is not a storyboard folder, and a shot lives in one`);
  }
  const id = mintNodeId(state, options);
  const stamp = (options.now ?? new Date()).toISOString();
  const node: TreeNode = {
    id,
    parentId: options.parentId,
    type: SHOT_NODE_TYPE,
    title: options.title,
    order: nextSiblingOrder(state.manifest.tree, options.parentId),
    status: null,
    label: null,
    keywords: [],
    synopsis: '',
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
  };
  state.manifest.tree.push(node);
  setStoredMeta(node, options.stored);
  return node;
}
