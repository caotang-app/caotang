/**
 * The two binder/corkboard view commands — `view.setExpanded` and
 * `view.setCorkboardScope`, the binder's expansion overrides and the corkboard's
 * container.
 *
 * They follow the three original view commands' rules exactly: shape-only
 * validation, `mutates: 'view'`, no undo, an activity-log row with no `affected`
 * list, and nothing persisted. These tests pin those rules for the two new names
 * one by one, so a regression in either is named by the test that fails.
 */

import { describe, expect, it } from 'vitest';

import {
  COMMAND_REGISTRY,
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  isViewState,
  lookupCommand,
  type BusContext,
  type Command,
  type CommandName,
  type CommandError,
  type ViewState,
} from '../src/index.js';
import { CHAPTER_ONE, MANUSCRIPT, THE_LANDING, UNKNOWN_ID, makeSnapshot } from './fixtures.js';

function cmd(name: CommandName, params: Record<string, unknown>, issuedBy: 'user' | 'agent' = 'user'): Command {
  return { id: `cmd_TEST${name.length}`, name, params, issuedBy, createdAt: 0, ...(issuedBy === 'agent' ? { turnId: 't1' } : {}) };
}

/** A bus over the shipped pieces, with the view state held where the test can read it. */
function bus(view: ViewState = createViewState()) {
  const log = createActivityLog();
  const undo = createUndoStore();
  let notified = 0;
  const context: BusContext = {
    state: { name: 'project state, never handed to a view command' },
    view,
    read: () => makeSnapshot(),
    undo,
    log,
    idempotency: createIdempotencyCache(),
    notify: () => {
      notified += 1;
    },
  };
  return { context, log, undo, view, notified: () => notified };
}

function refusal(result: { ok: boolean; error?: CommandError }): CommandError {
  if (result.ok || result.error === undefined) throw new Error('expected a refusal');
  return result.error;
}

function validate(name: CommandName, params: unknown) {
  const registration = lookupCommand(name);
  if (!registration.ok) throw new Error(`no registration for ${name}`);
  return registration.value.descriptor.validate(params, makeSnapshot());
}

