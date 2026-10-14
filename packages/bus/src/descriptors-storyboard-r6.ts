/**
 * r6 (storyboard): the descriptor of `shot.importImage`, the one command this round adds to the storyboard. Its apply is
 * the store's (`packages/store/src/commands-storyboard-r6.ts`), reached through the same registry as the rest of the
 * closed set (`registry.ts`).
 *
 * The apply is asynchronous, because the image is written to `assets/` before the shot names it, so the descriptor
 * is `asyncApply` and runs through `executeAsync`. Validation is pure and total (command-bus §2): it checks the closed
 * key set and the two strings. Whether the node exists and is a shot is the apply's to say, before any byte is written,
 * because only the apply reads the stored project.
 */

import type { CommandDescriptor, ShotImportImageParams } from './command.js';
import { ok, type Result, type CommandError } from './result.js';
import { requireDeclaredParams, requireNonBlankString } from './params.js';

export const shotImportImage: CommandDescriptor<ShotImportImageParams> = {
  mutates: 'project',
  // The image is a file the writer chose, so the gate asks rather than refusing a writer's own picture. An agent cannot stage
  // bytes, so its call is refused as not-found before anything is written, the same as the cover import.
  agentRisk: 'write-confirm',
  undo: 'inverse',
  asyncApply: true,
  validate: (params): Result<ShotImportImageParams, CommandError> => {
    const p = requireDeclaredParams('shot.importImage', params);
    if (!p.ok) return p;
    const nodeId = requireNonBlankString(p.value, 'nodeId', { maxChars: 64 });
    if (!nodeId.ok) return nodeId;
    const stagingId = requireNonBlankString(p.value, 'stagingId', { maxChars: 64 });
    if (!stagingId.ok) return stagingId;
    return ok({ nodeId: nodeId.value, stagingId: stagingId.value });
  },
};
