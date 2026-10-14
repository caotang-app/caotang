/**
 * The HTTP transport — [provider-gateway.md §3–§4](docs/architecture/provider-gateway.md).
 *
 * This is the only file that calls `fetch`, which is the spec's rule that the gateway
 * "is the only module that makes network calls" made structural. Every request passes
 * `assertEgress` first, so a request for any other origin is refused before a socket
 * opens. Every redirect is refused rather than followed, because a followed POST would
 * carry the manuscript to wherever the redirect points.
 *
 * Timing has three phases, and each is a deadline measured on the injected clock:
 *  - **connect**: until headers arrive, 10s after the attempt starts;
 *  - **first token**: until the first output, 30s after the attempt starts;
 *  - **idle**: between chunks once output has started, 60s;
 * with the whole request capped at 5 minutes, across retries.
 *
 * Retry is allowed only while nothing has been delivered to the caller. Once a single
 * delta has been yielded, a failure is final, because a second attempt would repeat
 * text the caller already holds.
 */

import type { Clock } from './clock.js';
import { abortError, EgressDeniedError, ProviderError, providerMessages } from './errors.js';
import { backoffMs, isRetryable, parseRetryAfter, type RetryPolicy, type TransportTimeouts } from './retry.js';
import type { RequestLog, RequestOutcome } from './request-log.js';
import { redact } from './redact.js';
import { createSseParser } from './sse.js';
import { CallerCancelled, DeadlineReached, guard, sleep } from './timing.js';
import { estimateTokens } from './tokens.js';
import { type FinishReason, parseChunk } from './wire.js';
import type { ChatChunk, Usage } from './types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportDeps {
  readonly fetch: FetchLike;
  readonly clock: Clock;
  readonly random: () => number;
  readonly timeouts: TransportTimeouts;
  readonly retry: RetryPolicy;
  readonly log: RequestLog;
  /** the origin of the active profile's endpoint, or undefined when no endpoint profile is active */
  readonly activeOrigin: () => string | undefined;
}

/** One logical call: everything a request needs, with the key attached for this call only. */
export interface CallSpec {
  readonly profileId: string;
  readonly model: string;
  /** the host, for messages a person reads */
  readonly host: string;
  /** the normalised base, for the endpoint message */
  readonly baseUrl: string;
  readonly path: '/chat/completions' | '/models';
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly accept: string;
  readonly body?: string;
  /** plaintext, for this call's Authorization header only. Never stored on an error or a log entry. */
  readonly apiKey?: string;
  /** the prompt's estimated size, the fallback when a provider sends no usage */
  readonly promptTokens: number;
  readonly signal?: AbortSignal;
  /** overrides the policy's retry count. The §5 probe makes exactly one attempt. */
  readonly maxRetries?: number;
}

/** Counts attempts and records the usage the ledger should see, whatever the outcome. */
export interface StreamStats {
  attempts: number;
  usage: Usage | undefined;
}

/** Shared across attempts, so a retry knows whether anything has reached the caller yet. */
interface StreamState {
  delivered: string;
  sawDelta: boolean;
}

interface Deadline {
  readonly attemptStart: number;
  readonly totalAt: number;
}

interface Limit {
  readonly ms: number;
  /** what to tell the person if this limit is the one that fires */
  readonly reason: string;
}

interface WireAccumulator {
  done: boolean;
  /**
   * Set by the first parsed event, whether or not it carries text. The first-token deadline
   * is about a provider that has gone silent, and a reasoning model streaming its thinking
   * is not silent, so the deadline ends at the first event and not the first visible token.
   */
  alive: boolean;
  finish: FinishReason | undefined;
  usage: Usage | undefined;
}

interface StreamOutcome {
  readonly finish: FinishReason;
  readonly usage: Usage | undefined;
}

const EXCERPT_LIMIT = 300;
/** How much of an error body is read. Enough for any provider message; not a page dump. */
const ERROR_BODY_LIMIT = 2_048;
/** How much of a successful body is kept, so a protocol excerpt can show what arrived. */
const HEAD_LIMIT = 2_048;
const CONTEXT_OVERFLOW = /context[_ ]length|maximum context|context window|too many tokens|reduce the length/i;
const REJECTS_RESPONSE_FORMAT = /response_format|json_object|json_schema/i;

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
  }
  return String(err);
}

/** Redacts, collapses whitespace, and bounds. Every excerpt that leaves this file passes through here. */
function clean(text: string, spec: CallSpec): string {
  return redact(text, [spec.apiKey]).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT);
}

