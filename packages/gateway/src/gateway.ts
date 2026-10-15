/**
 * The provider gateway — [provider-gateway.md §3](docs/architecture/provider-gateway.md).
 *
 * This file is the router and the accountant. It picks the profile a request targets,
 * sends a mock profile to the mock and an endpoint profile through the transport, and
 * records what each request cost in the ledger. It does not talk HTTP and it does not
 * touch key bytes beyond the single `reveal` it makes for a request it is about to send.
 *
 * The order of operations is fixed, and each step is there for a reason:
 *  1. resolve the target profile (an unknown id is an error, not a fallback);
 *  2. run the egress check against the URL, before the key is decrypted, so a refused
 *     request never touches key material;
 *  3. reveal the key, then send;
 *  4. record usage in `finally`, so an abandoned, failed, or aborted request is still
 *     counted for the requests it made.
 */

import { systemClock, type Clock } from './clock.js';
import { hostOf, originOf } from './base-url.js';
import { type ProfileStore } from './profiles.js';
import { ProfileError, ProviderError, providerMessages } from './errors.js';
import type { KeyStore } from './keys/key-store.js';
import { UsageLedger } from './ledger.js';
import { createMockProvider, type MockProvider } from './mock/mock-provider.js';
import { collectOnce } from './once.js';
import { RequestLog } from './request-log.js';
import { DEFAULT_RETRY, DEFAULT_TIMEOUTS, type RetryPolicy, type TransportTimeouts } from './retry.js';
import {
  assertEgress,
  probeJsonObject,
  requestJson,
  streamChat,
  type CallSpec,
  type FetchLike,
  type StreamStats,
  type TransportDeps,
} from './transport.js';
import { DEFAULT_MAX_OUTPUT_TOKENS } from './profiles.js';
import { usageFor } from './tokens.js';
import { openaiChatAdapter } from './adapters/openai-chat.js';
import type { AdapterContext, ProviderAdapter } from './adapters/types.js';
import type {
  ChatChunk,
  ChatRequest,
  ModelInfo,
  ModelLimits,
  ProfileView,
  ProviderGateway,
  Usage,
  UsageAttribution,
} from './types.js';

export interface Gateway extends ProviderGateway {
  readonly profiles: ProfileStore;
  readonly ledger: UsageLedger;
  readonly requestLog: RequestLog;
  /**
   * The limits and prices of a model, for the caller to fill context-assembly's model config (context-assembly
   * §5). The profile is the one named, else the active one; the model is the one named, else the profile's.
   * Synchronous, so an assembly can call it: it reads what `listModels` last reported for the profile, and
   * takes the documented default for anything that report did not state (see {@link ModelLimits}). With no
   * profile at all it is the defaults, since there is then no request to limit.
   */
  modelLimits(profileId?: string, model?: string): ModelLimits;
  /**
   * §5: asks the endpoint once whether it accepts `response_format: json_object`, and
   * caches the answer on the profile. The settings screen calls this at save time. Until
   * it has run, structured requests carry the schema in a system message and no
   * `response_format`. Returns the answer. Calls for a non-active endpoint profile are
   * refused by the egress guard, which is the intent: activate first, then probe.
   */
  probeResponseFormat(profileId?: string): Promise<boolean>;
}

export interface GatewayOptions {
  profiles: ProfileStore;
  keys: KeyStore;
  clock?: Clock;
  /** the jitter source; defaults to `Math.random`, and tests pin it */
  random?: () => number;
  /** the network; defaults to `globalThis.fetch`, and tests substitute a scripted one */
  fetch?: FetchLike;
  timeouts?: Partial<TransportTimeouts>;
  retry?: Partial<RetryPolicy>;
  ledger?: UsageLedger;
  requestLog?: RequestLog;
  /** the mock used for mock profiles; defaults to the shipped script library */
  mock?: MockProvider;
}

const ZERO: Usage = { promptTokens: 0, completionTokens: 0 };
const PROBE_PROMPT = 'Reply with the JSON object {"ok": true}.';

