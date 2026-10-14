/**
 * The transport seam, and the one real transport behind it — [extensibility.md §3.3](../../../docs/architecture/extensibility.md).
 *
 * **Streamable HTTP only.** The revision is negotiated with the SDK's `auto` mode (§3.3, §12 D17,
 * as amended by this work). The SDK sends `server/discover` first. A server that offers
 * 2026-07-28 answers with its discovery result, and the requests then go out with no `initialize`
 * and no session header. A 2025-era server answers that probe with a JSON-RPC "method not found",
 * which the SDK reads as a legacy server, so it is connected through the plain `initialize`
 * handshake it knows. The list is requested with `cacheMode: 'refresh'`, because the SDK otherwise
 * serves a cached list and a changed tool would go unnoticed.
 *
 * The seam ({@link McpWire}) is what the client talks to. The SDK wire is one implementation;
 * `mock.ts` is another, scripted for evals. The client never imports the SDK directly, so every
 * behaviour above the seam is testable without a socket.
 *
 * **Failures leave this file as {@link WireError}s**, classified by kind. The kind decides
 * what the person is told: a network failure and a CORS refusal look the same to `fetch`, so the
 * wrapper probes the same URL with a no-cors request. A reachable server that refuses the browser
 * is a CORS refusal, and §3.3 names it as one.
 */

import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
  type FetchLike,
} from '@modelcontextprotocol/client';

import { egressAllowed } from './egress.js';
import type { McpServerConfig } from './config.js';

/**
 * The newest protocol revision, which the client asks for first (§12 D17). A server that speaks it is connected on the
 * stateless path. A server that speaks only an older revision is connected through the SDK's legacy handshake.
 */
export const MODERN_REVISION = '2026-07-28';

/** What the server sees us as. */
export const CLIENT_NAME = 'caotang';
export const CLIENT_VERSION = '0.1.0';

/** How long the probe that tells CORS from a dead host may take. */
const PROBE_MS = 5_000;

/** The start of the SDK's message when the server's `initialize` answer names a revision the client does not offer. */
const UNSUPPORTED_SERVER_REVISION = "Server's protocol version is not supported";

/**
 * `revision`: the server speaks none of the revisions Caotang offers (2026-07-28, or a 2024 or 2025 revision),
 * so there is no common one to connect on. It is named apart from a generic protocol error, because the
 * person's fix is the server's version, not the URL.
 */
export type WireErrorKind = 'network' | 'cors' | 'timeout' | 'abort' | 'auth' | 'http' | 'protocol' | 'result' | 'revision';

/** A classified transport failure. The client turns the kind into the person's sentence. */
export class WireError extends Error {
  readonly kind: WireErrorKind;
  readonly status: number | undefined;
  /** For a `revision` failure: the revision the server's `initialize` answer named, when the SDK's message carries it. */
  readonly answeredRevision: string | undefined;
  /** For a `revision` failure: the revisions the server listed as supported, when its refusal carried the list. */
  readonly supportedRevisions: readonly string[];

  constructor(kind: WireErrorKind, message: string, status?: number, named: { readonly answered?: string; readonly supported?: readonly string[] } = {}) {
    super(message);
    this.name = 'WireError';
    this.kind = kind;
    this.status = status;
    this.answeredRevision = named.answered;
    this.supportedRevisions = named.supported ?? [];
  }
}

/** A tool as a server advertises it. Verbatim: the description and the schema are the server's own text. */
export interface WireTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly annotations?: WireAnnotations;
}

/** The self-declared hints. They inform nothing by themselves (§7: attacker-controlled text). */
export interface WireAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

/** A call's result: the content blocks verbatim, and whether the tool reported an error. */
export interface WireCallResult {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}

export interface WireOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** One server's connection. Operations are sequential per server; the client never overlaps two calls on one wire. */
export interface McpWire {
  listTools(options: WireOptions): Promise<readonly WireTool[]>;
  callTool(name: string, args: Record<string, unknown>, options: WireOptions): Promise<WireCallResult>;
  close(): Promise<void>;
}

/** What a wire needs from the app: the vault's bearer lookup, a fetch, and the CORS probe. */
export interface WireDeps {
  readonly resolveBearer: (tokenRef: string) => Promise<string | undefined>;
  readonly fetch: FetchLike;
  readonly probe: (url: string) => Promise<boolean>;
}

export type WireFactory = (server: McpServerConfig, deps: WireDeps) => McpWire;

/**
 * The CORS probe: the same URL, asked for with a no-cors GET. A browser answers an opaque
 * response when the host is up, even when it would refuse the real request, and it rejects
 * when the host is down. Only the difference between the two matters here.
 */
export function corsProbe(fetchImpl: FetchLike): (url: string) => Promise<boolean> {
  return async (url) => {
    try {
      await fetchImpl(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(PROBE_MS) });
      return true;
    } catch {
      return false;
    }
  };
}

/** The SDK-backed wire for one server. It opens its connection on first use. */
class StreamableHttpWire implements McpWire {
  private readonly server: McpServerConfig;
  private readonly deps: WireDeps;
  private client: Client | undefined;
  /** Set by the fetch wrapper just before a network failure surfaces, so the classifier can tell CORS from a dead host. */
  private networkFailure: 'network' | 'cors' | undefined;

  constructor(server: McpServerConfig, deps: WireDeps) {
    this.server = server;
    this.deps = deps;
  }

