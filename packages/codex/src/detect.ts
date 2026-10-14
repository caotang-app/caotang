/**
 * Mention detection — [codex.md §4](../../../docs/architecture/codex.md).
 *
 * A pure function of (texts, entries). It is headless on purpose (ARCHITECTURE
 * §1.6): the same engine serves the per-document cache (`MentionIndex`), the
 * assembly-time scan of the instruction and selection, and the evals.
 *
 * The rules, as implemented here:
 *
 * 1. Terms are `name` plus `aliases`, matched per term. Each term is one search
 *    needle; an entry whose name and alias fold to the same needle has one term.
 * 2. A Latin term (see `isLatinTerm`) matches only where its neighbours are not
 *    word characters. A non-Latin term matches as a plain substring.
 * 3. Case is folded by default. An entry with `caseSensitive: true` matches exact
 *    case. Both modes still apply the boundary rule.
 * 4. Exclusion phrases (`exclude`) are matched with the entry's own case mode and
 *    boundary rule. A term occurrence lying wholly inside an exclusion occurrence
 *    is dropped. Other occurrences of the same term are judged on their own (K6).
 * 5. Plurals are not generated. "Goblin" does not match "Goblins" unless "Goblins"
 *    is an alias, which follows from rule 2.
 * 6. Overlaps resolve leftmost-longest. An occurrence that starts inside an
 *    accepted one is dropped, so "Ann" does not also count inside "Ann Smith".
 *    Two entries claiming the exact same span resolve to the name over an alias,
 *    then to the lower entry id.
 */

import type { CodexEntry } from '@caotang/store';
import { atWordBoundary, canonical, caseFold, compareText, isLatinTerm } from './text.js';

/** One text to scan: a document body, the instruction, or the selection. */
export interface DetectionDoc {
  /** Reported back in `DetectionHit.where`. Documents use their node id. */
  readonly id: string;
  readonly text: string;
  /** The spellings this text adds to the codex's own, such as a screenplay's cue names (cues.ts). Absent for none. */
  readonly terms?: readonly DocumentTerm[];
}

/**
 * A spelling one text adds for one entry, beyond the entry's name and aliases (screenplay.md §4: a cue is a mention). It is
 * matched as the entry's own terms are: the same case mode, the same boundary rule, and the same exclusions.
 */
export interface DocumentTerm {
  readonly entryId: string;
  readonly text: string;
  /** The entry's case mode, which the spelling is matched by. */
  readonly caseSensitive?: boolean;
}

export interface DetectionHit {
  /** Surviving occurrences across all scanned texts. */
  readonly count: number;
  /** Ids of the texts that held at least one surviving occurrence, in input order. */
  readonly where: readonly string[];
}

/** Entry id → hit. An entry with no surviving occurrence is absent. */
export type DetectionResult = ReadonlyMap<string, DetectionHit>;

/** A needle to search for, normalised once per entry. */
export interface Phrase {
  readonly entryId: string;
  /** Canonical text for case-sensitive entries; case-folded text otherwise. */
  readonly value: string;
  readonly caseSensitive: boolean;
  /** Rule 2: whether the boundary rule applies. */
  readonly latin: boolean;
}

export interface Term extends Phrase {
  /** 0 for the name, 1 for an alias. */
  readonly priority: 0 | 1;
}

/** The normalised terms and exclusion phrases of a codex, built once per codex revision. */
export interface CompiledCodex {
  readonly terms: readonly Term[];
  readonly exclusions: readonly Phrase[];
}

/** Both matching forms of one text. Indices in each form are valid for that form only. */
interface Surfaces {
  readonly canon: string;
  readonly folded: string;
}

interface Match {
  readonly entryId: string;
  readonly start: number;
  readonly end: number;
  readonly priority: 0 | 1;
}

/** Normalise an entry's name, alias or exclusion phrase into its search needle. */
function needleOf(raw: string, caseSensitive: boolean): string {
  const form = canonical(raw).trim();
  return caseSensitive ? form : caseFold(form);
}

/**
 * Normalise a codex once. Entries of every policy are compiled, because the
 * mention counts shown in the codex panel do not depend on the include policy.
 * Policy is applied later, in candidate selection.
 */
