/**
 * The storyboard module's side of the store's shot-command port (storyboard.md §3.1; `ShotCommandPort` in
 * `@caotang/store`). The store cannot import this package, since this one depends on the store, so whoever builds
 * the store registry hands it this adapter. The harness does, and it depends on both packages.
 *
 * The guards and the write are `applyStoryboardCommand`'s, unchanged. This file only maps its result to the bus's
 * error shape and names what the activity row should say. A refused command has written nothing: the module's
 * `applyStoryboardCommand` runs each guard before its one write.
 */

import type { CommandError, Result } from '@caotang/bus';
import { nodeById, type ProjectState, type ShotCommandPort, type ShotCommandReport } from '@caotang/store';

import { applyStoryboardCommand, type ShotCommand } from './commands.js';
import { toBusResult } from './tools.js';

/** The row a storyboard command writes: the node it touched, by its human title, and what changed (command-bus §8). */
function reportOf(state: ProjectState, name: ShotCommand['name'], params: unknown): ShotCommandReport {
  const given = params as { readonly id?: string; readonly title?: string; readonly nodeId?: string };
  if (name === 'shot.setMeta') {
    const nodeId = given.nodeId ?? '';
    const title = nodeById(state, nodeId)?.title ?? nodeId;
    return { affected: [{ nodeId, title }], summary: `updated the camera fields of "${title}"` };
  }
  const nodeId = given.id ?? '';
  const title = given.title ?? nodeId;
  if (name === 'storyboard.create') return { affected: [{ nodeId, title }], summary: `created the storyboard "${title}"` };
  return { affected: [{ nodeId, title }], summary: `created the shot "${title}"` };
}

/**
 * The port the store is given. `binder.move` is not in it: the store's own `binder.move` apply already moves a
 * node, and the storyboard module's version of that move is the same write.
 */
export function shotCommandPort(): ShotCommandPort {
  return {
    apply(state: ProjectState, name, params: unknown, now: Date): Result<ShotCommandReport, CommandError> {
      const applied = toBusResult(applyStoryboardCommand(state, { name, params } as ShotCommand, { now }));
      if (!applied.ok) return applied;
      return { ok: true, value: reportOf(state, name, params) };
    },
  };
}
