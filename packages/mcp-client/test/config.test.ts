/**
 * The settings slice, and the egress allowlist that depends on it. Everything here is pure: the
 * tests build settings values, parse and serialise them, and check the named refusals. The
 * properties that matter are that one bad entry never takes the others down, that an import cannot
 * carry a grant or a pin, and that nothing exported names a token.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_MCP_SETTINGS,
  MCP_SERVER_LIMIT,
  checkServerUrl,
  clampServers,
  egressAllowed,
  egressAllowlistFor,
  exportServers,
  MCP_TOOL_NAME_MAX,
  loadMcpSettings,
  newServerKey,
  parseServerImport,
  toolNameList,
  type McpServerConfig,
} from '../src/index.js';
import { FIXED_NOW, serverFor } from './support.js';

const KEY_BODY = /^s_[0-9A-HJKMNP-TV-Z]{10}$/;

describe('toolNameList', () => {
  it('keeps a selection of names sorted and without repeats', () => {
    expect(toolNameList(['write_note', 'search_lore', 'write_note'])).toEqual(['search_lore', 'write_note']);
    expect(toolNameList([])).toEqual([]);
  });

  it.each([
    ['a name that is not a string', ['search_lore', 3]],
    ['an empty name', ['']],
    ['a name longer than the limit', ['x'.repeat(MCP_TOOL_NAME_MAX + 1)]],
    ['a selection that is not a list', 'search_lore'],
  ])('refuses %s', (_label, value) => {
    expect(toolNameList(value)).toBe('invalid');
  });
});

describe('checkServerUrl', () => {
  it.each([
    ['https://example.test/mcp', 'https://example.test/mcp'],
    ['https://example.test', 'https://example.test'],
    ['  https://example.test/mcp  ', 'https://example.test/mcp'],
    ['http://localhost:7433/mcp', 'http://localhost:7433/mcp'],
    ['http://127.0.0.1:9000/mcp', 'http://127.0.0.1:9000/mcp'],
  ])('accepts %s', (input, expected) => {
    expect(checkServerUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ['https://example.test/mcp/', 'must not end in a slash'],
    ['http://example.test/mcp', 'must use https://'],
    ['http://127.evil.example/mcp', 'must use https://'],
    ['https://user:pw@example.test/mcp', 'must not carry a username or password'],
    ['https://example.test/mcp?token=abc', 'must not carry a query string or fragment'],
    ['https://example.test/mcp#frag', 'must not carry a query string or fragment'],
    ['ftp://example.test/mcp', 'must start with https://'],
    ['', 'is empty'],
    ['not a url', 'is not a URL'],
  ])('refuses %s, naming the reason', (input, reason) => {
    const verdict = checkServerUrl(input);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('expected a refusal');
    expect(verdict.reason).toContain(reason);
  });
});

describe('loadMcpSettings', () => {
  const valid = (key: string, name: string) => ({
    key,
    name,
    transport: 'http',
    url: `https://${key.toLowerCase()}.test/mcp`,
    auth: { kind: 'none' },
    enabled: true,
    trustReads: false,
    pinnedTools: {},
    addedAt: FIXED_NOW,
  });

  it('keeps every valid server and drops the malformed one by name', () => {
    const raw = {
      enabled: true,
      servers: [
        valid('s_AAAAAAAAAA', 'Alpha'),
        { ...valid('s_BBBBBBBBBB', 'Broken'), url: 'http://evil.test/mcp' },
        valid('s_CCCCCCCCCC', 'Gamma'),
        'not an object',
      ],
    };
    const loaded = loadMcpSettings(raw, FIXED_NOW);
    expect(loaded.settings.enabled).toBe(true);
    expect(loaded.settings.servers.map((server) => server.name)).toEqual(['Alpha', 'Gamma']);
    expect(loaded.warnings).toContain('dropped MCP server "Broken": The server URL must use https:// unless it points at localhost, so the request is not sent in plain text.');
    expect(loaded.warnings).toContain('dropped MCP server entry 4: it is not an object');
  });

  it('drops only the one pin that is malformed, so its tool needs a review', () => {
    const raw = {
      enabled: true,
      servers: [
        {
          ...valid('s_AAAAAAAAAA', 'Alpha'),
          pinnedTools: {
            mcp__s_AAAAAAAAAA__good: { hash: 'a'.repeat(64), firstSeen: FIXED_NOW, lastReviewedAt: FIXED_NOW },
            mcp__s_AAAAAAAAAA__bad: { hash: 'not-a-hash' },
          },
        },
      ],
    };
    const loaded = loadMcpSettings(raw, FIXED_NOW);
    const [alpha] = loaded.settings.servers;
    expect(Object.keys(alpha?.pinnedTools ?? {})).toEqual(['mcp__s_AAAAAAAAAA__good']);
    expect(loaded.warnings.some((warning) => warning.includes('mcp__s_AAAAAAAAAA__bad'))).toBe(true);
  });

  it('turns the master switch off when it is not a boolean, and says so', () => {
    const loaded = loadMcpSettings({ enabled: 'yes', servers: [] }, FIXED_NOW);
    expect(loaded.settings.enabled).toBe(false);
    expect(loaded.warnings).toContain('MCP master switch is not true or false; MCP & tools is off');
  });

  it('loads the empty default for a missing or non-object slice', () => {
    expect(loadMcpSettings(undefined, FIXED_NOW).settings).toEqual(EMPTY_MCP_SETTINGS);
    const broken = loadMcpSettings('garbage', FIXED_NOW);
    expect(broken.settings).toEqual({ enabled: false, servers: [] });
    expect(broken.warnings).toHaveLength(1);
  });

  it('clamps to twenty servers and names every server it drops', () => {
    const servers = Array.from({ length: MCP_SERVER_LIMIT + 3 }, (_, index) =>
      valid(`s_${String(index).padStart(10, 'A')}`, `Server ${index}`),
    );
    const loaded = loadMcpSettings({ enabled: true, servers }, FIXED_NOW);
    expect(loaded.settings.servers).toHaveLength(MCP_SERVER_LIMIT);
    const dropped = loaded.warnings.filter((warning) => warning.includes('at most 20 servers are kept'));
    expect(dropped).toHaveLength(3);
    expect(dropped[0]).toContain('"Server 20"');
  });

  it('drops a second entry that reuses a key, and names it', () => {
    const raw = { enabled: true, servers: [valid('s_AAAAAAAAAA', 'First'), valid('s_AAAAAAAAAA', 'Second')] };
    const loaded = loadMcpSettings(raw, FIXED_NOW);
    expect(loaded.settings.servers.map((server) => server.name)).toEqual(['First']);
    expect(loaded.warnings[0]).toContain('is already used by an earlier entry');
  });
});

describe('clampServers', () => {
  it('leaves a list at or under the limit alone', () => {
    const servers = [serverFor('s_AAAAAAAAAA')];
    expect(clampServers(servers)).toEqual({ servers, dropped: [] });
  });
});

describe('parseServerImport', () => {
  const existing = [serverFor('s_EXSTNG0001', 'Existing', { url: 'https://existing.test/mcp' })];
  const options = (keys: string[]) => {
    let next = 0;
    return { existing, now: FIXED_NOW, newKey: () => keys[next++] ?? 's_FBKAAAAAAA' };
  };

  it('keeps the valid entries and refuses each bad one by name', () => {
    const text = JSON.stringify({
      servers: [
        { name: 'Good', url: 'https://good.test/mcp' },
        { name: 'Bearer', url: 'https://bearer.test/mcp', auth: { kind: 'bearer', tokenRef: 'tok_1' } },
        { name: 'Grants', url: 'https://grants.test/mcp', trustReads: true },
        { name: 'Pins', url: 'https://pins.test/mcp', pinnedTools: {} },
        { name: 'Dup', url: 'https://existing.test/mcp' },
        { name: 'Plain', url: 'http://remote.test/mcp' },
      ],
    });
    const result = parseServerImport(text, options(['s_NEWAAAA001']));
    expect(result.servers.map((server) => server.name)).toEqual(['Good']);
    expect(result.refused.map((refusal) => refusal.entry)).toEqual(['"Bearer"', '"Grants"', '"Pins"', '"Dup"', '"Plain"']);
    expect(result.refused[0]?.reason).toContain('never read from a file');
    expect(result.refused[1]?.reason).toContain('"trustReads"');
    expect(result.refused[3]?.reason).toContain('already in the list');
  });

  it('gives an imported server a fresh key, no pins, and no trust', () => {
    const result = parseServerImport(JSON.stringify([{ name: 'New', url: 'https://new.test/mcp', enabledTools: ['b', 'a'] }]), options(['s_NEWAAAA001']));
    expect(result.servers).toEqual([
      {
        key: 's_NEWAAAA001',
        name: 'New',
        transport: 'http',
        url: 'https://new.test/mcp',
        auth: { kind: 'none' },
        enabled: true,
        trustReads: false,
        pinnedTools: {},
        addedAt: FIXED_NOW,
        enabledTools: ['a', 'b'],
      },
    ]);
  });

  it('refuses the file as a whole when it is not JSON', () => {
    const result = parseServerImport('{ not json', options([]));
    expect(result.servers).toEqual([]);
    expect(result.refused).toEqual([{ entry: 'the file', reason: 'it is not JSON' }]);
  });

  it('refuses the entries past the limit, by name', () => {
    const many = Array.from({ length: MCP_SERVER_LIMIT }, (_, index) => serverFor(`s_${String(index).padStart(10, 'B')}`, `E${index}`, { url: `https://e${index}.test/mcp` }));
    const text = JSON.stringify([
      { name: 'One', url: 'https://one.test/mcp' },
      { name: 'Two', url: 'https://two.test/mcp' },
    ]);
    const result = parseServerImport(text, { existing: many, now: FIXED_NOW, newKey: () => 's_NEWAAAA001' });
    expect(result.servers).toEqual([]);
    expect(result.refused.map((refusal) => refusal.reason)).toEqual([
      'it would be past the 20-server limit',
      'it would be past the 20-server limit',
    ]);
  });
});

describe('exportServers', () => {
  it('writes names, URLs and the auth kind, and nothing that belongs to this install', () => {
    const server: McpServerConfig = {
      ...serverFor('s_SECRETKEY1', 'Bible', { url: 'https://bible.test/mcp', enabledTools: ['search'] }),
      auth: { kind: 'bearer', tokenRef: 'vault_token_ref_123' },
      trustReads: true,
      pinnedTools: { mcp__s_SECRETKEY1__search: { hash: 'a'.repeat(64), firstSeen: FIXED_NOW, lastReviewedAt: FIXED_NOW } },
    };
    const text = exportServers([server]);
    expect(text).not.toContain('s_SECRETKEY1');
    expect(text).not.toContain('vault_token_ref_123');
    expect(text).not.toContain('trustReads');
    expect(text).not.toContain('pinnedTools');
    const parsed = JSON.parse(text) as { servers: Array<{ name: string; url: string; auth: { kind: string }; enabledTools: string[] }> };
    expect(parsed.servers).toEqual([
      { name: 'Bible', url: 'https://bible.test/mcp', auth: { kind: 'bearer' }, enabled: true, enabledTools: ['search'] },
    ]);
  });

  it('round-trips through the import without carrying a grant across', () => {
    const exported = exportServers([serverFor('s_AAAAAAAAAA', 'Bible', { url: 'https://bible.test/mcp', trustReads: true })]);
    const result = parseServerImport(exported, { existing: [], now: FIXED_NOW, newKey: () => 's_NEWAAAA001' });
    expect(result.refused).toEqual([]);
    expect(result.servers[0]).toMatchObject({ name: 'Bible', url: 'https://bible.test/mcp', trustReads: false, pinnedTools: {} });
  });
});

describe('newServerKey', () => {
  it('mints the s_ form from the Crockford alphabet, and never returns a taken key', () => {
    const key = newServerKey(new Set(), () => new Uint8Array(10).fill(7));
    expect(key).toMatch(KEY_BODY);
    expect(key).toBe('s_7777777777');
    const last = newServerKey(new Set(), () => new Uint8Array(10).fill(31));
    expect(last).toBe(`s_${'Z'.repeat(10)}`);
  });

  it('re-rolls past a key that is taken', () => {
    let calls = 0;
    const randomBytes = (n: number): Uint8Array => {
      calls += 1;
      return new Uint8Array(n).fill(calls === 1 ? 0 : 1);
    };
    const first = newServerKey(new Set(), () => new Uint8Array(10).fill(0));
    const second = newServerKey(new Set([first]), randomBytes);
    expect(second).not.toBe(first);
    expect(second).toMatch(KEY_BODY);
  });

  it('gives up rather than return a duplicate when every roll is taken', () => {
    expect(() => newServerKey(new Set([`s_${'0'.repeat(10)}`]), () => new Uint8Array(10).fill(0))).toThrow('could not mint');
  });
});

describe('egressAllowed', () => {
  const allow = {
    providerEndpoints: ['https://openrouter.ai/api/v1'],
    mcpServerUrls: ['https://stories.test/mcp'],
  };

  it('allows a provider endpoint and its sub-paths on a segment boundary', () => {
    expect(egressAllowed('https://openrouter.ai/api/v1/chat/completions', allow)).toBe(true);
    expect(egressAllowed('https://openrouter.ai/api/v10/x', allow)).toBe(false);
  });

  it('allows the connected server URL and refuses anything else', () => {
    expect(egressAllowed('https://stories.test/mcp', allow)).toBe(true);
    expect(egressAllowed('https://stories.test/mcp/sub', allow)).toBe(true);
    expect(egressAllowed('https://stories.test.evil.example/mcp', allow)).toBe(false);
    expect(egressAllowed('http://stories.test/mcp', allow)).toBe(false);
    expect(egressAllowed('https://stories.test:8443/mcp', allow)).toBe(false);
  });

  it('refuses credentials in the target and any scheme but web', () => {
    expect(egressAllowed('https://user@stories.test/mcp', allow)).toBe(false);
    expect(egressAllowed('ftp://stories.test/mcp', allow)).toBe(false);
    expect(egressAllowed('not a url', allow)).toBe(false);
  });

  it('builds the allowlist from enabled servers only', () => {
    const list = egressAllowlistFor({
      providerEndpoints: ['https://api.example.test/v1'],
      servers: [serverFor('s_AAAAAAAAAA', 'On', { url: 'https://on.test/mcp' }), serverFor('s_BBBBBBBBBB', 'Off', { url: 'https://off.test/mcp', enabled: false })],
    });
    expect(list.mcpServerUrls).toEqual(['https://on.test/mcp']);
    expect(egressAllowed('https://off.test/mcp', list)).toBe(false);
  });
});
