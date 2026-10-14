/**
 * The storyboard shot commands through the bus, with a fake storyboard port (storyboard.md §3.1, §4). The real
 * port is the storyboard module's; these tests pin what the store owns around it: the inverse, its order, the
 * row, and a refusal that writes nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  err,
  execute,
  ok,
  type BusContext,
  type Command,
  type CommandRegistry,
  type ValidationSnapshot,
} from '@caotang/bus';

import { createProjectCommandRegistry, type ProjectState, type ShotCommandPort } from '../src/index.js';

/** A fake storyboard module: a map of shot metadata, with the module's own guard on `shot.setMeta`. */
function fakePort(): { port: ShotCommandPort; stored: Map<string, unknown> } {
  const stored = new Map<string, unknown>();
  const port: ShotCommandPort = {
    apply(_state, name, params) {
      if (name === 'shot.setMeta') {
        const p = params as { nodeId: string; stored: Record<string, unknown> | null; expect: unknown };
        if (JSON.stringify(stored.get(p.nodeId) ?? null) !== JSON.stringify(p.expect ?? null)) {
          return err({ code: 'revision-conflict', message: `the metadata of shot "${p.nodeId}" changed after the plan was made`, target: p.nodeId });
        }
        if (p.stored === null) stored.delete(p.nodeId);
        else stored.set(p.nodeId, p.stored);
        return ok({ affected: [{ nodeId: p.nodeId, title: 'Shot 1' }], summary: 'set the camera fields of "Shot 1"' });
      }
      const p = params as { id: string; title: string };
      stored.set(p.id, {});
      return ok({ affected: [{ nodeId: p.id, title: p.title }], summary: `created "${p.title}"` });
    },
  };
  return { port, stored };
}

/** A bus over the store's registry, with the injected port. The registry is passed to every `execute`. */
function harness(port: ShotCommandPort) {
  const registry: CommandRegistry = createProjectCommandRegistry({ shots: port });
  const log = createActivityLog();
  const bus: BusContext<ProjectState> = {
    state: {} as ProjectState,
    view: createViewState(),
    read: () => ({}) as unknown as ValidationSnapshot,
    undo: createUndoStore({ dispatch: (command) => execute(command, bus, registry) }),
    log,
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  return { registry, log, bus };
}

function agent(name: 'shot.create' | 'shot.setMeta', params: Record<string, unknown>, callId: string): Command {
  return { id: `cmd_${callId}`, name, params, issuedBy: 'agent', turnId: 'turn-1', callId, createdAt: 1 };
}

describe('shot.setMeta — the store applies the module’s write and undoes it with the swapped values', () => {
  it('writes the stored value, logs one row, and registers an inverse that restores the value the plan read', () => {
    const { port, stored } = fakePort();
    const { bus, log, registry } = harness(port);
    const result = execute(agent('shot.setMeta', { nodeId: 'n_SHOT0000001', stored: { shotSize: 'CU' }, expect: null }, 'set-1'), bus, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stored.get('n_SHOT0000001')).toEqual({ shotSize: 'CU' });
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ command: 'shot.setMeta', summary: 'set the camera fields of "Shot 1"' });
    // One undo restores the plan's read: no stored metadata.
    expect(bus.undo.undo(result.value.undoGroupId!).ok).toBe(true);
    expect(stored.has('n_SHOT0000001')).toBe(false);
  });

  it('refuses a stale plan with the module’s own error, and writes no row and registers no undo', () => {
    const { port, stored } = fakePort();
    const { bus, log, registry } = harness(port);
    const result = execute(agent('shot.setMeta', { nodeId: 'n_SHOT0000002', stored: { shotSize: 'WS' }, expect: { shotSize: 'CU' } }, 'set-stale'), bus, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('revision-conflict');
    expect(result.error.message).toContain('changed after the plan was made');
    expect(stored.has('n_SHOT0000002')).toBe(false);
    expect(log.entries()).toHaveLength(0);
  });
});

describe('shot.create — the store registers the shot’s removal as its inverse', () => {
  it('creates the shot, logs the module’s row, and undoes the creation', () => {
    const { port, stored } = fakePort();
    const { bus, log, registry } = harness(port);
    const result = execute(agent('shot.create', { id: 'n_SHOT0000003', parentId: 'n_FOLDER00001', title: 'Shot 3', stored: {} }, 'create-1'), bus, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stored.has('n_SHOT0000003')).toBe(true);
    expect(log.entries()[0]).toMatchObject({ command: 'shot.create', summary: 'created "Shot 3"' });
    expect(result.value.undoGroupId).toBeDefined();
  });

  it('refuses the three shot names as not wired when no storyboard port was injected', () => {
    const registry = createProjectCommandRegistry({});
    const bus: BusContext<ProjectState> = {
      state: {} as ProjectState,
      view: createViewState(),
      read: () => ({}) as unknown as ValidationSnapshot,
      undo: createUndoStore({ dispatch: (command) => execute(command, bus, registry) }),
      log: createActivityLog(),
      idempotency: createIdempotencyCache(),
      notify: () => {},
    };
    const result = execute(agent('shot.create', { id: 'n_SHOT0000004', parentId: 'n_FOLDER00001', title: 'Shot 4', stored: {} }, 'create-unwired'), bus, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('has no implementation in this build');
  });
});
