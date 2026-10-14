/**
 * Calls from an external caller (`source: 'mcp'`). An external host holds no approval, so a
 * write-confirm tool is refused whatever the call says, and a plan from outside Caotang does not run.
 * A write-auto tool runs for an external caller only where the project has opted in (extensibility
 * §9). The facade is the surface an external caller is handed: it binds the source, takes no
 * approval, and reaches neither a plan runner nor the undo store.
 */

import { describe, expect, it } from 'vitest';

import { CHAPTER_ONE, LANDING, STORM, makeHarness, makeState, refusalOf, run, snapshotOf, valueOf } from './fixtures.js';

describe('a write-confirm tool called from outside Caotang', () => {
  it('is refused even when the call says it is confirmed, because an external host holds no approval', () => {
    const state = makeState();
    const before = snapshotOf(state);
    const error = refusalOf(
      run(makeHarness({}, state), 'binder.restructure', { ops: [{ action: 'rename', node: LANDING, title: 'X' }] }, { source: 'mcp', permission: { confirmed: true } }),
    );
    expect(error.code).toBe('permission-denied');
    expect(error.risk).toBe('write-confirm');
    expect(snapshotOf(state)).toBe(before);
  });

  it('is refused for a plan approval claimed on the wire, the same way', () => {
    const state = makeState();
    const before = snapshotOf(state);
    const error = refusalOf(
      run(makeHarness({}, state), 'codex.write', { entries: [{ action: 'create', name: 'Wire' }] }, { source: 'mcp', permission: { approvedPlan: true } }),
    );
    expect(error.code).toBe('permission-denied');
    expect(snapshotOf(state)).toBe(before);
  });

  it('is told that the user has to run it from Caotang, and not that a plan or a confirmation can carry it', () => {
    const error = refusalOf(
      run(makeHarness(), 'codex.write', { entries: [{ action: 'create', name: 'Wire' }] }, { source: 'mcp', permission: { confirmed: true } }),
    );
    expect(error.message).toContain('from an external caller');
    expect(error.correctiveHint).toContain('from Caotang');
    expect(error.correctiveHint).not.toContain('plan step');
  });

  it('gives doc.import the same external refusal, since no confirmation reaches an external caller in this build', () => {
    const state = makeState();
    const before = snapshotOf(state);
    const error = refusalOf(
      run(makeHarness({}, state), 'doc.import', { parent: CHAPTER_ONE, title: 'Outside', body: 'x' }, { source: 'mcp', permission: { confirmed: true } }),
    );
    expect(error.code).toBe('permission-denied');
    expect(error.correctiveHint).toContain('from Caotang');
    expect(snapshotOf(state)).toBe(before);
  });
});

describe('a write-auto tool called from outside Caotang', () => {
  it('is refused while the project has not opened external writes, and nothing is written or logged', () => {
    const state = makeState();
    const before = snapshotOf(state);
    const harness = makeHarness({}, state);
    const error = refusalOf(run(harness, 'meta.set', { targets: [STORM], status: 'final' }, { source: 'mcp' }));
    expect(error.code).toBe('permission-denied');
    expect(error.risk).toBe('write-auto');
    expect(error.message).toContain('external writes are off for this project');
    expect(error.correctiveHint).toContain('turn on external writes');
    expect(snapshotOf(state)).toBe(before);
    expect(harness.log.length).toBe(0);
  });

  it('is refused for notes.append the same way', () => {
    const error = refusalOf(run(makeHarness(), 'notes.append', { doc: LANDING, text: 'Outside.' }, { source: 'mcp' }));
    expect(error.code).toBe('permission-denied');
  });

  it('runs once the project has opted in, and every row it writes is tagged mcp', () => {
    const state = makeState();
    const harness = makeHarness({ externalWrites: true }, state);
    valueOf(run(harness, 'meta.set', { targets: [STORM], status: 'final' }, { source: 'mcp' }));
    expect(state.manifest.tree.find((node) => node.id === STORM)?.status).toBe('final');
    expect(harness.log.length).toBeGreaterThan(0);
    expect(harness.log.entries().every((entry) => entry.source === 'mcp')).toBe(true);
  });

  it('lets an external caller read whatever the opt-in', () => {
    valueOf(run(makeHarness(), 'project.overview', {}, { source: 'mcp' }));
  });
});

