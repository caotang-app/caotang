/**
 * The agent's coherence surface as pure models (coherence.md §6.3, §8, agent-harness §2, §8): "Fix with agent" builds its
 * plan from the finding's passage, a run records the scope it covered so "Run again" can scan it, a review's plan shows what it
 * reads, a streamed draft is not the panel's text, and a saved price can be cleared.
 */

import { expect, test } from '@playwright/test';

import {
  emptyCoherenceFile,
  runDeterministic,
  type CoherenceFile,
  type CoherenceModel,
  type CoherenceRun,
  type Finding,
  type ModelReply,
} from '../../packages/coherence/src/index.js';
import { getBody, getRevision, setBody } from '../../packages/store/src/index.js';

import { planCoherenceReview, reviewCostFor, runCoherenceReview } from '../../apps/desktop/src/app/coherence-review.js';
import { fixPlanFor, rerunScopeOf, runViewsOf } from '../../apps/desktop/src/app/findings-model.js';
import { newTurnView, reduceTurn } from '../../apps/desktop/src/app/agent-model.js';
import { priceClearedBy, priceFromInputs } from '../../apps/desktop/src/app/providers.js';
import { formatUsd, stepPreviewOf } from '../../apps/desktop/src/app/plan-preview.js';
import { reviewCostAt } from '../../packages/harness/src/index.js';
import type { ModelLimits } from '../../packages/gateway/src/index.js';
import { IDS, project } from './fixtures.js';

const QUOTE = 'Four little words';

/** A llm finding that quotes `QUOTE` in Scene A, with its offsets as the review would have recorded them. */
function findingOver(body: string, id = 'f_AAAAAAAAAA'): Finding {
  const from = body.indexOf(QUOTE);
  return {
    id,
    runId: 'r_RUN0000001',
    class: 'llm',
    checkId: 'llm:factual',
    type: 'factual',
    severity: 'error',
    status: 'open',
    factGroup: 'scene a|count',
    evidence: [{ docId: IDS.sceneA, quote: QUOTE, from, to: from + QUOTE.length }],
    reasoning: 'The count changes.',
    message: 'The count of words changes between two lines.',
    createdAt: '2026-10-08T09:00:00.000Z',
    updatedAt: '2026-10-08T09:00:00.000Z',
  };
}

function fileWith(findings: Finding[], runs: CoherenceRun[] = []): CoherenceFile {
  return { ...emptyCoherenceFile(), findings, runs };
}

function runOf(overrides: Partial<CoherenceRun>): CoherenceRun {
  return {
    id: 'r_RUNAAAAAAA',
    at: '2026-10-08T09:00:00.000Z',
    kind: 'deterministic',
    checkIds: ['presence.expected'],
    scope: { docIds: [IDS.sceneA] },
    findingsUpserted: [],
    status: 'complete',
    ...overrides,
  };
}

test.describe('Fix with agent: the pre-filled plan (coherence.md §6.3)', () => {
  test('builds one scene.draft rewrite of the quoted passage, with its anchor captured from the text as it stands', () => {
    const state = project();
    const body = getBody(state, IDS.sceneA);
    const fix = fixPlanFor(state, fileWith([findingOver(body)]), 'f_AAAAAAAAAA');
    expect(typeof fix).toBe('object');
    if (typeof fix === 'string') return;
    const [step] = fix.plan.steps;
    expect(step?.tool).toBe('scene.draft');
    expect(step?.params).toMatchObject({ doc: IDS.sceneA, mode: 'rewrite_selection' });
    const anchor = step?.params['selection'] as { from: number; to: number; exact: string };
    expect(anchor.exact).toBe(QUOTE);
    expect(body.slice(anchor.from, anchor.to)).toBe(QUOTE);
    expect(fix.intent).toContain('Scene A');
  });

  test('locates the quote again when its stored offsets have gone stale, and refuses a passage that has changed', () => {
    const state = project();
    const body = getBody(state, IDS.sceneA);
    const fresh = findingOver(body);
    const stale: Finding = { ...fresh, evidence: fresh.evidence.map((passage) => ({ ...passage, from: 0, to: QUOTE.length })) };
    setBody(state, IDS.sceneA, `A new opening line. ${body}`);
    const moved = fixPlanFor(state, fileWith([stale]), 'f_AAAAAAAAAA');
    expect(typeof moved).toBe('object');
    setBody(state, IDS.sceneA, 'Nothing like it any more.');
    const gone = fixPlanFor(state, fileWith([findingOver(body)]), 'f_AAAAAAAAAA');
    expect(typeof gone).toBe('string');
    expect(gone).toContain('has changed');
  });

  test('says in words when the finding is no longer in the file', () => {
    expect(fixPlanFor(project(), undefined, 'f_NOTTHERE000')).toContain('no longer in the findings file');
  });
});

