/**
 * The detection fixture corpus — codex.md §9's "detection unit fixtures": boundary
 * cases (Latin vs CJK), case sensitivity, exclusions, plural rejection, punctuation and
 * apostrophes, overlapping names (longest match), and K6.
 *
 * Each row is one headless test. `expect` gives the surviving count per entry name,
 * and an entry not listed expects 0. The expectations were worked out from the rules
 * in codex.md §4, row by row, and are not copied from the engine's output. Rule 2 is
 * applied as the spec words it, plus two readings the spec does not state outright: a
 * combining mark is a word character (it belongs to the letter before it), and spaces
 * and punctuation do not make a term non-Latin, so "Dr. Who" is bounded. A row that
 * fails is a question for the rule, not a reason to edit the number.
 */

import type { CodexEntry } from '@caotang/store';

/** A codex entry with the manifest's shape and benign defaults. Its id is derived from its name. */
export function entry(name: string, overrides: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id: `c_${name}`,
    name,
    aliases: [],
    type: 'character',
    description: `About ${name}.`,
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    ...overrides,
  };
}

export type DetectionSection =
  | 'latin-boundary'
  | 'cjk'
  | 'case'
  | 'exclusion'
  | 'k6'
  | 'plural'
  | 'punctuation'
  | 'overlap'
  | 'counting';

export interface DetectionRow {
  readonly section: DetectionSection;
  readonly label: string;
  readonly entries: readonly CodexEntry[];
  readonly text: string;
  /** Surviving count per entry name. An entry not listed expects 0. */
  readonly expect: Readonly<Record<string, number>>;
}

function row(
  section: DetectionSection,
  label: string,
  entries: readonly CodexEntry[],
  text: string,
  expect: Readonly<Record<string, number>>,
): DetectionRow {
  return { section, label, entries, text, expect };
}

