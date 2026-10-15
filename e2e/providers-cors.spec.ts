import { expect, test } from '@playwright/test';

import { PRESETS, presetFor } from '../packages/gateway/src/index.js';
import { adapterFor } from '../packages/gateway/src/adapters/index.js';

/**
 * The CORS support sweep (provider-gateway §9, providers-browser-cors.md §2). For every shipped preset this asks the
 * *browser* — not a stub — whether a page fetch may reach the provider: a GET on the models path carrying the preset's
 * auth-shaped headers, so a real preflight runs where the headers demand one. No keys are needed: a blocked preflight
 * fails before auth is consulted, and a passing one answers 401/200 either way.
 *
 * The result per preset is attached to the test run as JSON (`cors-sweep` attachment). The registry's `cors` field is
 * checked against it: a preset flagged 'ok' that the browser cannot reach is a stale row and fails; 'blocked' rows are
 * asserted to actually fail, so the disabled badge the UI shows is the truth.
 */

interface SweepResult {
  readonly preset: string;
  readonly url: string;
  readonly outcome: 'ok' | 'blocked' | 'http-error' | 'error';
  readonly status?: number;
  readonly detail?: string;
}

/** The headers a real request carries, with a placeholder credential — enough to trigger the same preflight. */
function requestFor(presetId: string): { url: string; headers: Record<string, string> } {
  const preset = presetFor(presetId);
  if (preset === undefined) return { url: '', headers: {} };
  const adapter = adapterFor(preset.adapter);
  const ctx = { baseUrl: preset.baseUrl, model: preset.defaultModel, quirks: preset.quirks, caps: {} };
  const path = adapter.modelsPath(ctx) ?? '/models';
  return {
    url: `${preset.baseUrl.replace(/\/$/, '')}${path}`,
    headers: adapter.headers(ctx, { apiKey: 'sweep-placeholder-not-a-key' }, 'models'),
  };
}

test.describe.configure({ mode: 'serial' });

test('every preset answers or honestly fails a browser CORS request', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/');

  const results: SweepResult[] = [];
  for (const preset of PRESETS) {
    if (preset.id === 'mock') continue;
    const request = requestFor(preset.id);
    const outcome = await page.evaluate(
      async ({ url, headers }) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15_000);
        try {
          const res = await fetch(url, { method: 'GET', headers, signal: ac.signal });
          return { outcome: res.ok ? 'ok' : 'http-error', status: res.status };
        } catch (error) {
          // A CORS refusal surfaces as a TypeError; a timeout surfaces as AbortError.
          const name = error instanceof DOMException ? error.name : '';
          if (name === 'AbortError') return { outcome: 'error', detail: 'timed out' };
          return { outcome: 'blocked', detail: error instanceof TypeError ? 'TypeError (CORS or network)' : String(error) };
        } finally {
          clearTimeout(timer);
        }
      },
      { url: request.url, headers: request.headers },
    );
    results.push({
      preset: preset.id,
      url: request.url,
      outcome: outcome.outcome as SweepResult['outcome'],
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
    });
  }

  await testInfo.attach('cors-sweep', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });

  for (const result of results) {
    const preset = presetFor(result.preset)!;
    if (preset.cors === 'ok') {
      expect(
        result.outcome === 'ok' || result.outcome === 'http-error',
        `${result.preset} is flagged cors:'ok' but the browser could not read the response (${result.outcome}: ${result.detail ?? result.status})`,
      ).toBe(true);
    }
    if (preset.cors === 'blocked') {
      expect(result.outcome, `${result.preset} is flagged cors:'blocked' but answered ${result.status}`).toBe('blocked');
    }
    // 'unknown' rows are only recorded.
  }
});
