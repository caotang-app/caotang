/**
 * [editor-engine.md] §7 — **the two-lane undo policy**, as pure functions over
 * `(EditorState, Transaction)`.
 *
 * ## What this module is
 *
 * §7's mechanism, in one place, callable headless. §7's table puts user
 * keystrokes in **Lane 1** (`prosemirror-history`, *"engine-default
 * coalescing. Untouched by the bus"*) and every agent apply in **Lane 2**,
 * *"applied as one transaction batch with `tr.setMeta('addToHistory', false)`"*.
 * A parameter that lives in an interface and in six documents and in **no
 * function body** is a guarantee nothing can violate, so this file is the one
 * that reads §4's `historyExcluded` and the one that owns that meta.
 *
 * It is not a second engine and it is not the Tiptap adapter. It imports no
 * view, no DOM value and no store; `EditorState` and `Transaction` are
 * `prosemirror-state`'s, which is the document model §3's schema already uses.
 * Tiptap's `History` extension *is* this plugin (verified: `@tiptap/pm/history`
 * is `export * from "prosemirror-history"`, and `prosemirror-history@1.5.1`
 * arrives via `@tiptap/pm@3.31.4`, which this package already declares), so the
 * adapter and this policy are arguing about the same history stack rather than
 * two of them. The decision that puts the policy here rather than in the
 * adapter — which is unbuildable under `vitest.config.ts`'s `environment:
 * 'node'` — is docs/decisions.md.
 *
 * ## `closeHistory` is not decoration, and the measurement is the reason
 *
 * `addToHistory: false` on its own satisfies §7 rule 1 for the *transaction it
 * marks*, and the next sentence of rule 1 — *"the user's undo stack only ever
 * reverts their own keystrokes"* — needs a second mechanism. Measured on
 * `@tiptap/pm@3.31.4` / `prosemirror-history@1.5.1`, same document, same
 * positions, the only difference being `closeHistory`:
 *
 * | | after the excluded agent apply + one more user keystroke | after one Ctrl+Z |
 * |---|---|---|
 * | `addToHistory: false` alone | depth **1** — the keystroke coalesced into the user's still-open event | depth **0**, both keystrokes gone |
 * | `addToHistory: false` + `closeHistory` | depth **2** — the agent turn is a boundary | depth **1**, one keystroke gone |
 *
 * The first row is the failure names and tells you
 * to test for by name — the skip-some-elements thread's *"undo once → history
 * empty"*: the excluded transaction leaves the user's event open, so the next
 * keystroke is appended to it and **one** Ctrl+Z consumes two of the user's own
 * edits. `closeHistory` is what closes the user's event, which is precisely its
 * own documented job — *"prevent further steps from being appended to an
 * existing history event (so that they require a separate undo command to
 * undo)"*.
 *
 * `addToHistory: false` remains necessary and is not redundant with it: the two
 * are read in different branches of `applyTransaction` (the `closeHistory` key
 * resets the grouping window; the `addToHistory` test decides whether the step
 * is appended at all), so the agent's text stays out of **both** stacks.
 */
import { closeHistory } from '@tiptap/pm/history';
import type { Transaction } from '@tiptap/pm/state';

/**
 * §4's option, on all three mutating members of `EditorInstance`. **Declared
 * once and used by both ends** — `seam.ts`'s interface spells these three
 * members with this type, and {@link markLane} is the only thing that reads it,
 * so the parameter and the guarantee cannot drift apart the way a duplicated
 * `{ historyExcluded?: boolean }` would let them.
 */
export interface LaneOptions {
  /**
   * §4's parameter, on `setContent`, `insertAtSelection` and `replaceRange`.
   * §4's own error-modes clause: *"Primitives with `historyExcluded` never throw
   * for content reasons"* — it is a lane choice, not a guard, so there is
   * nothing here to refuse.
   */
  historyExcluded?: boolean;
}

/** §7's table's two rows, as a value. */
export type Lane = 'user' | 'agent';

/**
 * **The read of `historyExcluded`.** §7's table maps Lane 2 to *"any bus text
 * mutation"* and §7 rule 2 restores through `setContent(historyExcluded: true)`,
 * so one boolean names the lane and this is the only place it is interpreted.
 *
 * Strict `=== true` rather than truthiness: the option is optional, so an
 * omitted `opts` and `{}` both mean Lane 1, and `historyExcluded: false` is a
 * caller stating Lane 1 explicitly. A truthy read would make the two
 * indistinguishable — which is the shape of defect this slice exists to remove.
 */
export const laneOf = (opts?: LaneOptions): Lane =>
  opts?.historyExcluded === true ? 'agent' : 'user';

/**
 * **The one place `addToHistory: false` is written**, and the whole of §7's
 * enforcement. Returns `tr` unchanged for Lane 1, so a user keystroke passes
 * through untouched — §7's Lane 1 is *"untouched by the bus"*, and a policy that
 * stamped meta on user transactions would be editing the lane it is not in.
 *
 * Idempotent and replay-safe by construction: an already-marked transaction
 * takes the same branch, and a transaction PM generated itself (a Ctrl+Z replay)
 * arrives without `opts` and so is left alone.
 */
export const markLane = <T extends Transaction>(tr: T, opts?: LaneOptions): T => {
  if (laneOf(opts) === 'user') return tr;
  closeHistory(tr);
  tr.setMeta('addToHistory', false);
  return tr;
};
