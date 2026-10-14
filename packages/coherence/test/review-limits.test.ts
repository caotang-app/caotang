import { describe, expect, it, vi } from 'vitest';

import {
  REVIEW_BUDGETS,
  emptyCoherenceFile,
  executeReviewTool,
  planReview,
  runReview,
  setFindingStatusForAgent,
  type CoherenceFile,
  type CoherenceModel,
  type ContextBlock,
  type Finding,
  type ReviewContext,
  type ReviewPlan,
} from '../src/index.js';

import { LATER, NOW, buildState, detect, entry } from './fixtures.js';

const ELENA = 'c_5H8QK2M9RT';

function oneScene(body: string): ReturnType<typeof buildState> {
  return buildState({ scenes: [{ id: 'sA', title: 'Only', body }], entries: [entry(ELENA, 'Elena')] });
}

describe('review budgets (§5.3, context-assembly §3)', () => {
  it('truncates a focus document to its token budget and says so in the plan', () => {
    const plan = planReview(oneScene('Elena is here. '.repeat(10_000)), emptyCoherenceFile(), { scope: { mode: 'full' } });
    expect(plan.documents[0]?.truncated).toBe(true);
    expect(plan.documents[0]?.estimatedTokens).toBeLessThan(REVIEW_BUDGETS.focusTokens + 1_000);
  });

  it('caps the codex layer at its budget, however much the caller supplies', () => {
    const plan = planReview(oneScene('Elena is here.'), emptyCoherenceFile(), { scope: { mode: 'full' } }, {
      codex: () => [{ key: 'long', text: 'entry text. '.repeat(5_000) }],
    });
    expect(plan.documents[0]?.estimatedTokens).toBeLessThan(REVIEW_BUDGETS.codexTokens + 1_000);
    expect(plan.documents[0]?.codexDropped).toEqual(['long']);
  });

  it('caps the story-so-far layer at its budget', () => {
    const plan = planReview(oneScene('Elena is here.'), emptyCoherenceFile(), { scope: { mode: 'full' } }, {
      storySoFar: () => [{ key: 'long', text: 'earlier synopsis. '.repeat(8_000) }],
    });
    expect(plan.documents[0]?.estimatedTokens).toBeLessThan(REVIEW_BUDGETS.storyTokens + 1_000);
    expect(plan.documents[0]?.storyDropped).toEqual(['long']);
  });
});

/** The text between two markers in the first extraction's user message, which carries the codex and story layers. */
function between(user: string, start: string, end: string): string {
  const from = user.indexOf(start);
  const to = user.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`markers not found: "${start}" … "${end}"`);
  return user.slice(from + start.length, to);
}

describe('context layers keep whole entries (codex.md §6, context-assembly §2)', () => {
  /** Runs one approved review and returns the user message of its first call. */
  async function firstUserMessage(context: ReviewContext): Promise<{ user: string; plan: ReviewPlan }> {
    const state = oneScene('Elena is here.');
    const plan = planReview(state, emptyCoherenceFile(), { scope: { mode: 'full' } }, context);
    const users: string[] = [];
    const model: CoherenceModel = {
      model: 'fake-1',
      complete: async (request) => {
        users.push(request.user);
        return { content: '{"spans": []}' };
      },
    };
    await runReview(state, emptyCoherenceFile(), plan, { model, approved: true, now: NOW, context });
    return { user: users[0] ?? '', plan };
  }

  it('ends the codex block on an entry boundary, with entries of different lengths', async () => {
    const entries: ContextBlock[] = [
      { key: 'one', text: `## One (character)\n${'a'.repeat(3_000)}` },
      { key: 'two', text: `## Two (location)\n${'b'.repeat(5_000)}` },
      { key: 'three', text: `## Three (object)\n${'c'.repeat(4_000)}` },
      { key: 'four', text: `## Four (lore)\n${'d'.repeat(500)}` },
    ];
    const { user, plan } = await firstUserMessage({ codex: () => entries });
    const codex = between(user, 'Codex entries relevant to this document:\n', '\n\nStory so far');
    expect(codex).toBe(`${entries[0]?.text}\n\n${entries[1]?.text}`);
    expect(user).not.toContain('## Three');
    expect(user).not.toContain('ccc');
    expect(plan.documents[0]?.codexDropped).toEqual(['three', 'four']);
  });

  it('keeps the nearest scenes in the story-so-far layer, and drops the oldest whole', async () => {
    const scenes: ContextBlock[] = Array.from({ length: 8 }, (_, i) => ({ key: `scene-${i}`, text: `Synopsis ${i}: ${'s'.repeat(4_000)}` }));
    const { user, plan } = await firstUserMessage({ storySoFar: () => scenes });
    const story = between(user, 'Story so far (synopses of earlier scenes):\n', '\n\nFocus document');
    expect(story.endsWith(scenes[7]?.text ?? '')).toBe(true);
    expect(story).not.toContain('Synopsis 0:');
    expect(plan.documents[0]?.storyDropped).toEqual(['scene-0', 'scene-1', 'scene-2']);
  });
});

