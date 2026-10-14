/**
 * The in-process MCP server the client tests talk to. It is the SDK's own stateless handler
 * (`createMcpHandler`, the same entry `packages/mcp-server` serves), reached through a `fetch`
 * that never opens a socket. The client under test is the real SDK wire, so the protocol is real;
 * only the transport is in memory, and nothing here touches the network (repo rule 6).
 */

import { createMcpHandler, Server, type McpHttpHandler, type Tool } from '@modelcontextprotocol/server';

import { MODERN_REVISION, type McpServerConfig, type ToolPin } from '../src/index.js';

/** A tool as this fixture advertises it. The schema is a plain JSON Schema object. */
export interface FixtureTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

/** A call's answer as the server returns it. */
export interface FixtureResult {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}

/** The server's mutable state. A test changes `tools` to play a rug pull, and `respond` to change how a call is answered. */
export interface FixtureState {
  tools: FixtureTool[];
  respond: (name: string, args: Record<string, unknown>) => FixtureResult | Promise<FixtureResult>;
}

/** One POST the client made, as it was sent. */
export interface RecordedPost {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface InProcessServer {
  /** Pass this as the client's `fetch`. Every request goes to the handler, and none reaches a socket. */
  readonly fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly state: FixtureState;
  /** Every POST the client has made, in order. */
  readonly posts: RecordedPost[];
  /** The next POST with this JSON-RPC method fails as a network error, once. */
  failNext(method: string): void;
  /** Every POST fails as a network error until cleared. */
  failAll(on: boolean): void;
  close(): Promise<void>;
}

/** A plain-text result, the simplest well-formed content block. */
export function textResult(text: string, isError = false): FixtureResult {
  return { content: [{ type: 'text', text }], isError };
}

/** Starts a fixture server over the given state. `revisions` are the protocol revisions it speaks; by default, only 2026-07-28. */
export function startInProcessServer(state: FixtureState, options: { readonly revisions?: readonly string[] } = {}): InProcessServer {
  const posts: RecordedPost[] = [];
  let failOnce: string | undefined;
  let failEverything = false;
  const revisions = options.revisions ?? [MODERN_REVISION];

  const handler: McpHttpHandler = createMcpHandler(() => buildServer(state, revisions), { legacy: 'stateless' });

  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.method === 'POST') {
      const body = await request.clone().text();
      const method = rpcMethodOf(body);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      posts.push({ method, headers, body });
      if (failEverything || (failOnce !== undefined && failOnce === method)) {
        failOnce = undefined;
        throw new TypeError('Failed to fetch');
      }
    }
    return handler.fetch(request);
  };

  return {
    fetch,
    state,
    posts,
    failNext(method) {
      failOnce = method;
    },
    failAll(on) {
      failEverything = on;
    },
    async close() {
      await handler.close();
    },
  };
}

function buildServer(state: FixtureState, revisions: readonly string[]): Server {
  const server = new Server(
    { name: 'caotang-mcp-client-fixture', version: '0.0.0' },
    {
      capabilities: { tools: {} },
      supportedProtocolVersions: [...revisions],
    },
  );
  server.setRequestHandler('tools/list', () => ({ tools: state.tools.map((tool) => toSdkTool(tool)) }));
  server.setRequestHandler('tools/call', async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const result = await state.respond(request.params.name, args);
    return { content: [...result.content] as never[], isError: result.isError === true };
  });
  return server;
}

function toSdkTool(tool: FixtureTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.inputSchema ?? { type: 'object' }) as Tool['inputSchema'],
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

function rpcMethodOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { method?: unknown };
    return typeof parsed.method === 'string' ? parsed.method : '';
  } catch {
    return '';
  }
}

/** A server config for a test: a key, a name, and a URL on a made-up host. The URL never resolves; the fixture answers it. */
export function serverFor(key: string, name = 'Story Bible', overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    key,
    name,
    transport: 'http',
    url: `https://${key.toLowerCase()}.fixture.test/mcp`,
    auth: { kind: 'none' },
    enabled: true,
    trustReads: false,
    pinnedTools: {},
    addedAt: '2026-10-08T09:00:00.000Z',
    ...overrides,
  };
}

/** A pin with a fixed reviewed time, for tests that build pins by hand. */
export function pinAt(hash: string, when = '2026-10-08T09:00:00.000Z'): ToolPin {
  return { hash, firstSeen: when, lastReviewedAt: when };
}

/** A clock that returns the same instant, so pins and fingerprints are reproducible. */
export const FIXED_NOW = '2026-10-08T09:00:00.000Z';
