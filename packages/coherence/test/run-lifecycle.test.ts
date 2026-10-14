import { setBody } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import type {
  CoherenceError} from '../src/index.js';
import {
  RUN_HISTORY_LIMIT,
  ScopeError,
  dismissFinding,
  discardRun,
  emptyCoherenceFile,
  markFindingFixed,
  reopenFinding,
  runDeterministic,
  setFindingStatusForAgent,
  type CoherenceFile,
  type CoherenceRun,
  type Finding,
} from '../src/index.js';

import { LATER, NOW, buildState, detect, entry } from './fixtures.js';

const ELENA = 'c_5H8QK2M9RT';
const ANSEL = 'c_ANSELANSEL';

function scenario(): ReturnType<typeof buildState> {
  return buildState({
    scenes: [
      { id: 'harbour', title: 'Harbour', body: 'Gulls only.' },
      { id: 'shore', title: 'Shore', body: 'Elena watched the sea.' },
    ],
    entries: [entry(ELENA, 'Elena'), entry(ANSEL, 'Ansel')],
  });
}

function declared(): CoherenceFile {
  return {
    ...emptyCoherenceFile(),
    sceneMeta: { harbour: { expectedPresent: [ELENA] }, shore: { expectedPresent: [ANSEL] } },
  };
}

function full(state: ReturnType<typeof buildState>, file: CoherenceFile, now: Date = NOW): ReturnType<typeof runDeterministic> {
  return runDeterministic(state, file, { scope: { mode: 'full' }, now, detector: detect });
}

function byId(file: CoherenceFile, id: string): Finding {
  const found = file.findings.find((finding) => finding.id === id);
  if (found === undefined) throw new Error(`no finding ${id}`);
  return found;
}

