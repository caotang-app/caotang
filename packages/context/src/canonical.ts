/**
 * Canonical JSON for L7's parameters. Object keys are sorted at every depth and
 * `undefined` members are omitted, so two params objects with the same content produce
 * the same bytes whatever order their keys were written in. The golden prompts depend on
 * that: a reordered object literal must not change the prompt.
 */

import { compareText } from './text.js';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareText)) {
      const member = source[key];
      if (member !== undefined) out[key] = sortKeys(member);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}
