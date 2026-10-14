/**
 * Section 5.1's retention ladder - [command-bus.md](docs/architecture/command-bus.md) 5.1.
 *
 * Every test names the sentence it defends, and the shape of the assertion
 * follows the sentence: a limit is tested on **both** edges, two limits that
 * disagree are tested on the case where they disagree, and the store sweep is
 * tested by looking for what survived rather than for a success path.
 *
 * One trap runs through this file, and most of the fixtures below dodge it
 * deliberately. **The oldest row of a document is its pinned baseline**, so a
 * single-document fixture cannot test the cap or the age limit at all: the one row
 * the limit would reach first is the one rule 5 protects. Fixtures that test rules
 * 2 and 3 therefore use one row per document, and only the rule 5 tests reuse a
 * document.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryIndexedDb } from '../src/runtime/memory-idb.js';
import {
  DEFAULT_RETENTION,
  InvalidRetentionConfigError,
  evictSnapshots,
  planSnapshotEviction,
  resolveRetentionConfig,
  snapshotBudget,
  snapshotKey,
} from '../src/runtime/retention.js';
import {
  SNAPSHOT_STORE,
  openRuntimeStore,
  readBodySnapshots,
  writeBodySnapshot,
  type RuntimeStore,
  type SnapshotRow,
} from '../src/runtime/store.js';

const DB = 'caotang-retention-test';
const DAY = 86_400_000;
/** A fixed "today" - the clock is injected precisely so this is a constant. */
const TODAY = Date.parse('2026-10-03T00:00:00.000Z');
/** A window long enough that the age limit never fires, so a cap test is a cap test. */
const NEVER = 3650;

let store: RuntimeStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
});

async function openStore(): Promise<RuntimeStore> {
  const db = new MemoryIndexedDb();
  store = await openRuntimeStore(db, DB);
  return store;
}

/** A row with a stable key; `days` is how long ago it was captured. */
function row(
  docId: string,
  revision: number,
  days: number,
  body = `body of ${docId} at ${revision}`,
): SnapshotRow {
  return {
    projectId: 'p_1',
    docId,
    revision,
    body,
    capturedAt: TODAY - days * DAY,
    command: 'editor.replaceRange',
  };
}

const key = (r: SnapshotRow) => snapshotKey(r);
const keys = (rows: readonly SnapshotRow[]) => rows.map(key).sort();

// ---------------------------------------------------------------------------

describe('rule 2 - cap: 100 checkpoints per project, oldest evicted first', () => {
  it('is a no-op at exactly the cap and evicts one row at one over it', () => {
    const at = Array.from({ length: 100 }, (_, i) => row(i % 2 === 0 ? 'a' : 'b', i, 100 - i));
    const over = [...at, row('a', 100, 0)];

    expect(planSnapshotEviction(at, TODAY, { checkpointCap: 100, checkpointDays: NEVER }).evict).toHaveLength(0);
    expect(planSnapshotEviction(over, TODAY, { checkpointCap: 100, checkpointDays: NEVER }).evict).toHaveLength(1);
  });

  it('evicts the oldest row that is not a baseline, and the two oldest are the baselines', () => {
    const rows = Array.from({ length: 101 }, (_, i) => row(i % 2 === 0 ? 'a' : 'b', i, 101 - i));
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 100, checkpointDays: NEVER });

    expect(plan.retain).toHaveLength(100);
    // Revisions 0 and 1 are each their document's first snapshot, so rule 5 holds
    // them and the cap reaches the next one instead.
    expect(plan.overCap.map((r) => r.revision)).toEqual([2]);
    expect(keys(plan.pinned)).toEqual([key(rows[0]!), key(rows[1]!)].sort());
    expect(plan.capMet).toBe(true);
  });

  it('takes the oldest, not the lowest revision - capturedAt decides', () => {
    // Revision 9 is older than revision 0, so rule 2's "oldest" evicts 9 first.
    // Two documents, so neither row is a baseline and the cap can reach either.
    const young = row('a', 0, 1);
    const old = row('b', 9, 40);
    const plan = planSnapshotEviction([young, old], TODAY, { checkpointCap: 1, checkpointDays: NEVER });

    expect(plan.overCap.map((r) => r.revision)).toEqual([9]);
    expect(plan.retain.map((r) => r.revision)).toEqual([0]);
  });
});

