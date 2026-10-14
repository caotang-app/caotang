/**
 * The health detail a listing earns (extensibility.md §3.2): the change to review, and each tool the model cannot be given a name for.
 * A server that reads healthy must not hide a tool without saying which one, so the detail names it. Every alias the client makes is
 * usable, so no live server reaches the hidden branch; these tests give the function a listing that does.
 */

import { describe, expect, it } from 'vitest';

import { healthDetailOf } from '../src/client.js';

const NO_CHANGE = { firstConnect: false, added: [], changed: [], removed: [] };

describe('the health detail names a tool the model cannot be given (extensibility.md §3.2, §3.5)', () => {
  it('names the one hidden tool by the name the server advertised it under', () => {
    const detail = healthDetailOf({
      delta: NO_CHANGE,
      tools: [
        { toolName: 'project.overview', usable: true },
        { toolName: 'bad tool', usable: false },
      ],
    });
    expect(detail).toBe('one tool is hidden from search and calls, because the model cannot be given its name: "bad tool"');
  });

  it('counts the hidden tools, names the first three, and says how many more there are', () => {
    const tools = ['a x', 'b x', 'c x', 'd x'].map((toolName) => ({ toolName, usable: false }));
    expect(healthDetailOf({ delta: NO_CHANGE, tools })).toBe(
      '4 tools are hidden from search and calls, because the model cannot be given their names: "a x", "b x", "c x" and 1 more',
    );
  });

  it('is no detail for a listing with every tool usable and no change to review', () => {
    expect(healthDetailOf({ delta: NO_CHANGE, tools: [{ toolName: 'project.overview', usable: true }] })).toBeUndefined();
  });
});
