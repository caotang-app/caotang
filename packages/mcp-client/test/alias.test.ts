/**
 * The model-facing names of one server's tools (extensibility §3.5). A name the model's rule takes keeps it, a name it does not
 * takes an alias it does, and no two tools of one server share a name the model is shown.
 */

import { describe, expect, it } from 'vitest';

import { modelSafeAliases } from '../src/alias.js';

/** The model's rule: letters, digits, `_` and `-`. */
const MODEL_RULE = /^[A-Za-z0-9_-]+$/;

/** The room an alias has: the model's 64 characters, less the prefix of a server key of ten characters (`mcp__s_XXXXXXXXXX__`). */
const ROOM = 64 - 'mcp__s_AAAAAAAAAA__'.length;

describe('modelSafeAliases', () => {
  it('keeps a name the model rule takes, and gives a dotted name an alias the rule takes', async () => {
    const aliases = await modelSafeAliases(['overview', 'project.overview', 'binder.read_tree'], ROOM);
    expect(aliases.get('overview')).toBe('overview');
    expect(aliases.get('project.overview')).toMatch(/^project_overview_[0-9a-f]{6}$/);
    expect(aliases.get('binder.read_tree')).toMatch(/^binder_read_tree_[0-9a-f]{6}$/);
    for (const alias of aliases.values()) expect(alias).toMatch(MODEL_RULE);
  });

  it('gives the same name to the same tool whatever order the server lists its tools in', async () => {
    const first = await modelSafeAliases(['project.overview', 'a b', 'overview'], ROOM);
    const second = await modelSafeAliases(['overview', 'a b', 'project.overview'], ROOM);
    expect(second.get('project.overview')).toBe(first.get('project.overview'));
    expect(second.get('a b')).toBe(first.get('a b'));
  });

  it('keeps apart two names that differ only in punctuation, and an unchanged name keeps its own', async () => {
    const aliases = await modelSafeAliases(['a_b', 'a.b', 'a/b'], ROOM);
    expect(aliases.get('a_b')).toBe('a_b');
    expect(aliases.get('a.b')).not.toBe(aliases.get('a/b'));
    expect(new Set(aliases.values()).size).toBe(3);
  });

  it('never gives a changed name the alias of an unchanged one, even when that alias is the one the changed name would take', async () => {
    // The alias 'a.b' would take, offered as a tool's own name: that tool keeps it, and 'a.b' is given another.
    const wouldTake = (await modelSafeAliases(['a.b'], ROOM)).get('a.b') ?? '';
    const aliases = await modelSafeAliases([wouldTake, 'a.b'], ROOM);
    expect(aliases.get(wouldTake)).toBe(wouldTake);
    expect(aliases.get('a.b')).not.toBe(wouldTake);
    expect(new Set(aliases.values()).size).toBe(2);
  });

  it('fits a long name in the room, so the qualified name stays within the model limit', async () => {
    const long = `${'x'.repeat(40)}.${'y'.repeat(30)}`;
    const alias = (await modelSafeAliases([long], ROOM)).get(long) ?? '';
    expect(alias.length).toBeLessThanOrEqual(ROOM);
    expect(alias).toMatch(MODEL_RULE);
  });

  it('gives an empty name, or one of punctuation only, a name the rule takes', async () => {
    const aliases = await modelSafeAliases(['', '...'], ROOM);
    expect(aliases.get('')).toMatch(/^tool_[0-9a-f]{6}$/);
    expect(aliases.get('...')).toMatch(MODEL_RULE);
    expect(aliases.get('...')).not.toBe(aliases.get(''));
  });

  it('gives each name once, however many times the server lists it', async () => {
    const aliases = await modelSafeAliases(['overview', 'overview'], ROOM);
    expect([...aliases.keys()]).toEqual(['overview']);
  });
});
