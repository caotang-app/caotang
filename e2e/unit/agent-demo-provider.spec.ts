import { expect, test } from '@playwright/test';

import type { ChatRequest } from '../../packages/gateway/src/types.js';
import { DEMO_REFUSAL, DRAFT_PREFIX, PLANNER_PREFIX } from '../../packages/gateway/src/mock/index.js';

import { DEMO_FALLBACK_REPLY, appMockProvider } from '../../apps/desktop/src/app/providers.js';

/**
 * The zero-key demo's provider as the app wires it (providers.ts): the demo scripts, then the planner fallback, then the echo.
 * Run without a browser: the provider is a pure mock, so what is checked is the app's own list and the words it holds.
 */

/** A planner call the way the harness sends one: its system message names the agent and it asks for a JSON object. */
function plannerCall(intent: string): ChatRequest {
  return {
    messages: [
      { role: 'system', content: `${PLANNER_PREFIX} Plan the steps.` },
      { role: 'user', content: `Request: ${intent}` },
    ],
    responseFormat: { jsonSchemaHint: { title: 'Plan', description: 'A JSON object.' } },
  };
}

/** A drafting call the way the harness sends one: prose, asked for as text. */
function draftingCall(brief: string): ChatRequest {
  return {
    messages: [
      { role: 'system', content: `${DRAFT_PREFIX} Write the prose for the scene described below.` },
      { role: 'user', content: `Document "The Ferry":\nMode: draft\nBrief: ${brief}` },
    ],
    responseFormat: 'text',
  };
}

/** What the app's provider streams back for a request, and the error it ends on, if any. */
async function answer(request: ChatRequest): Promise<{ text: string; error: unknown }> {
  let text = '';
  try {
    for await (const chunk of appMockProvider().complete(request)) text += chunk.delta ?? '';
    return { text, error: undefined };
  } catch (error) {
    return { text, error };
  }
}

test('the demo fallback reply and the demo refusal are the same words, held once in the gateway mock', () => {
  expect(DEMO_FALLBACK_REPLY).toBe(DEMO_REFUSAL);
  expect(DEMO_FALLBACK_REPLY).toContain('answers only the three demo requests');
});

test('a planner request the demo does not know gets the plain fallback reply, with no error', async () => {
  const { text, error } = await answer(plannerCall('Something the demo does not know.'));
  expect(error).toBeUndefined();
  expect(text).toBe(JSON.stringify({ reply: DEMO_FALLBACK_REPLY }));
});

test('a drafting call the demo does not script is refused with the demo words, and no text', async () => {
  const { text, error } = await answer(draftingCall('Name the POV character.'));
  expect(text).toBe('');
  expect((error as { message?: string } | undefined)?.message).toBe(DEMO_FALLBACK_REPLY);
});
