/**
 * Text normalisation for matching — the one implementation that codex.md §4
 * (mention detection) and agent-harness row 12 (`codex.read`) both call, so a name
 * that matches in the manuscript matches the same way in a codex search.
 *
 * Everything here is locale-independent: `toLowerCase()` with no locale, code-unit
 * comparison, no `Intl`. The same text has to match the same way on every machine,
 * or the §9 detection fixtures stop being stable evidence.
 */

/**
 * Canonical form for matching: Unicode NFC, with typographic apostrophes folded to
 * U+0027. A word processor substitutes these for the straight apostrophe, and a
 * name typed in the codex must still find them in the manuscript.
 *
 * NFC can change length (it composes sequences), so callers never mix indices from
 * the raw string with indices from the canonical one.
 */
export function canonical(text: string): string {
  return text.normalize('NFC').replace(/[‘’ʼ]/g, "'");
}

/**
 * Simple Unicode case folding, length-preserving in UTF-16 code units.
 *
 * Whole-string `toLowerCase()` is the fast path. It changes length only for U+0130
 * (dotted capital I, which lowercases to two code points). U+0130 has no *simple*
 * case fold, so the slow path keeps it as written. Final sigma and long s fold to
 * their base letters (CaseFolding.txt, status C+S). Because the result has the
 * same length as its input, an index found in the folded text is valid in the
 * canonical text, which is what the excerpt windows in `codex.read` need.
 */
export function caseFold(text: string): string {
  const lowered = text.toLowerCase();
  const folded = lowered.length === text.length ? lowered : foldEachCodePoint(text);
  // U+03C2 (final sigma) → U+03C3; U+017F (long s) → s.
  return folded.replace(/ς/g, 'σ').replace(/ſ/g, 's');
}

function foldEachCodePoint(text: string): string {
  return text.replace(/[\s\S]/gu, (ch) => {
    const lower = ch.toLowerCase();
    return lower.length === ch.length ? lower : ch;
  });
}

/**
 * The code points that continue a word for the boundary rule of codex.md §4 rule 2:
 * letters, digits and combining marks. No script is exempt. A Han ideograph, a kana or
 * a Hangul syllable is a letter, so a Latin name next to one is not a whole word: "AI"
 * is not matched inside 我用AI写作, and "Elena" is not matched before the particle in
 * "Elena가". A combining mark belongs to the letter before it, so it is not a boundary
 * either. The spec's wording, "letter-or-digit", leaves marks out. This follows
 * Unicode's word class (UTS #18 `\w`), which includes them.
 */
const WORD_CHAR = /[\p{L}\p{Nd}\p{M}]/u;

/** True when a code point continues a word for the boundary rule (see `WORD_CHAR`). */
export function isWordCodePoint(ch: string): boolean {
  return WORD_CHAR.test(ch);
}

const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * codex.md §4 rule 2: a term made of Latin letters and digits is matched at word
 * boundaries. Spaces and punctuation are neutral, so "Dr. Who", "Room 101" and
 * "AT&T" are Latin too. The spec says "only Latin letters/digits". Read literally,
 * that makes "Dr. Who" and "Jean-Luc" non-Latin, and "Jean-Luc" would then match
 * inside "XJean-Luc". Any letter outside the Latin script makes the term non-Latin,
 * and it then matches as a plain substring. A term with neither a Latin letter nor an
 * ASCII digit (punctuation only) is non-Latin as well.
 */
export function isLatinTerm(term: string): boolean {
  let anchored = false;
  for (const ch of term) {
    if (LETTER.test(ch)) {
      if (!LATIN_LETTER.test(ch)) return false;
      anchored = true;
    } else if (ch >= '0' && ch <= '9') {
      anchored = true;
    }
  }
  return anchored;
}

/** The code point ending at `index` (exclusive), or '' at the string start. */
export function charBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** The code point starting at `index`, or '' past the end. */
export function charAt(text: string, index: number): string {
  const cp = text.codePointAt(index);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * The boundary test for a Latin term occupying `[start, end)`: the neighbour on
 * each side is not a word character (or there is no neighbour).
 */
export function atWordBoundary(text: string, start: number, end: number): boolean {
  const before = charBefore(text, start);
  const after = charAt(text, end);
  return (before === '' || !isWordCodePoint(before)) && (after === '' || !isWordCodePoint(after));
}

/**
 * context-assembly.md §3's estimate, `ceil(chars / 4)`. Budgets and the `codex.read`
 * token cap are enforced on this estimate before the call, and the ledger records
 * real usage afterwards.
 */
export function tokensForChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateTokens(text: string): number {
  return tokensForChars(text.length);
}

/** Code-unit order. Every ordering in this package uses it, so no result depends on a locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
