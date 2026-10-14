# Provider gateway — BYOK model access spec (v1)

> Status: built. Scope: everything between the agent harness / editor and the provider's HTTP endpoint. The harness's tool-surface decisions live in [agent-harness.md](agent-harness.md); this file owns the *transport, config, accounting, and the mock contract*.

## 1. Responsibility & ownership

- **Owns:** provider profiles (URL/key/model), HTTP client, streaming, retries/backoff, abort, token accounting, request/response log, mock provider.
- **Never:** sees tool names, binder state, or prompts' meaning. It transports messages; the harness owns prompt assembly. It is the *only* module that makes network calls (ARCHITECTURE §2.6).

## 2. Profiles (data shape)

```ts
interface ProviderProfile {
  id: string;                 // generated, stable
  name: string;               // "OpenRouter main", "Local LM Studio"
  baseUrl: string;            // https://api.openai.com/v1 — stored WITHOUT trailing slash; /chat/completions appended
  apiKey: string;             // stored via §7
  defaultModel: string;       // "openai/gpt-4.1-mini"
  temperature?: number;       // default 0.7
  maxOutputTokens?: number;   // default 4096; harness may override per call
  pricePer1k?: { prompt: number; completion: number };  // optional, USD; powers context-assembly §5 cost estimates (display-only)
  isActive: boolean;          // exactly one profile active at a time
}
```

