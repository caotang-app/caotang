/**
 * Mock script library — [provider-gateway.md §8](docs/architecture/provider-gateway.md).
 *
 * Contract, verbatim from the spec:
 *  - Deterministic: same script + same request = same response bytes. No clock, no
 *    randomness (temperature ignored).
 *  - Scriptable: `echo`, `toolJson`, `stream(words)`, `fail(mode)` ship by default.
 *  - Usage accounting: fake token counts = `ceil(chars/4)` so ledger assertions
 *    work unchanged.
 */

import type { ProviderErrorKind } from '../errors.js';
import type { ChatChunk, ChatRequest, ModelInfo } from '../types.js';

// The token rule lives in one module so the mock and the real gateway agree on it.
// Re-exported here so the `./mock` subpath keeps the names the desktop app and the tests use.
export { estimateTokens, usageFor } from '../tokens.js';

/** A scripted failure: the §4 kind the stream raises, with what the gateway would carry for it. */
export interface MockError {
  kind: ProviderErrorKind;
  /** the HTTP status the failure stands for, when it has one */
  status?: number;
  /** the wait the provider asked for, in milliseconds */
  retryAfterMs?: number;
  /** diagnostic text; also the excerpt the message quotes, for the kinds that quote one */
  detail?: string;
  /**
   * The words the failure carries, when the script words it itself (a demo refusal). The gateway's own text for the kind is used
   * when this is absent, so a script that names no words gets the same message a real provider failure would show.
   */
  message?: string;
}

export interface MockResponse {
  content: string;
  finishReason?: 'stop' | 'length' | 'error';
  /** raises a `ProviderError` of this kind before any output, instead of answering */
  error?: MockError;
}

/** Picks the response for a request. First match wins — order is the script's order. */
export interface MockScript {
  match: (req: ChatRequest) => boolean;
  respond: (req: ChatRequest) => MockResponse | AsyncIterable<ChatChunk>;
}

/** Yield control without advancing wall-clock time, so consumers' async logic runs. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Last user message, or the last message of any role — the mock's "the prompt". */
function promptOf(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i -= 1) {
    const m = req.messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return req.messages.at(-1)?.content ?? '';
}

const always = () => true;

/** `echo` — returns the user message. The default happy-path script. */
export const echo: MockScript = {
  match: always,
  respond: (req) => ({ content: promptOf(req) }),
};

/** `toolJson` — emits a canned JSON tool call for the harness protocol. */
export const toolJson: MockScript = {
  match: (req) => req.responseFormat !== undefined && req.responseFormat !== 'text',
  respond: (req) => {
    const hint = req.responseFormat && req.responseFormat !== 'text' ? req.responseFormat : undefined;
    return {
      content: JSON.stringify({
        tool: 'binder.create',
        arguments: { parentId: 'root', type: 'text', title: 'Mock Scene' },
        ...(hint ? { schemaHint: hint } : {}),
      }),
    };
  },
};

/** `stream(words)` — chunks a string into word-sized deltas, exercising async consumers. */
export function stream(text: string): MockScript {
  return {
    match: always,
    async *respond(): AsyncIterable<ChatChunk> {
      for (const word of text.split(/(?<=\s)/)) {
        await tick();
        if (word.length > 0) yield { delta: word };
      }
    },
  };
}

export type FailMode = 'network' | 'auth' | 'rate-limit' | 'context-length';

/** The §4 error each spec fail mode stands for. */
const FAIL_ERRORS: Record<FailMode, MockError> = {
  network: { kind: 'network', detail: 'simulated' },
  auth: { kind: 'auth', status: 401 },
  'rate-limit': { kind: 'rate_limit', status: 429 },
  'context-length': { kind: 'context_length', status: 400 },
};

/** `fail(mode)` — simulates error paths for harness error tests: each mode raises the §4 error it names. */
export function fail(mode: FailMode): MockScript {
  return {
    match: always,
    respond: () => ({ content: '', error: { ...FAIL_ERRORS[mode] } }),
  };
}

/** Model list the mock reports. Fixed — determinism applies here too. */
export const MOCK_MODELS: ModelInfo[] = [
  { id: 'mock/echo-1', contextWindow: 128_000 },
  { id: 'mock/tool-json-1', contextWindow: 128_000 },
  { id: 'mock/stream-1', contextWindow: 32_000 },
];

/** The default script library, in match order. `echo` is the fallback. */
export const defaultScripts: MockScript[] = [toolJson, echo];
