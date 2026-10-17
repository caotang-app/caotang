/**
 * What the two fallback fonts of the screenplay PDF share (cjk-font.ts, emoji-font.ts): reading a font file that ships
 * beside the module, cutting a subset with @pdf-lib/fontkit, and naming it. Reached only through those two modules, which
 * render-pdf.ts imports dynamically.
 */

import * as fontkitModule from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';

/** The ES build of fontkit has only a default export; its types name `create` directly. Both shapes are read. */
export const fontkit = ((fontkitModule as unknown as { default?: typeof fontkitModule }).default ?? fontkitModule) as typeof fontkitModule;

interface NodeFs {
  readFile(path: URL): Promise<Uint8Array>;
}

/**
 * A font file's bytes. In the browser the file is a build asset on the app's own origin; under Node it is read from disk.
 * `label` names the font in the error a failed load throws.
 */
export async function fontFileBytes(url: URL, label: string): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    // Under Node (the tests, the MCP server) the file is read from disk. The specifier is a variable, so the browser build
    // does not try to bundle a Node module it never runs.
    const specifier = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ specifier)) as NodeFs;
    return new Uint8Array(await fs.readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`pdf: the ${label} did not load (${response.status} ${response.statusText})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function encodeSubset(subset: ReturnType<Font['createSubset']>): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const parts: Uint8Array[] = [];
    subset
      .encodeStream()
      .on('data', (chunk) => parts.push(chunk))
      .on('end', () => {
        const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
        let at = 0;
        for (const part of parts) {
          out.set(part, at);
          at += part.length;
        }
        resolve(out);
      });
  });
}

/** Six capital letters from the glyph list (PDF 1.7 §9.6.4): the same subset always gets the same tag. */
export function subsetTag(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (hash % 26));
    hash = Math.floor(hash / 26) + i * 7919;
  }
  return tag;
}

