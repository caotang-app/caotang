/**
 * The snapshot-eviction invariant fixture — command-bus.md §5.1, driven by real writes.
 *
 * Every agent turn that writes a body captures the body before the write (the store's apply does
 * this, and the snapshot sink receives it). This fixture makes 108 such writes through the harness's
 * own scene-draft path, with a clock that puts some of them past the 30-day limit, and then asks the
 * store's retention planner what to keep. The invariants are §5.1's, not the planner's own.
 */

import { describe, expect, it } from 'vitest';

import { createProjectCommandRegistry, getRevision, planSnapshotEviction, type BodySnapshot, type SnapshotRow } from '@caotang/store';

import { createAgentPorts } from '../../src/agent/ports.js';
import { createHarness } from '../../src/runtime.js';
import { LANDING, STORM, makeState } from '../fixtures.js';

/** command-bus §5.1 rule 2: the per-project cap. */
const DEFAULT_RETENTION_CAP = 100;
const DAY = 86_400_000;

describe('snapshot eviction, against writes the harness actually made (command-bus §5.1)', () => {
  it('keeps the cap, keeps the first snapshot of every document, expires the old, and orphans nothing', () => {
    const rows: BodySnapshot[] = [];
    let now = 0;
    const clock = () => now;
    const registry = createProjectCommandRegistry({ clock: { now: clock }, snapshots: (row) => void rows.push(row) });
    const state = makeState();
    const harness = createHarness({ state, registry, ports: createAgentPorts(), clock });

    // Five writes long before "today" (past the 30-day limit), then the rest a little before it.
    const today = 100 * DAY;
    const writes: { doc: string; count: number; at: number }[] = [
      { doc: LANDING, count: 5, at: today - 40 * DAY },
      { doc: LANDING, count: 100, at: today - 2 * DAY },
      { doc: STORM, count: 3, at: today - 2 * DAY },
    ];
    let seq = 0;
    for (const write of writes) {
      for (let index = 0; index < write.count; index += 1) {
        seq += 1;
        now = write.at + index;
        const outcome = harness.call(
          {
            name: 'scene.draft',
            callId: `evict-${seq}`,
            params: { doc: write.doc, mode: 'continue', instruction: 'continue the scene' },
            proposal: { text: `Line ${seq}.`, words: 2, revision: getRevision(state, write.doc) },
          },
          { turnId: `evict-turn-${seq}`, permission: { confirmed: true } },
        );
        expect(outcome.ok, `write ${seq} to ${write.doc} should apply`).toBe(true);
        harness.endTurn(`evict-turn-${seq}`);
      }
    }
    expect(rows.length).toBe(108);

    const plan = planSnapshotEviction(rows as readonly SnapshotRow[], today + DAY);

    // §5.1 rule 2: the cap holds, unless first-snapshot pins make it impossible (rule 5), which is reported, not hidden.
    expect(plan.retain.length).toBeLessThanOrEqual(DEFAULT_RETENTION_CAP);
    expect(plan.capMet).toBe(true);

    // §5.1 rule 5: the first snapshot of each document is never evicted, however old or however many later ones exist.
    const firstOf = (docId: string) => rows.filter((row) => row.docId === docId).sort((a, b) => a.revision - b.revision)[0];
    const retainedKeys = new Set(plan.retain.map((row) => `${row.docId}:${row.revision}`));
    expect(retainedKeys.has(`${LANDING}:${firstOf(LANDING)?.revision}`)).toBe(true);
    expect(retainedKeys.has(`${STORM}:${firstOf(STORM)?.revision}`)).toBe(true);

    // §5.1 rule 3: past the 30-day limit is evicted, except the pinned first snapshots.
    for (const row of plan.expired) {
      expect(retainedKeys.has(`${row.docId}:${row.revision}`)).toBe(false);
    }

    // §5.1 rule 6: nothing is left orphaned. Every evicted row is named as an orphan, and no retained row is.
    const evictedKeys = new Set(plan.evict.map((row) => `${row.docId}:${row.revision}`));
    expect(plan.orphans.length).toBe(plan.evict.length);
    for (const row of plan.orphans) expect(evictedKeys.has(`${row.docId}:${row.revision}`)).toBe(true);

    // The plan partitions the snapshots: each is kept or evicted, never both.
    expect(plan.retain.length + plan.evict.length).toBe(rows.length);
    for (const key of retainedKeys) expect(evictedKeys.has(key)).toBe(false);

    // Determinism (§5.1): the same rows and the same day give the same plan.
    const again = planSnapshotEviction(rows as readonly SnapshotRow[], today + DAY);
    expect(again.retain.map((row) => row.revision)).toEqual(plan.retain.map((row) => row.revision));
  });
});
