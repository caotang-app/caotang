/**
 * A coherence scan over the document guard, through the agent loop (coherence.md §7 tool 15; agent-harness §2, §8).
 *
 * A scope over the guard is the writer's to approve. The port refuses it without the approval, and the loop puts the
 * scope in front of the writer on a one-step card. An approved scan runs under that card's confirmation; a cancelled
 * one does not run, and the turn ends with nothing written. A scope under the guard needs no card at all.
 *
 * Each test drives a real session on the real bus, answered by the mock provider. Nothing touches the network.
 */

import { describe, expect, it } from 'vitest';

import type { ChatRequest } from '@caotang/gateway';
import { addDocument, type ProjectState } from '@caotang/store';

import { createAgentSession, type Decision, type Harness, type PendingCard, type TurnReport } from '../../src/index.js';
import { CHAPTER_ONE, OPENED, makeHarness, makeState } from '../fixtures.js';
import { mockGateway } from './gateway.js';
import { answer, steps, transcript } from './scripts.js';

const INTENT = 'Check the whole book for continuity.';
const SCAN_STEP = steps({ tool: 'coherence.scan', params: { scope: { mode: 'full' } }, expect: 'the whole book is scanned' });

/** A project with 21 scenes in Chapter 1, which is over the 20-document guard (as coherence-tools.test.ts sets it up). */
function overGuardProject(): ProjectState {
  const state = makeState();
  for (let index = 0; index < 21; index += 1) addDocument(state, { parentId: CHAPTER_ONE, title: `Scene ${index}`, body: `Scene ${index} is here.`, now: OPENED });
  return state;
}

/** One turn, with the writer's decision given for every card it is shown. Returns the report and the cards asked for. */
async function turnWith(
  harness: Harness,
  replies: readonly string[],
  decide: (card: PendingCard) => Decision,
): Promise<{ readonly report: TurnReport; readonly asked: PendingCard[]; readonly requests: ChatRequest[] }> {
  const requests: ChatRequest[] = [];
  const gateway = await mockGateway([transcript(INTENT, replies, requests)]);
  const asked: PendingCard[] = [];
  const session = createAgentSession({
    harness,
    gateway,
    decide: async (card) => {
      asked.push(card);
      return decide(card);
    },
    sessionId: 'scan-approval',
  });
  const report = await session.submit(INTENT);
  return { report, asked, requests };
}

describe('a scan over the document guard waits for the writer (coherence.md §7 tool 15)', () => {
  it('shows the writer a one-step card, and runs the scan once the card is approved', async () => {
    const state = overGuardProject();
    const { report, asked } = await turnWith(makeHarness({}, state), [SCAN_STEP, answer('The book is scanned.')], () => ({ action: 'approve' }));
    expect(asked.map((card) => card.kind)).toEqual(['confirm']);
    expect(report.status).toBe('replied');
    expect(state.coherence?.runs.length).toBe(1);
    expect(report.cards).toContainEqual(expect.objectContaining({ kind: 'confirm', decision: 'approved', tools: ['coherence.scan'] }));
    expect(report.trace.map((entry) => [entry.tool, entry.outcome])).toEqual([['coherence.scan', 'ok']]);
  });

  it('does not run the scan when the writer cancels the card, and the turn ends cancelled with nothing written', async () => {
    const state = overGuardProject();
    const { report, asked } = await turnWith(makeHarness({}, state), [SCAN_STEP, answer('unused')], () => ({ action: 'cancel' }));
    expect(asked.map((card) => card.kind)).toEqual(['confirm']);
    expect(report.status).toBe('cancelled');
    expect(state.coherence?.runs ?? []).toHaveLength(0);
    expect(report.cards).toContainEqual(expect.objectContaining({ kind: 'confirm', decision: 'cancelled' }));
  });

  it('shows no card for a scope under the guard, and runs the scan at once', async () => {
    const state = makeState();
    const { report, asked } = await turnWith(makeHarness({}, state), [SCAN_STEP, answer('The book is scanned.')], () => ({ action: 'approve' }));
    expect(asked).toEqual([]);
    expect(report.status).toBe('replied');
    expect(state.coherence?.runs.length).toBe(1);
  });
});
