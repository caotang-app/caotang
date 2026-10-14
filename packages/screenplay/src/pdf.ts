/**
 * A minimal PDF writer for the paginated screenplay ([screenplay.md §5.3](../../../docs/architecture/screenplay.md)).
 *
 * One uncompressed content stream per page, the base-14 Courier font in WinAnsi encoding,
 * and nothing else. Caotang owns it for the same reason it owns the EPUB emitter
 * (exporter.md §3a): a dormant dependency costs more than a few hundred lines of
 * frozen-format output. The embedded Courier Prime of A3 and the library question belong
 * to the PDF-library benchmark. Courier Prime is metrically identical to Courier, so the layout is the
 * same either way.
 *
 * Every byte is ASCII. Strings are escaped on the way in, so the object offsets the xref
 * table records are string offsets, and the tests can check them exactly.
 */

import { LAYOUT } from './paginate.js';

export interface PdfText {
  readonly text: string;
  /** Points from the left page edge. */
  readonly x: number;
  /** Baseline in points from the top page edge. */
  readonly y: number;
}

export interface PdfInfo {
  readonly title?: string;
  readonly producer?: string;
}

/** Characters WinAnsi encodes above 0x7F that the Latin-1 range does not cover. */
const WIN_ANSI_EXTRA: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  '‰': 0x89,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
};

/** The WinAnsi byte for a character. Anything it cannot encode becomes a question mark. */
function winAnsiCode(ch: string): number {
  const code = ch.codePointAt(0) ?? 0x3f;
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return WIN_ANSI_EXTRA[ch] ?? 0x3f;
}

/** A PDF literal string body: escapes parentheses and backslashes, writes other non-ASCII as octal. */
export function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = winAnsiCode(ch);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return out;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function contentStream(lines: readonly PdfText[]): string {
  const parts = ['BT', '/F1 12 Tf'];
  for (const line of lines) {
    parts.push(`1 0 0 1 ${num(line.x)} ${num(LAYOUT.pageHeight - line.y)} Tm`, `(${pdfString(line.text)}) Tj`);
  }
  parts.push('ET');
  return parts.join('\n');
}

/**
 * Writes one PDF from pages of positioned text. Object 1 is the catalogue, 2 the page tree,
 * 3 the font, 4 the info dictionary. Each page then takes two objects: the page, and its
 * content stream.
 */
export function writePdf(pages: readonly (readonly PdfText[])[], info: PdfInfo = {}): Uint8Array<ArrayBuffer> {
  const pageId = (i: number): number => 5 + 2 * i;
  const bodies: string[] = [];
  bodies[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  bodies[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  bodies[3] = `<< /Title (${pdfString(info.title ?? 'Screenplay')}) /Producer (${pdfString(info.producer ?? 'Caotang')}) >>`;
  pages.forEach((lines, i) => {
    const stream = contentStream(lines);
    bodies[pageId(i) - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LAYOUT.pageWidth} ${LAYOUT.pageHeight}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>`;
    bodies[pageId(i)] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n%CAOTANG\n';
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
