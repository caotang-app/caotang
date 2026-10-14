/**
 * Character cues as mention and consistency inputs — [screenplay.md §4](../../../docs/architecture/screenplay.md).
 *
 * These are pure functions over the parse output. The mention index consumes the names
 * (a cue is a detection term), and the `script.cue-consistency` check consumes the spelling
 * groups. Neither changes what is stored, and neither calls a model.
 */

import { cueBaseName } from './classify.js';
import type { ScreenplayElement } from './types.js';

/** Character names as cued, extensions and dual markers removed, in first-seen order, deduplicated. */
export function characterCueNames(elements: readonly ScreenplayElement[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const el of elements) {
    if (el.type !== 'character') continue;
    const name = cueBaseName(el.text);
    if (name !== '' && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** The comparison key for a cue: upper case, punctuation dropped, spaces collapsed. `MR. SMITH` and `MR SMITH` share one. */
export function cueKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CueSpellingGroup {
  readonly key: string;
  /** Two or more spellings of the same character, in first-seen order. */
  readonly spellings: readonly string[];
}

/** Cue names that refer to one character but are spelled more than one way (script.cue-consistency). */
export function cueSpellingGroups(elements: readonly ScreenplayElement[]): CueSpellingGroup[] {
  const byKey = new Map<string, string[]>();
  for (const name of characterCueNames(elements)) {
    const key = cueKey(name);
    const spellings = byKey.get(key) ?? [];
    if (!spellings.includes(name)) spellings.push(name);
    byKey.set(key, spellings);
  }
  const groups: CueSpellingGroup[] = [];
  for (const [key, spellings] of byKey) {
    if (spellings.length > 1) groups.push({ key, spellings });
  }
  return groups;
}
