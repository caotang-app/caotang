# Codex panels — per-entity appearance view & future boards (v1)

> Status: built, except where a section says otherwise.
> Cross-refs: mention cache = [codex.md](codex.md) §4 (`MentionIndex`) · codex UI = [codex.md](codex.md) §8 · binder filters (the list view composes them) = [binder-filters.md](binder-filters.md) · corkboard view contract = [ui-modules.md](ui-modules.md) §3.

## 1. The appearance view (v0.1)

**Contract:** for a codex entry, list every document node whose cached `MentionIndex.hits[entryId] > 0`, in **manuscript order**, with per-doc mention counts. Data source = the per-doc mention caches (already built at document-write time, codex.md §4) — **zero new detection passes**, the view is a projection over existing caches.

```ts
interface AppearanceEntry { docId: string; title: string; count: number; firstOffset: number; }  // firstOffset = body-projection offset of the first hit (click-through)
appearances(entryId: string, caches: Map<docId, MentionIndex>, order: nodeOrder): AppearanceEntry[]
```

- **Where it lives:** the codex panel's entry detail (codex.md §8's editor gains an "Appears in" section): doc titles (click → `view.setActiveDoc` + `revealRange` at `firstOffset`), mention count per doc, total count. Folder mentions (caches are per-doc only) resolve to the folder row for narrative completeness — folder hits come from the same detection pass at cache build time if the doc under it mentions nothing (v0.1 simplification: **doc-level hits only**; folder-synopsis mentions are not scanned — assumption A2).
- **Why manuscript order matters:** the appearance list doubles as the cheap version of Plottr's character tab AND Aeon's narrative view (A7 implication 3): "where does Elena act, in reading order" — the entity-arc-at-a-glance. Order = binder sibling order (gap-encoded, pure sequence).
- **Cache honesty:** appearances reflect cache state (`docRevision`-stamped); a doc edited but not yet re-scanned shows its last-computed counts (same staleness contract as binder word counts, project-format §2 — derived, allowed stale, recomputed on open). The view is **never** the authority for policy decisions — include-policy assembly (codex.md §5) uses the same caches, so view and context agree by construction.
- **Empty state:** "No mentions yet — mentions appear as you write or via `codex.write` attach" (actionable: attach picker).

## 2. Codex panel: search & filter (composes the filter pattern)

The codex panel's existing search box (codex.md §8) firms up to the **same discipline as binder-filters.md** — client-side, deterministic, no command surface:

- Text box: case-insensitive substring over `name` + `aliases` + `description` (same field set as `codex.read` query — one semantic everywhere).
- Type chips: `character | location | object | lore | subplot | other` (toggle, multi-select) + include-policy chips (`always | detected | manual | never`).
- **No saved codex queries in v0.1** (binder filters own the saved-query pattern; codex search is a browse surface — codex entries are ≤ hundreds, the tree is thousands; revisit with usage evidence).

## 3. Explicitly backlog (boundaries recorded, not specced)

These stay out of v0.1 per Principle 5; shapes recorded so the eventual specs inherit fixed boundaries:

