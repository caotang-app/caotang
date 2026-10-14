/**
 * A fake OpenAI-compatible endpoint, served to the page by Playwright's route interception (not a server). It runs the
 * app's real transport, so the list-models probe, the response-format probe and the streamed planner reply all travel the
 * same path a real provider's would. The address is loopback, so the profile needs no key (provider-gateway §7).
 *
 * `reply` answers each chat request with the text the model "writes". A planner call (the agent's system message) gets its
 * plan the first time, and a plain reply after the results have come back.
 */

import { expect, type Page, type Route } from '@playwright/test';

export const FAKE_ENDPOINT = 'http://127.0.0.1:5999/v1';

/** The chat request body as the app sends it, reduced to what the fake reads. */
export interface FakeRequest {
  readonly stream: boolean;
  readonly system: string;
  readonly assistantTurns: number;
  readonly user: string;
}

export type FakeReply = (request: FakeRequest) => string;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function parse(route: Route): FakeRequest {
  const body = JSON.parse(route.request().postData() ?? '{}') as {
    stream?: boolean;
    messages?: { role: string; content: string }[];
  };
  const messages = body.messages ?? [];
  const first = messages[0];
  return {
    stream: body.stream !== false,
    system: first?.role === 'system' ? first.content : '',
    assistantTurns: messages.filter((message) => message.role === 'assistant').length,
    user: messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n'),
  };
}

/** One Server-Sent Events body, as an OpenAI-style stream: the text as one delta, then the finish reason and usage. */
function sse(text: string): string {
  const chunks = [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: Math.ceil(text.length / 4) } },
  ];
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
}

/**
 * Routes every request to the fake endpoint through `reply`. Call it before the page makes the requests (before `goto`,
 * or before the click that starts them).
 */
export async function fakeEndpoint(page: Page, reply: FakeReply): Promise<void> {
  await page.route('http://127.0.0.1:5999/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/v1/models') {
      await route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 'test-model' }, { id: 'other-model' }] }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/v1/chat/completions') {
      const parsed = parse(route);
      if (!parsed.stream) {
        // The response-format probe asks for a JSON object and gets one.
        await route.fulfill({
          status: 200,
          headers: { ...CORS, 'content-type': 'application/json' },
          body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok": true}' } }] }),
        });
        return;
      }
      await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(reply(parsed)) });
      return;
    }
    await route.fulfill({ status: 404, headers: CORS, body: 'not found' });
  });
}

/**
 * The planner's first reply is `plan`; every later one is a plain answer, so a turn ends after its results. A drafting call
 * (the prose a drafted step writes) gets `draft`, so a step the model writes is the text the test names.
 */
export function planThenAnswer(plan: unknown, answer = 'Done.', draft = 'A drafted synopsis.'): FakeReply {
  return (request) => {
    if (request.system.startsWith('You are drafting prose')) return draft;
    return request.assistantTurns === 0 ? JSON.stringify(plan) : JSON.stringify({ reply: answer });
  };
}

/**
 * Adds the fake endpoint as a profile and makes it the active one, through Settings on the projects screen. The endpoint must be
 * routed (`fakeEndpoint`) before this, since saving it lists its models.
 */
export async function useFakeEndpoint(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings');
  await settings.getByRole('button', { name: 'Add a provider' }).click();
  await settings.getByLabel('Name').fill('Fake endpoint');
  await settings.getByLabel('Endpoint (the base URL, ending in /v1)').fill(FAKE_ENDPOINT);
  await settings.getByLabel('Model').fill('test-model');
  await settings.getByRole('button', { name: 'Save profile' }).click();
  await expect(settings.getByText('Saved “Fake endpoint”.')).toBeVisible();
  await settings.locator('[data-profile="Fake endpoint"]').getByRole('button', { name: 'Use this profile' }).click();
  await expect(settings.getByText('is now the active profile')).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();
}
