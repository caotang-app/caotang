/** A JSON object, as opposed to an array, `null` or a scalar. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An own property, never one inherited from `Object.prototype`. */
export function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * At most `max` UTF-16 units, cut on a code-point boundary, with an ellipsis when it was
 * cut. The result's `.length` is `<= max` even when the text holds astral characters, so a
 * caller that reads "200 chars" as `.length` is not surprised.
 */
export function clipChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const point of text) {
    if (out.length + point.length > max - 1) break;
    out += point;
  }
  return `${out}…`;
}