/** Appends `text` to the kept head of a body, up to `HEAD_LIMIT`, and no further. */
function keepHead(head: string, text: string): string {
  return head.length >= HEAD_LIMIT ? head : head + text.slice(0, HEAD_LIMIT - head.length);
}

function networkError(spec: CallSpec, reason: string): ProviderError {
  const detail = clean(reason, spec);
  return new ProviderError('network', providerMessages.network(spec.host, detail), { detail });
}

function protocolError(spec: CallSpec, raw: string): ProviderError {
  const excerpt = clean(raw, spec);
  return new ProviderError('protocol', providerMessages.protocol(spec.host, excerpt), { detail: excerpt });
}

/**
 * The limit for one phase, capped by the whole-request deadline. When the cap is what
 * fires, the reason says so, because "request exceeded 5 minutes" is the true cause and
 * "no first token within 30s" would be a lie.
 */
function limitAt(deps: TransportDeps, deadline: Deadline, phaseEnd: number, phaseReason: string): Limit {
  const now = deps.clock.now();
  if (phaseEnd <= deadline.totalAt) return { ms: phaseEnd - now, reason: phaseReason };
  return {
    ms: deadline.totalAt - now,
    reason: `request exceeded ${Math.round(deps.timeouts.totalMs / 60_000)} minutes`,
  };
}

/**
 * The egress guard. A request whose origin is not the active profile's endpoint origin
 * is refused. This is checked in the transport, before a socket opens, and also in the
 * gateway before any key is decrypted, so a refused request never touches key material.
 */
export function assertEgress(deps: TransportDeps, url: string): void {
  const requested = new URL(url).origin;
  const allowed = deps.activeOrigin();
  if (allowed === undefined) {
    throw new EgressDeniedError(`Refused a request to ${requested}: no endpoint profile is active.`);
  }
  if (requested !== allowed) {
    throw new EgressDeniedError(
      `Refused a request to ${requested}: only the active profile's endpoint (${allowed}) may be contacted.`,
    );
  }
}

function logAttempt(
  deps: TransportDeps,
  spec: CallSpec,
  attempt: number,
  outcome: RequestOutcome,
  extra: { status?: number; error?: unknown } = {},
): void {
  const error = extra.error instanceof ProviderError ? extra.error : undefined;
  const status = extra.status ?? error?.status;
  deps.log.append({
    at: deps.clock.now(),
    profileId: spec.profileId,
    model: spec.model,
    attempt,
    url: spec.url,
    outcome,
    ...(status !== undefined ? { status } : {}),
    ...(error !== undefined ? { errorKind: error.kind } : {}),
    ...(error?.detail !== undefined ? { note: error.detail } : {}),
  });
}

/** Maps a failed attempt to the outcome the log should record for it. */
function outcomeOf(err: unknown): RequestOutcome {
  if (err instanceof EgressDeniedError) return 'refused';
  if (err instanceof CallerCancelled) return 'cancelled';
  return 'failed';
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already closed or errored: there is nothing left to release.
  }
}

async function readExcerpt(deps: TransportDeps, spec: CallSpec, response: Response): Promise<string> {
  try {
    const text = await guard(response.text(), deps.timeouts.connectMs, deps.clock, spec.signal);
    return text.slice(0, ERROR_BODY_LIMIT);
  } catch (err) {
    if (err instanceof CallerCancelled) throw err;
    await discard(response);
    return '';
  }
}

/**
 * Recognises a context-window refusal in a 400 body and extracts the two numbers the
 * user needs. Providers phrase this differently, so the regexes take what they can and
 * fall back to the local estimate of the prompt.
 */
export function contextOverflow(body: string, estimate: number): { prompt: number; window: number | undefined } | undefined {
  if (!CONTEXT_OVERFLOW.test(body)) return undefined;
  const window = /maximum context length is ([\d,]+)/i.exec(body)?.[1];
  const prompt = /resulted in ([\d,]+) tokens/i.exec(body)?.[1];
  return {
    prompt: prompt === undefined ? estimate : Number(prompt.replace(/,/g, '')),
    window: window === undefined ? undefined : Number(window.replace(/,/g, '')),
  };
}

