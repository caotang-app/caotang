/**
 * The fallback font's {@link FontLoader} for Node: the MCP server, and the tests. The app has its own, over `fetch`
 * (apps/desktop/src/app/cjk-font.ts), so this file is a subpath of its own (`@caotang/exporter/cjk-font-node`) and the
 * package's index never imports it: the browser bundle never sees `node:fs`.
 *
 * Where it looks, in order:
 *
 * 1. `fonts/NotoSansCJKsc-Regular.woff` beside the running module. The MCPB bundle stages the file there, beside
 *    `caotang-mcp.mjs`, so the installed server needs no `node_modules`.
 * 2. The `@caotang/font-noto-cjk` package, resolved from the running module: a checkout, and the built bundle run in place.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CJK_FONT_FILE, type FontLoader } from './cjk-font.js';

const PACKAGE = '@caotang/font-noto-cjk';

/** The places {@link loadCjkFontInNode} reads, in the order it tries them. */
export function cjkFontCandidates(moduleUrl: string = import.meta.url): string[] {
  const candidates = [join(dirname(fileURLToPath(moduleUrl)), 'fonts', CJK_FONT_FILE)];
  try {
    candidates.push(createRequire(moduleUrl).resolve(`${PACKAGE}/${CJK_FONT_FILE}`));
  } catch {
    // Not resolvable from here: the bundled copy, if any, is the only place.
  }
  return candidates;
}

/** Reads the fallback font from the first place that holds it, and says every place it looked when none does. */
export const loadCjkFontInNode: FontLoader = async () => {
  const candidates = cjkFontCandidates();
  for (const path of candidates) {
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      // Try the next place.
    }
  }
  throw new Error(`${CJK_FONT_FILE} is not at ${candidates.join(' or ')}`);
};
