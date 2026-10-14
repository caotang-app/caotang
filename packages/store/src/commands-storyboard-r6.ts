/**
 * r6 (storyboard): the store's apply of `shot.importImage` (storyboard.md §3.1), the import a card's image slot makes.
 * Its descriptor is the bus's (`storyboardR6Commands` in `@caotang/bus`, `descriptors-storyboard-r6.ts`), so a refusal here
 * is never the first place a bad value is caught.
 *
 * The apply does three things in order, and only the last one is the shot's. It checks the shot exists and is a shot, so
 * a refused import writes no file. It writes the staged image into `assets/` through the host's port. Then it sets the
 * shot's `image` through the storyboard module's own `shot.setMeta` (the port the store was given), which runs the module's
 * guards and its `expect` check. One undo restores the image the shot had before, so the file stays and the reference goes
 * back, the same rule the cover import keeps.
 *
 * The storyboard module is injected, not imported, for the reason every other port is: it depends on this package.
 */

import { newId } from '@caotang/ids';
import {
  ApplyRefusal,
  storyboardR6Commands,
  type ApplyContext,
  type Command,
  type CommandApply,
  type CommandRegistry,
  type ShotImportImageParams,
} from '@caotang/bus';

import { sniffCoverImage, COVER_MAX_BYTES, type ApplyClock, type ProjectAssetPort } from './commands-project.js';
import type { ShotCommandPort } from './commands.js';
import { nodeById, type ProjectState } from './state.js';

type ImportApply<P> = CommandApply<P, ProjectState>;

/** The node type a shot card is (storyboard.md §2.1). The store does not import the storyboard module to name it. */
const SHOT_NODE_TYPE = 'shot';

/** A new asset id, `a_` and ten Crockford base32 characters, the shape the storyboard's image store uses. */
function mintAssetId(): string {
  return `a_${newId('c').slice(2)}`;
}

/** The inverse command, minted as the user's own gesture, as the store's other inverses are (command-bus §4). */
function inverseCommand<P>(name: 'shot.setMeta', params: P, clock: ApplyClock): Command<P> {
  return { id: newId('cmd'), name, params, issuedBy: 'user', createdAt: clock.now() };
}

function shotImportImageApply(clock: ApplyClock, assets: ProjectAssetPort, shots: ShotCommandPort): ImportApply<ShotImportImageParams> {
  return async (state, params, context: ApplyContext) => {
    const node = nodeById(state, params.nodeId);
    if (node === undefined || node.type !== SHOT_NODE_TYPE) {
      throw new ApplyRefusal({
        code: 'not-found',
        message: `there is no shot "${params.nodeId}", so the image was not imported`,
        target: 'nodeId',
        correctiveHint: 'choose a shot card and add the image to that card',
      });
    }
    const stored: unknown = node.shot;
    if (stored !== undefined && stored !== null && (typeof stored !== 'object' || Array.isArray(stored))) {
      throw new ApplyRefusal({
        code: 'invalid-params',
        message: 'the shot’s stored details are not an object, so an image cannot be set on it until they are fixed',
        target: 'nodeId',
        correctiveHint: 'open the shot and save its fields first',
      });
    }

    const bytes = assets.staging.take(params.stagingId);
    if (bytes === undefined) {
      throw new ApplyRefusal({
        code: 'not-found',
        message: 'the image is no longer held, so nothing was imported',
        target: 'stagingId',
        correctiveHint: 'choose the image again',
      });
    }
    if (bytes.length > COVER_MAX_BYTES) {
      throw new ApplyRefusal({
        code: 'limit-exceeded',
        message: `the image is ${Math.round(bytes.length / (1024 * 1024))} MB, and an image may be at most ${COVER_MAX_BYTES / (1024 * 1024)} MB`,
        target: 'stagingId',
        correctiveHint: 'use a smaller image of the same picture',
      });
    }
    const kind = sniffCoverImage(bytes);
    if (kind === undefined) {
      throw new ApplyRefusal({
        code: 'invalid-params',
        message: 'the file is not a PNG, JPEG or WebP image, which are the formats a shot can hold',
        target: 'stagingId',
        correctiveHint: 'choose a PNG, JPEG or WebP file',
      });
    }

    const assetId = mintAssetId();
    const path = `assets/${assetId}.${kind.extension}`;
    await assets.writeBytes(path, bytes);

    // Everything after the await is synchronous, and reads the shot again, because the project may have moved while the
    // file was written. The write goes through the storyboard module's own guard, with the value it expects to replace.
    const current = nodeById(state, params.nodeId);
    const before: unknown = current?.shot ?? null;
    const nextStored: Record<string, unknown> = { ...((before ?? {}) as Record<string, unknown>), image: assetId };
    const applied = shots.apply(
      state,
      'shot.setMeta',
      { nodeId: params.nodeId, stored: nextStored, expect: before },
      new Date(clock.now()),
    );
    if (!applied.ok) throw new ApplyRefusal(applied.error);

    // The inverse swaps the two values, as shot.setMeta's own does. The file it leaves behind is harmless (assets/ is not
    // read for shots that do not name it), and removing it here would make undo depend on a write this apply does not own.
    context.undo.inverse(
      inverseCommand<ShotImportImageInverse>(
        'shot.setMeta',
        { nodeId: params.nodeId, stored: (before ?? null) as Record<string, unknown> | null, expect: nextStored },
        clock,
      ),
    );
    context.report({ affected: [...applied.value.affected], summary: `put an image on "${node.title}"` });
    return { nodeId: params.nodeId, assetId, path };
  };
}

/** The params of the inverse `shot.setMeta`, which the bus checks against its own declared keys. */
type ShotImportImageInverse = { nodeId: string; stored: Record<string, unknown> | null; expect: unknown };

/** The apply, narrowed to the registry's state type (the bus does not type project state; see `commands.ts`'s `narrow`). */
function narrow<P>(apply: ImportApply<P>): CommandApply<P, unknown> {
  return apply as CommandApply<P, unknown>;
}

/**
 * The r6 registration, for the store's registry. `shot.importImage` is registered only when the host injects both ports: the
 * asset port (the bytes) and the storyboard port (the shot's write). Without either the name stays descriptor-only, and the bus
 * refuses it as not wired, so an import is never reachable by accident.
 */
export function storyboardR6CommandRegistrations(options: {
  readonly clock: ApplyClock;
  readonly assets?: ProjectAssetPort;
  readonly shots?: ShotCommandPort;
}): Partial<CommandRegistry> {
  if (options.assets === undefined || options.shots === undefined) return {};
  return {
    'shot.importImage': {
      descriptor: storyboardR6Commands.shotImportImage,
      apply: narrow(shotImportImageApply(options.clock, options.assets, options.shots)),
    },
  };
}