export function compileCodex(entries: readonly CodexEntry[]): CompiledCodex {
  const terms: Term[] = [];
  const exclusions: Phrase[] = [];
  for (const entry of entries) {
    const caseSensitive = entry.caseSensitive === true;

    // Name and aliases that fold to one needle become one term, and the name's
    // priority wins. Two terms with the same needle would only double-count a site.
    const byNeedle = new Map<string, 0 | 1>();
    const addTerm = (raw: string, priority: 0 | 1): void => {
      const value = needleOf(raw, caseSensitive);
      if (value === '') return;
      const prior = byNeedle.get(value);
      if (prior === undefined || priority < prior) byNeedle.set(value, priority);
    };
    addTerm(entry.name, 0);
    for (const alias of entry.aliases ?? []) addTerm(alias, 1);
    for (const [value, priority] of byNeedle) {
      terms.push({ entryId: entry.id, value, caseSensitive, latin: isLatinTerm(value), priority });
    }

    const phrases = new Set<string>();
    for (const phrase of entry.exclude ?? []) {
      const value = needleOf(phrase, caseSensitive);
      if (value !== '') phrases.add(value);
    }
    for (const value of phrases) {
      exclusions.push({ entryId: entry.id, value, caseSensitive, latin: isLatinTerm(value) });
    }
  }
  return { terms, exclusions };
}

function surfacesOf(text: string): Surfaces {
  const canon = canonical(text);
  return { canon, folded: caseFold(canon) };
}

function haystackFor(surfaces: Surfaces, phrase: Phrase): string {
  return phrase.caseSensitive ? surfaces.canon : surfaces.folded;
}

/** Start offsets of `needle` in `haystack`. Overlapping occurrences are all reported. */
function occurrencesOf(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    starts.push(at);
  }
  return starts;
}

/** The spans of a phrase in one text, after its boundary rule. */
function spansOf(surfaces: Surfaces, phrase: Phrase): Array<readonly [number, number]> {
  const haystack = haystackFor(surfaces, phrase);
  const spans: Array<readonly [number, number]> = [];
  for (const start of occurrencesOf(haystack, phrase.value)) {
    const end = start + phrase.value.length;
    if (phrase.latin && !atWordBoundary(haystack, start, end)) continue;
    spans.push([start, end]);
  }
  return spans;
}

/** Earlier start first; at one start, the longer span first; then priority, then id. */
function byReach(a: Match, b: Match): number {
  return a.start - b.start || b.end - a.end || a.priority - b.priority || compareText(a.entryId, b.entryId);
}

/**
 * Mention counts for one text: entry id → surviving occurrences. This is the core of
 * `detect`, and the per-document cache stores its output. `terms` are the spellings this text adds (`DocumentTerm`).
 */
export function countMentions(text: string, compiled: CompiledCodex, terms: readonly DocumentTerm[] = []): Map<string, number> {
  return scanMentions(text, compiled, terms).counts;
}

/**
 * The matching terms of one text: the codex's, and the spellings the text adds, normalised as the codex's are. A spelling
 * that repeats an entry's own term, or is empty once normalised, adds nothing.
 */
function termsFor(compiled: CompiledCodex, extra: readonly DocumentTerm[]): readonly Term[] {
  if (extra.length === 0) return compiled.terms;
  const seen = new Set<string>();
  const added: Term[] = [];
  for (const term of extra) {
    const caseSensitive = term.caseSensitive === true;
    const value = needleOf(term.text, caseSensitive);
    if (value === '' || seen.has(`${term.entryId}\u0000${value}\u0000${caseSensitive}`)) continue;
    seen.add(`${term.entryId}\u0000${value}\u0000${caseSensitive}`);
    added.push({ entryId: term.entryId, value, caseSensitive, latin: isLatinTerm(value), priority: 0 });
  }
  return added.length === 0 ? compiled.terms : [...compiled.terms, ...added];
}

/**
 * One pass over a text, giving both what `countMentions` gives and where each entry's first surviving
 * mention starts, in the body's own offsets (codex-panels.md §1, `firstOffset`). The offsets are the ones
 * the appearance view reveals, so they must be offsets into the text the caller holds, not into the
 * canonical form, which NFC can make shorter.
 */
