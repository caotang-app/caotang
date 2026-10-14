/**
 * The store's apply for `coherence.discardRun` — [coherence.md §7.1 and §8](../../../docs/architecture/coherence.md).
 *
 * The removal is the run history's, and the rule about which findings it takes is the bus's (`findingsDiscardedWith`),
 * the same one the coherence module's lifecycle applies. The apply changes the held copy of the file; the file is saved
 * through `ArtifactFs` by the coherence module after the command, as every other coherence change is (coherence-state.ts).
 *
 * Undo is `compensable`, and it puts back what the discard took and nothing else. The run goes back at the index it held,
 * and each finding goes back at the index it held. Everything else the file holds at undo time is left as it is. A scan or
 * a model review between the discard and the undo is a later change of its own, and its run and findings stay. A finding
 * is not put back where the file already holds the same fact (the check, the group and the documents, which is the key
 * the coherence module's upsert matches on): the scan that ran after the discard shows that fact, and putting the old
 * finding back beside it would show the fact twice, and a dismissal of the held one would be undone by its duplicate.
 */

import { findingsDiscardedWith, type ApplyContext, type CommandApply, type CoherenceDiscardRunParams } from '@caotang/bus';

import type { CoherenceFindingState, CoherenceRunState, CoherenceState } from './coherence-state.js';
import { runWordsOf } from './coherence-words.js';
import type { ProjectState } from './state.js';

/** The held file a discard changes. `validate` refused a project with none, so a missing one here is a defect. */
function heldFile(state: ProjectState): CoherenceState {
  if (state.coherence === undefined) throw new Error('no coherence file is open for this project');
  return state.coherence;
}

/** A finding the discard took, with the index it held in the file, so undo can put it back there. */
interface TakenFinding {
  readonly finding: CoherenceFindingState;
  readonly index: number;
}

/**
 * The fact a finding is about, as the coherence module keys it (its upsert's identity): the check, the group and the
 * documents it quotes. A finding without a check or a group carries no such key, so nothing is taken to match it.
 */
function factKeyOf(finding: CoherenceFindingState): string | undefined {
  if (finding.checkId === undefined || finding.factGroup === undefined) return undefined;
  const docs = [...new Set((finding.evidence ?? []).map((passage) => passage.docId))].sort().join(',');
  return JSON.stringify([finding.checkId, finding.factGroup, docs]);
}

/**
 * Puts back what a discard took, in place, and nothing else. `taken` is in the order the file held the findings, so each
 * one is inserted at its own index in turn, and the indices still fit the file the earlier insertions built.
 */
function restoreTaken(file: CoherenceState, run: CoherenceRunState, runIndex: number, taken: readonly TakenFinding[]): void {
  if (!file.runs.some((candidate) => candidate.id === run.id)) {
    file.runs.splice(Math.min(runIndex, file.runs.length), 0, run);
  }
  for (const { finding, index } of taken) {
    if (file.findings.some((candidate) => candidate.id === finding.id)) continue;
    const key = factKeyOf(finding);
    if (key !== undefined && file.findings.some((candidate) => factKeyOf(candidate) === key)) continue;
    file.findings.splice(Math.min(index, file.findings.length), 0, finding);
  }
}

/** The discard, applied to the held file, with the compensation that restores exactly what it took. */
export const applyCoherenceDiscardRun: CommandApply<CoherenceDiscardRunParams, ProjectState> = (state, params, context: ApplyContext) => {
  const file = heldFile(state);
  const runIndex = file.runs.findIndex((candidate) => candidate.id === params.runId);
  const run: CoherenceRunState | undefined = file.runs[runIndex];
  if (run === undefined) {
    throw new Error(`coherence.discardRun reached its apply with run "${params.runId}", which validate refused`);
  }
  const { kept, removed } = findingsDiscardedWith(file.findings, params.runId);
  const taken: TakenFinding[] = removed.map((finding) => ({ finding, index: file.findings.indexOf(finding) }));

  file.runs = file.runs.filter((candidate) => candidate.id !== params.runId);
  file.findings = kept;

  context.undo.compensate(`restore run ${params.runId} and its findings`, () => {
    restoreTaken(heldFile(state), run, runIndex, taken);
  });
  const count = removed.length;
  const words = `discarded ${runWordsOf(run)}`;
  context.report({
    affected: [],
    summary: count === 0 ? words : `${words} and ${count} untouched finding${count === 1 ? '' : 's'} it made`,
  });
  return { runId: params.runId, removedFindingIds: removed.map((finding) => finding.id) };
};
