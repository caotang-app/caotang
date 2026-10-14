# @caotang/harness

The agent: the tool registry (agent-harness.md §3) and the interaction loop built on it (§2).

- **Registry** (`src/metadata.ts` for the rows, `src/runtime.ts` and `src/tools/` for the calls): the frozen fourteen
  of v0.1 (`agent.plan` is the fourteenth, the protocol row) and twelve extension rows, 26 in all on 2026-10-09
  (agent-harness §10, revised 2026-10-09 by this work). Every call is validated against a closed-set schema,
  prepared through the bus's own `validate`, gated, and dispatched.
- **Loop** (`src/agent/`): intent → context → model → plan or confirm → bus → verify ladder → report.
- **Evals** (`src/agent/eval.ts`, `test/eval/`): scenarios with strict and unordered matchers and token ceilings.

## Decision: the tool-call wire protocol

**Tool calls travel as JSON inside the reply's content, not as native function calls.**

The reply is exactly one of two JSON objects (`src/agent/protocol.ts`):

```json
{"steps": [{"tool": "scene.draft", "params": {...}, "expect": "..."}]}
{"reply": "..."}
```

Why this shape, and not native tool calling:

1. **The gateway has no tool fields to use.** `ChatRequest` carries messages, a model, sampling settings
   and `responseFormat`. It has no `tools` and no `tool_calls`, and adding them means changing the
   OpenAI-compatible client and probing every endpoint for support.
2. **The spec's own structured path is `responseFormat`.** provider-gateway §5 says the harness needs JSON
   for plans; the gateway states the schema in a system message and sends `response_format` only where a
   probe says the endpoint accepts it. The harness sends `REPLY_SCHEMA_HINT` that way.
3. **The check is the registry's own.** A step's shape is checked with `planParams`, and its params with the
   tool's closed-set schema (`checkParams`). The same declaration produces the schema the planner is shown,
   so a key the schema lists is a key the validator accepts, and no other.
4. **A model cannot write what only the loop may stage.** Generated prose, synopses and findings are
   *proposals*: the loop drafts them with a separate model call and the card shows them. A step's params
   never carry a proposal. `parseReply` checks the reply against the plan schema, and the external caller's
   calls have any proposal removed before a port sees them (`runtime.ts`).
5. **A malformed reply is answered in words.** A non-JSON reply, a refused step or a retry all go back to the
   model as a message naming the shape it should have had. The turn does not fail on a bad reply.

The planner's system message is built from the registry: only tools that are callable and wired are listed,
each with its risk, description and schema, and `agent.plan` never appears (it is the protocol, not a tool).
The two system prefixes (`PLANNER_SYSTEM_PREFIX`, `DRAFT_SYSTEM_PREFIX`) are duplicated in
`@caotang/gateway/mock` so its scripts can tell the calls apart; a test asserts the copies agree.

## Module map

| File | Role |
|---|---|
| `src/runtime.ts` | `createHarness`: the call path, the tool gate, the port path, plan execution, external callers |
| `src/plan.ts` | Plans: preflight, execution from a step (`from`), the shared `AskBack` envelope (four codes) |
| `src/agent/protocol.ts` | The reply shapes, the planner's system message, the model-facing messages |
| `src/agent/context.ts` | `ContextPort` and a minimal assembler (L1, L2, L5), with drop reasons, layer budgets and the prompt preview (`previewOf`) |
| `src/agent/inputs.ts` | The budgeted inputs of `synopsis.fill` (25,000 characters a document) and `continuity.scan` (the last 1,000 characters) |
| `src/agent/drafting.ts` | Generation for the three model-backed tools, streamed through the gateway, with each finish reason read |
| `src/agent/ports.ts` | `codex.read` (via `@caotang/codex`), `scene.draft`, `synopsis.fill`, `continuity.scan`, and previews |
| `src/agent/cards.ts` | Status cards (An earlier change lifecycle), grouping, plan cards, edits, the dependency badge, the steps that have run |
| `src/agent/loop.ts` | `createAgentSession`: the turn, the decisions, the ladder, the conflict re-show, the bound, the report, the restore |
| `src/agent/events.ts` | The event stream (§8), the report, the trace, the checkpoint label |
| `src/agent/eval.ts` | The scenario format, the runner, the matchers, the undo-replay check |

## How a turn runs

1. **Context.** The `ContextPort` assembles the layers for the intent. The product's assembler is
   `@caotang/context`, built in parallel; this package does not depend on it. The minimal assembler here
   produces L1 (summary), L2 (codex by mention and policy, budgeted by whole entries) and L5 (focus tail).
2. **Reply.** The planner is called with the reply schema. Reads run at once and their results go back to
   the model. Anything else is a write.
3. **Staging.** Model-backed steps are drafted before anything is shown. A refusal here (no such document,
   an empty draft, a call the turn cannot afford) goes back to the model. Each draft records its document's
   revision before the model is asked, so the draft is staged against the text the model was given.
4. **Cards.** One write-auto call runs at once, with no card. One write-confirm call gets a one-step confirm
   card. Several steps get a plan card. A card whose preflight refuses a step is shown, and it cannot be
   approved. The user can edit it or cancel it.
