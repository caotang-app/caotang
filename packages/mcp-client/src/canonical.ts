/**
 * Canonical JSON and the SHA-256 pins built on it — [extensibility.md §3.2](../../../docs/architecture/extensibility.md)
 * (`ToolPin`) and assumption A4: the hash is SHA-256 over the canonical JSON of
 * `{ toolName, description, inputSchema }`.
 *
 * Canonical means one byte string per JSON value: object keys sorted by UTF-16 code
 * unit, no insignificant whitespace, arrays in order, `undefined` members dropped. A pin
 * is only as stable as this function, so the test suite pins its output byte for byte.
 *
 * `crypto.subtle` is used rather than `node:crypto`, because the client also runs in the
 * browser build and must not import a Node module.
 */

/** One JSON value's canonical text. Throws on a value JSON cannot carry (a function, a bigint, NaN). */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot carry a non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonical JSON cannot carry a ${typeof value}`);
  }
}

/** SHA-256 of a string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The self-declared hints a pin covers. `readOnlyHint` decides whether a trusted tool runs without a
 * confirmation (§7), so a hint that changed without a review would promote a write tool to auto-run.
 * They are pinned with the rest of the listing, and only the four hint keys, never anything else.
 */
export interface PinnedAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/**
 * The pin hash of one advertised tool: assumption A4, SHA-256 over the canonical JSON of
 * `{ toolName, description, inputSchema }`, extended with the four hint keys when the server
 * advertises them (see {@link PinnedAnnotations}). A tool with no hints hashes exactly as A4 says.
 *
 * The description and the schema are the server's own text, taken verbatim. The caller normalises an
 * absent description to `''` and an absent schema to `{ type: 'object' }` before it reaches here, so the
 * same listing always hashes the same way.
 */
export function pinHash(tool: {
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: PinnedAnnotations;
}): Promise<string> {
  const annotations = tool.annotations === undefined ? undefined : pinnedHints(tool.annotations);
  return sha256Hex(canonicalJson({ toolName: tool.toolName, description: tool.description, inputSchema: tool.inputSchema, annotations }));
}

/** The four hint keys that are present, with their values. Absent when none is. */
export function pinnedHints(annotations: PinnedAnnotations): PinnedAnnotations | undefined {
  const hints: Record<string, boolean> = {};
  for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    const value = annotations[key];
    if (typeof value === 'boolean') hints[key] = value;
  }
  return Object.keys(hints).length === 0 ? undefined : (hints as PinnedAnnotations);
}