describe('cancellation', () => {
  it('stops before the first call when the signal is already aborted, and keeps the run partial', async () => {
    const state = oneScene('Elena is here.');
    const plan = planReview(state, emptyCoherenceFile(), { scope: { mode: 'full' } });
    const controller = new AbortController();
    controller.abort();
    const model: CoherenceModel = { model: 'fake-1', complete: vi.fn(async () => ({ content: '{"spans": []}' })) };
    const result = await runReview(state, emptyCoherenceFile(), plan, { model, approved: true, now: NOW, signal: controller.signal });
    expect(model.complete).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
    expect(result.notes).toContain('extraction stopped: the run was cancelled');
  });
});

describe('the approved tool path', () => {
  it('runs an approved plan and returns the file, the run and a summary', async () => {
    const state = oneScene('Elena is here.');
    const plan: ReviewPlan = planReview(state, emptyCoherenceFile(), { scope: { mode: 'full' } });
    const model: CoherenceModel = { model: 'fake-1', complete: async () => ({ content: '{"spans": []}' }) };
    const result = await executeReviewTool(plan, true, { state, file: emptyCoherenceFile(), now: NOW, model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file?.runs).toHaveLength(1);
    expect(result.summary).toBe('Review complete: 0 finding(s) recorded.');
  });
});

describe('the agent fix postcondition when the check cannot run', () => {
  it('refuses with cannot-verify, not with a guess, when the mention count is unavailable', () => {
    const state = buildState({
      scenes: [{ id: 'harbour', title: 'Harbour', body: 'Gulls only.' }],
      entries: [entry(ELENA, 'Elena')],
    });
    const file: CoherenceFile = {
      ...emptyCoherenceFile(),
      sceneMeta: { harbour: { expectedPresent: [ELENA] } },
      findings: [
        {
          id: 'f_AAAAAAAAAA',
          runId: 'r_BBBBBBBBBB',
          class: 'deterministic',
          checkId: 'presence.expected',
          type: 'expected-absent',
          severity: 'error',
          status: 'open',
          factGroup: 'c_5h8qk2m9rt|expected-present',
          message: 'Elena is expected in Harbour',
          evidence: [{ docId: 'harbour', quote: 'Gulls only.', from: 0, to: 11 }],
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        } satisfies Finding,
      ],
    };
    // No detector and no cache: the count is unavailable, so the check cannot confirm the fix.
    const outcome = setFindingStatusForAgent(state, file, { findingId: 'f_AAAAAAAAAA', status: 'fixed' }, { now: LATER });
    expect(outcome).toMatchObject({ ok: false, refusal: 'cannot-verify' });
    // With a detector the same request is answered by the check itself.
    const answered = setFindingStatusForAgent(state, file, { findingId: 'f_AAAAAAAAAA', status: 'fixed' }, { now: LATER, detector: detect });
    expect(answered).toMatchObject({ ok: false, refusal: 'evidence-still-present' });
  });
});