  async listTools(options: WireOptions): Promise<readonly WireTool[]> {
    this.networkFailure = undefined;
    try {
      const client = await this.open(options.timeoutMs, options.signal);
      const listed = await client.listTools(undefined, { cacheMode: 'refresh', timeout: options.timeoutMs, signal: options.signal });
      return listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations === undefined ? undefined : {
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.destructiveHint,
          idempotentHint: tool.annotations.idempotentHint,
          openWorldHint: tool.annotations.openWorldHint,
        },
      }));
    } catch (error) {
      throw this.classify(error, options.signal);
    }
  }

  async callTool(name: string, args: Record<string, unknown>, options: WireOptions): Promise<WireCallResult> {
    this.networkFailure = undefined;
    try {
      const client = await this.open(options.timeoutMs, options.signal);
      const result = await client.callTool({ name, arguments: args }, { timeout: options.timeoutMs, signal: options.signal });
      return { content: result.content, isError: result.isError === true };
    } catch (error) {
      throw this.classify(error, options.signal);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) await client.close();
  }

  private async open(timeoutMs: number, signal?: AbortSignal): Promise<Client> {
    if (this.client !== undefined) return this.client;
    // `auto`, not a pin: a pin refuses every 2025-era server (D17's amendment). The probe is the same either way.
    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION }, { versionNegotiation: { mode: 'auto' } });
    const auth = this.server.auth;
    const transport = new StreamableHTTPClientTransport(new URL(this.server.url), {
      ...(auth.kind === 'bearer' ? { authProvider: { token: () => this.deps.resolveBearer(auth.tokenRef) } } : {}),
      fetch: this.fetchFor(),
      redirectPolicy: 'same-origin',
    });
    try {
      await client.connect(transport, { timeout: timeoutMs, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
    this.client = client;
    return client;
  }

  /** Every request goes through here, and only to the server's own URL (§4 rule 6). A failure is probed before it is reported. */
  private fetchFor(): FetchLike {
    return async (input, init) => {
      const target = typeof input === 'string' ? input : input.href;
      if (!egressAllowed(target, { providerEndpoints: [], mcpServerUrls: [this.server.url] })) {
        this.networkFailure = 'network';
        throw new TypeError(`request to ${target} is outside the connected server`);
      }
      try {
        return await this.deps.fetch(input, init);
      } catch (error) {
        if (isAbort(error)) throw error;
        const reachable = await this.deps.probe(target).catch(() => false);
        this.networkFailure = reachable ? 'cors' : 'network';
        throw error;
      }
    };
  }

  private classify(error: unknown, signal: AbortSignal | undefined): WireError {
    if (error instanceof WireError) return error;
    if (isAbort(error) || signal?.aborted === true) return new WireError('abort', 'the call was aborted');
    // The SDK wraps a failed request in its own error (the version probe reports "Failed to fetch" as a
    // ProtocolError, for one). The fetch wrapper saw the real failure and recorded it, so that record wins.
    if (this.networkFailure !== undefined) return new WireError(this.networkFailure, errorMessage(error));
    if (error instanceof SdkHttpError) {
      const status = error.status;
      if (status === 401 || status === 403) return new WireError('auth', `the server answered HTTP ${status}`, status);
      return new WireError('http', `the server answered HTTP ${status}`, status);
    }
    if (error instanceof UnauthorizedError) return new WireError('auth', 'the server answered HTTP 401');
    if (error instanceof SdkError) {
      switch (error.code) {
        case SdkErrorCode.RequestTimeout:
          return new WireError('timeout', error.message);
        case SdkErrorCode.InvalidResult:
        case SdkErrorCode.UnsupportedResultType:
          return new WireError('result', error.message);
        // The probe itself failed (an unusable reply, or a close with no answer). That is a protocol failure. A revision
        // with no common one is `UnsupportedProtocolVersionError`, classified below.
        case SdkErrorCode.EraNegotiationFailed:
          return new WireError('protocol', error.message);
        case SdkErrorCode.SendFailed:
        case SdkErrorCode.ConnectionClosed:
        case SdkErrorCode.NotConnected:
          return new WireError('network', error.message);
        default:
          return new WireError('protocol', error.message);
      }
    }
    if (error instanceof UnsupportedProtocolVersionError) return new WireError('revision', error.message, undefined, { supported: revisionTokens(error.supported) });
    // The legacy handshake's own check, on the revision the server answered `initialize` with. The SDK throws a plain
    // Error for it (pinned SDK 2.3.1), so the message is what identifies it, and the message is where the revision is.
    if (error instanceof Error && error.message.startsWith(UNSUPPORTED_SERVER_REVISION)) {
      return new WireError('revision', error.message, undefined, { answered: answeredRevisionOf(error.message) });
    }
    if (error instanceof ProtocolError) return new WireError('protocol', error.message);
    if (error instanceof TypeError) return new WireError('network', error.message);
    return new WireError('protocol', errorMessage(error));
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How many revisions a refusal names at most. A server's own list is shown in full up to this many. */
const MAX_NAMED_REVISIONS = 8;

/** The revision the SDK's message names: `Server's protocol version is not supported: <rev>`. The server wrote it, so only a plain token is kept. */
function answeredRevisionOf(message: string): string | undefined {
  return revisionToken(message.slice(UNSUPPORTED_SERVER_REVISION.length).replace(/^:\s*/, ''));
}

/** The revisions a server listed, each kept only when it is a plain token, and at most {@link MAX_NAMED_REVISIONS} of them. */
function revisionTokens(values: readonly unknown[]): string[] {
  return values.map(revisionToken).filter((token): token is string => token !== undefined).slice(0, MAX_NAMED_REVISIONS);
}

/**
 * A revision as the server wrote it, if it is a plain token: a short run of letters, digits, dots, dashes and underscores.
 * The text reaches the person and the model, so anything longer, or with spaces, is left out rather than repeated.
 */
function revisionToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9A-Za-z._-]{1,32}$/.test(value) ? value : undefined;
}

/** The default wire: one {@link StreamableHttpWire} per server. */
export const createStreamableHttpWire: WireFactory = (server, deps) => new StreamableHttpWire(server, deps);
