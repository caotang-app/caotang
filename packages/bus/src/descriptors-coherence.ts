/**
 * `coherence.discardRun` — the run history's one removal ([coherence.md §7.1](../../../docs/architecture/coherence.md),
 * §8). Its rule is the lifecycle's (`discardRun` in the coherence module): the run goes, and so do the findings it
 * created that the writer or the agent never touched. The store's apply does the removal and keeps what it took, so
 * undo can put it back.
 *
 * Write-confirm for the agent, as the spec's table says: a discard is a writer's tidy-up of derived state, and an agent
 * never needs it to finish a task. The undo is compensable, because the removed run and findings are restored from a
 * copy taken at apply time, not by replaying a command.
 */

import type { CommandDescriptor, CoherenceDiscardRunParams } from './command.js';
import { notFound, requireDeclaredParams, requireNonBlankString } from './params.js';
import { ok } from './result.js';

export const coherenceDiscardRun: CommandDescriptor<CoherenceDiscardRunParams> = {
  mutates: 'project',
  agentRisk: 'write-confirm',
  undo: 'compensable',
  validate: (params, snapshot) => {
    const p = requireDeclaredParams('coherence.discardRun', params);
    if (!p.ok) return p;
    const runId = requireNonBlankString(p.value, 'runId');
    if (!runId.ok) return runId;
    const coherence = snapshot.coherence;
    if (coherence === undefined) {
      return notFound(
        'no coherence file is open for this project, so there is no run to discard',
        'open the project with its coherence file loaded: a project with no file loads as an empty one',
        'runId',
      );
    }
    if (!(coherence.runs ?? []).some((run) => run.id === runId.value)) {
      return notFound(`no run has id "${runId.value}"`, 'use a run from the run history in the findings tab', 'runId');
    }
    return ok({ runId: runId.value });
  },
};
