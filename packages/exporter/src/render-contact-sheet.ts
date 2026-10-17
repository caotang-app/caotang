/**
 * The contact-sheet PDF emitter — [storyboard.md](../../../docs/architecture/storyboard.md) §6, `ContactSheetPdfRenderer`.
 *
 * `@caotang/storyboard` lays the sheet out (`planContactSheet`, `paginate`): the page size, the card grid, the number chips,
 * the spec rows, the action lines and the header, in points from the top left. This file draws that plan and nothing else.
 * It makes no layout decision of its own, except two that need the real font: a line the plan's width estimate let through
 * is cut with an ellipsis where the font says it overflows, and a picture is scaled to fit its box without being stretched.
 *
 * ## The library
 *
 * `pdf-lib` (exact pin, MIT), loaded with a dynamic `import()` inside {@link drawContactSheet} and nowhere else, so the editor
 * bundle never pays for it (the DOCX and EPUB pattern, exporter.md §3). It runs in the browser and in Node, with no network:
 * the text is set in the PDF's built-in Helvetica, which every PDF reader has, so no font file is fetched or embedded and the
 * page's Content-Security-Policy is not touched.
 *
 * ## What the built-in font cannot show
 *
 * Helvetica's built-in encoding is WinAnsi: Latin letters with their accents, and common punctuation. A character outside it
 * (Chinese, Cyrillic, an emoji) is drawn as `?`, and the compile log says how many were replaced. Embedding a Unicode font
 * would lift this; it is a known limit, not a silent loss.
 *
 * ## Pictures
 *
 * PNG and JPEG are embedded as they are stored. A picture the engine cannot draw (a WebP file, bytes that are gone, a file that
 * does not parse) gets the card's caption in its box instead, and the log names the picture once.
 */

import type * as PdfLib from 'pdf-lib';
import { sniffImage, type PlacedCard, type PlacedText, type SheetPlan } from '@caotang/storyboard';

export const PDF_MIME = 'application/pdf';

export interface ContactSheetPdfInput {
  readonly plan: SheetPlan;
  /** Shot id to the asset id of the picture its card draws (`planContactSheet`'s `pictures`). */
  readonly pictures: ReadonlyMap<string, string>;
  /** The bytes of one picture by asset id, or `null` when they cannot be read. */
  readonly readPicture: (assetId: string) => Promise<Uint8Array | null>;
  /** The document's title, in its metadata. */
  readonly title: string;
  readonly author?: string;
  /** The moment the compile ran: the document's creation and modification dates, so one compile writes one file. */
  readonly at: Date;
}

export interface ContactSheetPdf {
  readonly contents: Uint8Array;
  readonly notes: readonly string[];
}

/** A colour as red, green and blue from 0 to 1. */
interface Shade {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const INK: Shade = { r: 0.1, g: 0.1, b: 0.1 };
const MUTED: Shade = { r: 0.4, g: 0.4, b: 0.4 };
const FRAME_FILL: Shade = { r: 0.93, g: 0.93, b: 0.93 };
const FRAME_LINE: Shade = { r: 0.7, g: 0.7, b: 0.7 };
const CHIP_FILL: Shade = { r: 0.15, g: 0.15, b: 0.15 };
const PAPER: Shade = { r: 1, g: 1, b: 1 };

/** What the built-in font can encode, and a running count of what it could not. */
interface TextSetter {
  /** The text with each character the font cannot encode as `?`, and control characters as spaces. */
  safe(text: string): string;
  readonly replaced: () => number;
}

function textSetter(font: PdfLib.PDFFont): TextSetter {
  const supported = new Set(font.getCharacterSet());
  let replaced = 0;
  return {
    safe(text) {
      let out = '';
      for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
          out += ' ';
        } else if (supported.has(code)) {
          out += char;
        } else {
          out += '?';
          replaced += 1;
        }
      }
      return out;
    },
    replaced: () => replaced,
  };
}

/** The text cut, with an ellipsis, to the width the font measures. Text that fits is returned as it is. */
export function fitToWidth(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  let keep = chars.length;
  while (keep > 0 && measure(`${chars.slice(0, keep).join('').trimEnd()}…`) > maxWidth) keep -= 1;
  return keep === 0 ? '' : `${chars.slice(0, keep).join('').trimEnd()}…`;
}

