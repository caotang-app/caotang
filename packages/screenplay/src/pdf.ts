/**
 * A minimal PDF writer for the paginated screenplay ([screenplay.md §5.3](../../../docs/architecture/screenplay.md)).
 *
 * One uncompressed content stream per page, one font in WinAnsi encoding, and nothing else.
 * Caotang owns it for the same reason it owns the EPUB emitter (exporter.md §3a): a dormant
 * dependency costs more than a few hundred lines of frozen-format output, and no library is
 * needed for text in one monospaced font.
 *
 * The font is Courier Prime (A3), embedded whole as a TrueType font program (`FontFile2`),
 * when the caller passes its bytes. The exporter always does. Without them the page names the
 * base-14 Courier, which every viewer has; Courier Prime has Courier's metrics, so the layout
 * is the same either way.
 *
 * Every byte is ASCII. Strings are escaped on the way in and the font program is written in
 * hexadecimal (`ASCIIHexDecode`), so the object offsets the xref table records are string
 * offsets, and the tests can check them exactly.
 */

import { COURIER_PRIME_METRICS } from './fonts/courier-prime-metrics.js';
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
  readonly author?: string;
  readonly producer?: string;
}

/** A TrueType font program to embed: Courier Prime (A3). Its metrics are the ones `COURIER_PRIME_METRICS` states. */
export interface PdfFont {
  readonly bytes: Uint8Array;
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

/** Whether WinAnsi can encode a character, so the font can print it. */
export function isPrintable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA[ch] !== undefined;
}

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

function hex(bytes: Uint8Array): string {
  const digits = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    out += digits.charAt(byte >> 4) + digits.charAt(byte & 15);
    // A line break every 64 bytes keeps the file readable in a text editor. ASCIIHexDecode ignores white space.
    if (i % 64 === 63) out += '\n';
  }
  return `${out}>`;
}

/** The font dictionary for Courier Prime as an embedded TrueType font, with WinAnsi codes 32 to 255. */
function embeddedFontObjects(font: PdfFont, descriptorId: number, fileId: number): { font: string; descriptor: string; file: string } {
  const m = COURIER_PRIME_METRICS;
  const widths = Array.from({ length: 224 }, () => String(m.width)).join(' ');
  const program = hex(font.bytes);
  return {
    font:
      `<< /Type /Font /Subtype /TrueType /BaseFont /${m.postScriptName} /FirstChar 32 /LastChar 255 ` +
      `/Widths [${widths}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptorId} 0 R >>`,
    descriptor:
      `<< /Type /FontDescriptor /FontName /${m.postScriptName} /Flags ${m.flags} /FontBBox [${m.bbox.join(' ')}] ` +
      `/ItalicAngle ${m.italicAngle} /Ascent ${m.ascent} /Descent ${m.descent} /CapHeight ${m.capHeight} ` +
      `/XHeight ${m.xHeight} /StemV ${m.stemV} /MissingWidth ${m.width} /FontFile2 ${fileId} 0 R >>`,
    file: `<< /Length ${program.length} /Length1 ${font.bytes.length} /Filter /ASCIIHexDecode >>\nstream\n${program}\nendstream`,
  };
}

/**
 * Writes one PDF from pages of positioned text. Object 1 is the catalogue, 2 the page tree,
 * 3 the font, 4 the info dictionary. Each page then takes two objects: the page, and its
 * content stream. An embedded font adds its descriptor and its program after the pages.
 */
export function writePdf(
  pages: readonly (readonly PdfText[])[],
  info: PdfInfo = {},
  font?: PdfFont,
): Uint8Array<ArrayBuffer> {
  const pageId = (i: number): number => 5 + 2 * i;
  const bodies: string[] = [];
  bodies[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  if (font === undefined) {
    bodies[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  } else {
    const descriptorId = pageId(pages.length);
    const objects = embeddedFontObjects(font, descriptorId, descriptorId + 1);
    bodies[2] = objects.font;
    bodies[descriptorId - 1] = objects.descriptor;
    bodies[descriptorId] = objects.file;
  }
  const author = info.author === undefined || info.author.trim() === '' ? '' : ` /Author (${pdfString(info.author)})`;
  bodies[3] = `<< /Title (${pdfString(info.title ?? 'Screenplay')})${author} /Producer (${pdfString(info.producer ?? 'Caotang')}) >>`;
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