test.describe('Run again: the scope a run covered (coherence.md §8)', () => {
  test('re-runs a full run as a full scan, and a run that covered one document as that document', () => {
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA, IDS.sceneB], mode: 'full' } }))).toEqual({ mode: 'full' });
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA], mode: 'doc' } }))).toEqual({ mode: 'doc', docIds: [IDS.sceneA] });
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA], mode: 'changed' } }))).toEqual({ mode: 'doc', docIds: [IDS.sceneA] });
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA] } }))).toEqual({ mode: 'doc', docIds: [IDS.sceneA] });
  });

  test('does not offer to re-run a changed run over several documents, since no scope the engine has names those documents', () => {
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA, IDS.sceneB], mode: 'changed' } }))).toBeUndefined();
  });

  test('re-running a changed run scans the document it covered, rather than finding nothing changed since the run', () => {
    const state = project();
    const now = new Date('2026-10-09T09:00:00.000Z');
    // Every other document with a body was reviewed at its current revision, so the only document a changed scan finds is Scene A.
    const file = emptyCoherenceFile();
    for (const docId of [IDS.sceneB, IDS.deepScene]) {
      file.reviewState[docId] = { lastReviewedRevision: getRevision(state, docId), lastReviewedAt: now.toISOString() };
    }
    // The app always gives the engine a mention detector; without one every count is unavailable and no review state is kept.
    const detector = () => new Map<string, number>();
    const changed = runDeterministic(state, file, { scope: { mode: 'changed' }, now, detector });
    expect(changed.run.scope.docIds).toEqual([IDS.sceneA]);
    const scope = rerunScopeOf(changed.run);
    expect(scope).toEqual({ mode: 'doc', docIds: [IDS.sceneA] });
    if (scope === undefined) return;
    // The first changed run reviewed Scene A, so a changed re-run would find nothing: the re-run names the document instead.
    const again = runDeterministic(state, changed.file, { scope, now, detector });
    expect(again.run.scope.docIds).toEqual([IDS.sceneA]);
    expect(again.run.notes ?? []).not.toContain('no documents in scope');
    expect(again.file.reviewState[IDS.sceneA]?.lastReviewedRevision).toBe(getRevision(state, IDS.sceneA));
  });

  test('does not offer to re-run a run that does not say what it covered, and shows only deterministic runs as re-runnable', () => {
    expect(rerunScopeOf(runOf({ scope: { docIds: [IDS.sceneA, IDS.sceneB] } }))).toBeUndefined();
    const file = fileWith([], [runOf({ id: 'r_QUICKAAAAA', scope: { docIds: [IDS.sceneA], mode: 'full' } }), runOf({ id: 'r_REVIEWAAAA', kind: 'llm', scope: { docIds: [IDS.sceneA], mode: 'full' } })]);
    const rows = runViewsOf(file, () => 'Scene A');
    expect(rows.find((row) => row.id === 'r_QUICKAAAAA')?.rerunScope).toEqual({ mode: 'full' });
    expect(rows.find((row) => row.id === 'r_REVIEWAAAA')?.rerunScope).toBeUndefined();
  });
});