describe('the external facade', () => {
  it('binds every call to the mcp source, whatever the caller would claim', () => {
    const harness = makeHarness({ externalWrites: true });
    const outcome = harness.external.call(
      { name: 'meta.set', callId: 'facade-1', params: { targets: [STORM], status: 'final' } },
      { turnId: 'turn-facade' },
    );
    expect(outcome.ok).toBe(true);
    expect(harness.log.entries().every((entry) => entry.source === 'mcp')).toBe(true);
  });

  it('gives no approval to a call, and reads only the turn id from what it is handed', () => {
    const harness = makeHarness({}, makeState());
    // An adapter may hold a turn with more fields than the type names. The facade reads only the turn id.
    const wireTurn = { turnId: 'turn-wire', permission: { confirmed: true }, source: 'native' };
    const outcome = harness.external.call(
      { name: 'binder.restructure', callId: 'wire-1', params: { ops: [{ action: 'rename', node: LANDING, title: 'X' }] } },
      wireTurn,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('permission-denied');
    // The external refusal, not the native one: the source was bound to mcp.
    expect(outcome.error.message).toContain('from an external caller');
  });

  it('offers no plan runner, no undo store and no log', () => {
    const external = makeHarness().external as unknown as Record<string, unknown>;
    expect(Object.keys(external).sort()).toEqual(['call', 'endTurn', 'tools']);
  });

  it('lists the reads to an external caller, and the write-auto tools only once the project has opted in', () => {
    const closed = makeHarness().external.tools().map((tool) => tool.name);
    expect(closed).toContain('project.overview');
    expect(closed).not.toContain('meta.set');
    expect(closed).not.toContain('binder.restructure');
    const open = makeHarness({ externalWrites: true }).external.tools().map((tool) => tool.name);
    expect(open).toContain('meta.set');
    expect(open).toContain('notes.append');
    expect(open).not.toContain('binder.restructure');
    expect(open).not.toContain('agent.plan');
  });

  it('keeps an external turn apart from a native turn that uses the same ids, so the native answer is not replayed', () => {
    const state = makeState();
    const harness = makeHarness({}, state);
    valueOf(run(harness, 'meta.set', { targets: [LANDING], status: 'final' }, { turnId: 'turn-shared', callId: 'call-shared' }));
    // The same turn id, call id and params, from outside, with no opt-in. A shared cache would answer it with the native success.
    const replayed = harness.external.call(
      { name: 'meta.set', callId: 'call-shared', params: { targets: [LANDING], status: 'final' } },
      { turnId: 'turn-shared' },
    );
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.error.code).toBe('permission-denied');
  });
});

describe('executePlan from outside Caotang', () => {
  it('refuses the plan outright, because a plan runs only after the user approves its card', () => {
    const state = makeState();
    const harness = makeHarness({}, state);
    const before = snapshotOf(state);
    const result = harness.executePlan(
      { steps: [{ tool: 'meta.set', params: { targets: [STORM], status: 'final' }, expect: 'finalise' }] },
      { turnId: 'turn-ext', callId: 'plan-ext', source: 'mcp' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
    expect(result.error.message).toContain('a plan runs only after the user approves its card in Caotang');
    expect(snapshotOf(state)).toBe(before);
    expect(harness.log.length).toBe(0);
  });

  it('still lets the app run a plan under the native source, which is the approval path', () => {
    const harness = makeHarness();
    const result = harness.executePlan(
      { steps: [{ tool: 'meta.set', params: { targets: [STORM], status: 'final' }, expect: 'finalise' }] },
      { turnId: 'turn-app', callId: 'plan-app' },
    );
    expect(result.ok && result.value.status).toBe('applied');
  });
});
