/**
 * `UndoStore.forget` (undo.ts) — the non-undoable path for a change the writer did not make. A forgotten group keeps its
 * changes in the project, and no undo can run its compensations, which is what the one-time move of stored furniture needs
 * (furniture-store.ts). These tests pin the store's side: the group leaves the stack, its compensations never run, the
 * other groups are untouched, and a turn whose group was forgotten opens a new one.
 */

import { describe, expect, it } from 'vitest';

import { createUndoStore, type Command, type CommandName, type UndoEntry } from '../src/index.js';

function cmd(name: CommandName, id: string, extra: Partial<Command> = {}): Command {
  return { id, name, params: {}, issuedBy: 'user', createdAt: 1_000, ...extra } as Command;
}

/** A compensable entry whose restore is counted, so a test can tell whether an undo ran it. */
function counted(commandId: string, name: CommandName, counter: { runs: number }): UndoEntry {
  return {
    kind: 'compensable',
    commandId,
    name,
    label: `restore ${commandId}`,
    restore: () => {
      counter.runs += 1;
    },
  };
}

describe('UndoStore.forget (undo.ts)', () => {
  it('drops a group from the stack, so it is no longer listed, looked up or undoable', () => {
    const undo = createUndoStore();
    const counter = { runs: 0 };
    const command = cmd('project.saveGoal', 'cmd_FORGET01');
    const group = undo.register(undo.targetFor(command, 1), counted(command.id, command.name, counter));

    expect(undo.groups().map((g) => g.id)).toEqual([group]);
    expect(undo.forget(group)).toBe(true);

    expect(undo.groups()).toEqual([]);
    expect(undo.group(group)).toBeUndefined();
    const attempt = undo.undo(group);
    expect(attempt.ok).toBe(false);
    expect(counter.runs).toBe(0);
  });

  it('never runs the compensations of a forgotten group, even when another group is undone after it', () => {
    const undo = createUndoStore();
    const moved = { runs: 0 };
    const later = { runs: 0 };
    const move = cmd('binder.saveFilter', 'cmd_MOVE0001');
    const movedGroup = undo.register(undo.targetFor(move, 1), counted(move.id, move.name, moved));
    const edit = cmd('project.saveGoal', 'cmd_EDIT0001');
    const editGroup = undo.register(undo.targetFor(edit, 2), counted(edit.id, edit.name, later));

    expect(undo.forget(movedGroup)).toBe(true);
    const result = undo.undo(editGroup);
    expect(result.ok).toBe(true);
    expect(later.runs).toBe(1);
    expect(moved.runs).toBe(0);
    expect(undo.groups()).toEqual([]);
  });

  it('leaves the other groups in their creation order, each still undoable', () => {
    const undo = createUndoStore();
    const counters = [{ runs: 0 }, { runs: 0 }, { runs: 0 }];
    const ids = ['cmd_ONE00001', 'cmd_TWO00001', 'cmd_THR00001'].map((id, index) => {
      const command = cmd('project.saveGoal', id);
      return undo.register(undo.targetFor(command, index), counted(id, command.name, counters[index]!));
    });

    expect(undo.forget(ids[1]!)).toBe(true);
    expect(undo.groups().map((g) => g.id)).toEqual([ids[0], ids[2]]);
    expect(undo.undo(ids[2]!).ok).toBe(true);
    expect(undo.undo(ids[0]!).ok).toBe(true);
    expect(counters.map((c) => c.runs)).toEqual([1, 0, 1]);
  });

  it('answers false for a group that does not exist, and changes nothing', () => {
    const undo = createUndoStore();
    const command = cmd('project.saveGoal', 'cmd_NONE0001');
    const group = undo.register(undo.targetFor(command, 1), counted(command.id, command.name, { runs: 0 }));

    expect(undo.forget('grp_999')).toBe(false);
    expect(undo.groups().map((g) => g.id)).toEqual([group]);
    // Forgetting twice is the same as forgetting once: the second call names no group.
    expect(undo.forget(group)).toBe(true);
    expect(undo.forget(group)).toBe(false);
  });

  it('opens a new group for the next command of a turn whose group was forgotten', () => {
    const undo = createUndoStore();
    const first = cmd('project.saveGoal', 'cmd_TURN0001', { issuedBy: 'agent', turnId: 'turn_A', createdAt: 1 });
    const firstGroup = undo.register(undo.targetFor(first, 1), counted(first.id, first.name, { runs: 0 }));
    expect(undo.forget(firstGroup)).toBe(true);

    const second = cmd('project.saveGoal', 'cmd_TURN0002', { issuedBy: 'agent', turnId: 'turn_A', createdAt: 2 });
    const secondTarget = undo.targetFor(second, 2);
    expect(secondTarget.id).not.toBe(firstGroup);
  });
});
