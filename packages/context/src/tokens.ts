/**
 * The one token estimator every layer uses — [context-assembly.md §3](../../../docs/architecture/context-assembly.md):
 * `ceil(chars / 4)`, enforced on estimates before the call, with the ledger recording
 * real usage afterwards.
 *
 * The implementation is `@caotang/codex`'s, which the `codex.read` cap already uses, so the
 * two budgets agree on one number. This module adds the inverse the layers need. A token
 * budget is a character budget: `tokensForChars(n) <= t` holds exactly when
 * `n <= charsFor(t)`, for every integer `t`. Layers therefore check budgets on character
 * counts, and every figure the report shows is the estimator's output on the same text.
 */

import { estimateTokens, tokensForChars } from '@caotang/codex';

export { estimateTokens, tokensForChars };

/** Characters per token in the estimate. Matches `tokensForChars`, and a test pins the two. */
export const CHARS_PER_TOKEN = 4;

/** The most characters a budget of `tokens` admits, on the same estimate. */
export function charsFor(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}