describe('rule 3 - retention: 30 days, past either limit a checkpoint is evicted', () => {
  it('evicts past the window and keeps at it, on both edges of the boundary', () => {
    // One row per document, or the oldest of them would be a pinned baseline.
    const past = row('a', 1, 31);
    const exactly = row('b', 1, 30);
    const inside = row('c', 1, 29);

    const plan = planSnapshotEviction([past, exactly, inside], TODAY);

    expect(plan.expired).toHaveLength(1);
    expect(key(plan.expired[0]!)).toBe(key(past));
    // Exactly 30 days is *at* the limit, not past it.
    expect(keys(plan.retain)).toEqual([key(exactly), key(inside)].sort());
  });

  it('takes checkpointDays from the config, not from a constant', () => {
    const plan = planSnapshotEviction([row('a', 1, 8)], TODAY, { checkpointCap: 100, checkpointDays: 7 });
    expect(plan.expired).toHaveLength(1);

    const kept = planSnapshotEviction([row('a', 1, 8)], TODAY, { checkpointCap: 100, checkpointDays: 9 });
    expect(kept.expired).toHaveLength(0);
  });
});

describe('rule 5 - first-snapshot-per-doc preserved while any later snapshot exists', () => {
  it('keeps the baseline and evicts the later ones', () => {
    const rows = [row('a', 1, 40), row('a', 2, 3), row('a', 3, 1), row('b', 1, 2), row('b', 2, 1)];
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 2, checkpointDays: 30 });

    // a@1 and b@1 are the baselines; the cap evicts the three non-baselines.
    expect(keys(plan.retain)).toEqual([key(rows[0]!), key(rows[3]!)].sort());
    expect(keys(plan.overCap)).toEqual([key(rows[1]!), key(rows[2]!), key(rows[4]!)].sort());
    expect(plan.pinned).toHaveLength(2);
    expect(plan.capMet).toBe(true);
  });

  it('does NOT protect a document that has only one snapshot - there is no baseline', () => {
    const lonely = row('solo', 7, 90);
    const plan = planSnapshotEviction([lonely], TODAY);

    expect(plan.expired).toHaveLength(1);
    expect(key(plan.expired[0]!)).toBe(key(lonely));
    expect(plan.pinned).toHaveLength(0);
  });

  it('survives rule 3: a baseline older than the window is still a baseline', () => {
    // Rule 5 says "never evicted", against both other limits, and its own stated
    // reason agrees - a baseline evicted on a timer is not a baseline.
    const baseline = row('a', 1, 400);
    const later = row('a', 2, 1);
    const plan = planSnapshotEviction([baseline, later], TODAY);

    expect(plan.expired).toHaveLength(0);
    expect(plan.overCap).toHaveLength(0);
    expect(keys(plan.retain)).toEqual([key(baseline), key(later)].sort());
  });

  it('reads the conditional rather than assuming it: alone, the same row ages out', () => {
    // The pin holds *while a later snapshot exists*. Strip the later one and the
    // row is an ordinary 40-day-old checkpoint.
    const baseline = row('a', 1, 40);
    const together = planSnapshotEviction([baseline, row('a', 2, 2)], TODAY);
    expect(together.expired).toHaveLength(0);

    const alone = planSnapshotEviction(together.retain.slice(0, 1), TODAY);
    expect(alone.expired).toHaveLength(1);
    expect(key(alone.expired[0]!)).toBe(key(baseline));
  });

  it('does not cascade: trimming a document’s later rows does not cost it its baseline', () => {
    // The re-derive-per-round ladder would drop a@1 here, after a@2 went, and
    // rule 5's stated purpose is exactly what that destroys.
    const rows = [row('a', 1, 40), row('a', 2, 2), row('a', 3, 1)];
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });

    expect(keys(plan.retain)).toEqual([key(rows[0]!)]);
  });
});