/** Turns a non-2xx response into the §4 error for its status. Never copies the key. */
async function statusError(deps: TransportDeps, spec: CallSpec, response: Response): Promise<ProviderError> {
  const raw = await readExcerpt(deps, spec, response);
  const excerpt = clean(raw, spec);
  const status = response.status;

  if (status === 401 || status === 403) {
    return new ProviderError('auth', providerMessages.auth(spec.host), { status });
  }
  if (status === 404) {
    return new ProviderError('endpoint', providerMessages.endpoint(spec.path, spec.baseUrl), { status, detail: excerpt });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), deps.clock.now());
    return new ProviderError('rate_limit', providerMessages.rateLimit(spec.host), { status, detail: excerpt, retryAfterMs });
  }
  if (status === 400) {
    const overflow = contextOverflow(raw, spec.promptTokens);
    if (overflow !== undefined) {
      return new ProviderError(
        'context_length',
        providerMessages.contextLength(overflow.prompt, overflow.window ?? 'unknown'),
        { status, detail: excerpt },
      );
    }
  }
  return new ProviderError('provider', providerMessages.provider(spec.host, status, excerpt), { status, detail: excerpt });
}

/**
 * One connection attempt: egress check, fetch, the connect deadline, and the status
 * mapping. Returns the response only for a 2xx. Everything else throws.
 */
