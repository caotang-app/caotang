/**
 * Two facts a plan card and a status card carry for the panel: a status card's start and finish, which its elapsed timer reads
 * (agent-harness §8), and a step's preview, which the preflight supplies when the step has no drafted proposal of its own
 * (agent-harness §2, §3 rows 9 and 13).
 */

import { describe, expect, it } from 'vitest';

import { advance, planCardOf, type EditableSteps, type PlanPreflight, type PlanStep, type StatusCard } from '../../src/index.js';

const card = (status: StatusCard['status']): StatusCard => ({
  id: 'c1',
  turnId: 'turn-1',
  callId: 'c1',
  tool: 'meta.set',
  risk: 'write-auto',
  status,
  args: {},
});

describe('a status card carries when it started and when it finished (agent-harness §8)', () => {
  it('stamps the start when a call moves to running, and the finish when it reaches done', () => {
    const running = advance(card('pending-approval'), 'running', { at: 1_000 });
    expect(running).toMatchObject({ status: 'running', startedAt: 1_000 });
    expect(running.finishedAt).toBeUndefined();
    const done = advance(running, 'done', { summary: 'set the label', at: 1_450 });
    expect(done).toMatchObject({ status: 'done', startedAt: 1_000, finishedAt: 1_450 });
  });

  it('a call cancelled before it runs has a finish and no start, so the panel shows no timer for it', () => {
    const cancelled = advance(card('pending-approval'), 'cancelled', { at: 2_000 });
    expect(cancelled).toMatchObject({ status: 'cancelled', finishedAt: 2_000 });
    expect(cancelled.startedAt).toBeUndefined();
  });

  it('a card moved without a time is stamped with neither', () => {
    const done = advance(card('running'), 'done');
    expect(done).not.toHaveProperty('finishedAt');
    expect(done).not.toHaveProperty('startedAt');
  });
});

describe('a step shows the preview its preflight carries when it has no drafted proposal (agent-harness §2)', () => {
  const steps: PlanStep[] = [{ tool: 'codex.write', params: { entries: [] }, expect: 'the codex entry is written' }];
  const state: EditableSteps = { steps, origins: [0], proposals: [undefined], stale: [false], superseded: [], completed: [] };
  const diff = { entries: [{ action: 'create', name: 'Kestrel' }] };

  it('a codex diff reaches the card from the preflight, where the step has nothing of its own to preview', () => {
    const preflight: PlanPreflight = {
      ok: true,
      steps: [{ index: 0, tool: 'codex.write', expect: 'the codex entry is written', status: 'ready', preview: diff }],
    };
    const view = planCardOf({
      id: 'card',
      turnId: 't',
      kind: 'plan',
      revision: 0,
      previewRevision: 0,
      from: 0,
      state,
      preflight,
      previews: [undefined],
      risks: ['write-auto'],
    });
    expect(view.steps[0]?.preview).toEqual(diff);
  });

  it('a preview the step computes from its draft wins over the preflight’s', () => {
    const preflight: PlanPreflight = {
      ok: true,
      steps: [{ index: 0, tool: 'codex.write', expect: 'the codex entry is written', status: 'ready', preview: diff }],
    };
    const own = { rows: [{ doc: 'The Friend', action: 'create', synopsis: 'A keeper.', words: 2 }] };
    const view = planCardOf({
      id: 'card',
      turnId: 't',
      kind: 'plan',
      revision: 0,
      previewRevision: 0,
      from: 0,
      state,
      preflight,
      previews: [own],
      risks: ['write-auto'],
    });
    expect(view.steps[0]?.preview).toEqual(own);
  });
});
