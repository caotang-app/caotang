/**
 * The bus's rules for `coherence.discardRun` (coherence.md §7.1, §8): the descriptor's validate, and the rule that
 * decides which findings a discard takes, which the store's apply and the coherence lifecycle both use.
 */

import { describe, expect, it } from 'vitest';

import { COMMAND_REGISTRY, findingsDiscardedWith, type ValidationSnapshot } from '../src/index.js';

const RUN_A = 'r_AAAAAAAAAA';
const RUN_B = 'r_BBBBBBBBBB';

function snapshot(coherence: ValidationSnapshot['coherence']): ValidationSnapshot {
  return {
    manifest: { tree: [], vocabulary: { statuses: [], labels: [] } },
    documents: new Map(),
    ...(coherence === undefined ? {} : { coherence }),
  };
}

describe('coherence.discardRun descriptor (coherence.md §7.1, §8)', () => {
  const descriptor = COMMAND_REGISTRY['coherence.discardRun'].descriptor;

  it('accepts a run the file holds, and names it as the parameter', () => {
    const result = descriptor.validate({ runId: RUN_A }, snapshot({ findings: [], sceneMeta: {}, runs: [{ id: RUN_A }] }));
    expect(result).toEqual({ ok: true, value: { runId: RUN_A } });
  });

  it('refuses a run the file does not hold, with the way to find one', () => {
    const result = descriptor.validate({ runId: RUN_B }, snapshot({ findings: [], sceneMeta: {}, runs: [{ id: RUN_A }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(`no run has id "${RUN_B}"`);
      expect(result.error.correctiveHint).toBe('use a run from the run history in the findings tab');
    }
  });

  it('refuses when no coherence file is open, rather than creating one to discard from', () => {
    const result = descriptor.validate({ runId: RUN_A }, snapshot(undefined));
    expect(result.ok).toBe(false);
  });

  it('refuses an unknown parameter, and a blank run id', () => {
    expect(descriptor.validate({ runId: RUN_A, extra: true }, snapshot({ findings: [], sceneMeta: {}, runs: [{ id: RUN_A }] })).ok).toBe(false);
    expect(descriptor.validate({ runId: '  ' }, snapshot({ findings: [], sceneMeta: {}, runs: [{ id: RUN_A }] })).ok).toBe(false);
  });

  it('is write-confirm for the agent and undoable by compensation, the way its apply keeps what it took', () => {
    expect(descriptor.agentRisk).toBe('write-confirm');
    expect(descriptor.undo).toBe('compensable');
  });
});

describe('findingsDiscardedWith (coherence.md §7.1)', () => {
  const made = (id: string, extra: { createdByRunId?: string; touchedAt?: string } = {}) => ({ id, ...extra });

  it('takes the findings a run made and nobody touched, and keeps a touched one and another run’s', () => {
    const findings = [
      made('f_untouched', { createdByRunId: RUN_A }),
      made('f_touched', { createdByRunId: RUN_A, touchedAt: '2026-10-08T10:00:00.000Z' }),
      made('f_other', { createdByRunId: RUN_B }),
      made('f_legacy'),
    ];
    const { kept, removed } = findingsDiscardedWith(findings, RUN_A);
    expect(removed.map((finding) => finding.id)).toEqual(['f_untouched']);
    expect(kept.map((finding) => finding.id)).toEqual(['f_touched', 'f_other', 'f_legacy']);
  });

  it('removes nothing when the run made nothing, so a discard of an empty run is a no-op for findings', () => {
    const { kept, removed } = findingsDiscardedWith([made('f_other', { createdByRunId: RUN_B })], RUN_A);
    expect(removed).toEqual([]);
    expect(kept).toHaveLength(1);
  });
});