describe('the cap against the pins - the one case where the cap is not met', () => {
  it('reports capMet false when baselines hold rows the cap would have evicted', () => {
    // a@1 and b@1 are both pinned and both 45+ days old. Rule 3 cannot take them,
    // rule 2 cannot take them, and the cap of 1 is left with 2 rows.
    const rows = [
      row('a', 1, 50),
      row('a', 2, 40),
      row('a', 3, 30),
      row('b', 1, 45),
      row('b', 2, 35),
    ];
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });

    expect(plan.capMet).toBe(false);
    expect(keys(plan.retain)).toEqual([key(rows[0]!), key(rows[3]!)].sort());
    expect(plan.retain).toHaveLength(2);
    // The non-baselines all went, each on the limit that owns it.
    expect(keys(plan.expired)).toEqual([key(rows[1]!), key(rows[4]!)].sort());
    expect(keys(plan.overCap)).toEqual([key(rows[2]!)]);
  });

  it('capMet is true whenever the retained rows are not all baselines', () => {
    for (const cap of [1, 2, 3, 5]) {
      for (const docs of [1, 2, 5]) {
        for (const perDoc of [1, 2, 3]) {
          const rows: SnapshotRow[] = [];
          for (let d = 0; d < docs; d += 1) {
            for (let n = 0; n < perDoc; n += 1) {
              rows.push(row(`doc${d}`, n, perDoc - n));
            }
          }
          const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: cap, checkpointDays: NEVER });

          // Whatever the pins do, every retained row is either inside the cap or
          // is a baseline. That is the whole of rule 2's reach.
          const allPinned = plan.retain.every((r) => plan.pinned.some((p) => key(p) === key(r)));
          expect(plan.capMet).toBe(allPinned ? plan.retain.length <= cap : true);
          if (plan.capMet) expect(plan.retain.length).toBeLessThanOrEqual(cap);
        }
      }
    }
  });
});

describe('rule 6 - orphan cleanup on eviction', () => {
  it('orphans equal evictions, and that is the reason the store delete is the same list', () => {
    const rows = [row('a', 1, 40), row('a', 2, 2), row('b', 1, 1)];
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });

    // b@1 is a document's only snapshot, so it is not a baseline and the cap
    // reaches it; a@2 is evicted as the non-baseline of its document.
    expect(keys(plan.evict)).toEqual(keys(plan.orphans));
    expect(plan.orphans).toHaveLength(2);
  });

  it('no retained row is ever listed as an orphan', () => {
    // Every stored row is its own last reference in v0.1 (see the file header), so
    // rule 6's cleanup is exactly the eviction list. When a later version makes the activity
    // log durable and rows start being shared, this is the tripwire that says the
    // assumption has expired.
    const rows = [row('a', 1, 40), row('a', 2, 2), row('a', 3, 1), row('b', 1, 1), row('b', 2, 99)];
    const plan = planSnapshotEviction(rows, TODAY, { checkpointCap: 2, checkpointDays: 30 });

    const orphans = new Set(keys(plan.orphans));
    expect(plan.retain.filter((r) => orphans.has(key(r)))).toHaveLength(0);
  });
});

