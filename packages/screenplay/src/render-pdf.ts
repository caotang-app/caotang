/**
 * The PDF renderer — [screenplay.md §5.3](../../../docs/architecture/screenplay.md), the paginated artifact.
 *
 * The blocks become Fountain text through the same path as the Fountain renderer, that text is
 * parsed, paginated and drawn. The PDF therefore cannot disagree with the Fountain it came
 * from, and the element path is the only path through the pipeline.
 *
 * The work is split in two. {@link layoutPdf} is synchronous and pure: it paginates, so the page
 * count and every page-break rule are known before anything is drawn, and the exporter can refuse
 * or log a compile without loading the font. {@link drawPdf} writes the file with Courier Prime
 * embedded (A3). The font is about 70 KB, so it is loaded by a dynamic import ({@link loadCourierPrime}),
 * the lazy-import pattern the DOCX and EPUB renderers use: the editor bundle never carries it, and
 * nothing is fetched from the network.
 *
 * A character WinAnsi cannot encode is printed in the CJK fallback, Noto Sans Mono CJK SC, when the font has it
 * (cjk-font.ts). The layout knows which characters those are without loading the font (the coverage table in
 * src/fonts/noto-cjk-coverage.ts), so the compile log can name the ones that still print as "?" before anything is
 * drawn. {@link loadCjkFallback} loads the font and fontkit by a dynamic import, and only for a layout that needs them.
 */

import type { FlatBlock } from './flat-block.js';
import { paginate, type LayoutPage, type PaginateOptions } from './paginate.js';
import { parseFountain } from './parse.js';
import { NOTO_CJK_RANGES } from './fonts/noto-cjk-coverage.js';
import { isPrintable, writePdf, type PdfCidFont, type PdfFont } from './pdf.js';
import { renderFountain, type FountainRenderOptions } from './render-fountain.js';

export const PDF_MIME = 'application/pdf';

export type PdfRenderOptions = FountainRenderOptions & Pick<PaginateOptions, 'titlePage' | 'sceneNumbers' | 'continued'>;

/** A paginated screenplay, ready to draw. */
export interface PdfLayout {
  readonly pages: readonly LayoutPage[];
  /** The script pages, the title page left out. */
  readonly scriptPageCount: number;
  readonly title: string;
  readonly author?: string;
  /** What the Fountain step left out, and the characters neither font can print, in order. */
  readonly notes: readonly string[];
  /** The characters WinAnsi cannot encode that the CJK fallback prints, in order of first use. Empty: no fallback is loaded. */
  readonly fallbackCharacters: readonly string[];
}

export interface PdfRenderResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly pageCount: number;
  /** What the Fountain step left out, in order. */
  readonly notes: readonly string[];
}

/** The characters on the pages that WinAnsi cannot encode, once each, in order of first use. */
function unprintable(pages: readonly LayoutPage[]): string[] {
  const found = new Set<string>();
  for (const page of pages) {
    for (const line of page.lines) {
      for (const ch of line.text) if (!isPrintable(ch)) found.add(ch);
    }
  }
  return [...found];
}

let coverage: readonly (readonly [number, number])[] | undefined;

/** The code point ranges the fallback font maps, decoded once from the coverage table. */
function fallbackRanges(): readonly (readonly [number, number])[] {
  if (coverage !== undefined) return coverage;
  const ranges: [number, number][] = [];
  let end = -1;
  for (const token of NOTO_CJK_RANGES.split(' ')) {
    const [gap, length] = token.split('.').map((part) => parseInt(part, 36)) as [number, number];
    const start = end + 1 + gap;
    end = start + length - 1;
    ranges.push([start, end]);
  }
  coverage = ranges;
  return ranges;
}