test.describe('the review’s plan on the card (coherence.md §7 tool 16)', () => {
  test('shows the documents the review reads, its token estimates and the stage counts', () => {
    // The shape the harness's preview gives the card (agent/ports.ts previewFor): each document's estimate is `tokens`.
    const preview = {
      documents: [{ title: 'Scene A', tokens: 120, truncated: false, codexDropped: ['Ada'], storyDropped: [] }],
      categories: ['factual'],
      maxFindings: 50,
      estimate: { extractCalls: 1, extractTokens: 120, verifyCallsAtMost: 0, verifyTokensAtMost: 0, totalTokensAtMost: 120 },
      overGuard: false,
      promptPreview: 'Read the document.',
    };
    const view = stepPreviewOf('coherence.review', preview, project());
    expect(view).toMatchObject({
      kind: 'review',
      documents: [{ title: 'Scene A', tokens: 120, truncated: false, left: ['Ada'] }],
      extractCalls: 1,
      verifyCallsAtMost: 0,
      totalTokensAtMost: 120,
      maxFindings: 50,
      overGuard: false,
      prompt: 'Read the document.',
    });
  });

  test('shows nothing for a review whose plan is not there', () => {
    expect(stepPreviewOf('coherence.review', undefined, project())).toBeUndefined();
  });

  test('the Findings tab reads a review’s cost through the harness’s reviewCostAt, at the profile’s default model as the agent session does', () => {
    const plan = planCoherenceReview(project(), emptyCoherenceFile(), { scope: { mode: 'full' }, maxFindings: 50 });
    // A gateway whose limits differ by profile and by model. The desktop's agent session names its profile and no model, so the loop
    // stages `reviewCostAt(plan, gateway, profileId, undefined)` (loop.ts); the Findings tab must read the limits the same way.
    const limits = { maxOutputTokens: 1000, pricePer1k: { prompt: 1, completion: 2 } };
    const asked: [string | undefined, string | undefined][] = [];
    const gateway = {
      modelLimits(profileId?: string, model?: string): ModelLimits {
        asked.push([profileId, model]);
        if (profileId !== 'pr_PRICED0001') return { maxOutputTokens: 1000, pricePer1k: { prompt: 9, completion: 9 } };
        return model === undefined ? limits : { maxOutputTokens: 1000, pricePer1k: { prompt: 7, completion: 7 } };
      },
    };
    const card = reviewCostAt(plan, gateway, 'pr_PRICED0001', undefined);
    const findings = reviewCostFor(plan, gateway, 'pr_PRICED0001');
    expect(asked).toEqual([
      ['pr_PRICED0001', undefined],
      ['pr_PRICED0001', undefined],
    ]);
    expect(findings).toBe(card?.totalUsd);
    expect(formatUsd(findings ?? 0)).toBe(formatUsd(card?.totalUsd ?? 0));
    // The prompt side is the plan's own token bound, and the reply side is each call's output cap, not the verification input (the old
    // Findings figure charged the verification input at the reply price).
    const calls = plan.estimate.extractCalls + plan.estimate.verifyCallsAtMost;
    expect(card?.promptUsd).toBeCloseTo(plan.estimate.totalTokensAtMost / 1000);
    expect(card?.completionUsd).toBeCloseTo(calls * 1000 * (2 / 1000));
    expect(findings).toBeGreaterThan(0);
    // An unpriced model shows no cost on either surface.
    expect(reviewCostFor(plan, { modelLimits: () => ({ maxOutputTokens: 1000 }) }, 'pr_PRICED0001')).toBeUndefined();
  });
});

test.describe('the streamed draft and the panel (agent-harness §8)', () => {
  test('a draft delta is not the panel’s tail, so the panel shows no draft text while the scene streams', () => {
    const turn = newTurnView('t1', 'Draft it');
    const after = reduceTurn(turn, { type: 'draft.delta', turnId: 't1', docTitle: 'Scene A', delta: 'The ferry', start: true });
    expect(after.streamed).toBe('');
    const streamed = reduceTurn(turn, { type: 'model.delta', turnId: 't1', delta: 'Planning' });
    expect(streamed.streamed).toBe('Planning');
  });
});

test.describe('clearing a saved price (provider-gateway §2)', () => {
  test('two empty price inputs clear a saved price, and a partly filled pair is still refused', () => {
    expect(priceClearedBy('', '')).toBe(true);
    expect(priceClearedBy('  ', '')).toBe(true);
    expect(priceClearedBy('0.5', '')).toBe(false);
    expect(priceFromInputs('', '')).toEqual({ ok: true });
    expect(priceFromInputs('0.5', '')).toMatchObject({ ok: false });
  });
});

test.describe('the held coherence file for a fix', () => {
  test('a finding with no quoted passage says there is no text to fix', () => {
    const quiet: Finding = { ...findingOver(getBody(project(), IDS.sceneA)), evidence: [] };
    expect(fixPlanFor(project(), fileWith([quiet]), 'f_AAAAAAAAAA')).toContain('no text to fix');
  });
});

test.describe('the Findings tab’s model review keeps what changed while it waited (coherence.md §5.3)', () => {
  test('the run is written into the held file as it stands once the model answers, so a scan made meanwhile is kept', async () => {
    const state = project();
    const file = emptyCoherenceFile();
    const plan = planCoherenceReview(state, file, { scope: { mode: 'doc', docIds: [IDS.sceneA] }, maxFindings: 50 });
    const scanned = runOf({ id: 'r_SCANWHILE1' });
    let held: CoherenceFile = file;
    const model: CoherenceModel = {
      model: 'test-model',
      complete: async (): Promise<ModelReply> => {
        // A scan of the manuscript lands while the review waits on the model, and replaces the held file.
        held = { ...emptyCoherenceFile(), runs: [scanned] };
        return { content: '{"spans": []}' };
      },
    };
    const result = await runCoherenceReview({ state, file, plan, model, maxFindings: 50, now: new Date('2026-10-09T09:00:00.000Z'), currentFile: () => held });
    expect(result.file.runs.map((run) => run.id)).toEqual([scanned.id, result.run.id]);
  });
});