export const DETECTION_ROWS: readonly DetectionRow[] = [
  // --- Latin word boundaries (§4 rule 2) -----------------------------------------
  row('latin-boundary', 'a name inside a longer word does not match', [entry('Ann')], 'Anna walked in.', {}),
  row('latin-boundary', 'a name is matched as a whole word', [entry('Ann')], 'Ann walked in.', { Ann: 1 }),
  row('latin-boundary', 'a name at both string edges matches', [entry('Ann')], 'Ann', { Ann: 1 }),
  row('latin-boundary', 'punctuation is a boundary on both sides', [entry('Ann')], 'Ann, Ann. (Ann)!', { Ann: 3 }),
  row('latin-boundary', 'a letter before or after blocks the match', [entry('Ann')], 'Annabel and xAnn', {}),
  row('latin-boundary', 'a digit before or after blocks the match', [entry('Ann')], 'Ann2 and 2Ann', {}),
  row('latin-boundary', 'a multi-word name keeps its end boundary', [entry('Dr Who')], 'Dr Whoa, then Dr Who.', {
    'Dr Who': 1,
  }),
  row('latin-boundary', 'digits inside a name are matched whole', [entry('Room 101')], 'Room 1012 and Room 101.', {
    'Room 101': 1,
  }),
  row('latin-boundary', 'an all-digit name is bounded like any other', [entry('1984')], '19845 and in 1984.', {
    '1984': 1,
  }),
  row('latin-boundary', 'accented Latin letters are word characters', [entry('Élodie')], 'Élodies and Élodie.', {
    Élodie: 1,
  }),
  // U+0331 has no precomposed form with 'a', so NFC leaves it in place. Had the row used
  // U+0301, NFC would fold it into a-acute and the term would never occur.
  row('latin-boundary', 'a combining mark after the last letter stops the match', [entry('Elena')], 'Elena\u0331 arrived.', {}),
  row('latin-boundary', 'a combining mark before the first letter stops the match', [entry('Elena')], '\u0331Elena arrived.', {}),
  row('latin-boundary', 'a hyphen is a boundary inside and around a name', [entry('Jean-Luc')], 'Jean-Luc, not XJean-Luc.', {
    'Jean-Luc': 1,
  }),
  row('latin-boundary', 'an acronym inside an all-caps word does not match', [entry('AI')], 'AIs and AI.', { AI: 1 }),

  // --- Latin against CJK and other scripts (§4 rule 2, non-Latin substring) -----
  row('cjk', 'a CJK name matches as a plain substring', [entry('艾琳')], '艾琳娜走了。', { 艾琳: 1 }),
  row('cjk', 'a CJK name needs no boundary inside running text', [entry('艾琳')], '我见到了艾琳。', { 艾琳: 1 }),
  row('cjk', 'every CJK occurrence counts', [entry('李')], '李白李明', { 李: 2 }),
  row('cjk', 'a Latin name next to CJK letters is not bounded by them', [entry('AI')], '我用AI写作', {}),
  row('cjk', 'a Latin name between CJK brackets is bounded by them', [entry('AI')], '「AI」写了。', { AI: 1 }),
  row('cjk', 'a Latin name next to CJK still stops at a Latin letter', [entry('AI')], '用AIs写', {}),
  row('cjk', 'a Korean particle attached to a Latin name blocks the match', [entry('Elena')], 'Elena가 왔다.', {}),
  row('cjk', 'a Japanese particle attached to a Latin name blocks the match', [entry('Elena')], 'Elenaは笑った。', {}),
  row('cjk', 'a Cyrillic name matches inside an inflected form', [entry('Иван')], 'Иванов пришёл.', { Иван: 1 }),
  row('cjk', 'a Latin name does not match inside a longer Cyrillic word', [entry('Ivan')], 'Ivanов пришёл.', {}),
  row('cjk', 'a mixed Latin and CJK name is a plain substring', [entry('Elena艾')], 'Elena艾琳 and xElena艾.', {
    'Elena艾': 2,
  }),
  row('cjk', 'a fullwidth comma separates two Latin words', [entry('Ann')], 'Ann，Bob.', { Ann: 1 }),

  // --- Case (§4 rule 3) ----------------------------------------------------------
  row('case', 'default matching ignores case', [entry('Elena')], 'ELENA and elena', { Elena: 2 }),
  row('case', 'a case-sensitive name matches exact case only', [entry('Will', { caseSensitive: true })], 'Will, will and WILL.', {
    Will: 1,
  }),
  row('case', 'a case-sensitive name still applies the boundary rule', [entry('Will', { caseSensitive: true })], 'Willow and Will.', {
    Will: 1,
  }),
  row('case', 'Greek capitals fold to lowercase, final sigma included', [entry('Οδυσσεύς')], 'ΟΔΥΣΣΕΎΣ', {
    Οδυσσεύς: 1,
  }),
  row('case', 'a German sharp s does not fold to ss', [entry('Straße')], 'STRASSE', {}),
  row('case', 'accented capitals fold to accented lowercase', [entry('élodie')], 'ÉLODIE', { élodie: 1 }),
  row('case', 'a dotted capital I has no simple case fold', [entry('istanbul')], 'İstanbul', {}),
  row('case', 'alias matching ignores case', [entry('Elizabeth', { aliases: ['Liz'] })], 'LIZ and liz', {
    Elizabeth: 2,
  }),

  // --- Exclusions (§4 rule 4) ----------------------------------------------------
  row('exclusion', 'an exclude phrase suppresses the match inside it', [entry('Will', { exclude: ['Will you'] })], 'Will you come?', {}),
  row('exclusion', 'a match outside the exclude phrase still counts', [entry('Will', { exclude: ['Will you'] })], 'Will you come? Will Smith arrived.', {
    Will: 1,
  }),
  row('exclusion', 'an exclude phrase is case-insensitive for a case-insensitive entry', [entry('Will', { exclude: ['will you'] })], 'WILL YOU go', {}),
  row('exclusion', 'an exclude phrase follows the entry case mode', [entry('Will', { caseSensitive: true, exclude: ['will you'] })], 'Will you go', {
    Will: 1,
  }),
  row('exclusion', 'an exclude phrase must cover the match wholly', [entry('Ann Smith', { exclude: ['Smith Jr'] })], 'Ann Smith Jr.', {
    'Ann Smith': 1,
  }),
  row('exclusion', 'an exclude phrase belongs to its own entry only', [entry('Lee', { exclude: ['Lee Harvey'] }), entry('Harvey')], 'Lee Harvey', {
    Harvey: 1,
  }),

  // --- K6: exclusion is judged at each match site (codex.md §10 K6) -------------
  row('k6', 'an exclude phrase elsewhere in the document does not silence a distant hit', [entry('Will', { exclude: ['Will you'] })], 'Will you go. Later Will Smith came, and Will you agreed.', {
    Will: 1,
  }),
  row('k6', 'an exclude term present but unrelated leaves the hit', [entry('Ann', { exclude: ['Annie'] })], 'Annie came. Ann left.', {
    Ann: 1,
  }),
  row('k6', 'an exclude phrase in another paragraph does not suppress', [entry('Lord Varn', { exclude: ['Lord Varnish'] })], 'Lord Varn sighed.\n\nThe Lord Varnish sale.', {
    'Lord Varn': 1,
  }),
  row('k6', 'the only site of an exclude phrase is suppressed', [entry('Elena', { exclude: ["Elena's dog"] })], "Elena's dog barked.", {}),
  row('k6', 'each site is judged on its own surroundings', [entry('Elena', { exclude: ["Elena's dog"] })], "Elena's dog barked. Elena walked in. Elena's dog again.", {
    Elena: 1,
  }),

  // --- Plural rejection (§4 rule 5) ----------------------------------------------
  row('plural', 'a plural of a name is not matched', [entry('Goblin')], 'goblins attacked', {}),
  row('plural', 'an irregular plural is not matched', [entry('Wolf')], 'wolves', {}),
  row('plural', 'a plural matches once it is added as an alias', [entry('Goblin', { aliases: ['Goblins'] })], 'goblins and goblin', {
    Goblin: 2,
  }),
  row('plural', 'a plural of a multi-word name is not matched', [entry('Dr Who')], 'Dr Whos', {}),

  // --- Punctuation and apostrophes -----------------------------------------------
  row('punctuation', 'a straight apostrophe inside a name matches', [entry("O'Brien")], "O'Brien spoke.", {
    "O'Brien": 1,
  }),
  row('punctuation', 'a typographic apostrophe in the text folds to the straight one', [entry("O'Brien")], 'O’Brien spoke.', {
    "O'Brien": 1,
  }),
  row('punctuation', 'a typographic apostrophe in the name folds too', [entry('O’Brien')], "O'Brien spoke.", {
    'O’Brien': 1,
  }),
  row('punctuation', "a possessive 's is a boundary, not a plural", [entry('Elena')], "Elena's", { Elena: 1 }),
  row('punctuation', "an apostrophe-s after a multi-word name is a boundary", [entry('Ann Lee')], "Ann Lee's cat", {
    'Ann Lee': 1,
  }),
  row('punctuation', 'a period inside a name is matched literally', [entry('Dr. Who')], 'Dr. Who.', {
    'Dr. Who': 1,
  }),
  row('punctuation', 'a hyphen is not folded to a space', [entry('Jean-Luc')], 'Jean Luc', {}),
  row('punctuation', 'curly quotes and em dashes are boundaries', [entry('Ann')], '“Ann”—Ann—ann', {
    Ann: 3,
  }),
  row('punctuation', 'whitespace inside a name is significant', [entry('Dr Who')], 'Dr  Who', {}),

  // --- Overlapping names: leftmost-longest (§4 rule 6) ---------------------------
  row('overlap', 'a longer name wins over its own prefix name', [entry('Ann'), entry('Ann Smith')], 'Ann Smith arrived. Ann left.', {
    Ann: 1,
    'Ann Smith': 1,
  }),
  row('overlap', 'a shorter name inside a longer one is suppressed', [entry('Smith'), entry('Ann Smith')], 'Ann Smith', {
    'Ann Smith': 1,
  }),
  row('overlap', 'an alias longer than the name is one occurrence', [entry('Ann', { aliases: ['Ann Smith'] })], 'Ann Smith', {
    Ann: 1,
  }),
  row('overlap', 'a name beats an alias when two entries claim one span', [entry('Lee'), entry('Harvey', { aliases: ['Lee'] })], 'Lee', {
    Lee: 1,
  }),
  row('overlap', 'leftmost-longest: the earlier term wins a chain of overlaps', [entry('Dr Ann'), entry('Ann Smith')], 'Dr Ann Smith', {
    'Dr Ann': 1,
  }),
  row('overlap', 'adjacent names that do not overlap both count', [entry('Ann'), entry('Bob')], 'Ann Bob', {
    Ann: 1,
    Bob: 1,
  }),
  row('overlap', 'a longer CJK name wins over its prefix', [entry('艾琳'), entry('艾琳娜')], '艾琳娜', {
    艾琳娜: 1,
  }),
  row('overlap', 'overlapping occurrences of one term form one run', [entry('李李')], '李李李', {
    李李: 1,
  }),

  // --- Counting ------------------------------------------------------------------
  row('counting', 'repeated occurrences all count', [entry('Elena')], 'Elena. Elena. Elena', { Elena: 3 }),
  row('counting', 'a name and an alias that fold to one needle count once per site', [entry('Elena', { aliases: ['elena'] })], 'Elena', {
    Elena: 1,
  }),
  row('counting', 'surrounding whitespace in a name is trimmed', [entry('  Elena  ')], 'Elena', {
    '  Elena  ': 1,
  }),
  row('counting', 'empty text yields no hits', [entry('Elena')], '', {}),
  row('counting', 'an entry with no usable term never matches', [entry('   ')], 'anything at all', {}),
];
