import { expect, test } from '@playwright/test';

import type { ActivityEntry, UndoGroup } from '../../packages/bus/src/index.js';

import {
  activityRows,
  issuerLabel,
  isViewEvent,
  sourceBadge,
  titleOf,
} from '../../apps/desktop/src/app/activity-model.js';

/** One executed command, as the bus writes its row (command-bus.md §8). */
function row(command: string, summary: string, undoGroupId?: string): ActivityEntry {
  return {
    at: 1_700_000_000_000,
    command,
    issuedBy: 'user',
    source: 'native',
    affected: [],
    summary,
    ...(undoGroupId === undefined ? {} : { undoGroupId }),
  };
}

function group(id: string): UndoGroup {
  return { id, kind: 'user-gesture', at: 1, label: 'restore to before this action', entries: [] };
}

test('the rows are newest first, and the view events are hidden unless the writer asks for them', () => {
  const log = [
    row('binder.create', 'created a scene'),
    row('view.setSelection', 'selected it'),
    row('binder.rename', 'renamed it'),
  ];
  const none = () => undefined;

  const hidden = activityRows(log, { showViews: false, groupOf: none });
  expect(hidden.map((item) => item.entry.command)).toEqual(['binder.rename', 'binder.create']);
  // The position in the whole log is kept, so the list can key its rows as the log grows.
  expect(hidden.map((item) => item.index)).toEqual([2, 0]);

  const shown = activityRows(log, { showViews: true, groupOf: none });
  expect(shown.map((item) => item.title)).toEqual(['Renamed', 'Selection changed', 'New item']);
});

test('an undo is offered once per group, on its newest row, and only while the group is still in the undo store', () => {
  const groups = new Map([['g1', group('g1')]]);
  const log = [
    row('binder.rename', 'first rename', 'g1'),
    row('binder.rename', 'second rename', 'g1'),
    row('doc.write', 'a text save', 'g2'),
  ];

  const rows = activityRows(log, { showViews: false, groupOf: (id) => groups.get(id) });

  // Newest first: g2 is not in the store (it was undone), so it has no undo; g1's newest row has it, and its older row does not.
  expect(rows.map((item) => item.undo?.id ?? null)).toEqual([null, 'g1', null]);
});

test('a group that has been undone offers nothing, whatever its rows say', () => {
  const log = [row('binder.rename', 'renamed', 'gone')];
  const rows = activityRows(log, { showViews: false, groupOf: () => undefined });
  expect(rows[0]?.undo).toBeNull();
});

test('every command has a person’s title, and an unknown name is shown as it is', () => {
  expect(titleOf('binder.move')).toBe('Moved');
  expect(titleOf('codex.upsert')).toBe('Codex entry saved');
  expect(titleOf('export.compileSelection')).toBe('Part of the manuscript exported');
  expect(titleOf('some.future.command')).toBe('some.future.command');
});

test('the source and the issuer are labelled for a reader', () => {
  expect(sourceBadge('native')).toBe('Native');
  expect(sourceBadge('mcp')).toBe('MCP');
  expect(issuerLabel('user')).toBe('You');
  expect(issuerLabel('agent')).toBe('Agent');
  expect(isViewEvent('view.setScroll')).toBe(true);
  expect(isViewEvent('binder.move')).toBe(false);
});
