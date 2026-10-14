/**
 * Provider gateway types — [provider-gateway.md §2–§3](docs/architecture/provider-gateway.md).
 *
 * These are the contract, transcribed. If a shape here disagrees with the spec,
 * the spec wins and this file is the bug.
 *
 * Three fields are additions the spec does not name, each forced by a rule it does state:
 *  - `ProviderProfile.kind` — the MOCK profile type that the brief and §8 require. A
 *    `baseUrl` alone cannot tell a mock from a real endpoint without sniffing strings.
 *  - `ChatRequest.turnId` — §6 accounts usage per agent turn, and the gateway cannot
 *    attribute a request to a turn unless the harness says which turn it belongs to.
 *  - the attribution argument of `ProviderGateway.accountTokens` — §3 names the hook
 *    but not the keys a ledger row needs (`profileId`, `model`).
 */

/** §2 — `openai-compatible` is the real transport; `mock` is the no-key fixture (baseUrl `mock://caotang`). */
export type ProfileKind = 'openai-compatible' | 'mock';

/**
 * §2's data shape. The spec stores `apiKey` via §7, and that is how this file reads
 * it: the key is an input to create and update, and the record that survives is a
 * `ProfileView`, which has no key on it. Nothing serialises this object.
 */
export interface ProviderProfile {
  /** generated, stable — never derived from the name */
  id: string;
  /** "OpenRouter main", "Local LM Studio" */
  name: string;
  /** the transport this profile speaks */
  kind: ProfileKind;
  /** stored WITHOUT trailing slash; `/chat/completions` appended at call time */
  baseUrl: string;
  /** stored via §7 (AES-GCM, non-extractable). Never persisted in plaintext. */
  apiKey: string;
  defaultModel: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** optional, USD; powers context-assembly cost estimates (display-only) */
  pricePer1k?: { prompt: number; completion: number };
  /** exactly one profile is active whenever any profile exists */
  isActive: boolean;
}

/** §5 — the one-shot `response_format` probe, cached on the profile. */
export interface ResponseFormatProbe {
  /** whether the endpoint accepted `response_format: {type: 'json_object'}` */
  supportsJsonObject: boolean;
  /** epoch ms of the probe */
  probedAt: number;
}

/** What the settings UI and the activity log may see: a profile without its key. */
export interface ProfileView extends Omit<ProviderProfile, 'apiKey'> {
  /** whether a key is stored for this profile. The key itself is never on a view. */
  hasKey: boolean;
  /** absent until the probe has run for this endpoint */
  responseFormat?: ResponseFormatProbe;
}

/** Input to `ProfileStore.create`. Omitted optional fields take the kind's defaults. */
export interface NewProfile {
  name: string;
  kind: ProfileKind;
  /** required for `openai-compatible`; `mock` defaults to `mock://caotang` */
  baseUrl?: string;
  /** required for `openai-compatible` unless the base is loopback; ignored for `mock` */
  apiKey?: string;
  /** required for `openai-compatible`; `mock` defaults to `mock/echo-1` */
  defaultModel?: string;
  temperature?: number;
  maxOutputTokens?: number;
  pricePer1k?: { prompt: number; completion: number };
  /** activates the new profile; without it, the first profile ever created is active */
  isActive?: boolean;
}

/** Input to `ProfileStore.update`. `kind` and `id` are fixed for a profile's life. */
export interface ProfilePatch {
  name?: string;
  baseUrl?: string;
  /** replaces the stored key; an empty string clears it (loopback endpoints only) */
  apiKey?: string;
  defaultModel?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** A new price replaces the saved one. `null` clears it, so the profile is unpriced again; an absent field keeps the saved price. */
  pricePer1k?: { prompt: number; completion: number } | null;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatChunk {
  delta?: string;
  finishReason?: 'stop' | 'length' | 'error';
  usage?: Usage;
}

/**
 * One model as the provider's `/models` answer describes it. Each field is present only when the provider
 * says it: a provider that reports nothing gives a bare `{ id }`, and the caller gets the documented defaults
 * from {@link ModelLimits} instead.
 */
export interface ModelInfo {
  id: string;
  /** The context window in tokens, under whichever name the provider uses for it (wire.ts). */
  contextWindow?: number;
  /** The output cap the provider advertises, in tokens. Informational: requests send the profile's cap (provider-gateway §2). */
  maxOutputTokens?: number;
  /** The provider's price, in USD per 1,000 tokens (the profile's unit, §2). Read from a per-token price list. */
  pricePer1k?: { prompt: number; completion: number };
}

/**
 * A model's limits and prices, as the caller fills context-assembly's model config from them
 * (context-assembly §5). Each field is what the gateway will actually use for the model. A field the
 * provider did not say and the profile does not set is absent, and the card shows no number for it.
 */
export interface ModelLimits {
  /** The context window in tokens, when the provider reported one. Absent means unknown: no window check is made. */
  readonly contextWindow?: number;
  /** The output cap a request is sent with: the profile's, else the documented default (provider-gateway §2). */
  readonly maxOutputTokens: number;
  /** The price in USD per 1,000 tokens: the profile's, else the provider's. Display-only (provider-gateway §6, D4). */
  readonly pricePer1k?: { readonly prompt: number; readonly completion: number };
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** overrides profile.defaultModel */
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  stop?: string[];
  /** see §5 — schema-in-system-message, plus json_object only after the probe */
  responseFormat?: 'text' | { jsonSchemaHint: object };
  /** default: active profile */
  profileId?: string;
  /** the agent turn this request belongs to; keys the per-turn ledger row (§6) */
  turnId?: string;
}

/** Who a unit of usage is attributed to. `at` defaults to the gateway clock. */
export interface UsageAttribution {
  profileId: string;
  model: string;
  turnId?: string;
  at?: number;
}

export interface ProviderGateway {
  complete(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>;
  completeOnce(req: ChatRequest, signal?: AbortSignal): Promise<ChatMessage>;
  listModels(profileId: string): Promise<ModelInfo[]>;
  /**
   * §3's internal accounting hook. Gateway-originated requests are accounted by the
   * gateway itself; this is for usage the harness observes outside `complete`, and it
   * counts as one request unless the caller says otherwise by never calling it twice.
   */
  accountTokens(usage: Usage, by: UsageAttribution): void;
}
