/**
 * The body envelope both file codecs share — [project-format.md §3](docs/architecture/project-format.md)
 * and [codex.md §3](docs/architecture/codex.md).
 *
 * A file is a front-matter block, one blank line, the body, and one terminating
 * line ending. Only the envelope belongs here: the body is the irreplaceable
 * content and is never edited by these functions. What they guarantee is that
 * the envelope is exactly invertible, so the reader returns the body
 * byte-for-byte whatever it ends with.
 *
 * That guarantee is one rule, applied on both sides: **the writer always appends
 * the terminator, and the reader strips exactly the one the writer appended.**
 * The earlier pair broke it in two places. The writer appended a terminator only
 * to a body that did not already end in `\n`, while the reader always stripped one,
 * so `abc\n` came back as `abc`. And the reader stripped `\r\n` as a unit, so a body
 * ending in a bare `\r` lost the `\r`.
 *
 * Which line ending counts as "one" is the one the file's own opening fence uses.
 * The writer uses a single `newline` for the whole file, so the fence tells the
 * reader which it was, and a file that mixes endings is read leniently on its
 * terminator only.
 */

export type LineEnding = '\n' | '\r\n';

/** The line ending of an opening fence line (`---\n` or `---\r\n`). */
export function fenceLineEnding(openingFence: string): LineEnding {
  return openingFence.endsWith('\r\n') ? '\r\n' : '\n';
}

/**
 * Read the body out of the text that follows the closing fence.
 *
 * `afterClosingFence` starts at the first character of the line after the closing
 * `---`. Exactly one blank line is consumed before the body, and exactly one
 * terminator after it. Consuming exactly one blank line rather than "all leading
 * blank lines" is what makes an author-intended leading blank line round-trip.
 */
export function readBody(afterClosingFence: string, eol: LineEnding): string {
  let body = afterClosingFence;
  if (body.startsWith(eol)) {
    body = body.slice(eol.length);
  } else if (eol === '\r\n' && body.startsWith('\n')) {
    // A hand-edited CRLF file whose blank line is bare LF. The writer never
    // produces this, so it is read leniently rather than refused.
    body = body.slice(1);
  }
  if (body.endsWith(eol)) return body.slice(0, body.length - eol.length);
  if (eol === '\r\n' && body.endsWith('\n')) return body.slice(0, -1);
  return body;
}

/**
 * Assemble a file from its front-matter block and body.
 *
 * `block` must already end in `eol` (the fence's closing line). An empty body
 * writes the block alone, with no blank line and no terminator, which is how
 * {@link readBody} reads back `''`.
 */
export function composeFile(block: string, body: string, eol: LineEnding): string {
  if (body === '') return block;
  return `${block}${eol}${body}${eol}`;
}
