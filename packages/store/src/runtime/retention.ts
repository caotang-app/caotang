/**
 * Section 5.1's retention ladder - [command-bus.md](docs/architecture/command-bus.md) 5.1,
 * walked over the `snapshots` object store (`store.ts`).
 *
 * ## Why this file is a pure function first and a store call second
 *
 * Section 5.1's last line is a contract about testability, not an implementation
 * hint: *"eviction is a pure function of (checkpoint list, cap, days,
 * today-injected) - headless-testable"*. So `planSnapshotEviction` takes those
 * four things and touches nothing - no `Date.now()`, no IndexedDB, no settings
 * object - and `evictSnapshots` is the thin call that reads a list, hands it
 * over, and deletes what came back. The clock is a parameter because the spec
 * says it is one.
 *
 * ## The three limits do not compose, and the composition is the work
 *
 * Rules 2, 3 and 5 are each one sentence and together they pull against each
 * other in two places:
 *
 * - **Rule 5 pins** each document's first snapshot "while any later snapshot of a
 *   doc exists" - *never evicted*, as a word, against both other limits.
 * - **Rule 2 caps** the project at `checkpointCap`, oldest evicted first.
 * - **Rule 3 ages** a checkpoint out after `checkpointDays`.
 *
 * The first collision is age versus pin: a document's baseline is usually the
 * oldest row the project holds, so after thirty days of not writing that
 * document, rule 3 and rule 5 disagree about the same row. The spec resolves it
 * with an emphatic word - "never" - and the stated reason agrees: rule 5 exists
 * so per-doc history reconstruction is cheap, and a baseline evicted on a timer
 * is not a baseline. So a pinned row is exempt from both limits.
 *
 * The second is cap versus pin, and it has no resolution in the text, only a
 * bound. The cap counts *all* retained rows, so a project with 200 documents
 * that each have two snapshots holds 200 rows under `checkpointCap: 100`:
 * **the cap bounds non-baseline snapshots, and the baselines are bounded by the
 * document count.** That is a real bound rather than an escape hatch, and rather
 * than hide it `EvictionPlan.capMet` reports it, because rule 8 promises the user
 * "the user-visible guarantee that the cap is real" and a promise that quietly
 * does not hold is worse than a number that admits its own exception.
 *
 * ## The pins are derived from the rows the sweep was given
 *
 * Not from the rows that survive, which is the tempting reading and the wrong
 * one. Re-deriving a pin after each eviction means a document trimmed down to a
 * single row loses its baseline on the next round - the ladder becomes a cascade,
 * and rule 5's own stated purpose ("the diff baseline - makes per-doc history
 * reconstruction cheap") is exactly what a cascade destroys. A document's first
 * snapshot is a property of the project's history, not of whatever one sweep
 * happened to leave behind. So the pins are computed once, from the input.
 *
 * ## What a "checkpoint" is here, and why the unit is the row
 *
 * Section 5.1 counts **checkpoints** and stores **snapshots**, and rule 4 says a
 * checkpoint "references the existing snapshot" - so the two are not the same
 * thing, and rule 6 ("deleting a checkpoint removes any snapshot no remaining
 * checkpoint references") only does work where references are shared.
 *
 * In v0.1 the only durable checkpoint artifact *is* the row. `store.ts` makes rule 4's
 * dedupe a property of the `[projectId, docId, revision]` key, so an unchanged
 * body cannot be stored twice and its second capture surfaces as
 * `SnapshotExistsError`, which the compensable applies treat as the success they
 * are. Undo groups themselves are in memory and per session (undo.ts says so, and
 * command-bus A3 is the source for it), and the durable activity log that will reference
 * checkpoints is the row, not this one.
 *
 * So the ladder counts rows, and `orphans` equals `evict` - each stored row is
 * its own last reference, so deleting it *is* rule 6's cleanup. That equality is
 * asserted in the suite with its reason attached, so that when a later version makes the
 * activity log durable and rows start being shared, the assertion fails loudly
 * instead of quietly outliving the assumption that made it true.
 */

