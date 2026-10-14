/**
 * The storyboard module's port for `shots.annotate` (storyboard.md §4, tool 19).
 *
 * The planner is `@caotang/storyboard`'s `annotateShotsTool`, which plans and applies nothing. This port dispatches the
 * plan's commands through the bus, in order, under the call's own turn and grant, so they land in one undo group
 * (agent-harness §5). A refused plan has no commands, so a batch with one bad shot changes nothing.
 *
 * The port is wired only where the store registry carries the three shot commands (see runtime.ts): a port that
 * dispatched commands the registry could not run would be listed and then refused on every call.
 */

import { ok, type ActivityEntry } from '@caotang/bus';
import { annotateShotsTool } from '@caotang/storyboard';

import type { CallParams, PortToolName, ToolOutcome, ToolPort } from '../types.js';

/** One node a dispatched command touched, by its human title (command-bus §8). */
type Affected = ActivityEntry['affected'][number];

/**
 * The storyboard ports, keyed by tool name. `presentAssets` supplies the asset ids under `assets/` at the time of
 * the call, which the image check reads (storyboard.md §4); the app supplies it, and without one no image is present.
 */
export function storyboardPorts(presentAssets: () => ReadonlySet<string>): Readonly<Partial<Record<PortToolName, ToolPort>>> {
  const annotate: ToolPort = (params, context): ToolOutcome => {
    const planned = annotateShotsTool(params, { state: context.state, presentAssets: presentAssets() });
    if (!planned.ok) return planned;

    const affected: Affected[] = [];
    let undoGroupId: string | undefined;
    for (const command of planned.value.commands) {
      const applied = context.dispatch(command.name, command.params as unknown as CallParams);
      if (!applied.ok) return { ok: false, error: applied.error };
      affected.push(...applied.value.affected);
      undoGroupId ??= applied.value.undoGroupId;
    }
    const changed = planned.value.plan.changes.length;
    const unchanged = planned.value.plan.unchanged.length;
    return ok({
      data: { changed, unchanged },
      summary: planned.value.summary,
      affected,
      ...(undoGroupId === undefined ? {} : { undoGroupId }),
    });
  };

  return { 'shots.annotate': annotate };
}
