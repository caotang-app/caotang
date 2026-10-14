/**
 * Speaker resolution — [dialogue-narrative.md §2.2](../../../docs/architecture/dialogue-narrative.md).
 *
 * A `Name: text` line resolves against the codex's characters, the way a screenplay cue
 * does (screenplay.md §4): by name or alias, through the same canonical form the mention
 * detector uses, so a cue and a mention in the manuscript agree on who is meant. An entry
 * with `caseSensitive` set matches exactly. A container's default speaker is a codex entry
 * id, so it resolves by id.
 */

import { canonical, caseFold } from '@caotang/codex';
import type { CodexEntry } from '@caotang/store';

export type SpeakerResolution =
  | { readonly kind: 'resolved'; readonly entry: CodexEntry }
  | { readonly kind: 'ambiguous'; readonly entries: readonly CodexEntry[] }
  | { readonly kind: 'unknown' };

function keyOf(text: string, caseSensitive: boolean): string {
  const trimmed = canonical(text.trim());
  return caseSensitive ? trimmed : caseFold(trimmed);
}

function matches(entry: CodexEntry, name: string): boolean {
  const wanted = name.trim();
  return [entry.name, ...entry.aliases].some((term) => keyOf(term, entry.caseSensitive) === keyOf(wanted, entry.caseSensitive));
}

/** Resolves a cue name against the codex's characters. Other entry types never speak. */
export function resolveSpeakerName(entries: readonly CodexEntry[], name: string): SpeakerResolution {
  const found = entries.filter((entry) => entry.type === 'character' && matches(entry, name));
  if (found.length === 1 && found[0] !== undefined) return { kind: 'resolved', entry: found[0] };
  if (found.length > 1) return { kind: 'ambiguous', entries: found };
  return { kind: 'unknown' };
}

/** A default speaker: a codex entry id, of any type, as container metadata names it. */
export function resolveSpeakerId(entries: readonly CodexEntry[], id: string): CodexEntry | undefined {
  return entries.find((entry) => entry.id === id);
}