import {
  SNAPSHOT_PROJECT_INDEX,
  SNAPSHOT_STORE,
  readBodySnapshots,
  requireLiveConnection,
  type RuntimeStore,
  type SnapshotRow,
} from './store.js';

const DAY_MS = 86_400_000;

/** Section 5.1 rules 2 and 3, verbatim key names: `retention.checkpointCap` / `retention.checkpointDays`. */
export interface RetentionConfig {
  readonly checkpointCap: number;
  readonly checkpointDays: number;
}

/** The defaults section 5.1 states: 100 checkpoints per project, 30-day retention. */
export const DEFAULT_RETENTION: RetentionConfig = Object.freeze({
  checkpointCap: 100,
  checkpointDays: 30,
});

export class InvalidRetentionConfigError extends Error {
  constructor(
    readonly field: 'checkpointCap' | 'checkpointDays',
    readonly value: unknown,
  ) {
    super(
      `retention.${field} must be a positive whole number, and it is ${String(value)}. ` +
        'A limit of 0 or a negative one is not "no retention" - it would delete every ' +
        'snapshot the moment it is written, and a non-finite one would silently never ' +
        'expire anything at all.',
    );
    this.name = 'InvalidRetentionConfigError';
  }
}

/**
 * Section 5.1's config exposure, merged over the defaults and **refused** when
 * it is nonsense.
 *
 * A settings surface that can express a cap of 0 is a settings surface that can
 * empty the undo history, and one that can express `NaN` from a bad parse is one
 * that can disable retention entirely while the UI still shows a number. Both are
 * refused at the boundary with the field named - the same trade as
 * `DocumentExistsError` over a bare `ConstraintError`, for the same reason.
 */
export function resolveRetentionConfig(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  const merged: RetentionConfig = {
    checkpointCap: overrides.checkpointCap ?? DEFAULT_RETENTION.checkpointCap,
    checkpointDays: overrides.checkpointDays ?? DEFAULT_RETENTION.checkpointDays,
  };
  for (const field of ['checkpointCap', 'checkpointDays'] as const) {
    const value = merged[field];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new InvalidRetentionConfigError(field, value);
    }
  }
  return Object.freeze(merged);
}

/** `projectId/docId/revision` - the snapshot key, as a string a `Set` can hold. */
export function snapshotKey(row: SnapshotRow): string {
  return `${row.projectId} ${row.docId} ${row.revision}`;
}

/**
 * Capture order, oldest first - section 5.1 rule 2's "oldest evicted first".
 *
 * `capturedAt` alone is not a total order: one agent turn can capture several
 * documents in the same millisecond, and a comparator that returns 0 for those
 * leaves the eviction order to `Array.prototype.sort`'s stability, which is a
 * property of the input rather than of the rule. The tie breaks on the key, so
 * two callers holding the same rows in different orders compute the same plan.
 */
function compareOldestFirst(a: SnapshotRow, b: SnapshotRow): number {
  if (a.capturedAt !== b.capturedAt) return a.capturedAt - b.capturedAt;
  if (a.docId !== b.docId) return a.docId < b.docId ? -1 : 1;
  return a.revision - b.revision;
}

/**
 * Rule 5's pins: the first row of every document that still has a later one.
 *
 * The conditional is section 5.1's own - *"while any later snapshot of a doc
 * exists"* - and it cuts both ways. A document with one row has no baseline to
 * protect and is evictable on age; a document with two or more has one, and that
 * one is not negotiable against the other two limits.
 */
function pinFirstPerDoc(rows: readonly SnapshotRow[]): Set<string> {
  const firstOf = new Map<string, SnapshotRow>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.docId, (counts.get(row.docId) ?? 0) + 1);
    if (!firstOf.has(row.docId)) firstOf.set(row.docId, row);
  }
  const pins = new Set<string>();
  for (const [docId, count] of counts) {
    if (count > 1) pins.add(snapshotKey(firstOf.get(docId)!));
  }
  return pins;
}

