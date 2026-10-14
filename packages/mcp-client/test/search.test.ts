/**
 * `tool.search` — determinism (§5, eval 2), the excerpt cap, browse and filter behaviour, the
 * refusals, the notes for an empty or unhealthy index, and the per-turn loaded set. The index is
 * built from a real client over the scripted servers, so the notes say what the client knows.
 */

import { describe, expect, it } from 'vitest';

import { EXCERPT_CHARS, TOOL_SEARCH_META, TOOL_SEARCH_NAME, TOOL_SEARCH_PARAMS, createLoadedTools, loadedAddendum, toolSearch } from '../src/index.js';
import { LONG_DESCRIPTION, SHELF_KEY, STORY_KEY, openClient, qualified } from './fixtures.js';

async function standardIndex() {
  return openClient({ approve: [STORY_KEY, SHELF_KEY], trust: [STORY_KEY] });
}

describe('the tool definition', () => {
  it('is a read tool outside the closed registry, with a parameter spec the harness can derive a schema from', () => {
    expect(TOOL_SEARCH_NAME).toBe('tool.search');
    expect(TOOL_SEARCH_META).toMatchObject({ name: 'tool.search', risk: 'read', undoable: false, surface: 'extension' });
    expect(TOOL_SEARCH_PARAMS.kind).toBe('object');
    expect(TOOL_SEARCH_PARAMS.required).toEqual(['query']);
    expect(Object.keys(TOOL_SEARCH_PARAMS.properties).sort()).toEqual(['limit', 'query', 'risk', 'server']);
  });
});

describe('determinism', () => {
  it('returns the same matches in the same order on every run, servers in config order and tools by name', async () => {
    const first = await standardIndex();
    const second = await standardIndex();
    const run = (client: Awaited<ReturnType<typeof standardIndex>>['client'], loaded = createLoadedTools()) =>
      toolSearch({ query: '', limit: 20 }, { index: () => client.indexedTools(), loaded });
    const a = run(first.client);
    const b = run(second.client);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('expected matches');
    expect(a.value.data).toEqual(b.value.data);
    expect(a.value.data.surfaced).toEqual([
      qualified(STORY_KEY, 'lore_lookup'),
      qualified(STORY_KEY, 'lore_update'),
      qualified(STORY_KEY, 'timeline_check'),
      qualified(SHELF_KEY, 'shelf_search'),
    ]);
  });
});

