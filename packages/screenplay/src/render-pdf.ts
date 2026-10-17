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
 */

import type { FlatBlock } from './flat-block.js';
import { paginate, type LayoutPage, type PaginateOptions } from './paginate.js';
import { parseFountain } from './parse.js';
import { isPrintable, writePdf, type PdfFont } from './pdf.js';
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
  /** What the Fountain step left out, and the characters the font cannot print, in order. */
  readonly notes: readonly string[];
}

export interface PdfRenderResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly pageCount: number;
  /** What the Fountain step left out, in order. */
  readonly notes: readonly string[];
}

/** The characters on the pages that WinAnsi cannot encode. Each one prints as a question mark. */
function unprintable(pages: readonly LayoutPage[]): string[] {
  const found = new Set<string>();
  for (const page of pages) {
    for (const line of page.lines) {
      for (const ch of line.text) if (!isPrintable(ch)) found.add(ch);
    }
  }
  return [...found];
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
  const missing = unprintable(pages);
  if (missing.length > 0) {
    const shown = missing.slice(0, 10).join(' ');
    notes.push(
      `pdf: Courier Prime cannot print ${missing.length === 1 ? 'this character' : `these ${missing.length} characters`}, so ${missing.length === 1 ? 'it is' : 'they are'} printed as "?": ${shown}${missing.length > 10 ? ' …' : ''}`,
    );
  }
  return {
    pages,
    scriptPageCount: pages.filter((page) => page.kind === 'script').length,
    title: opts.title,
    ...(opts.author === undefined ? {} : { author: opts.author }),
    notes,
  };
}

/** Draws a layout as a PDF. With a font, the font is embedded; without one the file names the base-14 Courier. */
export function drawPdf(layout: PdfLayout, font?: PdfFont): Uint8Array<ArrayBuffer> {
  return writePdf(
    layout.pages.map((page) => page.lines.map((line) => ({ text: line.text, x: line.x, y: line.y }))),
    { title: layout.title, ...(layout.author === undefined ? {} : { author: layout.author }) },
    font,
  );
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

/** The renderer seam of screenplay.md §5.3. Its files always embed Courier Prime. */
export function createPdfRenderer(): PdfRenderer {
  return {
    async emit(blocks, opts) {
      const { bytes } = renderPdf(blocks, opts, await loadCourierPrime());
      return new Blob([bytes], { type: PDF_MIME });
    },
  };
}
