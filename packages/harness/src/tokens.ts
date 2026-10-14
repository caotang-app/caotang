/**
 * Response-size accounting — [agent-harness.md §3](../../../docs/architecture/agent-harness.md)'s
 * `response_token_cap`.
 *
 * **An estimate, and labelled as one.** The harness has no model tokenizer, so a token is counted
 * as four characters, the common English rule of thumb. The caps are therefore approximate
 * ceilings, and a response that is cut on this estimate says so. Nothing in the harness claims a
 * count it did not measure.
 *
 * The estimator is `@caotang/codex`'s, the one the context budgets and the gateway's ledger also use,
 * so a cap, a budget and a ledger row all count the same text the same way.
 */

import { estimateTokens } from '@caotang/codex';

export { estimateTokens };

export const CHARS_PER_TOKEN = 4;

/** Whether a JSON-serialisable value fits its cap on the same estimate. */
export function fitsCap(value: unknown, cap: number): boolean {
  return estimateTokens(JSON.stringify(value) ?? '') <= cap;
}

/** The most characters a cap admits, on the same estimate. */
export function charBudget(cap: number): number {
  return cap * CHARS_PER_TOKEN;
}
