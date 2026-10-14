/**
 * The verification steps (agent-harness §7). Each one is reached only when an apply
 * does something other than what it was asked, so each test makes an apply do that,
 * through a registry that wraps the store's own apply, and checks the harness
 * reports it: as a `postcondition`, with the undo group named, and nothing undone
 * automatically.
 */

import type { ApplyContext, CommandApply, CommandName, CommandRegistry } from '@caotang/bus';
import { createProjectCommandRegistry } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { createHarness } from '../src/index.js';
import { CHAPTER_ONE, LANDING, clock, makeState, refusalOf, run, valueOf } from './fixtures.js';

const CONFIRMED = { permission: { confirmed: true } } as const;

/** The store's registry, with one name's apply replaced by a wrapper that may change what it is asked to do. */
function wrapped(name: CommandName, wrap: (inner: CommandApply<never, unknown>) => CommandApply<never, unknown>): CommandRegistry {
  const base = createProjectCommandRegistry({ clock });
  const inner = base[name].apply as CommandApply<never, unknown>;
  return {
    ...base,
    [name]: { descriptor: base[name].descriptor, apply: wrap(inner) },
  } as CommandRegistry;
}

describe('doc.import read-back', () => {
  it('reports a body the store did not keep as a postcondition, names the undo group, and keeps the import reversible', () => {
    const state = makeState();
    const registry = wrapped('doc.write', (inner) => (target, params, context: ApplyContext) => {
      const params2 = { ...(params as Record<string, unknown>), body: 'something else entirely' };
      return inner(target, params2 as never, context);
    });
    const harness = createHarness({ state, registry, clock: clock.now });
    const error = refusalOf(
      run(harness, 'doc.import', { parent: CHAPTER_ONE, title: 'Read Back', body: 'The real body.' }, CONFIRMED),
    );
    expect(error.code).toBe('postcondition');
    expect(error.message).toContain('the stored body is not the body that was sent');
    expect(error.details?.['undoGroupId']).toBeDefined();
    const imported = state.manifest.tree.find((node) => node.title === 'Read Back');
    expect(imported).toBeDefined();
  });
});

describe('binder.restructure tree check', () => {
  it('reports a tree that no longer validates as a postcondition, with the undo group named, and does not undo it', () => {
    const state = makeState();
    // A rename whose apply leaves the node pointing at a parent that does not exist.
    const registry = wrapped('binder.rename', (inner) => (target, params, context: ApplyContext) => {
      const result = inner(target, params as never, context);
      const node = (target as { manifest: { tree: { id: string; parentId: string | null }[] } }).manifest.tree.find(
        (candidate) => candidate.id === (params as { nodeId: string }).nodeId,
      );
      if (node !== undefined) node.parentId = 'n_NOWHERE01';
      return result;
    });
    const harness = createHarness({ state, registry, clock: clock.now });
    const error = refusalOf(
      run(harness, 'binder.restructure', { ops: [{ action: 'rename', node: LANDING, title: 'Renamed' }] }, CONFIRMED),
    );
    expect(error.code).toBe('postcondition');
    expect(error.message).toContain('no longer validates against the project format');
    expect(error.details?.['undoGroupId']).toBeDefined();
    expect(state.manifest.tree.find((node) => node.id === LANDING)?.title).toBe('Renamed');
  });

  it('answers normally when the tree validates, which is the common case', () => {
    const outcome = valueOf(run(createHarness({ state: makeState(), clock: clock.now }), 'binder.restructure', { ops: [{ action: 'rename', node: LANDING, title: 'Fine' }] }, CONFIRMED));
    expect(outcome.data['applied']).toBe(1);
  });
});