export function createGateway(options: GatewayOptions): Gateway {
  const { profiles, keys } = options;
  const clock = options.clock ?? systemClock;
  const ledger = options.ledger ?? new UsageLedger(clock);
  const requestLog = options.requestLog ?? new RequestLog();
  const mock = options.mock ?? createMockProvider();
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));

  const deps: TransportDeps = {
    fetch: fetchImpl,
    clock,
    random: options.random ?? Math.random,
    timeouts: { ...DEFAULT_TIMEOUTS, ...options.timeouts },
    retry: { ...DEFAULT_RETRY, ...options.retry },
    log: requestLog,
    // The egress pin is the profile a request resolved to, read live from the store, so
    // a key can only ever reach the origin it was entered for — never another profile's.
    profileOrigin: (profileId) => {
      const profile = profiles.get(profileId);
      return profile !== undefined && profile.kind === 'openai-compatible' ? originOf(profile.baseUrl) : undefined;
    },
  };

  /** The profile a request targets: the one named, else the active one. Never a silent fallback. */
  const targetOf = (profileId: string | undefined): ProfileView => {
    if (profileId !== undefined) {
      const found = profiles.get(profileId);
      if (found === undefined) throw new ProfileError('not-found', `No provider profile has the id ${profileId}.`);
      return found;
    }
    const active = profiles.active();
    if (active === undefined) throw new ProfileError('no-active', 'No provider profile is active. Add one in Settings.');
    return active;
  };

  /** Decrypts the key for one call. Only reached after the egress check has passed. */
  const keyFor = async (profile: ProfileView): Promise<string | undefined> => {
    if (profile.kind === 'mock' || !profile.hasKey) return undefined;
    const key = await keys.reveal(profile.id);
    if (key === undefined) throw new ProfileError('key-unreadable', providerMessages.missingKey(profile.name));
    return key;
  };

  /**
   * The route a (profile, model) pair speaks. M3 hangs the preset registry and
   * per-model route maps off this seam; until then every endpoint profile is the
   * OpenAI-compatible route the gateway has always spoken.
   */
  const routeOf = (profile: ProfileView, model: string): { adapter: ProviderAdapter; ctx: AdapterContext } => {
    void model;
    return {
      adapter: openaiChatAdapter,
      ctx: { baseUrl: profile.baseUrl, model, quirks: {}, caps: {} },
    };
  };

  const chatSpec = (
    profile: ProfileView,
    req: ChatRequest,
    route: { adapter: ProviderAdapter; ctx: AdapterContext },
    jsonObject: boolean,
    apiKey: string | undefined,
  ): CallSpec => {
    const { adapter, ctx } = route;
    const body = adapter.buildBody({
      req,
      ctx,
      temperature: req.temperature ?? profile.temperature ?? 0.7,
      maxTokens: req.maxOutputTokens ?? profile.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      jsonObject,
    });
    const path = adapter.completePath(ctx.model);
    const secrets: string[] = apiKey === undefined || apiKey === '' ? [] : [apiKey];
    return {
      profileId: profile.id,
      model: ctx.model,
      host: hostOf(profile.baseUrl),
      baseUrl: profile.baseUrl,
      path,
      url: `${profile.baseUrl}${path}`,
      method: 'POST',
      accept: 'text/event-stream',
      body: JSON.stringify(body),
      headers: adapter.headers(ctx, { apiKey }, 'complete'),
      secrets,
      parser: adapter.createStreamParser(ctx),
      promptTokens: usageFor(req.messages, '').promptTokens,
    };
  };

  async function* complete(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatChunk, void, undefined> {
    const profile = targetOf(req.profileId);
    const model = req.model ?? profile.defaultModel;
    const startedAt = clock.now();
    const stats: StreamStats = { attempts: 0, usage: undefined };

    try {
      if (profile.kind === 'mock') {
        stats.attempts = 1;
        for await (const chunk of mock.complete(req, signal)) {
          if (chunk.usage !== undefined) stats.usage = chunk.usage;
          yield chunk;
        }
        return;
      }

      const jsonObject =
        req.responseFormat !== undefined && req.responseFormat !== 'text' && profile.responseFormat?.supportsJsonObject === true;
      const route = routeOf(profile, model);
      assertEgress(deps, `${profile.baseUrl}${route.adapter.completePath(model)}`, profile.id);
      const apiKey = await keyFor(profile);
      const spec = { ...chatSpec(profile, req, route, jsonObject, apiKey), signal };
      yield* streamChat(deps, spec, stats);
    } finally {
      if (stats.attempts > 0) {
        ledger.record(
          { profileId: profile.id, model, turnId: req.turnId, role: req.role, at: startedAt },
          stats.usage ?? ZERO,
          stats.attempts,
        );
      }
    }
  }

  /** What `listModels` last reported, per profile. The limits an assembly reads come from here, so they are as fresh as that listing. */
  const reported = new Map<string, readonly ModelInfo[]>();

  async function listModels(profileId: string): Promise<ModelInfo[]> {
    const profile = targetOf(profileId);
    if (profile.kind === 'mock') {
      const models = await mock.listModels(profile.id);
      reported.set(profile.id, models);
      return models;
    }

    const { adapter, ctx } = routeOf(profile, profile.defaultModel);
    const modelsPath = adapter.modelsPath(ctx);
    if (modelsPath === null) {
      throw new ProviderError('endpoint', providerMessages.endpoint('/models', profile.baseUrl));
    }
    const url = `${profile.baseUrl}${modelsPath}`;
    assertEgress(deps, url, profile.id);
    const apiKey = await keyFor(profile);
    const json = await requestJson(deps, {
      profileId: profile.id,
      model: profile.defaultModel,
      host: hostOf(profile.baseUrl),
      baseUrl: profile.baseUrl,
      path: modelsPath,
      url,
      method: 'GET',
      accept: 'application/json',
      headers: adapter.headers(ctx, { apiKey }, 'models'),
      secrets: apiKey === undefined || apiKey === '' ? [] : [apiKey],
      promptTokens: 0,
    });
    const models = adapter.parseModels(json);
    if (models === undefined) {
      throw new ProviderError('protocol', providerMessages.protocol(hostOf(profile.baseUrl), 'the model list had no data array'));
    }
    reported.set(profile.id, models);
    return models;
  }

  function modelLimits(profileId?: string, model?: string): ModelLimits {
    const profile = profileId === undefined ? profiles.active() : profiles.get(profileId);
    if (profile === undefined) return { maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS };
    const modelId = model ?? profile.defaultModel;
    const info = reported.get(profile.id)?.find((item) => item.id === modelId);
    const price = profile.pricePer1k ?? info?.pricePer1k;
    return {
      ...(info?.contextWindow === undefined ? {} : { contextWindow: info.contextWindow }),
      maxOutputTokens: profile.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(price === undefined ? {} : { pricePer1k: { prompt: price.prompt, completion: price.completion } }),
    };
  }

  async function probeResponseFormat(profileId?: string): Promise<boolean> {
    const profile = targetOf(profileId);
    if (profile.kind === 'mock') {
      profiles.recordProbe(profile.id, { supportsJsonObject: true, probedAt: clock.now() });
      return true;
    }

    const url = `${profile.baseUrl}/chat/completions`;
    assertEgress(deps, url, profile.id);
    const apiKey = await keyFor(profile);
    const body = JSON.stringify({
      model: profile.defaultModel,
      messages: [{ role: 'user', content: PROBE_PROMPT }],
      max_tokens: 16,
      stream: false,
      response_format: { type: 'json_object' },
    });
    const supported = await probeJsonObject(deps, {
      profileId: profile.id,
      model: profile.defaultModel,
      host: hostOf(profile.baseUrl),
      baseUrl: profile.baseUrl,
      path: '/chat/completions',
      url,
      method: 'POST',
      accept: 'application/json',
      body,
      headers: apiKey === undefined || apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` },
      secrets: apiKey === undefined || apiKey === '' ? [] : [apiKey],
      promptTokens: usageFor([{ role: 'user', content: PROBE_PROMPT }], '').promptTokens,
    });
    profiles.recordProbe(profile.id, { supportsJsonObject: supported, probedAt: clock.now() });
    ledger.record({ profileId: profile.id, model: profile.defaultModel, at: clock.now() }, ZERO, 1);
    return supported;
  }

  function accountTokens(usage: Usage, by: UsageAttribution): void {
    ledger.record(
      { profileId: by.profileId, model: by.model, turnId: by.turnId, role: by.role, at: by.at ?? clock.now() },
      usage,
      1,
    );
  }

  return {
    profiles,
    ledger,
    requestLog,
    complete: (req, signal) => complete(req, signal),
    completeOnce: (req, signal) => collectOnce(complete(req, signal), signal),
    listModels,
    modelLimits,
    accountTokens,
    probeResponseFormat,
  };
}
