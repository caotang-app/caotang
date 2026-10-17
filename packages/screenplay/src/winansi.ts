/**
 * The characters Courier Prime prints: the WinAnsi encoding the screenplay PDF sets it in ([screenplay.md §5.3](../../../docs/architecture/screenplay.md)).
 * Its own module so the width rule (width.ts) and the writer (pdf.ts) read the same test.
 */

/** Characters WinAnsi encodes above 0x7F that the Latin-1 range does not cover. */
export const WIN_ANSI_EXTRA: Readonly<Record<string, number>> = {
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