export function scanMentions(
  text: string,
  compiled: CompiledCodex,
  extra: readonly DocumentTerm[] = [],
): { readonly counts: Map<string, number>; readonly firstOffsets: Map<string, number> } {
  const counts = new Map<string, number>();
  const firstOffsets = new Map<string, number>();
  const terms = termsFor(compiled, extra);
  if (text === '' || terms.length === 0) return { counts, firstOffsets };
  const surfaces = surfacesOf(text);

  // K6: exclusion spans are gathered per entry before any term is judged. Each
  // occurrence of an exclusion phrase is a site of its own, and it can only drop the
  // term occurrences that lie wholly inside it.
  const excluded = new Map<string, Array<readonly [number, number]>>();
  for (const phrase of compiled.exclusions) {
    const spans = spansOf(surfaces, phrase);
    if (spans.length === 0) continue;
    const owned = excluded.get(phrase.entryId) ?? [];
    owned.push(...spans);
    excluded.set(phrase.entryId, owned);
  }

  const matches: Match[] = [];
  for (const term of terms) {
    const haystack = haystackFor(surfaces, term);
    const exclusions = excluded.get(term.entryId);
    for (const start of occurrencesOf(haystack, term.value)) {
      const end = start + term.value.length;
      if (term.latin && !atWordBoundary(haystack, start, end)) continue;
      if (exclusions !== undefined && exclusions.some(([from, to]) => from <= start && end <= to)) continue;
      matches.push({ entryId: term.entryId, start, end, priority: term.priority });
    }
  }

  // Rule 6, leftmost-longest. `frontier` only moves forward, so a match is accepted
  // exactly when it starts at or after the end of the last accepted one.
  matches.sort(byReach);
  const toBody = bodyIndexOf(text, surfaces.canon);
  let frontier = 0;
  for (const match of matches) {
    if (match.start < frontier) continue;
    frontier = match.end;
    counts.set(match.entryId, (counts.get(match.entryId) ?? 0) + 1);
    // Accepted matches come in start order, so the first one an entry receives is its first mention.
    if (!firstOffsets.has(match.entryId)) firstOffsets.set(match.entryId, toBody(match.start));
  }
  return { counts, firstOffsets };
}

/**
 * Maps an index into the canonical text to the same character's index in the raw text. The canonical
 * text is NFC, which composes a base letter and its combining marks into one code unit, so the two can
 * differ in length, and an index taken from one is wrong in the other. Text that NFC leaves the same
 * length is taken as identical, which is the case for nearly every manuscript. Otherwise the raw text is
 * split into clusters (a base character with the marks that follow it), each cluster is canonicalised on
 * its own, and every canonical code unit remembers where its cluster starts in the raw text.
 */
function bodyIndexOf(text: string, canon: string): (index: number) => number {
  if (canon.length === text.length) return (index) => index;
  const starts: number[] = [];
  for (const cluster of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const rawStart = cluster.index ?? 0;
    const pieceLength = canonical(cluster[0]).length;
    for (let unit = 0; unit < pieceLength; unit += 1) starts.push(rawStart);
  }
  return (index) => (index < starts.length ? (starts[index] ?? text.length) : text.length);
}

/**
 * The body offset of each entry's first mention, for the entries that have one. The same rules as
 * `countMentions`, so an entry is in the map exactly when it has a count.
 */
export function firstMentionOffsets(text: string, compiled: CompiledCodex): Map<string, number> {
  return scanMentions(text, compiled).firstOffsets;
}

/** Run compiled detection over several texts and merge the per-text counts. */
export function detectCompiled(docs: readonly DetectionDoc[], compiled: CompiledCodex): DetectionResult {
  const found = new Map<string, { count: number; where: string[] }>();
  for (const doc of docs) {
    for (const [entryId, count] of countMentions(doc.text, compiled, doc.terms ?? [])) {
      const slot = found.get(entryId) ?? { count: 0, where: [] };
      slot.count += count;
      if (!slot.where.includes(doc.id)) slot.where.push(doc.id);
      found.set(entryId, slot);
    }
  }
  return found;
}

/**
 * codex.md §4's `detect(docs, entries)`. Use this for texts that are not cached
 * (instruction, selection, a one-off scan). For document bodies, go through
 * `MentionIndex`, which compiles once per codex revision and caches per document.
 */
export function detect(docs: readonly DetectionDoc[], entries: readonly CodexEntry[]): DetectionResult {
  return detectCompiled(docs, compileCodex(entries));
}