5. **Decisions.** The session asks `decide(pending)` for each card and waits. An edit is checked and the card
   is shown again, so an approval always covers the card as it now stands. A retry drafts the pending steps
   again. A cut draft is approved only with `acceptTruncated`. An approval the card refuses is shown again with
   the reason, and five decisions in a row that change nothing end the turn.
6. **Execution.** Approved steps run through the harness under the approval the card carries (`confirmed`
   or `approvedPlan`), so the bus gate checks it. A port's `editor.replaceRange` runs under the port's own
   grant (`inheritedGrant`), and a direct dispatch of the same primitive is refused.
7. **Verify ladder** (agent-harness §7). A refused step that changed nothing is adjusted by the model, shown
   again and approved again, twice at most. A step that changed something, or an anchor that did not resolve,
   stops the turn with an ask-back. Nothing is undone automatically.
   **Steps that have run are pinned.** A step that applied is recorded by origin in its card's `completed`
   set. It is shown as done, a retry resumes after it and never runs it again, and no edit may drop, change or
   move it (a reorder cannot carry a pending step across one). So a retry after an applied step, and a cancel
   after it, both keep the turn's undo group.
8. **Conflicts.** A draft whose document has changed since it was staged is refused at apply by the revision
   backstop (command-bus §6). The draft is kept on the card, marked stale, and the card is shown again with the
   reason. It cannot be approved until it is drafted again (Retry) or the card is cancelled.
9. **Bound.** Every model request passes one call site that counts it against `maxModelCalls` (default 8).
   A draft is checked against the calls left before it is asked for, so a batch the turn cannot afford is
   refused back to the model with a split named, and a retry the turn cannot afford is a notice on the card.
10. **Report.** The status, the summary, the steps, the cards and their decisions, the trace, the undo group,
    the ask-back if there is one, and the tokens. The turn's undo group is the checkpoint: "restore to before
    this turn". The group is recorded the moment a run applies anything, so a turn that is cancelled, stopped on
    a failed model call, or stopped by the bound after an applied step still has its checkpoint, and its summary
    says what was written before the stop.

### The four ask-back codes

`AskBack.code` is one type with four values:

- `needs_input`: the user has to act. This covers a refusal the ladder may adjust, a turn that used its
  model-call bound, and a provider call that failed (a rejected key, an unreachable endpoint). A provider failure
  is not a postcondition, so it is `needs_input`, with the next actions the user has: check the profile, or
  switch it.
- `conflict`: a revision moved. The draft is not rewritten by the model. It goes back to the card, where it is
  retried or cancelled (step 8 above).
- `verify_failed`: a postcondition failed, or an internal defect. Reported, and not retried.
- `anchor_unresolvable`: a selection the ladder could not place, with up to three candidates and the drift.

### Model-call stops, and the draft a provider cut

- **A cut draft.** The provider's finish reason `length` means it stopped at its output limit. The draft is staged
  as cut, the card shows it, and approval needs either a retry or `acceptTruncated: true`. A cut `continuity.scan`
  reply is not parsed as findings, because a cut list is not a complete one: it is refused back to the model.
- **An errored stream.** Finish reason `error` means the answer ended on a failure with part of it. Nothing is
  staged from it. The turn stops as `needs_input`, and no ghost preview is offered.
- **The bound.** A turn that uses `maxModelCalls` stops as `needs_input`, with the count in its reason.

### The prompt on a card (context-assembly §5)

Every model-backed step's card carries the prompt that produced its draft: each layer with its estimate and its
budget, each codex entry included and why (`always`, `matched 2 times in the brief`, `attached to Chapter 1`),
each dropped item and why, the focus text's first 120 characters with its clip size and the end marker, and the
estimated prompt and completion tokens (ceil(chars/4)). The card and the request are built from the same
`assemble()` call, so they cannot drift.

### Per-tool budgets (context-assembly §3)

- `synopsis.fill` sends each document's text capped at 25,000 characters from its start, with its notes after the
  body inside the same cap. A cut is a drop reason, naming both lengths.
- `continuity.scan` sends each document's last 1,000 characters. A call checks at most 20 documents, and a larger
  scope is refused with the split named. The schemas state both limits as `maxItems`.

### Anchors

`scene.draft` in `rewrite_selection` resolves its `TextAnchor` with `@caotang/editor`'s `resolveAnchor`, the same
ladder the editor's anchored apply uses (edit-anchors §3). The sync port calls it directly, after the loop has
awaited `preloadAnchorLibraries()`, because the port is synchronous and the preload is not. The anchor resolves
against the document as it is at apply time, so its drift is the apply-time revision minus the captured one. The
write itself carries the revision the draft was staged against, so a draft the user overtook is a conflict.

## Events and the status-card lifecycle

