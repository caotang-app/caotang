/**
 * Document file codec — [project-format.md §3](docs/architecture/project-format.md).
 *
 * A document file is front matter + blank line + body. The body is the
 * irreplaceable content (§4 severity tiering) and is treated as bytes: this
 * module does not normalise line endings, strip trailing whitespace, or add a
 * title heading. Those are editor/MD-dialect concerns (editor-engine.md §5, the
 * C20 dialect contract), and doing them here would make the file disagree with
 * the in-memory state that §8's acceptance test diffs against.
 */

import {
  formatFrontMatter,
  parseFrontMatter,
  FrontMatterError,
  type DocumentFrontMatter,
} from './frontmatter.js';
import { composeFile, fenceLineEnding, readBody } from './file-body.js';

export interface ParsedDocument {
  frontMatter: DocumentFrontMatter;
  /** Exactly what the author wrote, with no title heading and no trailing newline. */
  body: string;
}

const FENCE_RE = /^---[ \t]*\r?\n/;

/**
 * Split a document file into its front matter and body.
 *
 * The body is sliced from the raw text by offset so its own line endings and
 * trailing whitespace survive untouched. The envelope around it (one blank line
 * before, one terminator after) is {@link readBody}'s, shared with the codex file.
 */
export function parseDocumentFile(raw: string): ParsedDocument {
  const opening = raw.match(FENCE_RE);
  if (!opening) {
    throw new FrontMatterError('document file does not start with a `---` front matter fence');
  }
  const rest = raw.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m;
  const closingMatch = closing.exec(rest);
  if (!closingMatch) {
    throw new FrontMatterError('document file has no closing `---` front matter fence');
  }

  const yaml = rest.slice(0, closingMatch.index);
  const body = readBody(rest.slice(closingMatch.index + closingMatch[0].length), fenceLineEnding(opening[0]));

  return { frontMatter: parseFrontMatter(yaml), body };
}

export interface SerializeDocumentOptions {
  /** Line ending for the fence block; the body is never touched. */
  newline?: '\n' | '\r\n';
}

export function serializeDocumentFile(
  frontMatter: DocumentFrontMatter,
  body: string,
  options: SerializeDocumentOptions = {},
): string {
  const nl = options.newline ?? '\n';
  const block = formatFrontMatter(frontMatter).replace(/\n/g, nl);
  return composeFile(block, body, nl);
}

export { FrontMatterError };
export type { DocumentFrontMatter };
