/**
 * Screenplay cue names as mention terms — [screenplay.md §4](../../../docs/architecture/screenplay.md), codex.md §4.
 *
 * A character's cue in a screenplay is a mention of its entry. A cue can be spelled differently from the entry's name
 * (`MR. SMITH` against `Mr Smith`), and the detector matches the spelling it is given, so the cue's own spelling is a term
 * of its entry in that one document. The parse layer names the cues; this module resolves each cue to the entry it names
 * and returns the spellings as document terms. The detector then counts them itself (`scanMentions`), so nothing merges
 * a cue count into the detector's count afterwards.
 *
 * A cue that names no entry, or names two equally, adds nothing: the cue-collision check reports it (coherence.md §5.1).
 * Nothing here calls a model or writes anything.
 */

import { characterCueNames, cueKey, isScreenplayKind, normaliseSource, parseFountain } from '@caotang/screenplay';
import type { CodexEntry } from '@caotang/store';

import type { DocumentTerm } from './detect.js';
import { canonical, caseFold } from './text.js';

/** A codex entry's own spellings: its name, then its aliases. */
function spellingsOf(entry: CodexEntry): readonly string[] {
  return [entry.name, ...(entry.aliases ?? [])];
}

/** The case-folded form a spelling is matched by, as the detector normalises an entry's terms. */
function foldedOf(text: string): string {
  return caseFold(canonical(text).trim());
}

/**
 * The codex entry a cue names. An exact spelling wins, when exactly one entry holds it. Failing that, a cue matches an entry
 * when the two agree once punctuation and case are dropped, and only when that is one entry, so an ambiguous cue names none.
 */
export function entryForCue(entries: readonly CodexEntry[], name: string): CodexEntry | undefined {
  const folded = foldedOf(name);
  if (folded === '') return undefined;
  const exact = entries.filter((entry) => spellingsOf(entry).some((spelling) => foldedOf(spelling) === folded));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const key = cueKey(name);
  if (key === '') return undefined;
  const byKey = entries.filter((entry) => spellingsOf(entry).some((spelling) => cueKey(spelling) === key));
  return byKey.length === 1 ? byKey[0] : undefined;
}

/**
 * The cue terms one document adds to the detection: each character cue that names an entry, as a term of that entry, in the
 * entry's own case mode. Empty for a document that is not a screenplay, so every other document is detected as it always was.
 */
export function cueTermsOf(kind: string | undefined, body: string, entries: readonly CodexEntry[]): readonly DocumentTerm[] {
  if (!isScreenplayKind(kind) || entries.length === 0) return [];
  const names = characterCueNames(parseFountain(normaliseSource(body)).elements);
  const terms: DocumentTerm[] = [];
  for (const name of names) {
    const entry = entryForCue(entries, name);
    if (entry !== undefined) terms.push({ entryId: entry.id, text: name, caseSensitive: entry.caseSensitive === true });
  }
  return terms;
}
