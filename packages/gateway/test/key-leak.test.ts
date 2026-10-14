/**
 * The key-leak guard. The key must never appear in an error, a ledger row, a serialised
 * profile, a request-log entry, or console output. The hard case is a provider that
 * echoes the key back, which several real providers do, and the tests make that happen
 * on every path a response can take.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, redact } from '../src/index.js';
import { addEndpoint, collect, harness, KEY, ScriptedFetch, sseResponse, userMessage } from './helpers.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Every way a provider can answer with the key in it. */
const ECHOES: Array<[string, () => Response | Promise<Response>]> = [
  ['a 401 that quotes the key', () => jsonResponse(401, { error: `Incorrect API key provided: ${KEY}` })],
  ['a 404 that quotes the key', () => jsonResponse(404, `no route for key ${KEY}`)],
  ['a 400 that quotes the key', () => jsonResponse(400, { error: { message: `invalid ${KEY}` } })],
  ['a 429 that quotes the key', () => jsonResponse(429, `slow down, ${KEY}`)],
  ['a 500 that quotes the key', () => jsonResponse(500, `internal: ${KEY}`)],
  ['an in-stream error that quotes the key', () => sseResponse([{ error: { message: `key ${KEY} is bad` } }])],
  ['a malformed event that contains the key', () => sseResponse([`{"leaked": "${KEY}"`])],
  ['a bearer-style echo of a different token', () => jsonResponse(500, 'auth: Bearer sk-someone-elses-token-99999')],
];

describe('the key never reaches an error, a log, or the ledger', () => {
  it.each(ECHOES)('scrubs the key from the error and the log when the provider answers with %s', async (_name, responder) => {
    const h = harness({ net: new ScriptedFetch().push(responder), retry: { maxRetries: 0 } });
    await addEndpoint(h);

    const { error } = await collect(h.gateway.complete(userMessage('x')));
    expect(error).toBeInstanceOf(ProviderError);
    const err = error as ProviderError;

    const surfaces = JSON.stringify({ message: err.message, detail: err.detail, name: err.name, stack: err.stack });
    expect(surfaces).not.toContain(KEY);
    expect(surfaces).not.toContain('CAOTANG-SECRET');
    expect(surfaces).not.toContain('someone-elses-token');

    expect(JSON.stringify(h.gateway.requestLog.entries())).not.toContain(KEY);
    expect(JSON.stringify(h.gateway.ledger.snapshot())).not.toContain(KEY);
  });

  it('scrubs the key from a probe failure, since the probe is also a request', async () => {
    const h = harness({ net: new ScriptedFetch().push(() => jsonResponse(500, `response_format rejected for ${KEY}`)) });
    const profile = await addEndpoint(h);

    const error = await h.gateway.probeResponseFormat(profile.id).catch((e: unknown) => e);
    expect(JSON.stringify({ message: (error as Error).message, detail: (error as ProviderError).detail })).not.toContain(KEY);
  });

  it('keeps the key out of console output across every scenario', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')];
    try {
      for (const [, responder] of ECHOES) {
        const h = harness({ net: new ScriptedFetch().push(responder), retry: { maxRetries: 0 } });
        await addEndpoint(h);
        await collect(h.gateway.complete(userMessage('x')));
      }
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('the serialised profile carries no key', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the key off every view the store hands out, through create, update, and list', async () => {
    const h = harness();
    const created = await addEndpoint(h);
    const updated = await h.profiles.update(created.id, { name: 'renamed', apiKey: 'sk-rotated-key-abcdef123456' });

    const serialised = JSON.stringify({
      created,
      updated,
      get: h.profiles.get(created.id),
      list: h.profiles.list(),
      active: h.profiles.active(),
    });
    expect(serialised).not.toContain(KEY);
    expect(serialised).not.toContain('sk-rotated-key');
    expect(serialised).not.toContain('apiKey');
  });

  it('leaves the key recoverable only through the key store, never through a profile', async () => {
    const h = harness();
    const created = await addEndpoint(h);
    expect(await h.keys.reveal(created.id)).toBe(KEY);
    expect(JSON.stringify(h.profiles.get(created.id))).not.toContain(KEY);
  });
});

describe('the redaction rules', () => {
  it('removes a literal key, a bearer token, and a bare sk- credential', () => {
    const text = `key=${KEY} auth: Bearer abc.def-ghi header and sk-live-0123456789ABCDEF`;
    const out = redact(text, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('abc.def-ghi');
    expect(out).not.toContain('sk-live-0123456789ABCDEF');
    expect(out).toContain('[redacted]');
  });

  it('leaves ordinary prose alone', () => {
    expect(redact('The model returned 500 after 2 retries.', [KEY])).toBe('The model returned 500 after 2 retries.');
  });

  it('does nothing harmful when there is no key to remove', () => {
    expect(redact('nothing secret here', [undefined, ''])).toBe('nothing secret here');
  });
});
