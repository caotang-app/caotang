/**
 * The zero-key demo through the loop (context-assembly §6, coherence.md §6.3): a rewrite the demo did not script is refused by the
 * provider, so the turn stops on an ask-back with the demo's words, no card is shown, and the scene keeps its text. Before the
 * refusal, the echo fallback answered such a call with the prompt, which became the draft and was written into the scene.
 */

import { describe, expect, it } from 'vitest';

import { DEMO_REFUSAL, demoScripts, echo } from '@caotang/gateway/mock';
import { addDocument, getBody, type ProjectState } from '@caotang/store';

import { createAgentPorts, createAgentSession, createContextPort, createHarness, type AgentEvent, type Decision, type PendingCard } from '../../src/index.js';
import { OPENED, clock, makeState } from '../fixtures.js';
import { mockGateway } from './gateway.js';

const FERRY = 'n_FERRY00001';
const BODY = 'It rained over the harbour all evening, and the lamp stayed dark.';
const PASSAGE = 'the lamp stayed dark';

/** A project with one prose scene the fix would rewrite. */
function withFerry(): ProjectState {
  const state = makeState();
  addDocument(state, { id: FERRY, parentId: 'manuscript', title: 'The Ferry', body: BODY, now: OPENED });
  return state;
}

/** A rewrite of the passage, as the Fix with agent plan carries it: the scene, the mode, the selection and the brief. */
function rewritePlan() {
  const from = BODY.indexOf(PASSAGE);
  return {
    steps: [
      {
        tool: 'scene.draft',
        params: {
          doc: FERRY,
          mode: 'rewrite_selection',
          selection: { from, to: from + PASSAGE.length, exact: PASSAGE },
          instruction: 'Rewrite this passage so it no longer conflicts with the rest of the story.',
        },
        expect: 'the passage no longer conflicts with the rest of the story',
      },
    ],
  };
}

describe('the demo provider refuses a rewrite it did not script, through the loop', () => {
  it('stops the turn on the demo’s words, shows no card, and writes nothing into the scene', async () => {
    const state = withFerry();
    const before = getBody(state, FERRY);
    // The app's list: the demo scripts, then the echo fallback that the refusal must come before (providers.ts).
    const gateway = await mockGateway([...demoScripts, echo]);
    const harness = createHarness({ state, ports: createAgentPorts(), clock: clock.now });
    const pending: PendingCard[] = [];
    const events: AgentEvent[] = [];
    const decision: Decision = { action: 'approve' };
    const session = createAgentSession({
      harness,
      gateway,
      context: createContextPort({ state }),
      decide: async (card) => {
        pending.push(card);
        return decision;
      },
      emit: (event) => events.push(event),
      sessionId: 'demo-refusal',
    });

    const report = await session.submitPlan('Fix the passage in “The Ferry”', rewritePlan());

    expect(pending).toHaveLength(0);
    expect(report.status).toBe('failed');
    expect(report.askBack?.reason).toContain(DEMO_REFUSAL);
    expect(events.some((event) => event.type === 'ghost')).toBe(false);
    expect(getBody(state, FERRY)).toBe(before);
  });
});
