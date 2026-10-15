/**
 * Encoding detection for files whose bytes are not UTF-8 text.
 *
 * The loader holds a non-UTF-8 file in place rather than decoding it lossily
 * (read.ts `readUtf8`): the state holds text only, so the file stays on disk
 * untouched and no save writes over it. That keeps the bytes safe and leaves
 * two questions this module answers:
 *
 *   - *what are the bytes?* — {@link guessEncoding}, a deterministic guess over
 *     the file's first bytes, recorded on the load's `encodingIssues` report so
 *     the open can name the file and the likely encoding together;
 *   - *what would they look like as text?* — {@link decodeForPreview}, the
 *     best-effort decode a convert flow previews before it touches anything.
 *
 * The guesses are deliberately coarse. A byte histogram cannot tell a
 * Windows-1252 letter from a Shift-JIS one, and `unknown` is an honest answer
 * the caller can escalate (to the writer, or to a smarter pass), which a wrong
 * confident answer is not. Detection is pure: no I/O, no mutation, same bytes
 * in → same answer out.
 */

/**
 * The encodings a guess can name. `'unknown'` is a first-class answer — it
 * means the bytes are not UTF-8 and do not match the shapes below (a binary
 * file, or an encoding a byte histogram cannot name).
 */
export type EncodingGuess = 'utf-16le' | 'utf-16be' | 'windows-1252' | 'unknown';

/** A guess, plus the `'utf-8'` an already-valid file resolves to on decode. */
export type DecodedEncoding = 'utf-8' | EncodingGuess;

/** What a reported file is to the project. `'unknown'` covers a file the layout does not name. */
export type EncodingIssueKind = 'document' | 'codex' | 'unknown';

/**
 * One file the load found that is not UTF-8 text — the structured companion to
 * the notice the same file produces. `size` is the file's length in bytes and
 * `encoding` the guess from its first bytes; the bytes themselves are not
 * carried (the file stays where it is).
 */
export interface EncodingIssue {
  /** Project-relative path, e.g. `docs/n_XXXXXXXXXX.md`. */
  readonly path: string;
  readonly kind: EncodingIssueKind;
  /** File size in bytes. */
  readonly size: number;
  readonly encoding: EncodingGuess;
}

/** {@link decodeForPreview}'s result: the encoding the text was decoded as, and the text. */
export interface DecodedPreview {
  readonly encoding: DecodedEncoding;
  readonly text: string;
}

/** How many leading bytes a guess looks at. Detection is a first-block read, not a file scan. */
const GUESS_SAMPLE_BYTES = 4096;

/** The five values cp1252 leaves undefined — their presence rules the encoding out. */
const UNDEFINED_CP1252 = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/**
 * A deterministic best guess at what a non-UTF-8 file's bytes are.
 *
 * Order matters: the BOMs are certain, so they are answered before the
 * histograms run. Between them:
 *
 *   - UTF-16 without a BOM shows up as NUL bytes concentrated on one byte
 *     parity: `48 00` per ASCII character little-endian, `00 48` big-endian.
 *     Both parities have to agree for the guess to fire — a file that is NULs
 *     on both is binary, not text.
 *   - Windows-1252 / Latin-1 is the guess when the bytes carry high bytes
 *     (≥ 0x80) and nothing that cannot be text: no NULs, no C0 controls other
 *     than tab/LF/CR, no DEL, and none of the five code points cp1252 leaves
 *     undefined. A byte that fails UTF-8 has at least one high byte by
 *     definition, so this is the common case — a Western-European text file is
 *     what a non-UTF-8 `.md` almost always is.
 *   - Everything else is `'unknown'`: a double-byte encoding whose bytes happen
 *     to include an undefined cp1252 point, or a file that was never text.
 *
 * The guess reads at most the first {@link GUESS_SAMPLE_BYTES} bytes, so a
 * one-megabyte file costs the same as a one-kilobyte one.
 */
export function guessEncoding(bytes: Uint8Array): EncodingGuess {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  }

  const sample = bytes.length > GUESS_SAMPLE_BYTES ? bytes.subarray(0, GUESS_SAMPLE_BYTES) : bytes;

  // Sixteen pairs is the smallest sample the parity test runs on: a handful of
  // bytes is not enough evidence to call a file UTF-16 on NUL placement alone.
  if (sample.length >= 32) {
    const pairs = Math.floor(sample.length / 2);
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < pairs; i += 1) {
      if (sample[i * 2] === 0x00) evenNul += 1;
      if (sample[i * 2 + 1] === 0x00) oddNul += 1;
    }
    if (oddNul / pairs > 0.4 && evenNul / pairs < 0.05) return 'utf-16le';
    if (evenNul / pairs > 0.4 && oddNul / pairs < 0.05) return 'utf-16be';
  }

  let high = 0;
  let notText = 0;
  for (const byte of sample) {
    if (byte >= 0x80) {
      if (UNDEFINED_CP1252.has(byte)) notText += 1;
      else high += 1;
    } else if (byte === 0x7f || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) {
      notText += 1;
    }
  }
  if (notText > 0) return 'unknown';
  if (high > 0) return 'windows-1252';
  return 'unknown';
}

/**
 * Decode a file's bytes for preview, naming the encoding the text came out as.
 *
 * Byte-order marks are honoured first, then a strict UTF-8 decode; what is left
 * is decoded by the guess — UTF-16 by its decoder, everything else through
 * `windows-1252`, which maps every byte and so never throws. An `'unknown'`
 * guess therefore still returns text: it is a best-effort preview the caller
 * should distrust, not a conversion.
 *
 * Side-effect free by construction: the bytes are only read.
 */
export function decodeForPreview(bytes: Uint8Array): DecodedPreview {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8').decode(bytes) };
  }
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { encoding: 'utf-16le', text: new TextDecoder('utf-16le').decode(bytes) };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { encoding: 'utf-16be', text: new TextDecoder('utf-16be').decode(bytes) };
    }
  }
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    // Not UTF-8 — fall through to the guess.
  }
  const guess = guessEncoding(bytes);
  if (guess === 'utf-16le' || guess === 'utf-16be') {
    return { encoding: guess, text: new TextDecoder(guess).decode(bytes) };
  }
  return { encoding: guess, text: new TextDecoder('windows-1252').decode(bytes) };
}

/**
 * The name a guess is reported under in a load notice, e.g. "its bytes look
 * like Windows-1252". `'unknown'` has no name; callers phrase that case
 * themselves.
 */
export function encodingName(guess: Exclude<EncodingGuess, 'unknown'>): string {
  switch (guess) {
    case 'utf-16le':
      return 'UTF-16, little-endian';
    case 'utf-16be':
      return 'UTF-16, big-endian';
    case 'windows-1252':
      return 'Windows-1252';
  }
}
