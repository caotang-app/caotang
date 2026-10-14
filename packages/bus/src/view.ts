/**
 * The three `view.*` applies — [command-bus.md §2](docs/architecture/command-bus.md).
 *
 * **These are the non-vacuous case, and that is exactly why they exist here.**
 * `execute()` needs a command that really runs end to end, and every other name
 * in §9's closed set is waiting on a store-side apply. The view
 * commands need **no store at all**, because §2 defines their effect as
 * *"ephemeral UI state (selection, scroll, active doc) — never persisted"*. So
 * the pipeline's fixed order, its gate, its log append and its §5 skip rule are
 * all exercised by code that ships in this commit, rather than by a test that
 * has to invent a subject for them.
 *
 * ## The state is the bus's, and the bus's is the only one
 *
 * `ViewState` is declared in `command.ts` beside `ValidationSnapshot` for the
 * same reason: the bus owns this state, so it can type it, and no store or app
 * needs to satisfy it. The app creates one with `createViewState()` and passes
 * it to `execute()` as `bus.view`; `execute()` chooses it over `bus.state`
 * purely from the descriptor's `mutates` field, which is the one place §2's
 * `mutates` earns its keep in the pipeline.
 *
 * ## Nothing here is undoable, and §2 says so twice
 *
 * §2: *"`mutates: 'view'` commands skip undo registration and appear in the
 * activity log as non-undoable view events"*, and §9's row gives all three
 * `undo: 'none'`. The pipeline honours the first clause even when a descriptor
 * claims otherwise — a view command whose descriptor declares `undo: 'inverse'`
 * still registers nothing — and `test/pipeline.test.ts` pins that precedence,
 * because two spec sentences meet here and only one can win.
 */

import type {
  CommandApply,
  ViewState,
  ViewSetActiveDocParams,
  ViewSetCorkboardScopeParams,
  ViewSetExpandedParams,
  ViewSetScrollParams,
  ViewSetSelectionParams,
} from './command.js';

/** A fresh view state. Nothing is persisted, so there is nothing to load. */
export function createViewState(): ViewState {
  return { selection: [], activeDocId: null, scroll: {}, expanded: {}, corkboardScope: null };
}

/**
 * The structural check `execute()` runs before handing a view command its
 * state.
 *
 * **A type is not a runtime guarantee.** `BusContext` is an object literal an
 * app assembles, and the pipeline is the last place that can notice a project
 * state was passed where a view state belongs — after which a `view.setSelection`
 * would write `selection` onto a manifest. Three fields, checked by shape; no
 * brand, because a brand would be a promise in the same shape as the promise
 * this replaces.
 */
export function isViewState(value: unknown): value is ViewState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ViewState>;
  return (
    Array.isArray(candidate.selection) &&
    (typeof candidate.activeDocId === 'string' || candidate.activeDocId === null) &&
    typeof candidate.scroll === 'object' &&
    candidate.scroll !== null &&
    typeof candidate.expanded === 'object' &&
    candidate.expanded !== null &&
    (typeof candidate.corkboardScope === 'string' || candidate.corkboardScope === null)
  );
}

/**
 * The three applies. Each returns the value it set, so a caller's outcome
 * carries what changed without re-reading the state — the bus's *log and
 * subscribers* re-read from the store (§3), which is a different statement
 * about a different surface.
 *
 * ## All three report `affected: []`, and that is a fact rather than a gap
 *
 * §8's `affected` is *"{ nodeId, title }[] — human titles, not bare ids"*, and a
 * view apply has **no title to give**: `ViewState` holds ids and offsets, the bus
 * does not own project state (§1), and §3's rule is that a subscriber re-reads
 * *the store* — which does not hold a scroll offset or a selection at all, since
 * both are ephemeral by §2's own definition.
 *
 * So a bare id would be the only thing available, and putting one in a field the
 * spec says must carry a human title makes the log **worse**, not thinner: an
 * agent-panel row reading `n_3W8RN2TQ6C` where it should read a scene name. The
 * three commands change no node's rendered content — their effect lives in the
 * view state a subscriber already holds — so the empty list is the true answer
 * and **the digest is what carries the fact**.
 */

export const viewSetSelectionApply: CommandApply<ViewSetSelectionParams, ViewState> = (
  state,
  params,
  context,
) => {
  state.selection = [...params.nodeIds];
  context.report({ affected: [], summary: `selected ${countOf(state.selection.length, 'node')}` });
  return { selection: state.selection };
};

export const viewSetActiveDocApply: CommandApply<ViewSetActiveDocParams, ViewState> = (
  state,
  params,
  context,
) => {
  state.activeDocId = params.docId;
  // No title: §2 makes the active doc id ephemeral UI state, and the bus holds no
  // project state to resolve one from. See the header.
  context.report({ affected: [], summary: 'switched the active document' });
  return { activeDocId: state.activeDocId };
};

export const viewSetScrollApply: CommandApply<ViewSetScrollParams, ViewState> = (
  state,
  params,
  context,
) => {
  state.scroll = { ...state.scroll, [params.nodeId]: params.offset };
  context.report({ affected: [], summary: `scrolled to offset ${params.offset}` });
  return { nodeId: params.nodeId, offset: params.offset };
};

export const viewSetExpandedApply: CommandApply<ViewSetExpandedParams, ViewState> = (
  state,
  params,
  context,
) => {
  state.expanded = { ...state.expanded, [params.nodeId]: params.expanded };
  context.report({
    affected: [],
    summary: `${params.expanded ? 'expanded' : 'collapsed'} a folder in the binder`,
  });
  return { nodeId: params.nodeId, expanded: params.expanded };
};

export const viewSetCorkboardScopeApply: CommandApply<ViewSetCorkboardScopeParams, ViewState> = (
  state,
  params,
  context,
) => {
  state.corkboardScope = params.nodeId;
  // No title, for the reason the header gives: the scope is ephemeral UI state and
  // the bus holds no tree to resolve a name from.
  context.report({
    affected: [],
    summary: params.nodeId === null ? 'showed the manuscript on the corkboard' : 'showed a container on the corkboard',
  });
  return { nodeId: params.nodeId };
};

/** "1 node" / "3 nodes" — for the digest, which is all a view event leaves behind. */
function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