export interface EvictionPlan {
  /** The rows that survive, oldest first. */
  readonly retain: readonly SnapshotRow[];
  /** Every row this plan deletes - the union of rule 3's and rule 2's evictions. */
  readonly evict: readonly SnapshotRow[];
  /** Deleted by rule 3, the 30-day limit. */
  readonly expired: readonly SnapshotRow[];
  /** Deleted by rule 2, the per-project cap. Disjoint from `expired`. */
  readonly overCap: readonly SnapshotRow[];
  /** Rows rule 5 saved from an eviction this plan would otherwise have made. */
  readonly pinned: readonly SnapshotRow[];
  /**
   * Rule 6: rows no remaining checkpoint references, which this plan therefore
   * deletes from the store. **Equal to `evict` in v0.1** - see the file header,
   * and the suite's assertion that names the reason.
   */
  readonly orphans: readonly SnapshotRow[];
  /**
   * `retain.length <= checkpointCap`, or `false` when rule 5's pins hold rows the
   * cap would otherwise have evicted. Surfaced rather than hidden, so rule 8's
   * "the user-visible guarantee that the cap is real" can report the truth in the
   * one case where it is bounded by document count instead.
   */
  readonly capMet: boolean;
}

export function planSnapshotEviction(
  rows: readonly SnapshotRow[],
  today: number,
  config: RetentionConfig = DEFAULT_RETENTION,
): EvictionPlan {
  const resolved = resolveRetentionConfig(config);
  const ordered = [...rows].sort(compareOldestFirst);

  // Rule 5, from the rows this sweep was given - see the header on why not from
  // the survivors.
  const pins = pinFirstPerDoc(ordered);
  const pinned = ordered.filter((row) => pins.has(snapshotKey(row)));

  // Rule 3. A checkpoint is evicted once it is *past* the limit, so a row exactly
  // `checkpointDays` old is still inside it, and a pinned row is past nothing.
  const cutoff = today - resolved.checkpointDays * DAY_MS;
  const withinDays: SnapshotRow[] = [];
  const expired: SnapshotRow[] = [];
  for (const row of ordered) {
    if (row.capturedAt < cutoff && !pins.has(snapshotKey(row))) expired.push(row);
    else withinDays.push(row);
  }

  // Rule 2, oldest first, skipping what rule 5 protects. `excess` is left above
  // zero exactly when the pins are what stands between the project and its cap.
  let excess = withinDays.length - resolved.checkpointCap;
  const retain: SnapshotRow[] = [];
  const overCap: SnapshotRow[] = [];
  for (const row of withinDays) {
    if (excess > 0 && !pins.has(snapshotKey(row))) {
      overCap.push(row);
      excess -= 1;
    } else {
      retain.push(row);
    }
  }

  const evicted = [...expired, ...overCap];

  return {
    retain,
    evict: evicted,
    expired,
    overCap,
    pinned,
    orphans: evicted,
    capMet: retain.length <= resolved.checkpointCap,
  };
}

/**
 * Rule 6's delete, applied in storage: the rows the plan rejects go in one
 * transaction, so a sweep that fails part-way leaves every snapshot the project
 * had. Same one-transaction rule as section 4's writes, for the same reason —
 * and for the same reason it needs its own proof: §4's atomicity tests drive
 * `writeProjectState`, not this function, so a sweep that opened one
 * transaction per row would leave two of three rows behind and pass every one
 * of them. `a sweep that fails part-way leaves every snapshot the project had`
 * arms `MemoryIndexedDb.abortAfterWrites` mid-transaction and reads storage
 * directly; splitting the deletes across transactions fails exactly it.
 *
 * The plan is computed **inside** the transaction, from the rows that
 * transaction read, rather than from a list the caller read earlier: deleting
 * rows chosen against a stale list would evict against a count that had already
 * moved, which is section 3's zero-partial-effects shape applied to storage.
 */
