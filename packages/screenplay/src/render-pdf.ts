/**
 * The PDF renderer — [screenplay.md §5.3](../../../docs/architecture/screenplay.md), the paginated artifact.
 *
 * The blocks become Fountain text through the same path as the Fountain renderer, that text is
 * parsed, paginated and drawn. The PDF therefore cannot disagree with the Fountain it came
 * from, and the element path is the only path through the pipeline.
 */

import type { FlatBlock } from './flat-block.js';
import { paginate, type PaginateOptions } from './paginate.js';
import { parseFountain } from './parse.js';
import { writePdf } from './pdf.js';
import { renderFountain, type FountainRenderOptions } from './render-fountain.js';

export const PDF_MIME = 'application/pdf';

export type PdfRenderOptions = FountainRenderOptions & Pick<PaginateOptions, 'titlePage' | 'sceneNumbers' | 'continued'>;

export interface PdfRenderResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly pageCount: number;
  /** What the Fountain step left out, in order. */
  readonly notes: readonly string[];
}

export function renderPdf(blocks: readonly FlatBlock[], opts: PdfRenderOptions): PdfRenderResult {
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
  const bytes = writePdf(
    pages.map((page) => page.lines.map((line) => ({ text: line.text, x: line.x, y: line.y }))),
    { title: opts.title },
  );
  return { bytes, pageCount: pages.length, notes: fountain.notes };
}

export interface PdfRenderer {
  emit(blocks: readonly FlatBlock[], opts: PdfRenderOptions): Promise<Blob>;
}

export function createPdfRenderer(): PdfRenderer {
  return {
    async emit(blocks, opts) {
      const { bytes } = renderPdf(blocks, opts);
      return new Blob([bytes], { type: PDF_MIME });
    },
  };
}
