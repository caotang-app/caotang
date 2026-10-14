/**
 * The bus commands a storyboard plan is made of — [storyboard.md](../../../docs/architecture/storyboard.md)
 * §3.1 and §4, [command-bus.md](../../../docs/architecture/command-bus.md) §2 and §3.
 *
 * A planner returns these commands in the order they must run, and no planner or handler applies them.
 * The harness gives the list to the bus, which validates it, gates it, applies it and records one undo
 * group for the whole list (agent-harness §5). So a plan carries no inverse: the group is the undo. Each
 * `shot.setMeta` carries the stored value it replaces (`expect`), so the bus can build its inverse from
 * the command alone, and each guard that could go stale between planning and applying is a field of the
 * command, so the apply refuses it rather than writing against text the writer never saw.
 *
 * `binder.move` is a command the bus has always had (command-bus §9). `storyboard.create`, `shot.create` and
 * `shot.setMeta` are in the bus's closed registry too, with their shapes in `params.ts`. The store reaches this module through
 * its shot-command port (`command-port.ts`), which runs the per-command apply below for those three. `shot.importImage`
 * (storyboard.md §2.2) writes its file, then sets the picture through `shot.setMeta`.
 *
 * {@link applyStoryboardCommand} is the per-command apply: each guard runs first, then the one write. Its
 * callers are `command-port.ts`, for the bus, and {@link applyStoryboardCommands}, for a plan's list.
 */

import { getRevision, moveNode, nodeById, siblingOrderAt, type ProjectState } from '@caotang/store';

import { isScreenplayDocument, isShotNode, isStoryboardFolder } from './model.js';
import { addShotNode, addStoryboardFolder, setStoredMeta, shotFieldOf } from './nodes.js';
import { ok, refuse, type StoryboardResult } from './result.js';

/** `storyboard.create`: the `<Scene Title> — Shots` folder, with the scene facts the plan was made against. */
export interface StoryboardCreateParams {
  /** The folder's id, minted by the planner so the plan card names it and the shots can point at it. */
  readonly id: string;
  /** The folder the storyboard lands in: the scene's parent folder. */
  readonly parentId: string;
  readonly title: string;
  /** The scene as the plan saw it. The apply refuses when any of the three has moved (storyboard.md §4). */
  readonly scene: { readonly id: string; readonly parentId: string; readonly revision: number };
}

/** `shot.create`: one shot card, carrying its stored metadata. */
export interface ShotCreateParams {
  readonly id: string;
  readonly parentId: string;
  readonly title: string;
  readonly stored: Readonly<Record<string, unknown>>;
}

/** `shot.setMeta`: a whole `shot` value written over a shot's stored one. */
export interface ShotSetMetaParams {
  readonly nodeId: string;
  /** The whole stored `shot` value after the write. `null` removes the stored value, which is how an undo restores a shot that had none. */
  readonly stored: Readonly<Record<string, unknown>> | null;
  /** The stored value the planner read, or `null` when the shot had none. The apply refuses if it no longer holds. */
  readonly expect: unknown;
}

/** `binder.move`, as command-bus §9 declares it. */
export interface BinderMoveParams {
  readonly nodeId: string;
  readonly newParentId: string;
  /** A sibling index that counts every sibling except the moved node, which is what `siblingOrderAt` takes. */
  readonly index: number;
}

export type ShotCommand =
  | { readonly name: 'storyboard.create'; readonly params: StoryboardCreateParams }
  | { readonly name: 'shot.create'; readonly params: ShotCreateParams }
  | { readonly name: 'shot.setMeta'; readonly params: ShotSetMetaParams }
  | { readonly name: 'binder.move'; readonly params: BinderMoveParams };

export type ShotCommandName = ShotCommand['name'];

/** What an apply needs beyond the state. Ids are explicit in every create, so nothing is minted here. */
export interface ApplyOptions {
  /** Stamps `updatedAt` on a metadata write (binder-filters §2.1). Structure moves never stamp it. */
  readonly now?: Date;
}