/** The box a picture of `width` × `height` is drawn in: as large as fits inside `box`, centred, never stretched. */
export function containIn(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (width <= 0 || height <= 0) return { ...box };
  const scale = Math.min(box.width / width, box.height / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return { x: box.x + (box.width - drawnWidth) / 2, y: box.y + (box.height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight };
}

/**
 * Draws a contact-sheet plan as a PDF. Every page of the plan is one page of the file, in order, so the page count the plan
 * states is the page count the file has.
 */
export async function drawContactSheet(input: ContactSheetPdfInput): Promise<ContactSheetPdf> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const color = (c: Shade): PdfLib.RGB => rgb(c.r, c.g, c.b);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const setter = textSetter(regular);
  const notes: string[] = [];

  pdf.setTitle(setter.safe(input.title));
  if (input.author !== undefined && input.author.trim() !== '') pdf.setAuthor(setter.safe(input.author.trim()));
  pdf.setCreator('Caotang');
  pdf.setProducer('Caotang (pdf-lib)');
  pdf.setCreationDate(input.at);
  pdf.setModificationDate(input.at);

  // Each picture is embedded once, however many cards point at it, and a picture that cannot be drawn is named once.
  const embedded = new Map<string, PdfLib.PDFImage | null>();
  const pictureOf = async (assetId: string): Promise<PdfLib.PDFImage | null> => {
    const known = embedded.get(assetId);
    if (known !== undefined) return known;
    let image: PdfLib.PDFImage | null = null;
    const bytes = await input.readPicture(assetId);
    if (bytes === null) {
      notes.push(`contact sheet: image ${assetId} could not be read, so its cards show the caption`);
    } else {
      const format = sniffImage(bytes);
      try {
        if (format === 'png') image = await pdf.embedPng(bytes);
        else if (format === 'jpeg') image = await pdf.embedJpg(bytes);
        else notes.push(`contact sheet: image ${assetId} is not a PNG or JPEG, so its cards show the caption`);
      } catch (error) {
        image = null;
        notes.push(
          `contact sheet: image ${assetId} could not be embedded (${error instanceof Error ? error.message : String(error)}), so its cards show the caption`,
        );
      }
    }
    embedded.set(assetId, image);
    return image;
  };

  const { width: pageWidth, height: pageHeight, margin, headerHeight } = input.plan.geometry;
  const contentWidth = pageWidth - 2 * margin;
  /** The plan's y runs down from the top; the PDF's runs up from the bottom. */
  const flip = (y: number): number => pageHeight - y;

  const drawText = (page: PdfLib.PDFPage, placed: PlacedText, font: PdfLib.PDFFont, maxWidth: number, ink: Shade = INK): void => {
    const text = fitToWidth(setter.safe(placed.text), maxWidth, (candidate) => font.widthOfTextAtSize(candidate, placed.fontSize));
    if (text === '') return;
    page.drawText(text, { x: placed.x, y: flip(placed.y), size: placed.fontSize, font, color: color(ink) });
  };

  const drawCard = async (page: PdfLib.PDFPage, card: PlacedCard): Promise<void> => {
    const box = card.image;
    page.drawRectangle({
      x: box.x,
      y: flip(box.y + box.height),
      width: box.width,
      height: box.height,
      color: color(FRAME_FILL),
      borderColor: color(FRAME_LINE),
      borderWidth: 0.5,
    });
    const assetId = input.pictures.get(card.shotId);
    const image = card.hasImage && assetId !== undefined ? await pictureOf(assetId) : null;
    if (image !== null) {
      const fit = containIn(box, image.width, image.height);
      page.drawImage(image, { x: fit.x, y: flip(fit.y + fit.height), width: fit.width, height: fit.height });
    } else {
      drawText(page, card.placeholder ?? card.fallback, regular, box.width - 2 * (card.fallback.x - box.x), MUTED);
    }

    // The number chip sits on the picture, in its top-left corner.
    page.drawRectangle({
      x: card.chip.x,
      y: flip(card.chip.y + card.chip.height),
      width: card.chip.width,
      height: card.chip.height,
      color: color(CHIP_FILL),
    });
    drawText(page, card.chipText, bold, card.chip.width, PAPER);

    drawText(page, card.spec, regular, card.frame.width);
    for (const line of card.action) drawText(page, line, regular, card.frame.width);
  };

  for (const sheet of input.plan.pages) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const labelWidth = bold.widthOfTextAtSize(setter.safe(sheet.pageLabel.text), sheet.pageLabel.fontSize);
    drawText(page, sheet.title, bold, Math.max(0, contentWidth - labelWidth - 12));
    page.drawText(setter.safe(sheet.pageLabel.text), {
      x: pageWidth - margin - labelWidth,
      y: flip(sheet.pageLabel.y),
      size: sheet.pageLabel.fontSize,
      font: bold,
      color: color(MUTED),
    });
    if (sheet.summary !== undefined) drawText(page, sheet.summary, regular, contentWidth, MUTED);
    // A rule under the header, above the first row of cards.
    const ruleY = flip(margin + headerHeight - 6);
    page.drawLine({ start: { x: margin, y: ruleY }, end: { x: pageWidth - margin, y: ruleY }, thickness: 0.5, color: color(FRAME_LINE) });

    if (sheet.emptyNote !== undefined) drawText(page, sheet.emptyNote, regular, contentWidth, MUTED);
    for (const card of sheet.cards) await drawCard(page, card);
  }

  const replaced = setter.replaced();
  if (replaced > 0) {
    notes.push(
      `contact sheet: ${replaced} ${replaced === 1 ? 'character' : 'characters'} the PDF's built-in font cannot show (outside Latin script) ${replaced === 1 ? 'was' : 'were'} drawn as "?"`,
    );
  }
  return { contents: await pdf.save({ useObjectStreams: false }), notes };
}