describe('runDeterministic: upsert and the findings lifecycle (§6.1)', () => {
  it('creates open findings stamped with the run, and advances review state for every scanned scene', () => {
    const state = scenario();
    const first = full(state, declared());
    expect(first.run).toMatchObject({ kind: 'deterministic', status: 'complete', findingsUpserted: expect.any(Array) });
    // Two presence violations (Elena absent from Harbour, Ansel absent from Shore) and Ansel never named at all.
    expect(first.run.findingsUpserted).toHaveLength(3);
    for (const finding of first.file.findings) {
      expect(finding).toMatchObject({ status: 'open', runId: first.run.id, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    }
    expect(first.file.reviewState).toEqual({
      harbour: { lastReviewedRevision: 0, lastReviewedAt: NOW.toISOString() },
      shore: { lastReviewedRevision: 0, lastReviewedAt: NOW.toISOString() },
    });
  });

  it('re-running on unchanged facts updates the same findings and creates none', () => {
    const state = scenario();
    const first = full(state, declared());
    const second = full(state, first.file, LATER);
    expect(second.file.findings.map((f) => f.id).sort()).toEqual(first.file.findings.map((f) => f.id).sort());
    expect(second.run.findingsUpserted.sort()).toEqual(first.run.findingsUpserted.sort());
    const kept = byId(second.file, first.file.findings[0]?.id ?? '');
    expect(kept).toMatchObject({ runId: second.run.id, createdAt: NOW.toISOString(), updatedAt: LATER.toISOString() });
  });

  it('keeps a dismissed finding dismissed, appends its re-detection, and does not re-alarm', () => {
    const state = scenario();
    const first = full(state, declared());
    const target = first.file.findings[0]?.id ?? '';
    const dismissed = dismissFinding(first.file, target, { reason: 'intentional', note: 'deep POV' }, NOW);
    const second = full(state, dismissed, LATER);
    const finding = byId(second.file, target);
    expect(finding.status).toBe('dismissed');
    expect(finding.redetections).toEqual([{ runId: second.run.id, at: LATER.toISOString(), evidence: finding.evidence }]);
    expect(second.run.findingsUpserted).not.toContain(target);
    expect(second.run.notes).toContain('1 previously dismissed finding(s) still present');
  });

  it('keeps a fixed finding fixed, and reports its recurrence without re-opening it', () => {
    const state = scenario();
    const first = full(state, declared());
    const target = first.file.findings[0]?.id ?? '';
    const fixed = markFindingFixed(first.file, target, 'rewrote the opening', NOW);
    const second = full(state, fixed, LATER);
    expect(byId(second.file, target).status).toBe('fixed');
    // The note names the finding by the statement its card shows, never by its id.
    const message = byId(second.file, target).message;
    expect(second.run.notes?.some((note) => note === `recurred after marked fixed: “${message}”`)).toBe(true);
    expect(second.run.notes?.join(' ')).not.toContain(target);
  });

  it('clears an open finding that the check no longer produces, and says so in the run', () => {
    const state = scenario();
    const first = full(state, declared());
    const target = first.file.findings.find((f) => f.factGroup.startsWith(ELENA.toLowerCase()));
    expect(target).toBeDefined();
    setBody(state, 'harbour', 'Gulls only. Elena came down to the water.');
    const second = full(state, first.file, LATER);
    expect(second.file.findings.some((f) => f.id === target?.id)).toBe(false);
    expect(second.run.notes?.some((note) => note.includes('no longer detected were cleared'))).toBe(true);
  });
});

describe('runDeterministic: scope, review state and partial coverage (§6.2)', () => {
  it('a document scope upserts only findings that quote that document', () => {
    const state = scenario();
    const result = runDeterministic(state, declared(), { scope: { mode: 'doc', docIds: ['harbour'] }, now: NOW, detector: detect });
    expect(result.run.scope.docIds).toEqual(['harbour']);
    // Codex-level findings quote nothing, so they belong to every run; document-level ones must touch the scope.
    expect(result.file.findings.some((f) => f.evidence.some((passage) => passage.docId === 'shore'))).toBe(false);
    expect(result.file.findings.some((f) => f.evidence.some((passage) => passage.docId === 'harbour'))).toBe(true);
    expect(Object.keys(result.file.reviewState)).toEqual(['harbour']);
  });

  it('a changed scope reads only the documents edited since their last review', () => {
    const state = scenario();
    const first = full(state, declared());
    setBody(state, 'shore', 'Elena watched the sea. Ansel waved.');
    const changed = runDeterministic(state, first.file, { scope: { mode: 'changed' }, now: LATER, detector: detect });
    expect(changed.run.scope.docIds).toEqual(['shore']);

    const quiet = runDeterministic(state, changed.file, { scope: { mode: 'changed' }, now: LATER, detector: detect });
    expect(quiet.run.scope.docIds).toEqual([]);
    expect(quiet.run.notes).toContain('no documents in scope');
  });

  it('records the mode the writer asked for, so the run can be scanned again in the same scope (coherence.md §8)', () => {
    const state = scenario();
    expect(runDeterministic(state, declared(), { scope: { mode: 'doc', docIds: ['harbour'] }, now: NOW, detector: detect }).run.scope.mode).toBe('doc');
    expect(full(state, declared()).run.scope.mode).toBe('full');
  });

  it('is partial when a document has no usable count, and does not advance that document', () => {
    const result = runDeterministic(scenario(), declared(), { scope: { mode: 'full' }, now: NOW });
    expect(result.run.status).toBe('partial');
    expect(result.run.notes?.some((note) => note.includes('mention counts unavailable for 2 document(s)'))).toBe(true);
    expect(result.file.reviewState).toEqual({});
  });

  it('names empty documents it skipped, and does not scan them', () => {
    const state = buildState({
      scenes: [
        { id: 'shore', title: 'Shore', body: 'Elena watched the sea.' },
        { id: 'blank', title: 'Blank', body: '   ' },
      ],
      entries: [entry(ELENA, 'Elena')],
    });
    const result = full(state, emptyCoherenceFile());
    expect(result.run.notes?.some((note) => note.includes('empty document(s) skipped: Blank'))).toBe(true);
    expect(result.file.reviewState['blank']).toBeUndefined();
  });

  it('refuses a document scope that names an empty document', () => {
    const state = buildState({ scenes: [{ id: 'blank', title: 'Blank', body: '' }] });
    expect(() => runDeterministic(state, emptyCoherenceFile(), { scope: { mode: 'doc', docIds: ['blank'] }, now: NOW })).toThrow(ScopeError);
  });

  it('keeps the run history to its cap, dropping the oldest', () => {
    const state = scenario();
    const seeded = emptyCoherenceFile();
    seeded.runs = Array.from({ length: RUN_HISTORY_LIMIT }, (_, index) => ({
      id: `r_${String(index).padStart(10, 'A')}`,
      at: NOW.toISOString(),
      kind: 'deterministic',
      checkIds: [],
      scope: { docIds: [] },
      findingsUpserted: [],
      status: 'complete',
    } satisfies CoherenceRun));
    const result = full(state, seeded, LATER);
    expect(result.file.runs).toHaveLength(RUN_HISTORY_LIMIT);
    expect(result.file.runs.at(-1)?.id).toBe(result.run.id);
    expect(result.file.runs[0]?.id).not.toBe(seeded.runs[0]?.id);
  });
});

describe('dismissal and re-open (§6.3)', () => {
  const found = (): { file: CoherenceFile; id: string } => {
    const result = full(scenario(), declared());
    return { file: result.file, id: result.file.findings[0]?.id ?? '' };
  };

  it('accepts a reason from the picker and refuses one that is not', () => {
    const { file, id } = found();
    expect(() => dismissFinding(file, id, { reason: 'deep pov' }, NOW)).toThrow(/is not on the picker/);
    try {
      dismissFinding(file, id, { reason: 'deep pov' }, NOW);
    } catch (error) {
      expect((error as CoherenceError).code).toBe('dismissal-invalid');
    }
  });

  it('dismisses an open finding with its reason and note, and re-opens it with both cleared', () => {
    const { file, id } = found();
    const dismissed = dismissFinding(file, id, { reason: 'flashback', note: 'the cold open' }, NOW);
    expect(byId(dismissed, id)).toMatchObject({ status: 'dismissed', dismissedReason: 'flashback', note: 'the cold open' });
    const reopened = reopenFinding(dismissed, id, LATER);
    const finding = byId(reopened, id);
    expect(finding.status).toBe('open');
    expect(finding.dismissedReason).toBeUndefined();
    expect(finding.note).toBeUndefined();
  });

  it('will not dismiss a finding that is not open', () => {
    const { file, id } = found();
    const fixed = markFindingFixed(file, id, undefined, NOW);
    expect(() => dismissFinding(fixed, id, { reason: 'intentional' }, NOW)).toThrow(/is fixed; re-open it/);
  });

  it('discards a run, removing what it created that nobody touched, and keeping what they dismissed', () => {
    const result = full(scenario(), declared());
    const [keep, ...others] = result.file.findings;
    expect(keep).toBeDefined();
    expect(others).toHaveLength(2);
    const dismissedFile = dismissFinding(result.file, keep?.id ?? '', { reason: 'intentional' }, LATER);
    const discarded = discardRun(dismissedFile, result.run.id);
    expect(discarded.removedFindingIds.sort()).toEqual(others.map((f) => f.id).sort());
    expect(discarded.file.findings.map((f) => f.id)).toEqual([keep?.id ?? '']);
    expect(discarded.file.runs).toEqual([]);
  });

  it('keeps a finding the writer dismissed and then re-opened, since the re-open is still the writer’s touch', () => {
    const result = full(scenario(), declared());
    const target = result.file.findings[0]?.id ?? '';
    const reopened = reopenFinding(dismissFinding(result.file, target, { reason: 'intentional' }, LATER), target, LATER);
    const discarded = discardRun(reopened, result.run.id);
    expect(discarded.removedFindingIds).not.toContain(target);
    expect(discarded.file.findings.map((f) => f.id)).toContain(target);
  });

  it('keeps a finding an earlier run created when a later run updates it in the same millisecond', () => {
    const state = scenario();
    const first = full(state, declared(), NOW);
    const second = full(state, first.file, NOW);
    expect(second.run.findingsUpserted.length).toBeGreaterThan(0);
    const discarded = discardRun(second.file, second.run.id);
    expect(discarded.removedFindingIds).toEqual([]);
    expect(discarded.file.findings.map((f) => f.id).sort()).toEqual(first.file.findings.map((f) => f.id).sort());
  });
});

describe('the agent fix path (§7 tool 17 and its postcondition)', () => {
  const options = (): { now: Date; detector: typeof detect } => ({ now: LATER, detector: detect });

  it('refuses a dismissal with the spec wording, and refuses any status other than fixed', () => {
    const state = scenario();
    const { file } = full(state, declared());
    const id = file.findings[0]?.id ?? '';
    const dismissed = setFindingStatusForAgent(state, file, { findingId: id, status: 'dismissed' }, options());
    expect(dismissed).toEqual({ ok: false, refusal: 'dismissal-is-writer-judgment', message: 'dismissal is a writer judgment; propose it in your report' });
    const open = setFindingStatusForAgent(state, file, { findingId: id, status: 'open' }, options());
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.refusal).toBe('status-not-settable');
  });

  it('names an unknown finding and says where to look', () => {
    const state = scenario();
    const outcome = setFindingStatusForAgent(state, full(state, declared()).file, { findingId: 'f_NOPENOPENO', status: 'fixed' }, options());
    expect(outcome.ok === false && outcome.message).toContain('use an id from a recent run report or the findings inbox');
  });

  it('marks fixed only once the check no longer produces the finding, then reports it already fixed', () => {
    const state = scenario();
    const { file } = full(state, declared());
    const id = file.findings.find((f) => f.factGroup.startsWith(ELENA.toLowerCase()))?.id ?? '';

    const blocked = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed' }, options());
    expect(blocked).toEqual({ ok: false, refusal: 'evidence-still-present', message: 'evidence still present — apply the fix first' });

    setBody(state, 'harbour', 'Gulls only. Elena came down to the water.');
    const fixed = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed', note: 'added Elena' }, options());
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.finding).toMatchObject({ status: 'fixed', note: 'added Elena' });
    expect(fixed.alreadyFixed).toBe(false);

    const again = setFindingStatusForAgent(state, fixed.file, { findingId: id, status: 'fixed' }, options());
    expect(again.ok && again.alreadyFixed).toBe(true);
  });

  it('checks an llm finding by whether its quoted text is still in the manuscript', () => {
    const state = scenario();
    const llm: Finding = {
      id: 'f_LLMLLMLLML',
      runId: 'r_LLMLLMLLML',
      class: 'llm',
      checkId: 'llm:characterization',
      type: 'characterization',
      severity: 'warning',
      status: 'open',
      factGroup: 'elena|eye colour',
      message: 'Eye colour changes',
      evidence: [{ docId: 'shore', quote: 'Elena watched the sea.', from: 0, to: 22 }],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const file: CoherenceFile = { ...emptyCoherenceFile(), findings: [llm] };
    expect(setFindingStatusForAgent(state, file, { findingId: llm.id, status: 'fixed' }, options()).ok).toBe(false);

    setBody(state, 'shore', 'Elena turned to the sea.');
    const outcome = setFindingStatusForAgent(state, file, { findingId: llm.id, status: 'fixed' }, options());
    expect(outcome.ok).toBe(true);
  });

  it('refuses a note past the limit, names the count and the limit, and stores a note at the limit', () => {
    const state = scenario();
    const { file } = full(state, declared());
    const id = file.findings.find((f) => f.factGroup.startsWith(ELENA.toLowerCase()))?.id ?? '';
    setBody(state, 'harbour', 'Gulls only. Elena came down to the water.');

    const over = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed', note: 'x'.repeat(501) }, options());
    expect(over).toMatchObject({ ok: false, refusal: 'note-too-long' });
    if (!over.ok) expect(over.message).toContain('501 characters; the limit is 500');

    const atLimit = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed', note: 'x'.repeat(500) }, options());
    expect(atLimit.ok && atLimit.finding.note).toBe('x'.repeat(500));
  });

  it('counts a note in code points, as the harness does, so 300 emoji fit', () => {
    const state = scenario();
    const { file } = full(state, declared());
    const id = file.findings.find((f) => f.factGroup.startsWith(ELENA.toLowerCase()))?.id ?? '';
    setBody(state, 'harbour', 'Gulls only. Elena came down to the water.');
    const outcome = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed', note: '😀'.repeat(300) }, options());
    expect(outcome.ok).toBe(true);
  });

  it('refuses to mark a never-mentioned finding fixed when the recompute had no counts to judge it by', () => {
    const state = buildState({
      scenes: [{ id: 'harbour', title: 'Harbour', body: 'Gulls only.' }],
      entries: [entry(ANSEL, 'Ansel')],
    });
    const { file } = full(state, emptyCoherenceFile());
    const id = file.findings.find((f) => f.checkId === 'codex.never-mentioned')?.id ?? '';
    expect(id).not.toBe('');

    // No detector and no cache: the check cannot run, so its silence proves nothing.
    const blind = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed' }, { now: LATER });
    expect(blind).toMatchObject({ ok: false, refusal: 'cannot-verify' });

    // With counts, the same check still produces the finding, so the fix is refused for the right reason.
    const seen = setFindingStatusForAgent(state, file, { findingId: id, status: 'fixed' }, options());
    expect(seen).toMatchObject({ ok: false, refusal: 'evidence-still-present' });
  });
});
