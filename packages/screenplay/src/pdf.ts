/**
 * A minimal PDF writer for the paginated screenplay ([screenplay.md §5.3](../../../docs/architecture/screenplay.md)).
 *
 * One uncompressed content stream per page, one font in WinAnsi encoding, and, for a script with
 * other characters, one fallback font. Caotang owns it for the same reason it owns the EPUB
 * emitter (exporter.md §3a): a dormant dependency costs more than a few hundred lines of
 * frozen-format output. The one library the writer leans on, @pdf-lib/fontkit, cuts the fallback
 * subset, and is loaded only when a script needs it.
 *
 * The font is Courier Prime (A3), embedded whole as a TrueType font program (`FontFile2`),
 * when the caller passes its bytes. The exporter always does. Without them the page names the
 * base-14 Courier, which every viewer has; Courier Prime has Courier's metrics, so the layout
 * is the same either way.
 *
 * Characters WinAnsi cannot encode are printed in a second font when the caller passes one: the CJK fallback, a
 * subset of Noto Sans Mono CJK SC cut for the document (cjk-font.ts), embedded as a Type 0 font with a CIDFontType0
 * descendant (`FontFile3`, `CIDFontType0C`), `Identity-H` and a `ToUnicode` map, so the text can be copied and searched.
 * Each fallback glyph starts at its grid cell and advances the cell's width: two columns for a CJK character
 * (width.ts). The glyph is drawn from the cell's left edge, so the text extracts with no gaps between characters. A line with no such
 * character is written exactly as it was before the fallback existed, and a document with none has no second font.
 *
 * Every byte is ASCII. Strings are escaped on the way in and the font program is written in
 * hexadecimal (`ASCIIHexDecode`), so the object offsets the xref table records are string
 * offsets, and the tests can check them exactly.
 */

import { COURIER_PRIME_METRICS } from './fonts/courier-prime-metrics.js';
import { LAYOUT } from './paginate.js';
import { charColumns } from './width.js';

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

/** One glyph of the fallback subset. */
export interface PdfCidGlyph {
  /** The glyph's CID in the subset, which is also its code in the content stream (Identity-H). */
  readonly cid: number;
  /** The advance the PDF states, in glyph space: the character's grid cell, 600 a column. */
  readonly width: number;
}