/** A value copied out of a command, so the state never shares an object with the list the caller holds. */
function copyOf(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function createStoryboard(state: ProjectState, params: StoryboardCreateParams, options: ApplyOptions): StoryboardResult<void> {
  const scene = nodeById(state, params.scene.id);
  if (scene === undefined || !isScreenplayDocument(scene) || scene.parentId === null) {
    return refuse(
      'scene-changed',
      'the scene is no longer a screenplay document in the binder, so the plan no longer applies. Derive again from the current scene.',
      'conflict',
    );
  }
  // A move does not bump the revision, so the parent is checked on its own: the folder must land where the
  // approved card showed it, under the same parent as the scene the plan was made against.
  if (scene.parentId !== params.scene.parentId) {
    return refuse(
      'scene-moved',
      'the scene has been moved to another folder since the plan was made, so the shots would land somewhere the card did not show. Derive again.',
      'conflict',
    );
  }
  const revision = getRevision(state, scene.id);
  if (revision !== params.scene.revision) {
    return refuse(
      'revision-drift',
      `the scene changed after the plan was made (revision ${params.scene.revision} is now ${revision}), so its quoted anchors may be stale. Derive again from the current text.`,
      'conflict',
    );
  }
  if (nodeById(state, params.id) !== undefined) return refuse('id-taken', `node "${params.id}" already exists, so the storyboard cannot take that id.`);
  if (nodeById(state, params.parentId) === undefined) return refuse('not-found', `no folder "${params.parentId}" to hold the storyboard.`);
  addStoryboardFolder(state, { id: params.id, parentId: params.parentId, title: params.title, now: options.now });
  return ok(undefined);
}

function createShot(state: ProjectState, params: ShotCreateParams, options: ApplyOptions): StoryboardResult<void> {
  const parent = nodeById(state, params.parentId);
  if (parent === undefined || !isStoryboardFolder(parent)) {
    return refuse('not-a-storyboard', `"${params.parentId}" is not a storyboard folder, and a shot lives in one. Name a storyboard folder, or derive the shots from a scene.`);
  }
  if (nodeById(state, params.id) !== undefined) return refuse('id-taken', `node "${params.id}" already exists, so the shot cannot take that id.`);
  addShotNode(state, { id: params.id, parentId: params.parentId, title: params.title, stored: copyOf(params.stored), now: options.now });
  return ok(undefined);
}

function setShotMeta(state: ProjectState, params: ShotSetMetaParams, options: ApplyOptions): StoryboardResult<void> {
  const node = nodeById(state, params.nodeId);
  if (node === undefined) return refuse('shot-unknown', `no shot "${params.nodeId}". Read the storyboards with binder.read_tree, then name a shot id.`);
  if (!isShotNode(node)) return refuse('not-a-shot', `"${node.title}" (${node.id}) is a ${node.type}, not a shot.`);
  if (JSON.stringify(shotFieldOf(node) ?? null) !== JSON.stringify(params.expect ?? null)) {
    return refuse(
      'metadata-changed',
      `the metadata of shot "${params.nodeId}" changed after the plan was made. Annotate it again from its current values.`,
      'conflict',
    );
  }
  // `null` removes the key rather than storing a null, so an undo of a shot that had no metadata leaves none behind.
  setStoredMeta(node, params.stored === null ? undefined : copyOf(params.stored), options.now);
  return ok(undefined);
}

function moveTo(state: ProjectState, params: BinderMoveParams): StoryboardResult<void> {
  if (nodeById(state, params.nodeId) === undefined) return refuse('not-found', `no node "${params.nodeId}" to move.`);
  if (nodeById(state, params.newParentId) === undefined) return refuse('not-found', `no folder "${params.newParentId}" to move into.`);
  if (!Number.isInteger(params.index) || params.index < 0) return refuse('invalid-params', 'index must be a whole number, at least zero.');
  // The same mapping the bus's apply makes (store commands, binder.move): the index becomes the stored order.
  const order = siblingOrderAt(state, params.newParentId, params.index, params.nodeId);
  moveNode(state, params.nodeId, { parentId: params.newParentId, order });
  return ok(undefined);
}

/**
 * Applies one command. Its guard runs first and refuses without writing, so a refused command leaves the
 * state as it was. The bus calls this from its apply step; the storyboard planners never do.
 */
export function applyStoryboardCommand(state: ProjectState, command: ShotCommand, options: ApplyOptions = {}): StoryboardResult<void> {
  switch (command.name) {
    case 'storyboard.create':
      return createStoryboard(state, command.params, options);
    case 'shot.create':
      return createShot(state, command.params, options);
    case 'shot.setMeta':
      return setShotMeta(state, command.params, options);
    case 'binder.move':
      return moveTo(state, command.params);
  }
}

/**
 * Applies a whole list in order, all or nothing. The list runs on a copy first, so a refusal anywhere
 * leaves `state` untouched (command-bus §3: zero partial effects). The second pass repeats the same
 * sequence on the same starting state, which is deterministic because every id was minted by the planner.
 */
export function applyStoryboardCommands(
  state: ProjectState,
  commands: readonly ShotCommand[],
  options: ApplyOptions = {},
): StoryboardResult<void> {
  const trial = structuredClone(state);
  for (const command of commands) {
    const step = applyStoryboardCommand(trial, command, options);
    if (!step.ok) return step;
  }
  for (const command of commands) applyStoryboardCommand(state, command, options);
  return ok(undefined);
}
