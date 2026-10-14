/**
 * Text made safe for an XML part — the one sanitizer both XML renderers use.
 *
 * Escaping the five markup characters is not enough for XML 1.0. The format also
 * forbids a set of control code points outright, escaped or not, and a manuscript
 * can carry them: text copied out of a PDF or a plain-text source often does. A DOCX
 * or EPUB part holding one fails strict parsing, so the artifact is unreadable for a
 * reason the author never sees. The DOCX and EPUB writers each run their text through
 * {@link stripXmlIllegal} before any XML writer receives it (exporter.md §3, §3a).
 *
 * Tab, line feed and carriage return are legal and kept. Lone surrogates are not
 * listed here: every encoder the renderers use writes one as U+FFFD, which is legal.
 */

// The XML 1.0 `Char` production (§2.2), inverted: the code points a document may not carry.
// eslint-disable-next-line no-control-regex -- these control characters are the set XML forbids, which is the point of the rule
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** The text with every code point XML 1.0 forbids removed. It does not escape anything; see `escapeXml`. */
export function stripXmlIllegal(text: string): string {
  return text.replace(XML_FORBIDDEN, '');
}