The session emits `AgentEvent`s in order: `turn`, `model.delta` (streamed text), `context`, `card` (each status
card's lifecycle: `pending-approval`, `running`, `done`, `cancelled`, `failed`), `plan`, `ghost` (a draft handed
to the ghost preview, with its words, its title and whether it was cut), `findings`, `ladder`, `checkpoint` (the
label and the undo group), and `report`. `groupCards` groups consecutive calls of one turn, open while any is running.

## Turn identity and tokens

A turn is `<session>.turn-<n>`. The session name is random unless the caller pins one (`sessionId`; the evals
pin theirs), so two sessions on one gateway, whose ledger keys its rows by turn, never share a turn id, and the
bus's undo groups and the call cache never reuse one either. Within a turn, call ids are counted from the turn,
so a replay within a session is deterministic. Every model request carries its `turnId`, and the report reads its
totals from `gateway.ledger.turnTotals(turnId)`. A turn's figures are its own requests, not a running total.

## Evals

A scenario states an intent, a project, a gateway (its mock scripts are the model), the decisions the user makes,
and an expectation: the status and ask-back (with its candidates and drift), the cards with `strict` or `unordered`
matching, the trace with its params as a subset, the requests the model was sent (with what their system message
carries), the drops, the token and model-call ceilings, a restore check, and a state check.

- `test/eval/scenarios.test.ts`: fifteen scenarios across single-op, multi-step, plan-edit, verify-recovery,
  permission, anchor and undo. The anchor scenario asserts its candidates and its revision drift, and the undo
  scenario asserts the restored project is byte-equal to the one before the turn.
- `test/eval/codex.test.ts`: the five codex scenarios of codex.md §9. Budget-prune determinism is run twice.
- `test/eval/demo.test.ts`: the three zero-key demo intents of context-assembly §6, end to end on the mock.
- `test/eval/eviction.test.ts`: command-bus §5.1's snapshot-eviction invariants, from 108 writes the harness made.
- `test/agent/*.test.ts`: the loop, the cards, the ports, the context, the inputs, the protocol, the matchers and
  the ask-backs. Every loop test runs through `evaluate`, so the expectation it states is checked.

The three demo intents are defined here, in `@caotang/gateway/mock` (`DEMO_INTENTS`). context-assembly §6 names
the wizard's three intents by count only, so this package chose the three model-backed tools for them.

## Verification

```
node node_modules/typescript/bin/tsc --noEmit -p packages/harness/tsconfig.json
node node_modules/eslint/bin/eslint.js packages/harness
node node_modules/vitest/vitest.mjs run packages/harness
```

`packages/harness/tsconfig.json` includes `../editor/src/ambient.d.ts`: the editor's lazy `diff-match-patch` import
is typed there, and the harness program has to see it.

## Open items and known gaps

- **The lockfile.** `pnpm-lock.yaml`'s `packages/harness` importer records the new workspace links
  (`@caotang/codex`, `@caotang/editor`, `@caotang/gateway`). They were written by hand in the importers' own format and
  have not been checked by a real install. Run `pnpm install --frozen-lockfile` to confirm them.
- **Verification environment.** The workspace links for the new dependencies were not installed in the
  authoring worktree, so the suites were run with a scratch configuration that maps `@caotang/*` to each package's
  source, outside the repository. The repository's own `pnpm exec vitest` needs the install above.
- **Context.** Only L1, L2 and L5 are produced. L3 (structural synopses) and L4 (prior-scene synopses) belong to
  `@caotang/context`. The codex layer's budget is a single pool, not the reserved two-phase budgeting of
  context-assembly A3.
- **`continuity.scan` context.** Its per-tool expansion (context-assembly §3: the codex layer at 2.5k and the
  story-so-far at 6k) is not built. It sends the scope's document tails and nothing else, so its preview has no
  codex or story-so-far section.
- **`synopsis.fill` context.** Its spec layers are L5 (the document, capped as above) and L3 (structural synopses,
  context-assembly §2). L3 is not built, since it needs the product assembler. The card shows each document's
  layer and any cut, but no codex section, since the synopsis prompt carries none.
- **The planner's reply.** A planner reply the provider cut at its output limit is not special-cased. It fails to
  parse, and the model is asked again, which is the existing behaviour of a malformed reply.
- **Ghost preview.** The ghost is a `ghost` event with Apply (approve), Retry (`retry`) and Discard (cancel).
  The region itself, the streamed rendering and the in-editor placement are the UI's, not this package's.
- **Steering and queued messages** are v0.2 (agent-harness §10). A turn cannot be steered once it starts.
- **Restore scope.** The restore reverses the whole turn's group. The sentence that says edits made after the
  turn are included is the UI's to show.
- **`continuity.scan`** is read-only and returns findings. The coherence module (coherence.md) supersedes it
  later, as the spec says.
- **Tool descriptions.** The four port tools' descriptions dropped "Not wired in this build". `synopsis.fill` and
  `continuity.scan` state their limits and are at `descriptionVersion` 3 (§9): their schemas gained `maxItems`.
  `scene.draft` is at 2, unchanged. The other caps and versions are as before.
- **Snapshot eviction.** The fixture runs the store's retention planner over real harness writes. It does not
  run `evictSnapshots` against IndexedDB, which needs a browser store.