async function connect(deps: TransportDeps, spec: CallSpec, deadline: Deadline, controller: AbortController): Promise<Response> {
  assertEgress(deps, spec.url);

  const headers: Record<string, string> = { accept: spec.accept };
  if (spec.body !== undefined) headers['content-type'] = 'application/json';
  if (spec.apiKey !== undefined && spec.apiKey !== '') headers.authorization = `Bearer ${spec.apiKey}`;

  let pending: Promise<Response>;
  try {
    pending = deps.fetch(spec.url, {
      method: spec.method,
      headers,
      body: spec.body,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (err) {
    // A fetch that throws rather than rejecting is still a failure to reach the provider.
    throw networkError(spec, describe(err));
  }
  const limit = limitAt(
    deps,
    deadline,
    deadline.attemptStart + deps.timeouts.connectMs,
    `no response within ${seconds(deps.timeouts.connectMs)}`,
  );

  let response: Response;
  try {
    response = await guard(pending, limit.ms, deps.clock, spec.signal, () => {
      // The race is lost, so stop the fetch, and release a response that still arrives.
      controller.abort();
      pending.then(
        (late) => void late.body?.cancel().catch(() => undefined),
        () => undefined,
      );
    });
  } catch (err) {
    if (err instanceof DeadlineReached) throw networkError(spec, limit.reason);
    if (err instanceof CallerCancelled) throw err;
    throw networkError(spec, describe(err));
  }

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await discard(response);
    throw new EgressDeniedError(
      `${spec.host} redirected the request. Caotang does not follow redirects, so set the base URL to the final address in Settings.`,
    );
  }
  if (!response.ok) throw await statusError(deps, spec, response);
  return response;
}

/** The wait before the next attempt: the provider's `Retry-After` if it sent one, else the backoff. */
function retryWait(deps: TransportDeps, err: ProviderError, retries: number, maxRetries: number, totalAt: number): number | undefined {
  if (!isRetryable(err) || retries >= maxRetries) return undefined;
  const wait = err.retryAfterMs ?? backoffMs(retries, deps.random, deps.retry);
  return deps.clock.now() + wait < totalAt ? wait : undefined;
}

function* deltasOf(spec: CallSpec, payloads: readonly string[], acc: WireAccumulator): Generator<string, void, undefined> {
  for (const payload of payloads) {
    if (acc.done) return;
    if (payload === '[DONE]') {
      acc.done = true;
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      throw protocolError(spec, payload);
    }
    const parsed = parseChunk(json);
    if (parsed === undefined) throw protocolError(spec, payload);
    acc.alive = true;
    if (parsed.error !== undefined) {
      const detail = clean(parsed.error, spec);
      throw new ProviderError('provider', providerMessages.providerStream(spec.host, detail), { detail });
    }
    if (parsed.usage !== undefined) acc.usage = parsed.usage;
    if (parsed.finish !== undefined) acc.finish = parsed.finish;
    yield* parsed.deltas;
  }
}

/**
 * Reads the SSE body, yielding each delta as it arrives. The stream ends at `[DONE]`,
 * at end of body, or, once a finish reason has been seen, at the idle deadline (some
 * providers keep the connection open after the answer is complete).
 */
async function* readStream(
  deps: TransportDeps,
  spec: CallSpec,
  response: Response,
  deadline: Deadline,
  state: StreamState,
): AsyncGenerator<ChatChunk, StreamOutcome, undefined> {
  const { clock } = deps;
  if (response.body === null) throw protocolError(spec, 'the response had no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const acc: WireAccumulator = { done: false, alive: false, finish: undefined, usage: undefined };
  // The start of what the body said, kept for the excerpt if no event ever parses.
  let head = '';

  try {
    for (;;) {
      // Before the provider has said anything, the first-token window applies. After it,
      // the gap between events is what counts.
      const limit = acc.alive
        ? limitAt(deps, deadline, clock.now() + deps.timeouts.idleMs, `stream idle for ${seconds(deps.timeouts.idleMs)}`)
        : limitAt(
            deps,
            deadline,
            deadline.attemptStart + deps.timeouts.firstTokenMs,
            `no first token within ${seconds(deps.timeouts.firstTokenMs)}`,
          );

      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await guard(reader.read(), limit.ms, clock, spec.signal);
      } catch (err) {
        if (err instanceof CallerCancelled) throw err;
        if (err instanceof DeadlineReached) {
          // The provider finished and then went quiet. The answer is whole, so end it.
          if (acc.finish !== undefined) break;
          throw networkError(spec, limit.reason);
        }
        throw networkError(spec, describe(err));
      }

      if (read.done) {
        const tail = decoder.decode();
        head = keepHead(head, tail);
        for (const delta of deltasOf(spec, [...parser.push(tail), ...parser.end()], acc)) {
          state.delivered += delta;
          state.sawDelta = true;
          yield { delta };
        }
        break;
      }

      const text = decoder.decode(read.value, { stream: true });
      head = keepHead(head, text);
      for (const delta of deltasOf(spec, parser.push(text), acc)) {
        state.delivered += delta;
        state.sawDelta = true;
        yield { delta };
      }
      if (acc.done) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  // The body closed without [DONE] and without a finish reason: the answer is cut short.
  if (!acc.done && acc.finish === undefined) {
    // No event ever parsed, so this was never a stream: a plain completion from a server that
    // ignored `stream: true`, or a proxy's page. Asking again gets the same answer, so it is one
    // protocol failure with no retry, not a network failure to repeat.
    if (!acc.alive) throw protocolError(spec, head.trim() === '' ? 'the response was empty' : head);
    throw networkError(spec, 'the stream ended before the response finished');
  }
  return { finish: acc.finish ?? 'stop', usage: acc.usage };
}

/**
 * A streaming chat call, with the whole retry and timeout policy.
 *
 * The contract for the caller is: yields deltas as they arrive, then exactly one
 * terminal chunk carrying `finishReason` and `usage`. A caller abort is not thrown. It
 * becomes a terminal `finishReason: 'error'`, with usage counting the deltas actually
 * delivered (§3: "resolves the iterator with what arrived"). Every other failure is
 * thrown as a `ProviderError`, or as an `EgressDeniedError` for a refused request.
 */
export async function* streamChat(
  deps: TransportDeps,
  spec: CallSpec,
  stats: StreamStats,
): AsyncGenerator<ChatChunk, void, undefined> {
  const { clock } = deps;
  const maxRetries = spec.maxRetries ?? deps.retry.maxRetries;
  const totalAt = clock.now() + deps.timeouts.totalMs;
  const state: StreamState = { delivered: '', sawDelta: false };
  const estimated = (): Usage => ({ promptTokens: spec.promptTokens, completionTokens: estimateTokens(state.delivered) });
  let retries = 0;

  // The controller of the attempt in flight. Aborting it on the way out means a fetch never
  // outlives the generator that started it, whichever branch ends the stream.
  let controller: AbortController | undefined;
  try {
    for (;;) {
      const attempt = stats.attempts;
      stats.attempts += 1;
      const deadline: Deadline = { attemptStart: clock.now(), totalAt };
      let status: number | undefined;
      controller = new AbortController();

      try {
        const response = await connect(deps, spec, deadline, controller);
        status = response.status;
        const outcome = yield* readStream(deps, spec, response, deadline, state);
        const usage = outcome.usage ?? estimated();
        stats.usage = usage;
        logAttempt(deps, spec, attempt, 'ok', { status });
        yield { finishReason: outcome.finish, usage };
        return;
      } catch (err) {
        if (err instanceof CallerCancelled) {
          logAttempt(deps, spec, attempt, 'cancelled', { status });
          stats.usage = estimated();
          yield { finishReason: 'error', usage: stats.usage };
          return;
        }

        if (state.sawDelta) stats.usage = estimated();
        const wait =
          err instanceof ProviderError && !state.sawDelta ? retryWait(deps, err, retries, maxRetries, totalAt) : undefined;

        if (wait !== undefined && err instanceof ProviderError) {
          logAttempt(deps, spec, attempt, 'retrying', { status, error: err });
          retries += 1;
          try {
            await sleep(wait, clock, spec.signal);
          } catch (cancel) {
            if (cancel instanceof CallerCancelled) {
              stats.usage = estimated();
              yield { finishReason: 'error', usage: stats.usage };
              return;
            }
            throw cancel;
          }
          continue;
        }

        logAttempt(deps, spec, attempt, outcomeOf(err), { status, error: err });
        throw err;
      }
    }
  } finally {
    // A consumer that stops reading part-way (`return()` on the iterator) skips every
    // branch above. The provider still generated the deltas that were delivered, so they
    // are counted, as an estimate, rather than dropped from the ledger.
    if (stats.usage === undefined && state.sawDelta) stats.usage = estimated();
    controller?.abort();
  }
}

/**
 * A non-streaming GET (the model list), with the same retry and timeout policy. The body
 * is read whole, under the whole-request deadline. Returns the parsed JSON.
 */
export async function requestJson(deps: TransportDeps, spec: CallSpec): Promise<unknown> {
  const { clock } = deps;
  const maxRetries = spec.maxRetries ?? deps.retry.maxRetries;
  const totalAt = clock.now() + deps.timeouts.totalMs;
  let retries = 0;

  for (let attempt = 0; ; attempt += 1) {
    const deadline: Deadline = { attemptStart: clock.now(), totalAt };
    const controller = new AbortController();
    let status: number | undefined;
    try {
      const response = await connect(deps, spec, deadline, controller);
      status = response.status;
      const text = await readWhole(deps, spec, response, deadline);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw protocolError(spec, text);
      }
      logAttempt(deps, spec, attempt, 'ok', { status });
      return json;
    } catch (err) {
      if (err instanceof CallerCancelled) throw abortError();
      const wait = err instanceof ProviderError ? retryWait(deps, err, retries, maxRetries, totalAt) : undefined;
      if (wait !== undefined && err instanceof ProviderError) {
        logAttempt(deps, spec, attempt, 'retrying', { status, error: err });
        retries += 1;
        try {
          await sleep(wait, clock, spec.signal);
        } catch {
          throw abortError();
        }
        continue;
      }
      logAttempt(deps, spec, attempt, outcomeOf(err), { status, error: err });
      throw err;
    }
  }
}

async function readWhole(deps: TransportDeps, spec: CallSpec, response: Response, deadline: Deadline): Promise<string> {
  const limit = { ms: deadline.totalAt - deps.clock.now(), reason: `request exceeded ${Math.round(deps.timeouts.totalMs / 60_000)} minutes` };
  try {
    return await guard(response.text(), limit.ms, deps.clock, spec.signal);
  } catch (err) {
    if (err instanceof CallerCancelled) throw err;
    if (err instanceof DeadlineReached) throw networkError(spec, limit.reason);
    throw networkError(spec, describe(err));
  }
}

/**
 * The §5 probe: one request with `response_format: json_object`, and the answer about
 * whether the endpoint accepted it. An acceptance is a 2xx. A refusal is a 400 or 422
 * whose body names `response_format`. A 400 about anything else, such as a bad model
 * name, is not an answer about the format, so it is thrown and not cached.
 */
export async function probeJsonObject(deps: TransportDeps, spec: CallSpec): Promise<boolean> {
  const deadline: Deadline = { attemptStart: deps.clock.now(), totalAt: deps.clock.now() + deps.timeouts.totalMs };
  const controller = new AbortController();
  try {
    const response = await connect(deps, { ...spec, maxRetries: 0 }, deadline, controller);
    await discard(response);
    logAttempt(deps, spec, 0, 'ok', { status: response.status });
    return true;
  } catch (err) {
    if (err instanceof CallerCancelled) throw abortError();
    if (
      err instanceof ProviderError &&
      err.kind === 'provider' &&
      (err.status === 400 || err.status === 422) &&
      REJECTS_RESPONSE_FORMAT.test(err.detail ?? '')
    ) {
      logAttempt(deps, spec, 0, 'ok', { status: err.status, error: err });
      return false;
    }
    logAttempt(deps, spec, 0, outcomeOf(err), { error: err });
    throw err;
  }
}