describe('excerpts', () => {
  it('caps every excerpt at 200 characters and marks a cut', async () => {
    const { client } = await standardIndex();
    const result = toolSearch({ query: 'timeline' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected matches');
    const match = result.value.data.matches.find((candidate) => candidate.toolName === 'timeline_check');
    expect(match?.excerpt.length).toBeLessThanOrEqual(EXCERPT_CHARS);
    expect(match?.excerpt.endsWith('…')).toBe(true);
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(EXCERPT_CHARS);
  });

  it('gives the full descriptor to the harness for the turn, so the approval card can show the whole text', async () => {
    const { client } = await standardIndex();
    const result = toolSearch({ query: 'timeline' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected matches');
    const surfaced = result.value.surfaced.find((tool) => tool.toolName === 'timeline_check');
    expect(surfaced?.description).toBe(LONG_DESCRIPTION);
    expect(surfaced?.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('matching, browse and filters', () => {
  it('matches on the name and the description, case-insensitively', async () => {
    const { client } = await standardIndex();
    const byName = toolSearch({ query: 'LORE_UP' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    const byText = toolSearch({ query: 'aliases' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!byName.ok || !byText.ok) throw new Error('expected matches');
    expect(byName.value.data.surfaced).toEqual([qualified(STORY_KEY, 'lore_update')]);
    expect(byText.value.data.surfaced).toEqual([qualified(STORY_KEY, 'lore_lookup')]);
  });

  it('browses the first matches with an empty query, and says how many more there are', async () => {
    const { client } = await standardIndex();
    const result = toolSearch({ query: '', limit: 2 }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected matches');
    expect(result.value.data.surfaced).toHaveLength(2);
    expect(result.value.notes.join(' ')).toContain('2 more matched');
  });

  it('filters to one server by its key', async () => {
    const { client } = await standardIndex();
    const result = toolSearch({ query: '', server: SHELF_KEY }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected matches');
    expect(result.value.data.surfaced).toEqual([qualified(SHELF_KEY, 'shelf_search')]);
  });

  it('filters by the badge: read is the trusted, read-only tool, and write is everything that asks first', async () => {
    const { client } = await standardIndex();
    const reads = toolSearch({ query: '', risk: 'read' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    const writes = toolSearch({ query: '', risk: 'write', limit: 20 }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!reads.ok || !writes.ok) throw new Error('expected matches');
    expect(reads.value.data.matches.map((match) => match.risk)).toEqual(['read']);
    expect(reads.value.data.surfaced).toEqual([qualified(STORY_KEY, 'lore_lookup')]);
    expect(writes.value.data.matches.every((match) => match.risk === 'write')).toBe(true);
    expect(writes.value.data.surfaced).not.toContain(qualified(STORY_KEY, 'lore_lookup'));
  });

  it('reports a miss as a result with the corrective terms, not as an error', async () => {
    const { client } = await standardIndex();
    const result = toolSearch({ query: 'zzz' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('a miss is a result');
    expect(result.value.summary).toBe("no external tool matched 'zzz'; re-search with terms from the task");
    expect(result.value.data.surfaced).toEqual([]);
  });
});

describe('refusals name the parameter and the accepted set', () => {
  it.each([
    [{}, '"query" is required'],
    [{ query: 3 }, '"query" is required'],
    [{ query: 'a', extra: true }, '"extra" is not a parameter of tool.search'],
    [{ query: 'a', limit: 0 }, '"limit" must be an integer from 1 to 20'],
    [{ query: 'a', limit: 21 }, '"limit" must be an integer from 1 to 20'],
    [{ query: 'a', limit: 2.5 }, '"limit" must be an integer from 1 to 20'],
    [{ query: 'a', risk: 'auto' }, '"risk" must be "read" or "write"'],
    [{ query: 'x'.repeat(201) }, '"query" is longer than 200 characters'],
    [[], 'tool.search takes an object of named parameters'],
  ])('refuses %j', async (params, message) => {
    const { client } = await standardIndex();
    const result = toolSearch(params, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('invalid-params');
    expect(result.error.message).toContain(message);
  });
});

describe('the notes an empty or unhealthy index gives', () => {
  it('says so when no server is connected at all, as a result', async () => {
    const { client } = await openClient({ servers: [] });
    const result = toolSearch({ query: '' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected a result');
    expect(result.value.notes).toEqual(['no MCP servers connected — add one in Settings › MCP & tools']);
    expect(result.value.data.surfaced).toEqual([]);
  });

  it('says so when MCP & tools is off', async () => {
    const { client } = await openClient({ enabled: false, connect: [] });
    const result = toolSearch({ query: '' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected a result');
    expect(result.value.notes).toEqual(['MCP & tools is off — turn it on in Settings › MCP & tools']);
  });

  it('excludes an unreviewed server and names it, so a person knows why its tools are missing', async () => {
    const { client } = await openClient({ approve: [STORY_KEY], connect: [STORY_KEY, SHELF_KEY] });
    const result = toolSearch({ query: '' }, { index: () => client.indexedTools(), loaded: createLoadedTools() });
    if (!result.ok) throw new Error('expected a result');
    expect(result.value.notes.some((note) => note.startsWith('Research Shelf is not searched:'))).toBe(true);
    expect(result.value.data.surfaced.every((name) => name.startsWith(`mcp__${STORY_KEY}__`))).toBe(true);
  });
});

describe('the per-turn loaded set', () => {
  it('loads what a search surfaces, so a call can name it, and a new turn starts with nothing loaded', async () => {
    const { client } = await standardIndex();
    const loaded = createLoadedTools();
    loaded.beginTurn('turn-1');
    toolSearch({ query: 'lookup' }, { index: () => client.indexedTools(), loaded });
    expect(loaded.isLoaded(qualified(STORY_KEY, 'lore_lookup'))).toBe(true);
    expect(loaded.isLoaded(qualified(STORY_KEY, 'lore_update'))).toBe(false);
    loaded.beginTurn('turn-2');
    expect(loaded.isLoaded(qualified(STORY_KEY, 'lore_lookup'))).toBe(false);
    expect(loaded.turnId).toBe('turn-2');
  });

  it('describes the loaded tools in one L0 line, and nothing when none are loaded', () => {
    expect(loadedAddendum([])).toBeUndefined();
    expect(loadedAddendum([qualified(STORY_KEY, 'lore_lookup')])).toBe(
      `External tools loaded this turn, callable by their qualified name: mcp__${STORY_KEY}__lore_lookup.`,
    );
  });
});