describe('the plan is a pure function - 5.1s "headless-testable"', () => {
  it('does not read the clock: same rows, same today, same plan', () => {
    const rows = [row('a', 1, 40), row('a', 2, 2), row('b', 1, 1)];
    const a = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });
    const b = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });
    expect(keys(a.retain)).toEqual(keys(b.retain));
  });

  it('does not mutate the list it is given', () => {
    const rows = [row('a', 2, 1), row('a', 1, 40), row('b', 1, 3)];
    const before = rows.map(key);
    planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: 30 });
    expect(rows.map(key)).toEqual(before);
  });

  it('is order-independent - capturedAt ties break on the key, not on sort stability', () => {
    const rows = [row('b', 1, 5), row('a', 2, 5), row('a', 1, 5), row('b', 2, 5)];
    const forward = planSnapshotEviction(rows, TODAY, { checkpointCap: 1, checkpointDays: NEVER });
    const reversed = planSnapshotEvocationSafe(rows, TODAY);
    expect(keys(forward.evict)).toEqual(keys(reversed));
  });

  it('converges to the cap over repeated sweeps - rule 8s "the cap is real"', () => {
    // Four documents, three rows each, cap 3. The first sweep leaves the four
    // baselines and reports capMet false, because rule 5 holds all four. Once each
    // document is down to its baseline there is no *later* snapshot, so the
    // conditional in rule 5 no longer holds it, and the next sweep reaches the cap.
    // The cap is therefore real over time and only one sweep late.
    const rows: SnapshotRow[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(row(`doc${i % 4}`, i, 40 - i));
    const config = { checkpointCap: 3, checkpointDays: NEVER };

    const first = planSnapshotEviction(rows, TODAY, config);
    expect(first.capMet).toBe(false);
    expect(first.retain).toHaveLength(4);

    const second = planSnapshotEviction(first.retain, TODAY, config);
    expect(second.retain).toHaveLength(3);
    expect(second.capMet).toBe(true);

    const third = planSnapshotEviction(second.retain, TODAY, config);
    expect(third.evict).toHaveLength(0);
    expect(keys(third.retain)).toEqual(keys(second.retain));
  });
});

/** Same plan, fed the rows in the opposite order. */
function planSnapshotEvocationSafe(rows: readonly SnapshotRow[], today: number): readonly SnapshotRow[] {
  return planSnapshotEviction([...rows].reverse(), today, { checkpointCap: 1, checkpointDays: NEVER }).evict;
}

describe('the config exposure - rules 2 and 3 are "config-exposed"', () => {
  it('defaults to the numbers 5.1 states', () => {
    expect(DEFAULT_RETENTION).toEqual({ checkpointCap: 100, checkpointDays: 30 });
    expect(resolveRetentionConfig()).toEqual(DEFAULT_RETENTION);
  });

  it('merges a partial override over the defaults', () => {
    expect(resolveRetentionConfig({ checkpointCap: 5 })).toEqual({ checkpointCap: 5, checkpointDays: 30 });
  });

  it('refuses a cap or a window that would destroy or disable retention', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveRetentionConfig({ checkpointCap: bad })).toThrow(InvalidRetentionConfigError);
      expect(() => resolveRetentionConfig({ checkpointDays: bad })).toThrow(InvalidRetentionConfigError);
    }
  });

  it('names the field, so a settings surface can say which control is wrong', () => {
    try {
      resolveRetentionConfig({ checkpointDays: 0 });
      expect.unreachable('a zero retention window must be refused');
    } catch (thrown) {
      expect((thrown as InvalidRetentionConfigError).field).toBe('checkpointDays');
    }
  });
});