- **Multiple named profiles, one active.** Per-call model override is a parameter of `complete()` (harness chooses, e.g. cheap model for synopses), not a profile property.
- `settings` module owns profile CRUD UI; gateway owns validation. URL normalized on save: strip trailing `/`, reject URL not ending in a pathless-or-versioned base (accept `/v1`, reject full endpoint paths — provider differences are handled by the versioned path rule: we always POST `{baseUrl}/chat/completions`).
- **Adapters (planned, the owner's provider decision of 2026-10-14):** this build ships one adapter, OpenAI Chat Completions, behind the `ProviderAdapter` interface (§3). Three internal adapters are planned — Anthropic Messages, OpenAI Responses and OpenAI Chat Completions — with presets for the major providers and one generic OpenAI-compatible kind; writers never pick an API family. See [decisions.md](../decisions.md) § Providers.

## 3. Public API (gateway surface)

```ts
interface ProviderGateway {
  complete(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;  // streaming
  completeOnce(req: ChatRequest, signal?: AbortSignal): Promise<ChatMessage>;  // convenience, internally consumes complete()
  listModels(profileId: string): Promise<ModelInfo[]>;
  accountTokens(usage: Usage): void;   // internal accounting hook
}

interface ChatRequest {
  messages: ChatMessage[];     // [{role: 'system'|'user'|'assistant'|'tool', content: string}]
  model?: string;              // overrides profile.defaultModel
  temperature?: number;
  maxOutputTokens?: number;
  stop?: string[];
  responseFormat?: 'text' | { jsonSchemaHint: object };  // see §5 errors
  profileId?: string;          // default: active profile
}

interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; }
interface ChatChunk   { delta?: string; finishReason?: 'stop'|'length'|'error'; usage?: Usage; }
interface Usage       { promptTokens: number; completionTokens: number; }
interface ModelInfo   { id: string; contextWindow?: number; }
```

- Streaming: SSE parsing of `data:` lines per the OpenAI wire format; `finishReason` mapped from provider `finish_reason`. Chunk deltas concatenated by the caller (harness owns rendering).
- **Abort:** `AbortSignal` plumbs to `fetch`; abort mid-stream resolves the iterator with what arrived plus `finishReason: 'error'`. No zombie requests.

## 4. Retries, errors, timeouts (contract, not vibes)

| Failure | Behavior | Error surfaced to harness |
|---|---|---|
| Network error / timeout | Retry up to **2** retries, exponential backoff 1s → 4s, jitter ±20%. **Stream started = no retry** (partial output already delivered). | `ProviderError('network', detail)` |
| HTTP 401/403 | No retry. | `ProviderError('auth', 'Key rejected by <host>. Check the profile in Settings.')` |
| HTTP 404 on endpoint | No retry. | `ProviderError('endpoint', 'No /chat/completions at <baseUrl>. Most OpenAI-compatible bases end in /v1.')` |
| HTTP 429 | Honor `Retry-After` if present, else backoff; up to 2 retries. | `ProviderError('rate_limit', …)` after retries exhausted |
| HTTP 5xx | Retry per network rule. | `ProviderError('provider', status + body excerpt ≤ 300 chars)` |
| 200 but malformed SSE | Fail the stream once with raw excerpt. | `ProviderError('protocol', excerpt)` |
| Context length exceeded | **Not retried, not truncated silently.** | `ProviderError('context_length', 'Prompt ≈ <N> tokens exceeds model window (<M>). Reduce context: see activity log token budget.')` |

- Error text follows the finding: **written for the model/user to act on** (names the corrective surface — Settings, activity log), never a bare code.
- Timeouts: connect 10s, first-token 30s, idle-between-chunks 60s, total request 5min (configurable in settings, defaults only).
- Every request/response (including retries) lands in the **local request log** (§6), capped at 50 entries per session, inspectable UI. It stores no request bodies, headers or keys, and every error detail, log note and quoted provider excerpt passes through `redact` (`packages/gateway/src/redact.ts`): the profile's literal key is replaced wherever it appears, and anything shaped like a bearer token or an `sk-` key is replaced too.

## 5. Structured output

- Harness needs JSON for plans and verify steps. v0.1 contract: request-side `responseFormat: {jsonSchemaHint}` → gateway appends a system message "Respond with JSON matching: <schema>" (widely-compatible, works across OpenAI-compat providers) and sets `"response_format": {"type": "json_object"}` **only** if a probe shows the endpoint accepts it (one-shot probe call at profile-save time, cached result on the profile).
- Response side: harness owns parsing/validation (gateway stays dumb). Non-JSON return is a harness-side error with the raw text attached — gateway does not retry on content, only transport.

## 6. Token accounting

- `Usage` from each response chunk is accumulated **per agent turn and per calendar day**, stored locally: `usageLedger: {date, profileId, model, promptTokens, completionTokens, requests}`.
- Activity log shows per-turn totals (harness) and settings shows per-day totals (gateway ledger). This is local-only accounting; no quota enforcement beyond display (D4 below).

## 7. Key storage (v0.1 shape)

- Browser: keys in IndexedDB **outside** the project DB, encrypted at rest with AES-GCM via **non-extractable WebCrypto key** in a per-app-origin keypair. Plaintext never enters `localStorage` and never syncs. **Threat model:** this protects against *casual* theft (dumped IndexedDB blobs, shared machines) — **not** against XSS in the app origin or a compromised device (origin JS can *use* the key while the app is open). No stronger primitive exists for a no-backend web app; the honest assumption is recorded here, and the desktop app on the roadmap upgrades to OS keychains. The MCP bearer-token vault (extensibility.md §3.6) reuses this exact store.
- Never written to any file in the project artifact (project-format.md §2 forbids secrets there).
- Mock/dev: `MOCK` profile type needs no key.

## 8. Mock provider contract (test-critical)

The mock provider is a **deterministic, scriptable** implementation of `ProviderGateway` used by Vitest headless tests and Playwright runs (ARCHITECTURE §1.6).

```ts
interface MockScript {
  match: (req: ChatRequest) => boolean;    // picks the response for a request
  respond: (req: ChatRequest) => MockResponse | AsyncIterable<ChatChunk>;
}
```

- **Deterministic:** same script + same request = same response bytes. No clock, no randomness (temperature ignored).
- **Scriptable:** default script library ships with the test kit — `echo` (returns the user message), `toolJson` (emits a canned JSON tool call for the harness protocol), `stream(words)` (chunks a string into word-sized deltas), `fail(mode)` (simulates network/auth/429/context errors for harness error-path tests).
- **Usage accounting:** fake token counts = `ceil(chars/4)` so ledger assertions work unchanged.
- **Streaming shape:** yields chunks with `await setImmediate` between them so consumers' async logic is exercised identically to real SSE.

## 9. Decisions logged / assumptions

| # | Item | Status |
|---|---|---|
| D1 | One adapter (OpenAI Chat Completions) in this build, behind the adapter seam | The owner's provider decision (2026-10-14) plans three adapters and provider presets (§2); being built. |
| D2 | `response_format` via probe-gated json_object + schema-in-system | Explicit assumption — verify against popular providers (openrouter/local) in practice; the open question is which OpenAI-compatible providers accept `response_format` json_object / json_schema, and whether the fallback system-message approach holds. |
| D3 | Keys: IndexedDB + AES-GCM non-extractable key | Delegated; the threat model is stated in §7. |
| D4 | Usage display-only, no quota enforcement | Display only: Caotang is free and BYOK, so there is no quota logic. An optional `pricePer1k` per profile powers pre-approval cost estimates on plan cards (context-assembly §5); still display-only. |