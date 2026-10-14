/**
 * Small value helpers shared by the schema, the validator and the tools.
 *
 * Nothing in this file reads state or the clock. `describe` and `isRecord`
 * follow `packages/bus/src/params.ts` so a refusal reads the same wherever it
 * is produced.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "a string", "an array", "null", "nothing" — the phrase a refusal uses for what it got. */
export function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** Length in code points, the unit every limit in the specs is written in. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** The first `count` code points of `text`, never splitting a surrogate pair. */
export function firstCodePoints(text: string, count: number): string {
  return [...text].slice(0, count).join('');
}

/** "1 entry", "3 entries", "2 nodes" — the nouns this package uses all pluralise by one rule. */
export function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  if (/[^aeiou]y$/.test(noun)) return `${count} ${noun.slice(0, -1)}ies`;
  return `${count} ${noun}s`;
}

/**
 * A JSON string with object keys sorted at every depth.
 *
 * Two submissions of one call are equal as values, not as text: a JSON round trip
 * through a model does not promise key order, and a fingerprint over the raw text
 * would refuse a genuine replay. Array order is kept, because it is data.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