describe('the sweep - one transaction over the real store', () => {
  it('removes the evicted rows, leaves the rest, and reports what it did', async () => {
    const db = await openStore();
    const rows = [row('a', 1, 40), row('a', 2, 2), row('b', 1, 1)];
    for (const r of rows) await writeBodySnapshot(db, r);

    const plan = await evictSnapshots(db, 'p_1', TODAY, { checkpointCap: 1, checkpointDays: 30 });

    const left = await readBodySnapshots(db, 'p_1');
    expect(keys(left)).toEqual(keys(plan.retain));
    // Only a@1 survives: it is a@2's baseline, and b@1 is a document's only
    // snapshot, so nothing protects it from a cap of 1.
    expect(keys(left)).toEqual([key(rows[0]!)]);
  });

  it('leaves another project’s snapshots alone', async () => {
    const db = await openStore();
    await writeBodySnapshot(db, row('a', 1, 400));
    await writeBodySnapshot(db, { ...row('a', 1, 400), projectId: 'p_2' });

    await evictSnapshots(db, 'p_1', TODAY);

    expect(await readBodySnapshots(db, 'p_2')).toHaveLength(1);
  });

  it('is a no-op on a project with no snapshots', async () => {
    const db = await openStore();
    const plan = await evictSnapshots(db, 'nobody', TODAY);
    expect(plan.evict).toHaveLength(0);
    expect(plan.retain).toHaveLength(0);
  });

  it('a sweep that fails part-way leaves every snapshot the project had', async () => {
    // The file header claims the deletes go in one transaction "so a sweep that
    // fails part-way leaves every snapshot the project had", and names section
    // 4's one-transaction rule as the reason. That claim is about what survives
    // a *failure*, so it cannot be shown by a sweep that succeeds -
    // `abortAfterWrites` is the corpus's own hook for making an abort observable
    // part-way (memory-idb.ts), and runtime-store.test.ts uses it on section 4's
    // identical claim. Two rows must be in the plan, or the abort lands after
    // the only delete and proves nothing about the ones before it.
    const db = new MemoryIndexedDb();
    store = await openRuntimeStore(db, DB);
    const rows = [row('a', 1, 40), row('a', 2, 2), row('a', 3, 1), row('b', 1, 1), row('b', 2, 99)];
    for (const r of rows) await writeBodySnapshot(store, r);
    const config = { checkpointCap: 2, checkpointDays: 30 } as const;
    expect(planSnapshotEviction(rows, TODAY, config).evict).toHaveLength(3);

    db.abortAfterWrites(1);

    await expect(evictSnapshots(store, 'p_1', TODAY, config)).rejects.toThrow();

    // Read storage rather than the store's own read path, so a bug in that path
    // cannot hide a write that did or did not land.
    expect(db.rawRecords(DB, SNAPSHOT_STORE)).toHaveLength(rows.length);
  });

  it('repeated sweeps converge - the second deletes nothing', async () => {
    const db = await openStore();
    for (let i = 0; i < 6; i += 1) await writeBodySnapshot(db, row(i % 2 === 0 ? 'a' : 'b', i, 20 - i * 2));

    await evictSnapshots(db, 'p_1', TODAY, { checkpointCap: 2, checkpointDays: 30 });
    const second = await evictSnapshots(db, 'p_1', TODAY, { checkpointCap: 2, checkpointDays: 30 });

    expect(second.evict).toHaveLength(0);
    expect(await readBodySnapshots(db, 'p_1')).toHaveLength(2);
  });
});

describe('rule 8 - the numbers Settings > Data will show', () => {
  it('reports count, the size estimate, the span and the document count', async () => {
    const db = await openStore();
    // Deliberately arranged so primary-key order and capture order disagree.
    // `readBodySnapshots` returns [projectId, docId, revision], so a span read off
    // `rows[0]` and `rows[rows.length - 1]` would report 1 day and 3 days here
    // instead of the true 5 and 1 - a revision is not a clock.
    await writeBodySnapshot(db, { ...row('a', 1, 1, 'abcde'), capturedAt: TODAY - 1 * DAY });
    await writeBodySnapshot(db, { ...row('a', 2, 5, 'xyz'), capturedAt: TODAY - 5 * DAY });
    await writeBodySnapshot(db, { ...row('b', 1, 3, '1234'), capturedAt: TODAY - 3 * DAY });

    const budget = await snapshotBudget(db, 'p_1');

    expect(budget.count).toBe(3);
    expect(budget.documents).toBe(2);
    // body.length * 2 - 5 + 3 + 4 code units, UTF-16.
    expect(budget.estimatedBytes).toBe(12 * 2);
    expect(budget.oldest).toBe(TODAY - 5 * DAY);
    expect(budget.newest).toBe(TODAY - 1 * DAY);
  });

  it('reading the budget deletes nothing - a size question must not evict', async () => {
    const db = await openStore();
    await writeBodySnapshot(db, row('a', 1, 400));

    await snapshotBudget(db, 'p_1');

    // 400 days old and alone: a sweep would take this row. Reading the budget must not.
    expect(await readBodySnapshots(db, 'p_1')).toHaveLength(1);
  });

  it('reports zeroes for a project with no snapshots rather than undefined counts', async () => {
    const db = await openStore();
    const budget = await snapshotBudget(db, 'nobody');
    expect(budget).toMatchObject({ count: 0, estimatedBytes: 0, documents: 0 });
    expect(budget.oldest).toBeUndefined();
  });
});
