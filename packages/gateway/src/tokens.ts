/**
 * Token estimation — the `ceil(chars/4)` rule that §8 fixes for the mock, and that the
 * gateway also uses as the fallback when a provider omits `usage` from its stream.
 * One rule for both means a ledger row is comparable whichever path produced it.
 *
 * The estimator is not defined here. It is `@caotang/codex`'s, which the `codex.read` cap, the
 * context budgets and the harness's response caps already use, so every budget in the app
 * counts with the same number. This module keeps the one gateway-specific piece: the usage a
 * request's messages and its completion are charged at.
 */

import { estimateTokens, tokensForChars } from '@caotang/codex';

import type { ChatMessage, Usage } from './types.js';

export { estimateTokens };

/** Usage for a request whose prompt is `messages` and whose completion is `completion`. */
export function usageFor(messages: readonly ChatMessage[], completion: string): Usage {
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return {
    promptTokens: tokensForChars(promptChars),
    completionTokens: estimateTokens(completion),
  };
}