| Surface | Boundary from A7/A8 evidence | Landing condition |
|---|---|---|
| **Mentions-tab browser** (per-entry occurrence browser + header distribution bar — Novelcrafter's Mentions tab shape) | **A13 (2026-09-16):** a UI grouping over the same deterministic detection engine — occurrence lists grouped by content type (manuscript / scene summaries / codex entries / chat threads), snippet excerpts with highlighted matches, plus a header **distribution bar** (per-doc counts in binder order; the "character drops out of the story unexpectedly" continuity reading). Caotang's `MentionIndex` cache is the validated substrate — **zero new detection passes**, same projection pattern as §1's appearance view; codex→codex references come free (detector over entry descriptions). Detection mechanics confirmed identical incl. English-only auto-pluralisation and derived/recomputed-on-alias-change indexing (codex.md §10-K10). | **v0.2 candidate riding codex-panels** (the §1 appearance view is its v0.1 core; the grouped browser + distribution bar extend it). One dependency: chat threads as a browsable corpus require chat transcripts to be indexed docs (project-format note; v0.2). |
| **Entity boards** (character/place cards à la Plottr bible tabs) | A corkboard **variant** over codex entries (cards = entry name/type/description-preview/mention-count), not a new module — mirrors the media-track M3 conclusion ("corkboard variant with image + camera fields"). **One metadata shape everywhere; the board renders text, not just titles** (Plottr's "cards unreadable at zoom" warning); filters apply to boards (Plottr's tag/places asymmetry is the anti-pattern). | v0.2 with the corkboard zoom work; **A14** (StoryLine's data shape) informs field choices first. |
| **Timeline / plot-grid boards** (Plottr timeline = narrative-order × plotline columns) | Narrative-order × plotline is expressible as a corkboard grouping; **no dates** in v0.1 (Plottr has none — chronology is Aeon/D8 territory and coherence's SceneMeta day-offsets). New data model (plotline assignment per scene) = a manifest additive priced then. | **D8 gate cleared 2026-09-20** — Aeon's fiction model confirms **arcs-as-tags-over-scenes** (their Story Arc item type is a tag over events, not a container; forum users instantiate it for storyline layers), which matches the grid's plotline-column shape without a date model. The v0.2+ plot-grid can proceed on the recorded boundary; the plotline-assignment manifest additive is still priced at its own spec pass. |
| **Series / shared codex scope** (Plottr series view, NovelCrafter Series Codex, StoryLine shared codex) | Recurring across every competitor (A7 implication 4) — **v0.2 design constraint for codex.md, not v0.1**: entry ids and redundancy-file layout must survive a future "promote entry to series scope" without migration. Recorded as a constraint on codex.md §3 (ids globally unique per install; no project-local assumptions in file names). **Evidence-backed 2026-09-15 (A14 → codex.md §10-K9):** StoryLine ships exactly this shape — stable UUIDs (`seriesUuid`/`bookId`), `series.json` metadata, an optional `books:` frontmatter list where empty/missing = "appears in every book", explicit Promote/Demote moves. The constraint is validated, not just recorded. **Re-confirmed 2026-09-16 (A13, second vendor):** Novelcrafter's Series Codex = same-membership model (scope tag book vs series, move ops, All/Series/Book triage tabs; "the same as the standard codex" shared across every book — no per-book field overrides, scope is membership, not restructure). | Post-v0.1; multi-project story is a Phase-3 product question. |
| **Setup/payoff & relationship graphs** | StoryLine ships these; Caotang's coherence module owns continuity checking (coherence.md) — graphs are visualization over findings + codex, not a new check class. | Backlog (coherence-adjacent), marks exist. |
| **Appearance heatmap** | codex.md §2 already prices this (cheap derived stat, v0.2). | v0.2. |

## 4. Evals (headless)

- **Appearance fixtures:** fixed project (3 docs × 2 entries with aliases) → exact `AppearanceEntry[]` in manuscript order; alias-only mentions count; `exclude[]`-suppressed hits don't count; stale cache (doc written, cache not rebuilt) → last-computed counts + no error.
- **Panel trace (Playwright):** open entry → "Appears in" lists 2 docs → click first → active doc switches + editor reveals the range → filter by type chip → list narrows.
- **No new persistence:** nothing here writes the manifest (projection + view state only) — the persistence assertion is that `filters[]`/`goals[]`-style additions do **not** appear from panel use.

## 5. Assumptions

| # | Assumption | Status |
|---|---|---|
| A1 | Cached counts (doc-level) are the right truth for the appearance view | Evidence-backed (A7: the cheap version earns its place; policy assembly uses the same caches — view/context agreement by construction). |
| A2 | Doc-level hits only (folder synopses not scanned for mentions) | Explicit v0.1 simplification; folder-synopsis scanning is additive to the cache builder if evidence demands. *(2026-09-17: the codex-side saved-queries question is fully closed — rejected with all vendors checked; §2's browse-and-filter posture stands, the Mentions tab (§3) is the codex answer surface.)* |
| A3 | `firstOffset` click-through is stable enough for navigation | Explicit — a single body-projection offset at reveal time; the editor reveal clamps to doc bounds (no anchor ladder needed for a read-only jump; ladder territory starts at *edits*). |
| A4 | Codex panel search stays unsaved in v0.1 | Explicit (binder filters own saved queries; scale difference justifies asymmetry). |
