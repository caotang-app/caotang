/**
 * The source window: rows appended inside a window carry its source, rows outside it
 * keep theirs, nesting restores the outer caller, and an exception does not leave a
 * window open.
 */

import { createActivityLog, type ActivityEntry } from '@caotang/bus';
import { describe, expect, it } from 'vitest';

import { sourceWindow } from '../src/index.js';

function row(summary: string): ActivityEntry {
  return { at: 0, command: 'binder.rename', issuedBy: 'agent', source: 'native', affected: [], summary };
}

describe('sourceWindow', () => {
  it('stamps only the rows appended inside a window', () => {
    const log = createActivityLog();
    const window = sourceWindow(log);
    log.append(row('before'));
    window.within('mcp', () => log.append(row('inside')));
    log.append(row('after'));
    expect(log.entries().map((entry) => [entry.summary, entry.source])).toEqual([
      ['before', 'native'],
      ['inside', 'mcp'],
      ['after', 'native'],
    ]);
  });

  it('restores the outer caller after a nested window, and returns what the run returned', () => {
    const log = createActivityLog();
    const window = sourceWindow(log);
    const result = window.within('mcp', () => {
      window.within('native', () => log.append(row('nested-native')));
      log.append(row('outer-mcp'));
      return 42;
    });
    expect(result).toBe(42);
    expect(log.entries().map((entry) => [entry.summary, entry.source])).toEqual([
      ['nested-native', 'native'],
      ['outer-mcp', 'mcp'],
    ]);
  });

  it('closes the window when the run throws, so a later row is not stamped', () => {
    const log = createActivityLog();
    const window = sourceWindow(log);
    expect(() =>
      window.within('mcp', () => {
        log.append(row('before-throw'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    log.append(row('after-throw'));
    expect(log.entries().map((entry) => [entry.summary, entry.source])).toEqual([
      ['before-throw', 'mcp'],
      ['after-throw', 'native'],
    ]);
  });
});
