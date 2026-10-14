/**
 * The prompt a scene draft would send, shown before any draft is asked for (context-assembly §5). The Context section of Settings
 * reads it, so the writer sees what the budgets they set do to a real scene. It is built from the loop's own pieces: the task the
 * loop gives `scene.draft` (`sceneTask`), the role text (`sceneRole`) and the assembly (`createContextPort`), so the preview and a
 * request do not drift apart. It is a first turn, with no history, so the turn layers are empty.
 */

import type { ContextConfig, PromptPreview } from '@caotang/context';
import type { ProjectState } from '@caotang/store';

import { createContextPort } from './context.js';
import { sceneRole } from './drafting.js';
import { sceneTask } from './loop.js';

/** The brief a preview is drafted with, and the budgets it is assembled under. */
export interface ScenePreviewOptions {
  /** `draft` writes the whole scene and `continue` writes on from its end: the two modes a scene draft takes without a selection. */
  readonly mode: 'draft' | 'continue';
  /** The brief the draft would be given. */
  readonly instruction: string;
  readonly targetWords?: number;
  /** The budgets the writer set (Settings › Context). Absent, the spec's defaults apply. */
  readonly config?: ContextConfig;
}

/**
 * The preview of the prompt a scene draft of `docId` would send now. Undefined when the id names no document the agent can draft a
 * scene of: a missing node, a folder, or a dialogue container.
 */
export function scenePromptPreview(state: ProjectState, docId: string, options: ScenePreviewOptions): PromptPreview | undefined {
  const node = state.manifest.tree.find((candidate) => candidate.id === docId);
  if (node === undefined || node.type !== 'document') return undefined;
  const port = createContextPort({ state, ...(options.config === undefined ? {} : { config: options.config }) });
  const call = port.assemble({
    task: sceneTask(node.title, node.id, options.mode, options.instruction, undefined, options.targetWords, false),
    role: sceneRole(options.targetWords, node.kind, options.mode),
  });
  return call.preview;
}