export function evictSnapshots(
  store: RuntimeStore,
  projectId: string,
  today: number = Date.now(),
  config: RetentionConfig = DEFAULT_RETENTION,
): Promise<EvictionPlan> {
  const resolved = resolveRetentionConfig(config);
  return new Promise<EvictionPlan>((resolve, reject) => {
    // A store another tab upgraded refuses the sweep by name (RuntimeStoreStaleError), as every other write does.
    requireLiveConnection(store);
    const tx = store.db.transaction(SNAPSHOT_STORE, 'readwrite');
    let plan: EvictionPlan | undefined;
    tx.oncomplete = () => {
      resolve(plan ?? planSnapshotEviction([], today, resolved));
    };
    tx.onabort = () => reject(tx.error ?? new Error('the snapshot retention sweep was aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('the snapshot retention sweep failed'));
    const request = tx.objectStore(SNAPSHOT_STORE).index(SNAPSHOT_PROJECT_INDEX).getAll(projectId);
    request.onsuccess = () => {
      plan = planSnapshotEviction(request.result as SnapshotRow[], today, resolved);
      const snapshots = tx.objectStore(SNAPSHOT_STORE);
      for (const row of plan.evict) {
        snapshots.delete([row.projectId, row.docId, row.revision]);
      }
    };
  });
}

export interface SnapshotBudget {
  readonly count: number;
  /**
   * Rule 8's "estimated size", in bytes, as `body.length * 2` - the UTF-16 code
   * units a JS string holds, and an *estimate* by section 5.1's own wording,
   * rather than a figure read back from the storage engine.
   */
  readonly estimatedBytes: number;
  readonly oldest: number | undefined;
  readonly newest: number | undefined;
  readonly documents: number;
}

/**
 * Rule 8's numbers, for Settings > Data to render: count, estimated size, the
 * span the rows cover, and how many documents they belong to. The surface itself
 * is not this slice's to build - this returns what it would show, and
 * `evictSnapshots` is the "trim to cap now" behind its button.
 *
 * **It reads and does not evict**, and that distinction is the whole reason it is
 * a separate function: a "how much is stored" question must never be answered by
 * deleting something.
 *
 * **It also cannot report `capMet`, and the Settings surface will need both.**
 * docs/decisions.md closes with *"rule 8's Settings surface, which
 * must render `capMet` rather than the cap number alone"* - and this function is
 * the one a surface calls for its numbers, so a surface built from this return
 * value alone would show the count with no indication of the one case where the
 * cap is not met. That is deliberate rather than an oversight: `capMet` is a
 * property of a *plan*, so it costs a second pass (`planSnapshotEviction` over
 * the same rows, or the plan `evictSnapshots` already returns) to get, and
 * folding it in here would mean this function either deletes or duplicates the
 * sweep's work. **A surface that shows the budget should read the two together.**
 */
export async function snapshotBudget(
  store: RuntimeStore,
  projectId: string,
): Promise<SnapshotBudget> {
  const rows = await readBodySnapshots(store, projectId);
  let estimatedBytes = 0;
  let oldest: number | undefined;
  let newest: number | undefined;
  const documents = new Set<string>();
  for (const row of rows) {
    estimatedBytes += row.body.length * 2;
    documents.add(row.docId);
    // `readBodySnapshots` returns primary-key order - grouped by document and
    // ascending by revision within it - so the span is a min/max over the captures
    // and NOT `rows[0]` and `rows[rows.length - 1]`. Those two are the ends of
    // the *key*, and a revision is not a clock: document `b` at revision 1 is
    // newer than document `a` at revision 9 and sits earlier in that order.
    if (oldest === undefined || row.capturedAt < oldest) oldest = row.capturedAt;
    if (newest === undefined || row.capturedAt > newest) newest = row.capturedAt;
  }
  return {
    count: rows.length,
    estimatedBytes,
    oldest,
    newest,
    documents: documents.size,
  };
}
