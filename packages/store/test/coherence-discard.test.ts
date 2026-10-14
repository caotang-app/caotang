/**
 * `coherence.discardRun` through the store's registry (coherence.md §7.1, §8): the run and the untouched findings it
 * made go, the touched ones stay, and undo puts back exactly what the discard took, in the same order.
 */

import { describe, expect, it } from 'vitest';

import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type Command,
  type CommandError,
  type CommandName,
  type ExecutionOutcome,
  type Result,
  type UndoStore,
} from '@caotang/bus';
import { newId } from '@caotang/ids';

import {
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectCommandRegistry,
  createProjectState,
  emptyCoherenceState,
  type CoherenceFindingState,
  type CoherenceRunState,
  type CoherenceState,
  type ProjectState,
} from '../src/index.js';

const OPENED = new Date('2026-10-01T09:00:00.000Z');
const clock = { now: () => Date.parse('2026-10-08T10:00:00.000Z') };

const CHAPTER = 'n_CHAPTER001';
const STORM = 'n_TEMPEST001';
const RUN_A = 'r_AAAAAAAAAA';
const RUN_B = 'r_BBBBBBBBBB';
const RUN_C = 'r_CCCCCCCCCC';
const FINDING_MADE_UNTOUCHED = 'f_AAAAAAAAAA';
const FINDING_MADE_TOUCHED = 'f_BBBBBBBBBB';
const FINDING_OTHER_RUN = 'f_CCCCCCCCCC';
const FINDING_LATER_SCAN = 'f_DDDDDDDDDD';

function run(id: string): CoherenceRunState {
  return {
    id,
    at: OPENED.toISOString(),
    kind: 'deterministic',
    checkIds: ['codex.never-mentioned'],
    scope: { docIds: [STORM] },
    findingsUpserted: [],
    status: 'complete',
  };
}

function finding(id: string, runId: string, extra: Partial<CoherenceFindingState> = {}): CoherenceFindingState {
  return {
    id,
    status: 'open',
    updatedAt: OPENED.toISOString(),
    createdByRunId: runId,
    runId,
    evidence: [{ docId: STORM }],
    ...extra,
  };
}

/** A project with a manuscript, one document, and a coherence file holding two runs and three findings. */
function fixture(): ProjectState {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', OPENED));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: OPENED, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'The Storm', body: 'The gale arrived at dawn.', now: OPENED, id: STORM });
  const file: CoherenceState = emptyCoherenceState();
  file.runs.push(run(RUN_A), run(RUN_B));
  file.findings.push(
    finding(FINDING_MADE_UNTOUCHED, RUN_A),
    finding(FINDING_MADE_TOUCHED, RUN_A, { touchedAt: OPENED.toISOString(), status: 'dismissed', dismissedReason: 'intentional' }),
    finding(FINDING_OTHER_RUN, RUN_B),
  );
  state.coherence = file;
  return state;
}

interface Harness {
  readonly state: ProjectState;
  readonly undo: UndoStore;
  send(name: CommandName, params: Record<string, unknown>, options?: { issuedBy?: 'user' | 'agent' }): Result<ExecutionOutcome, CommandError>;
}

function harness(state: ProjectState = fixture()): Harness {
  const registry = createProjectCommandRegistry({ clock });
  const log = createActivityLog();
  const undo: UndoStore = createUndoStore({
    dispatch: (command) => execute(command, bus, registry),
  });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log,
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  return {
    state,
    undo,
    send(name, params, options = {}) {
      const command: Command = {
        id: newId('cmd'),
        name,
        params,
        issuedBy: options.issuedBy ?? 'user',
        createdAt: clock.now(),
      };
      return execute(command, bus, registry);
    },
  };
}

function expectOk(result: Result<ExecutionOutcome, CommandError>): ExecutionOutcome {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('coherence.discardRun (coherence.md §7.1, §8)', () => {
  it('removes the run and the findings it made that nobody touched, and keeps the touched one and the other run’s', () => {
    const h = harness();
    const outcome = expectOk(h.send('coherence.discardRun', { runId: RUN_A }));
    expect(h.state.coherence?.runs.map((candidate) => candidate.id)).toEqual([RUN_B]);
    expect(h.state.coherence?.findings.map((candidate) => candidate.id)).toEqual([FINDING_MADE_TOUCHED, FINDING_OTHER_RUN]);
    expect(outcome.undoGroupId).toBeDefined();
  });

  it('undo puts back the run and every finding it took, in their original order', () => {
    const h = harness();
    const before = JSON.stringify(h.state.coherence);
    const outcome = expectOk(h.send('coherence.discardRun', { runId: RUN_A }));
    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect(JSON.stringify(h.state.coherence)).toBe(before);
  });

  it('refuses a run the file does not hold, and changes nothing', () => {
    const h = harness();
    const before = JSON.stringify(h.state.coherence);
    const refused = h.send('coherence.discardRun', { runId: 'r_ZZZZZZZZZZ' });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(h.state.coherence)).toBe(before);
  });

  it('is refused for a project with no coherence file, since there is no run history to discard from', () => {
    const state = fixture();
    delete state.coherence;
    const refused = harness(state).send('coherence.discardRun', { runId: RUN_A });
    expect(refused.ok).toBe(false);
  });

  it('is write-confirm for the agent, so an agent call alone is refused and a plan approval is what lets it run', () => {
    const h = harness();
    const refused = h.send('coherence.discardRun', { runId: RUN_A }, { issuedBy: 'agent' });
    expect(refused.ok).toBe(false);
    expect(h.state.coherence?.runs).toHaveLength(2);
  });

  it('undo after a later scan keeps that scan’s run and its findings, and puts back only what the discard took', () => {
    const h = harness();
    const outcome = expectOk(h.send('coherence.discardRun', { runId: RUN_A }));
    // A scan between the discard and the undo: its run and its finding are in the held file when the undo runs.
    h.state.coherence?.runs.push(run(RUN_C));
    h.state.coherence?.findings.push(finding(FINDING_LATER_SCAN, RUN_C));
    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect(h.state.coherence?.runs.map((candidate) => candidate.id)).toEqual([RUN_A, RUN_B, RUN_C]);
    expect(h.state.coherence?.findings.map((candidate) => candidate.id)).toEqual([
      FINDING_MADE_UNTOUCHED,
      FINDING_MADE_TOUCHED,
      FINDING_OTHER_RUN,
      FINDING_LATER_SCAN,
    ]);
  });

  it('does not put back a finding the file already holds for the same fact, so the fact is not shown twice', () => {
    const state = fixture();
    // The untouched finding is a fact the run found. A scan after the discard finds that fact again, under a new id.
    const fact = { checkId: 'codex.never-mentioned', factGroup: 'c_x|never-mentioned' };
    const untouched = state.coherence?.findings[0];
    if (untouched === undefined) throw new Error('fixture: no untouched finding');
    Object.assign(untouched, fact);
    const h = harness(state);
    const outcome = expectOk(h.send('coherence.discardRun', { runId: RUN_A }));
    h.state.coherence?.runs.push(run(RUN_C));
    h.state.coherence?.findings.push(finding(FINDING_LATER_SCAN, RUN_C, fact));
    expect(h.undo.undo(outcome.undoGroupId!).ok).toBe(true);
    expect(h.state.coherence?.runs.map((candidate) => candidate.id)).toEqual([RUN_A, RUN_B, RUN_C]);
    expect(h.state.coherence?.findings.map((candidate) => candidate.id)).toEqual([FINDING_MADE_TOUCHED, FINDING_OTHER_RUN, FINDING_LATER_SCAN]);
  });
});
