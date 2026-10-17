/// <reference types="vite/client" />
// The `?url` import below is typed by Vite's client types; the root typecheck (e2e/) reaches this file through the session.
/**
 * The PDF exporter's fallback font, read in the browser (packages/exporter/src/cjk-font.ts).
 *
 * The font file comes from `@caotang/font-noto-cjk`. The `?url` import makes Vite emit it as an asset of its own, served
 * from this app's origin like every other file, so the Content-Security-Policy needs no change and no CDN is involved. The
 * import is dynamic and sits inside the loader, so neither the URL module nor the file is fetched until a contact sheet
 * holds text outside Latin script and the exporter asks for it.
 */

import type { FontLoader } from '@caotang/exporter';

export const loadCjkFontOverHttp: FontLoader = async () => {
  const { default: url } = await import('@caotang/font-noto-cjk/NotoSansCJKsc-Regular.woff?url');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
