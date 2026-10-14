/** Shape guards shared by the load-time and save-time readers. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** An ISO-8601 stamp as the manifest stores it: a string that parses as a date. */
export function isStamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** The first `max` code points of a string (a "character" in the spec's sense). */
export function clampCodePoints(text: string, max: number): { text: string; clamped: boolean } {
  const points = Array.from(text);
  if (points.length <= max) return { text, clamped: false };
  return { text: points.slice(0, max).join(''), clamped: true };
}

/** How many characters of a manifest value a load notice may carry. */
const NOTICE_CHARACTERS = 40;

/**
 * A manifest value as it appears inside a load notice. Notices are plain text, and the app
 * must render them as text, never as markup (a cross-scope request for apps/desktop). A value
 * a crafted manifest controls is flattened here: control, format and line-separator characters
 * become spaces, and the value is cut to {@link NOTICE_CHARACTERS}. A string is taken as
 * written; anything else as its JSON text.
 */
export function noticeText(value: unknown): string {
  const raw = typeof value === 'string' ? value : describeJson(value);
  const plain = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ');
  const fitted = clampCodePoints(plain, NOTICE_CHARACTERS);
  return fitted.clamped ? `${fitted.text}…` : fitted.text;
}

/** The values of keys a reader does not know, kept as written. Undefined when there are none. */
export function keptValues(source: Record<string, unknown>, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (keys.length === 0) return undefined;
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function describeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return '(not printable)';
  }
}