describe('view.setExpanded — the binder’s expansion override', () => {
  it('is declared as a view command, granted as a read, and never undo-registered', () => {
    const { descriptor } = COMMAND_REGISTRY['view.setExpanded'];
    expect(descriptor.mutates).toBe('view');
    expect(descriptor.agentRisk).toBe('read');
    expect(descriptor.undo).toBe('none');
  });

  it('validates a folder id and a boolean, and nothing else', () => {
    const ok = validate('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: false });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value).toEqual({ nodeId: CHAPTER_ONE, expanded: false });
  });

  it('refuses a non-boolean expanded and says what it wanted', () => {
    const error = refusal(validate('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: 'yes' }));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('params.expanded must be a boolean');
    expect(error.target).toBe('expanded');
  });

  it('refuses a missing expanded, not a silent false', () => {
    const error = refusal(validate('view.setExpanded', { nodeId: CHAPTER_ONE }));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('params.expanded must be a boolean');
  });

  it('refuses a blank node id with a hint, never a silent expansion of nothing', () => {
    const error = refusal(validate('view.setExpanded', { nodeId: '   ', expanded: true }));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('must not be blank');
    expect(error.correctiveHint).toContain('folder to expand or collapse');
  });

  it('refuses a key it does not declare and names the accepted set', () => {
    const error = refusal(validate('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: true, order: 3 }));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('"order"');
    expect(error.correctiveHint).toContain('accepts only: nodeId, expanded');
  });

  it('does not check that the folder exists — a stale id is a stale flag, not a refusal', () => {
    expect(validate('view.setExpanded', { nodeId: UNKNOWN_ID, expanded: true }).ok).toBe(true);
  });

  it('writes the override, logs a view event with no affected list, and notifies once', () => {
    const h = bus();
    const result = execute(cmd('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: false }), h.context);

    expect(result.ok).toBe(true);
    expect(h.view.expanded).toEqual({ [CHAPTER_ONE]: false });
    expect(h.undo.groups()).toEqual([]);
    expect(h.log.entries().map((entry) => entry.command)).toEqual(['view.setExpanded']);
    expect(h.log.entries()[0]?.affected).toEqual([]);
    expect(h.log.entries()[0]?.summary).toBe('collapsed a folder in the binder');
    expect(h.log.entries()[0]?.undoGroupId).toBeUndefined();
    expect(h.notified()).toBe(1);
  });

  it('keeps every other override when one folder changes', () => {
    const h = bus();
    execute(cmd('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: true }), h.context);
    execute(cmd('view.setExpanded', { nodeId: MANUSCRIPT, expanded: false }), h.context);
    expect(h.view.expanded).toEqual({ [CHAPTER_ONE]: true, [MANUSCRIPT]: false });
  });

  it('an agent may issue it, because it is a read', () => {
    const h = bus();
    const result = execute(cmd('view.setExpanded', { nodeId: CHAPTER_ONE, expanded: true }, 'agent'), h.context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grant.risk).toBe('read');
  });
});

describe('view.setCorkboardScope — the container the corkboard shows', () => {
  it('is declared as a view command, granted as a read, and never undo-registered', () => {
    const { descriptor } = COMMAND_REGISTRY['view.setCorkboardScope'];
    expect(descriptor.mutates).toBe('view');
    expect(descriptor.agentRisk).toBe('read');
    expect(descriptor.undo).toBe('none');
  });

  it('accepts a container id, and null as the manuscript default', () => {
    expect(validate('view.setCorkboardScope', { nodeId: CHAPTER_ONE })).toEqual({
      ok: true,
      value: { nodeId: CHAPTER_ONE },
    });
    expect(validate('view.setCorkboardScope', { nodeId: null })).toEqual({
      ok: true,
      value: { nodeId: null },
    });
  });

  it('refuses a blank string, which names nothing', () => {
    const error = refusal(validate('view.setCorkboardScope', { nodeId: '' }));
    expect(error.message).toContain('must not be blank');
    expect(error.correctiveHint).toContain('or null to show the manuscript');
  });

  it('refuses a missing nodeId rather than reading absence as null', () => {
    const error = refusal(validate('view.setCorkboardScope', {}));
    expect(error.code).toBe('invalid-params');
    expect(error.message).toContain('params.nodeId must be a string');
  });

  it('refuses a number, and names the key', () => {
    const error = refusal(validate('view.setCorkboardScope', { nodeId: 3 }));
    expect(error.code).toBe('invalid-params');
    expect(error.target).toBe('nodeId');
  });

  it('refuses a key it does not declare', () => {
    const error = refusal(validate('view.setCorkboardScope', { nodeId: null, expanded: true }));
    expect(error.message).toContain('"expanded"');
    expect(error.correctiveHint).toContain('accepts only: nodeId');
  });

  it('sets the scope, clears it on null, and logs a digest with no affected list', () => {
    const h = bus();
    execute(cmd('view.setCorkboardScope', { nodeId: CHAPTER_ONE }), h.context);
    expect(h.view.corkboardScope).toBe(CHAPTER_ONE);
    expect(h.log.entries()[0]?.summary).toBe('showed a container on the corkboard');

    execute(cmd('view.setCorkboardScope', { nodeId: null }), h.context);
    expect(h.view.corkboardScope).toBeNull();
    expect(h.log.entries()[1]?.summary).toBe('showed the manuscript on the corkboard');
    expect(h.log.entries().every((entry) => entry.affected.length === 0)).toBe(true);
    expect(h.undo.groups()).toEqual([]);
    expect(h.notified()).toBe(2);
  });

  it('does not touch the selection, the expansion overrides or the active document', () => {
    const h = bus();
    h.view.selection = [THE_LANDING];
    h.view.activeDocId = THE_LANDING;
    execute(cmd('view.setCorkboardScope', { nodeId: CHAPTER_ONE }), h.context);
    expect(h.view.selection).toEqual([THE_LANDING]);
    expect(h.view.activeDocId).toBe(THE_LANDING);
    expect(h.view.expanded).toEqual({});
  });
});

describe('the view state carries the two new fields, and the guard checks them', () => {
  it('a fresh view state has no expansion overrides and the manuscript scope', () => {
    expect(createViewState()).toEqual({
      selection: [],
      activeDocId: null,
      scroll: {},
      expanded: {},
      corkboardScope: null,
    });
  });

  it('accepts the default, and rejects a state missing either new field', () => {
    expect(isViewState(createViewState())).toBe(true);
    const { expanded: _expanded, ...withoutExpanded } = createViewState();
    expect(isViewState(withoutExpanded)).toBe(false);
    const { corkboardScope: _scope, ...withoutScope } = createViewState();
    expect(isViewState(withoutScope)).toBe(false);
    expect(isViewState({ ...createViewState(), corkboardScope: 4 })).toBe(false);
  });
});
