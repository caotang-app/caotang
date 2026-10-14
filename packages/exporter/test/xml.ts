/**
 * The XML well-formedness check the DOCX and EPUB tests share (exporter.md §3 and §3a:
 * a part that does not parse is not an artifact a reader can open).
 *
 * Two checks, because neither is enough alone. `sax` in strict mode is a real parser
 * for structure: unbalanced tags, unknown entities, text outside the root. It does not
 * check the character set, and XML 1.0 forbids some control characters outright, so
 * the character set is checked on the text itself.
 */

import { createRequire } from 'node:module';
import { strFromU8, unzipSync } from 'fflate/browser';

interface SaxParser {
  onerror: ((error: Error) => void) | null;
  write(chunk: string): SaxParser;
  close(): SaxParser;
}

interface SaxModule {
  parser(strict: boolean, options: { strictEntities: boolean }): SaxParser;
}

// `sax` is CommonJS and ships no type declarations. It is a devDependency of this package,
// pinned exactly, and the lockfile already carried it through `docx`.
const load = createRequire(import.meta.url);
const sax = load('sax') as SaxModule;

// The control characters XML 1.0 forbids, escaped or not. Matching them is the point of the check.
// eslint-disable-next-line no-control-regex -- these are the code points under test
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/** Throws, naming the part, when `xml` carries a forbidden character or does not parse as XML. */
export function assertWellFormedXml(name: string, xml: string): void {
  const bad = FORBIDDEN.exec(xml);
  if (bad !== null) {
    const hex = (bad[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    throw new Error(`${name} carries U+${hex} at offset ${bad.index}, which XML 1.0 does not allow`);
  }
  const parser = sax.parser(true, { strictEntities: true });
  // sax only records an error unless told otherwise, and then it would keep going on a broken part.
  parser.onerror = (error) => {
    throw error;
  };
  try {
    parser.write(xml).close();
  } catch (cause) {
    throw new Error(`${name} is not well-formed XML: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/**
 * Every entry of a ZIP as text, except the names listed in `skip` (EPUB's `mimetype`
 * is the one entry that is not XML). Callers assert on each part with
 * {@link assertWellFormedXml}.
 */
export function unzipText(bytes: Uint8Array, skip: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    if (skip.includes(name)) continue;
    out[name] = strFromU8(data);
  }
  return out;
}
