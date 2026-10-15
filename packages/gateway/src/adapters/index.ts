/**
 * The adapter registry — the id a preset names to the adapter that speaks it.
 */

import { anthropicMessagesAdapter } from './anthropic-messages.js';
import { openaiChatAdapter } from './openai-chat.js';
import { openaiResponsesAdapter } from './openai-responses.js';
import type { AdapterId, ProviderAdapter } from './types.js';

const REGISTRY: Record<AdapterId, ProviderAdapter> = {
  'openai-chat': openaiChatAdapter,
  'openai-responses': openaiResponsesAdapter,
  'anthropic-messages': anthropicMessagesAdapter,
};

export function adapterFor(id: AdapterId): ProviderAdapter {
  return REGISTRY[id];
}

export { openaiChatAdapter } from './openai-chat.js';
export { openaiResponsesAdapter } from './openai-responses.js';
export { anthropicMessagesAdapter } from './anthropic-messages.js';
export type {
  AdapterContext,
  AdapterId,
  BodyInput,
  CallSecrets,
  EffortStyle,
  ProviderAdapter,
  QuirkFlags,
  ReplayStyle,
  RouteSpec,
  StreamParser,
  StreamPiece,
} from './types.js';
