/**
 * A scene draft streams as the model writes it (agent-harness §8): the loop emits `draft.delta` events for the scene, the first of
 * which empties the scene's ghost region, and the deltas together are the draft. They are not the panel's `model.delta` tail.
 */

import { describe, expect, it } from 'vitest';

import { runScenario, type Scenario } from '../../src/agent/eval.js';
import type { AgentEvent } from '../../src/index.js';
import { makeState } from '../fixtures.js';
import { mockGateway } from './gateway.js';
import { prose, steps, transcript } from './scripts.js';

const INTENT = 'Draft the opening of The Friend.';
const DRAFT = 'The ferry came in with the tide.';

function scenarioOf(): Scenario {
  return {
    name: 'draft stream',
    category: 'single-op',
    intent: INTENT,
    project: makeState,
    gateway: () =>
      mockGateway([
        transcript(INTENT, [steps({ tool: 'scene.draft', params: { doc: 'The Friend', instruction: 'Open.', mode: 'draft' }, expect: 'drafted' })]),
        prose('Brief: Open.', DRAFT),
      ]),
    expect: { status: 'applied' },
  };
}

describe('a scene draft as it streams into the ghost region (agent-harness §8)', () => {
  it('emits the draft as deltas for its scene, starting with a mark that empties the region, and the deltas make up the draft', async () => {
    const run = await runScenario(scenarioOf());
    const deltas = run.events.filter((event): event is Extract<AgentEvent, { type: 'draft.delta' }> => event.type === 'draft.delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas[0]).toMatchObject({ start: true, delta: '', docTitle: 'The Friend' });
    expect(deltas.slice(1).every((event) => event.start !== true)).toBe(true);
    expect(deltas.map((event) => event.delta).join('')).toBe(DRAFT);
  });

  it('still stages the completed draft as a ghost once it has streamed, so the writer approves the text that was shown', async () => {
    const run = await runScenario(scenarioOf());
    const ghost = run.events.find((event) => event.type === 'ghost');
    expect(ghost).toMatchObject({ type: 'ghost', docTitle: 'The Friend', text: DRAFT });
  });
});
