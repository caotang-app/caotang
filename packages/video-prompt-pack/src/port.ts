/**
 * The one model seam this package calls through — [agent-harness.md §3](../../../docs/architecture/agent-harness.md)
 * (the port tools) and [provider-gateway.md](../../../docs/architecture/provider-gateway.md).
 *
 * The package owns no provider. The app injects an adapter over the gateway, and that
 * adapter is the only thing that knows keys, profiles and endpoints. A test injects a
 * fake. The shape matches `CoherenceModel`, so one adapter can serve both.
 */

export interface PromptModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface PromptModelRequest {
  readonly system: string;
  readonly user: string;
  /** The JSON shape the reply must follow. The gateway decides whether the provider enforces it. */
  readonly jsonSchemaHint: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface PromptModelReply {
  readonly content: string;
  readonly usage?: PromptModelUsage;
}

export interface PromptModel {
  /** The model that answered. The proposal records it so a draft can say what wrote it. */
  readonly model: string;
  complete(request: PromptModelRequest): Promise<PromptModelReply>;
}
