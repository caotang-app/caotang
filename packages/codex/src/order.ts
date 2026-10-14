/**
 * The deterministic codex order — [codex.md §6](../../../docs/architecture/codex.md)
 * step 3: `always` first, then `type` in enum order, then `name` case-insensitively.
 *
 * Insertion order is not part of the key. Two projects with the same entries in a
 * different order assemble the same bytes, which is what makes the §9 evals stable.
 * `codex.read` uses the same order for its result list, so the agent and the
 * assembler see one ordering.
 */

import type { CodexEntry } from '@caotang/store';
import { caseFold, canonical, compareText } from './text.js';

/**
 * codex.md §2's closed `type` enum, in the order §6 sorts by. It mirrors
 * `CODEX_TYPES` in `@caotang/store`. A test asserts the two lists are equal, so a
 * change on either side fails in one place.
 */
export const CODEX_TYPE_ORDER: readonly string[] = ['character', 'location', 'object', 'lore', 'subplot', 'other'];

interface SortKey {
  /** 0 for `always`, 1 for everything else. */
  readonly always: 0 | 1;
  /** Index in `CODEX_TYPE_ORDER`. Unknown types all rank after the last member. */
  readonly type: number;
  /** Only for unknown types: they follow the known ones, ordered by their text. */
  readonly unknownType: string;
  /** Case-folded name, the case-insensitive comparison. */
  readonly name: string;
  readonly id: string;
}

function keyOf(entry: CodexEntry): SortKey {
  const rank = CODEX_TYPE_ORDER.indexOf(entry.type);
  return {
    always: entry.includePolicy === 'always' ? 0 : 1,
    type: rank === -1 ? CODEX_TYPE_ORDER.length : rank,
    unknownType: rank === -1 ? entry.type : '',
    name: caseFold(canonical(entry.name)),
    id: entry.id,
  };
}

function compareKeys(a: SortKey, b: SortKey): number {
  return (
    a.always - b.always ||
    a.type - b.type ||
    compareText(a.unknownType, b.unknownType) ||
    compareText(a.name, b.name) ||
    // Names are unique case-insensitively only after load-time validation, and a
    // duplicate is kept (§2). The id makes the order total when two names collide.
    compareText(a.id, b.id)
  );
}

/** The codex.md §6 comparator. Entries of equal key are ordered by id. */
export function compareCodex(a: CodexEntry, b: CodexEntry): number {
  return compareKeys(keyOf(a), keyOf(b));
}

/** A copy of `entries` in the codex order. The input is not mutated. */
export function sortCodex<T extends CodexEntry>(entries: readonly T[]): T[] {
  return entries
    .map((entry) => ({ entry, key: keyOf(entry) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ entry }) => entry);
}
