/**
 * codex.md §2's closed enums and their load-time coercions — **one implementation
 * of each rule**, called from every surface that has to agree on it.
 *
 * ## Why this module exists
 *
 * codex.md §2 states each coercion twice in effect and once in words: the manifest
 * path (`caotang.json` → `validate.ts` → the state the loader builds) and the
 * redundancy-file path (`codex/<id>.md` → `codex-file.ts` → §5.4's rebuild). Two
 * coercions of the same enum in two modules is the shape this repo keeps paying
 * for — two records of one fact that drift apart, named as a standing harm in
 * The docs/decisions.md and again in the `@likecoin` five-record split.
 *
 * The rule for which surface is authoritative, stated once:
 *
 * - **The manifest is authoritative** (codex.md §3: "manifest wins over redundancy
 *   files"). `validate.ts` judges a manifest and hands back the *same object* it
 *   judged, so a coercion applied here is the coercion the product runs on.
 * - **The redundancy file is the recovery surface.** It has to obey the same
 *   rules, or a rebuilt entry would land in the manifest already violating §2 —
 *   and §3's whole reason for the file is that it survives manifest corruption.
 *
 * So the *rules* live here and both surfaces call them; neither surface keeps its
 * own copy. A test asserts the two paths produce the same value for the same
 * input, so a second copy cannot be reintroduced quietly.
 *
 * ## Why the coercions are here and not in `descriptors.ts`
 *
 * They are not: `descriptors.ts` **refuses** an unknown enum at the command
 * boundary (codex.md §7 validates a batch before execution), while these
 * **coerce on load** (§2: "unknown value on load → coerce … + warning"). Two
 * different behaviours on two different surfaces, one list of members each reads.
 * The *limits* are a third case and they do have one home — `@caotang/bus` exports
 * them and `@caotang/store` imports them, because the package graph permits only
 * that direction (store → bus) and a second copy of a limit is the drift species
 * above..
 */

import type { CodexIncludePolicy } from './manifest.js';

/** codex.md §2's closed `includePolicy` enum, in §2's order. */
export const CODEX_INCLUDE_POLICIES = ['always', 'detected', 'manual', 'never'] as const;

/** codex.md §2's closed `type` enum for v0.1 ("custom types = v0.2"). */
export const CODEX_TYPES = ['character', 'location', 'object', 'lore', 'subplot', 'other'] as const;

/** codex.md §2's closed `origin` enum. */
export const CODEX_ORIGINS = ['manual', 'agent', 'import'] as const;

/** CodexEntry.origin, kept as a named type so a caller cannot widen it by accident. */
export type CodexOrigin = (typeof CODEX_ORIGINS)[number];

/**
 * A coercion and whether it happened.
 *
 * Both callers need both halves, which is why this is not a bare value: the
 * manifest path has to *warn* (§2 says "coerce + warning"), and the file path
 * has to be silent about a value that was already legal. A function returning
 * only the coerced value would force one of them to re-derive `coerced` by
 * comparing against its own input — which is a second opinion about a rule that
 * already knows the answer.
 */
export interface CodexCoercion<T> {
  readonly value: T;
  readonly coerced: boolean;
}

/**
 * codex.md §2: "`includePolicy` — unknown value on load → coerce to `'detected'`
 * + warning (policy enum is closed)."
 *
 * The default is `'detected'` and not `'manual'` because `'manual'` means "only
 * when a human attached it by hand", which a value nobody wrote on purpose must
 * not silently acquire.
 */
export function coerceIncludePolicy(raw: unknown): CodexCoercion<CodexIncludePolicy> {
  if (typeof raw === 'string' && (CODEX_INCLUDE_POLICIES as readonly string[]).includes(raw)) {
    return { value: raw as CodexIncludePolicy, coerced: false };
  }
  return { value: 'detected', coerced: true };
}

/**
 * codex.md §2: "`origin` — unknown value on load → coerce to `'agent'` + warning
 * (enum closed)."
 *
 * `'agent'` and not `'manual'`, which reads backwards until you follow the provenance
 * rule: an unrecognised provenance is *not* evidence of a human having written it,
 * and codex.md ranks hand-authored above agent-inferred precisely so the ambiguous case
 * does not outrank the entry it was found on. §2's absent-value rule is separate
 * and is NOT this function's business — absence is `'manual'` (project-format §2,
 * "missing `origin` = `'manual'`"), which is a stated default, not a coercion.
 */
export function coerceOrigin(raw: unknown): CodexCoercion<CodexOrigin> {
  if (typeof raw === 'string' && (CODEX_ORIGINS as readonly string[]).includes(raw)) {
    return { value: raw as CodexOrigin, coerced: false };
  }
  return { value: 'agent', coerced: true };
}

/**
 * codex.md §2's `type`: a fixed v0.1 enum, custom types in v0.2 — so an
 * **unknown type is a future type and is kept**, not coerced. Only a missing or
 * empty value becomes `'other'`, the one member that means "none of the above",
 * which is also what `codex.upsert` writes for an unspecified type
 * (`CODEX_DEFAULT_TYPE`).
 *
 * Kept separate from the two coercions above on purpose: it is the one enum
 * where "closed" does **not** mean "reject what I do not recognise".
 */
export function coerceType(raw: unknown): CodexCoercion<string> {
  if (typeof raw === 'string' && raw !== '') return { value: raw, coerced: false };
  return { value: 'other', coerced: true };
}

/**
 * The first way a citation's offsets or timestamp break codex.md §2's `EntrySource`,
 * or `undefined` when they hold. Only a field that is **present** is judged: the
 * manifest type keeps `from`, `to` and `extractedAt` optional so a manifest written
 * before they were kept still loads (manifest.ts `CodexSource`), so an absent field
 * is not a problem here. A present one must have the right type — a whole offset
 * `≥ 0`, with `to ≥ from`, and an ISO-8601 time — because a citation whose offset is
 * the string `'zero'` cannot be written back as a JSON number.
 *
 * Shared by the manifest validator and the redundancy-file reader, so one citation
 * is judged by one rule whichever file it came from.
 */
export function citationOffsetProblem(citation: {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly extractedAt?: unknown;
}): string | undefined {
  const { from, to, extractedAt } = citation;
  if (from !== undefined && (typeof from !== 'number' || !Number.isInteger(from) || from < 0)) {
    return `from must be a whole offset ≥ 0, got ${JSON.stringify(from) ?? String(from)}`;
  }
  if (to !== undefined) {
    const floor = typeof from === 'number' ? from : 0;
    if (typeof to !== 'number' || !Number.isInteger(to) || to < floor) {
      return `to must be a whole offset ≥ ${floor}, got ${JSON.stringify(to) ?? String(to)}`;
    }
  }
  if (extractedAt !== undefined && (typeof extractedAt !== 'string' || Number.isNaN(Date.parse(extractedAt)))) {
    return `extractedAt must be an ISO-8601 time, got ${JSON.stringify(extractedAt) ?? String(extractedAt)}`;
  }
  return undefined;
}