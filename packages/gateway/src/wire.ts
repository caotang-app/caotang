/**
 * The OpenAI-compatible wire format, in both directions — the only place that knows
 * JSON field names. Everything above this file speaks `ChatRequest` and `ChatChunk`.
 *
 * Request side: the body, with the §5 schema hint appended as a system message, and
 * `response_format` present only when the endpoint has passed the probe.
 *
 * Response side: one SSE payload at a time, mapped onto deltas, a finish reason and
 * usage. Anything that does not have the expected shape is reported as `undefined` so
 * the transport can raise a `protocol` error with the raw excerpt, rather than guessing.
 */

import type { ChatRequest, ChatRole, ModelInfo, Usage } from './types.js';

/** The three finish reasons the contract allows. Anything the wire says that is not one of them is `error`. */
export type FinishReason = 'stop' | 'length' | 'error';

/**
 * §3's mapping. `stop`, and the two tool-call reasons, which Caotang never requests, are
 * `stop`. `length` stays `length`. `error`, `content_filter`, and any reason this file
 * does not recognise are `error`: the output cannot be vouched for, so the caller must
 * not treat it as a complete answer.
 */
export function mapFinishReason(raw: unknown): FinishReason | undefined {
  if (typeof raw !== 'string') return undefined;
  switch (raw) {
    case 'stop':
    case 'tool_calls':
    case 'function_call':
      return 'stop';
    case 'length':
      return 'length';
    default:
      return 'error';
  }
}

export interface WireMessage {
  role: ChatRole;
  content: string;
}

/**
 * §5: the schema goes in a system message appended after the conversation. It works
 * across OpenAI-compatible providers without `response_format`, which is why it is the
 * default and `response_format` is only an upgrade.
 */
export function wireMessages(req: ChatRequest): WireMessage[] {
  const messages: WireMessage[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const format = req.responseFormat;
  if (format !== undefined && format !== 'text') {
    messages.push({ role: 'system', content: `Respond with JSON matching: ${JSON.stringify(format.jsonSchemaHint)}` });
  }
  return messages;
}

export interface ChatBodyInput {
  model: string;
  messages: readonly WireMessage[];
  temperature: number;
  maxTokens: number;
  stop?: readonly string[];
  /** true only when the profile's probe accepted `response_format` */
  jsonObject: boolean;
}

/**
 * The request body. `stream_options.include_usage` asks for a final usage chunk. Without
 * it, most providers stream no usage at all, and the ledger would count zeros.
 */
export function chatBody(input: ChatBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (input.stop !== undefined && input.stop.length > 0) body.stop = [...input.stop];
  if (input.jsonObject) body.response_format = { type: 'json_object' };
  return body;
}

export interface ParsedChunk {
  deltas: string[];
  finish?: FinishReason;
  usage?: Usage;
  /** an in-stream error object, which some providers send with a 200 status */
  error?: string;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return JSON.stringify(error) ?? 'unknown error';
}

function usageOf(raw: unknown): Usage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.prompt_tokens !== 'number' || typeof record.completion_tokens !== 'number') return undefined;
  return { promptTokens: record.prompt_tokens, completionTokens: record.completion_tokens };
}

/**
 * Reads one parsed SSE payload. Returns `undefined` when the payload is not an object,
 * which the caller reports as a protocol failure. Choices beyond the first are ignored,
 * since Caotang asks for one completion.
 */
export function parseChunk(json: unknown): ParsedChunk | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  const out: ParsedChunk = { deltas: [] };

  if (record.error !== undefined && record.error !== null) out.error = errorText(record.error);

  const usage = usageOf(record.usage);
  if (usage !== undefined) out.usage = usage;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (typeof first === 'object' && first !== null) {
    const choice = first as Record<string, unknown>;
    const delta = choice.delta;
    if (typeof delta === 'object' && delta !== null) {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === 'string' && content.length > 0) out.deltas.push(content);
    }
    const finish = mapFinishReason(choice.finish_reason);
    if (finish !== undefined) out.finish = finish;
  }
  return out;
}

/**
 * Reads a `/models` response. Context windows arrive under several names, since no two
 * providers agree: OpenRouter and LM Studio use `context_length`, vLLM uses
 * `max_model_len`. Returns undefined when the envelope itself is wrong.
 */
export function parseModels(json: unknown): ModelInfo[] | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const envelope = json as Record<string, unknown>;
  const list = envelope.data ?? envelope.models;
  if (!Array.isArray(list)) return undefined;

  const models: ModelInfo[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id === '') continue;
    const window = [record.context_length, record.context_window, record.max_context_length, record.max_model_len].find(positive);
    const output = [record.max_completion_tokens, record.max_output_tokens, topProviderCap(record.top_provider)].find(positive);
    const price = priceOf(record.pricing);
    models.push({
      id: record.id,
      ...(window === undefined ? {} : { contextWindow: window }),
      ...(output === undefined ? {} : { maxOutputTokens: output }),
      ...(price === undefined ? {} : { pricePer1k: price }),
    });
  }
  return models;
}

/** A count the provider states as a positive number. Anything else is not stated, and the field is left out. */
function positive(value: unknown): value is number {
  return typeof value === 'number' && value > 0;
}

/** OpenRouter's `top_provider.max_completion_tokens`: the same output cap, under the provider's own envelope. */
function topProviderCap(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const cap = (value as Record<string, unknown>).max_completion_tokens;
  return positive(cap) ? cap : undefined;
}

/**
 * OpenRouter-style `pricing`: a price per token, as a decimal string or a number, for the prompt and the
 * completion. Returned per 1,000 tokens, the unit a profile's price is in. Both are needed, or there is no price.
 */
function priceOf(value: unknown): { prompt: number; completion: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const prompt = perToken(record.prompt);
  const completion = perToken(record.completion);
  if (prompt === undefined || completion === undefined) return undefined;
  return { prompt: prompt * 1_000, completion: completion * 1_000 };
}

/** One per-token price, read from a string or a number. Only a finite, non-negative one is a price. */
function perToken(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