/** A CID-keyed CFF subset to print the characters WinAnsi cannot encode (cjk-font.ts cuts it). */
export interface PdfCidFont {
  /** The subset's name: a six-letter tag, a plus, the PostScript name. */
  readonly baseFont: string;
  /** The bare CFF font program, CIDs numbered from 1. */
  readonly program: Uint8Array;
  /** The glyph each character the subset prints is drawn with. */
  readonly glyphs: ReadonlyMap<string, PdfCidGlyph>;
  /** The stated width of CID 1, 2, … in order. */
  readonly widths: readonly number[];
  readonly bbox: readonly [number, number, number, number];
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
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

function contentStream(lines: readonly PdfText[], fallback?: PdfCidFont): string {
  const parts = ['BT', '/F1 12 Tf'];
  let current = 'F1';
  const setFont = (name: string): void => {
    if (current !== name) parts.push(`/${name} 12 Tf`);
    current = name;
  };
  for (const line of lines) {
    const y = num(LAYOUT.pageHeight - line.y);
    if (fallback === undefined || ![...line.text].some((ch) => fallback.glyphs.has(ch))) {
      setFont('F1');
      parts.push(`1 0 0 1 ${num(line.x)} ${y} Tm`, `(${pdfString(line.text)}) Tj`);
      continue;
    }
    // A line with fallback glyphs is written as runs, each placed at its first character's column.
    for (const run of runsOf(line.text, fallback)) {
      parts.push(`1 0 0 1 ${num(line.x + run.column * LAYOUT.charWidth)} ${y} Tm`);
      if (run.glyphs === null) {
        setFont('F1');
        parts.push(`(${pdfString(run.text)}) Tj`);
      } else {
        setFont('F2');
        parts.push(`${cidString(run.glyphs)} Tj`);
      }
    }
  }
  parts.push('ET');
  return parts.join('\n');
}

interface Run {
  readonly column: number;
  readonly text: string;
  /** The fallback glyphs, or null for a run in the base font. */
  readonly glyphs: PdfCidGlyph[] | null;
}

/** A line cut into runs of base-font text and fallback glyphs, each with the grid column it starts at. */
function runsOf(text: string, fallback: PdfCidFont): Run[] {
  const runs: { column: number; text: string; glyphs: PdfCidGlyph[] | null }[] = [];
  let column = 0;
  for (const ch of text) {
    const glyph = isPrintable(ch) ? undefined : fallback.glyphs.get(ch);
    const last = runs[runs.length - 1];
    if (glyph === undefined) {
      if (last !== undefined && last.glyphs === null) last.text += ch;
      else runs.push({ column, text: ch, glyphs: null });
    } else if (last !== undefined && last.glyphs !== null) {
      last.text += ch;
      last.glyphs.push(glyph);
    } else {
      runs.push({ column, text: ch, glyphs: [glyph] });
    }
    column += charColumns(ch);
  }
  return runs;
}

/** A hexadecimal string of fallback glyph codes, two bytes each (Identity-H). */
function cidString(glyphs: readonly PdfCidGlyph[]): string {
  return `<${glyphs.map((glyph) => glyph.cid.toString(16).toUpperCase().padStart(4, '0')).join('')}>`;
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

/** UTF-16BE hex of one character, as a ToUnicode map and a text string write it. */
function utf16Hex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return out;
}

/** The ToUnicode CMap (PDF 1.7 §9.10.3): each fallback CID back to its character, so the text extracts. */
function toUnicodeCMap(fallback: PdfCidFont): string {
  const pairs = [...fallback.glyphs.entries()]
    .map(([ch, glyph]) => [glyph.cid, ch] as const)
    .sort((a, b) => a[0] - b[0])
    .filter(([cid], i, all) => i === 0 || all[i - 1]?.[0] !== cid);
  const blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk.map(([cid, ch]) => `<${cid.toString(16).toUpperCase().padStart(4, '0')}> <${utf16Hex(ch)}>`).join('\n')}\nendbfchar`,
    );
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** The five objects of the fallback font: the Type 0 font, its CIDFontType0 descendant, the descriptor, the program, the ToUnicode map. */
function fallbackFontObjects(fallback: PdfCidFont, first: number): string[] {
  const [cidId, descriptorId, fileId, mapId] = [first + 1, first + 2, first + 3, first + 4];
  const program = hex(fallback.program);
  const map = toUnicodeCMap(fallback);
  return [
    `<< /Type /Font /Subtype /Type0 /BaseFont /${fallback.baseFont} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${mapId} 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${fallback.baseFont} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R ` +
      `/DW 1000 /W [1 [${fallback.widths.join(' ')}]] >>`,
    `<< /Type /FontDescriptor /FontName /${fallback.baseFont} /Flags 4 /FontBBox [${fallback.bbox.join(' ')}] /ItalicAngle 0 ` +
      `/Ascent ${fallback.ascent} /Descent ${fallback.descent} /CapHeight ${fallback.capHeight} /StemV 80 /FontFile3 ${fileId} 0 R >>`,
    `<< /Subtype /CIDFontType0C /Length ${program.length} /Filter /ASCIIHexDecode >>\nstream\n${program}\nendstream`,
    `<< /Length ${map.length} >>\nstream\n${map}\nendstream`,
  ];
}

/** An info-dictionary string: a literal in WinAnsi when every character is printable, UTF-16BE with a byte order mark otherwise. */
function infoString(text: string): string {
  if ([...text].every(isPrintable)) return `(${pdfString(text)})`;
  return `<FEFF${utf16Hex(text)}>`;
}

/**
 * Writes one PDF from pages of positioned text. Object 1 is the catalogue, 2 the page tree,
 * 3 the font, 4 the info dictionary. Each page then takes two objects: the page, and its
 * content stream. An embedded font adds its descriptor and its program after the pages, and a fallback font that
 * prints at least one character adds its five objects after those. Every page names both fonts then.
 */
export function writePdf(
  pages: readonly (readonly PdfText[])[],
  info: PdfInfo = {},
  font?: PdfFont,
  cjk?: PdfCidFont,
): Uint8Array<ArrayBuffer> {
  const fallback = cjk === undefined || cjk.glyphs.size === 0 ? undefined : cjk;
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
  const fallbackId = pageId(pages.length) + (font === undefined ? 0 : 2);
  if (fallback !== undefined) {
    fallbackFontObjects(fallback, fallbackId).forEach((body, i) => {
      bodies[fallbackId - 1 + i] = body;
    });
  }
  const fonts = fallback === undefined ? '/F1 3 0 R' : `/F1 3 0 R /F2 ${fallbackId} 0 R`;
  const author = info.author === undefined || info.author.trim() === '' ? '' : ` /Author ${infoString(info.author)}`;
  bodies[3] = `<< /Title ${infoString(info.title ?? 'Screenplay')}${author} /Producer ${infoString(info.producer ?? 'Caotang')} >>`;
  pages.forEach((lines, i) => {
    const stream = contentStream(lines, fallback);
    bodies[pageId(i) - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LAYOUT.pageWidth} ${LAYOUT.pageHeight}] ` +
      `/Resources << /Font << ${fonts} >> >> /Contents ${pageId(i) + 1} 0 R >>`;
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