/** Whether the CJK fallback font (Noto Sans Mono CJK SC) has a glyph for a character. */
export function fallbackCovers(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  const ranges = fallbackRanges();
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid] as readonly [number, number];
    if (code < range[0]) hi = mid - 1;
    else if (code > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Paginates the blocks. Pure and synchronous: the same blocks and options always give the same pages. */
export function layoutPdf(blocks: readonly FlatBlock[], opts: PdfRenderOptions): PdfLayout {
  const fountain = renderFountain(blocks, opts);
  const parsed = parseFountain(fountain.text);
  const pages = paginate(parsed.elements, {
    titlePage: opts.titlePage,
    title: opts.title,
    author: opts.author,
    date: opts.date,
    sceneNumbers: opts.sceneNumbers,
    continued: opts.continued,
  });
  const notes = [...fountain.notes];
  const outside = unprintable(pages);
  const fallbackCharacters = outside.filter(fallbackCovers);
  const missing = outside.filter((ch) => !fallbackCovers(ch));
  if (missing.length > 0) {
    const shown = missing.slice(0, 10).join(' ');
    notes.push(
      `pdf: neither Courier Prime nor the CJK fallback font can print ${missing.length === 1 ? 'this character' : `these ${missing.length} characters`}, so ${missing.length === 1 ? 'it is' : 'they are'} printed as "?": ${shown}${missing.length > 10 ? ' …' : ''}`,
    );
  }
  return {
    pages,
    scriptPageCount: pages.filter((page) => page.kind === 'script').length,
    title: opts.title,
    ...(opts.author === undefined ? {} : { author: opts.author }),
    notes,
    fallbackCharacters,
  };
}

/**
 * Draws a layout as a PDF. With a font, the font is embedded; without one the file names the base-14 Courier. With a
 * fallback ({@link loadCjkFallback}), the characters WinAnsi cannot encode print in it; without one they print as "?".
 */
export function drawPdf(layout: PdfLayout, font?: PdfFont, fallback?: PdfCidFont): Uint8Array<ArrayBuffer> {
  return writePdf(
    layout.pages.map((page) => page.lines.map((line) => ({ text: line.text, x: line.x, y: line.y }))),
    { title: layout.title, ...(layout.author === undefined ? {} : { author: layout.author }) },
    font,
    fallback,
  );
}

/**
 * The CJK fallback subset a layout needs, or undefined when it needs none. Only a layout with a character WinAnsi cannot
 * encode, and the fallback font can print, loads cjk-font.ts, fontkit and the font file, by a dynamic import.
 */
export async function loadCjkFallback(layout: PdfLayout): Promise<PdfCidFont | undefined> {
  if (layout.fallbackCharacters.length === 0) return undefined;
  const { loadNotoCjk, subsetNotoCjk } = await import('./cjk-font.js');
  return subsetNotoCjk(await loadNotoCjk(), layout.fallbackCharacters);
}

/** Courier Prime Regular's bytes. The module that holds them is imported here and nowhere else. */
export async function loadCourierPrime(): Promise<PdfFont> {
  const { COURIER_PRIME_REGULAR_BASE64 } = await import('./fonts/courier-prime-regular.js');
  return { bytes: decodeBase64(COURIER_PRIME_REGULAR_BASE64) };
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Lays out and draws in one call. `font` embeds it; without one the file names the base-14 Courier. */
export function renderPdf(blocks: readonly FlatBlock[], opts: PdfRenderOptions, font?: PdfFont): PdfRenderResult {
  const layout = layoutPdf(blocks, opts);
  return { bytes: drawPdf(layout, font), pageCount: layout.pages.length, notes: layout.notes };
}

export interface PdfRenderer {
  emit(blocks: readonly FlatBlock[], opts: PdfRenderOptions): Promise<Blob>;
}

/** The renderer seam of screenplay.md §5.3. Its files always embed Courier Prime, and the CJK fallback when the script needs it. */
export function createPdfRenderer(): PdfRenderer {
  return {
    async emit(blocks, opts) {
      const layout = layoutPdf(blocks, opts);
      const bytes = drawPdf(layout, await loadCourierPrime(), await loadCjkFallback(layout));
      return new Blob([bytes], { type: PDF_MIME });
    },
  };
}
