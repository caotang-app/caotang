/**
 * `tool.search` — [extensibility.md §5](../../../docs/architecture/extensibility.md), the Tier-2
 * meta-tool: search-then-load. The search runs over the tools of healthy, enabled servers and
 * returns excerpts; the matched tools are loaded into the current turn, and only a loaded tool
 * can be called (see `invoke.ts`).
 *
 * This file exports the tool in the harness registry entry shape (`packages/harness/src/types.ts`),
 * as `packages/coherence/src/tools.ts` does for its three tools: a metadata row, a parameter
 * spec, and a handler. The JSON Schema is derived from `params` by the harness's own
 * `toJsonSchema` at registration, so this package does not import the harness.
 *
 * Determinism (§5, eval 2): the index lists servers in their configured order and tools by name,
 * so the same configuration gives the same answer on every run. There is no fuzzy or semantic
 * layer. Substring matching over the name and the description is adequate at twenty servers.
 */

import type { CommandError, Result } from '@caotang/bus';
import { err, ok } from '@caotang/bus';

import type { ExternalToolDescriptor, IndexedTools } from './client.js';
import { clipChars, hasOwn, isRecord } from './util.js';

export const TOOL_SEARCH_NAME = 'tool.search' as const;

/** §5: the excerpt cap. Shrinks the ambient poisoning surface; the full text still appears in the approval card. */
export const EXCERPT_CHARS = 200;

/** §5: the default and the ceiling for `limit`. */
export const SEARCH_LIMIT_DEFAULT = 8;
export const SEARCH_LIMIT_MAX = 20;

/** The longest query a call may carry. A query is a short phrase, not a document. */
export const QUERY_MAX = 200;

/** The mirror of the harness's `ToolMetadata` row, for a tool outside its closed `ToolName` set. */
export interface ExtensionToolMeta {
  readonly name: typeof TOOL_SEARCH_NAME;
  readonly risk: 'read';
  readonly undoable: false;
  readonly response_token_cap: number;
  readonly descriptionVersion: number;
  readonly description: string;
  readonly surface: 'extension';
}

export const TOOL_SEARCH_META: ExtensionToolMeta = {
  name: TOOL_SEARCH_NAME,
  risk: 'read',
  undoable: false,
  response_token_cap: 2000,
  descriptionVersion: 1,
  description:
    'Search the tools of connected external servers that are enabled and reviewed, by name or description. Read-only. A matched tool is loaded for this turn and can then be called by its qualified name. An empty query lists the first matches in a fixed order. At most 20 matches per call, each with a short excerpt.',
  surface: 'extension',
};

/**
 * The parameter spec, in the subset of the harness's `ParamSpec` this tool uses (the same mirror
 * `coherence/src/tools.ts` declares). The harness reads it as-is at registration.
 */
export type ToolParamSpec =
  | { readonly kind: 'string'; readonly description: string; readonly nonBlank?: boolean; readonly maxLength?: number }
  | { readonly kind: 'integer'; readonly description: string; readonly minimum?: number; readonly maximum?: number }
  | { readonly kind: 'enum'; readonly description: string; readonly values: readonly string[] }
  | {
      readonly kind: 'object';
      readonly description: string;
      readonly properties: Readonly<Record<string, ToolParamSpec>>;
      readonly required: readonly string[];
    };

export type ToolParamsObject = Extract<ToolParamSpec, { kind: 'object' }>;

/**
 * The entry the harness reads, in the shape `coherence/src/tools.ts` uses for its port tools: a
 * `port` kind, because `tool.search` has no commands of its own, and the handler is {@link toolSearch}.
 * The port name joins the harness's closed set at integration.
 */
export interface ToolSearchEntry {
  readonly kind: 'port';
  readonly meta: ExtensionToolMeta;
  readonly params: ToolParamsObject;
  readonly port: typeof TOOL_SEARCH_NAME;
}

export const TOOL_SEARCH_PARAMS: ToolParamsObject = {
  kind: 'object',
  description: 'What to search for.',
  properties: {
    query: {
      kind: 'string',
      description: 'A word or phrase to match against tool names and descriptions. Empty lists the first matches.',
      maxLength: QUERY_MAX,
    },
    server: {
      kind: 'string',
      description: 'Limit the search to one server, by its key (the s_ form shown in the server list).',
      nonBlank: true,
    },
    risk: {
      kind: 'enum',
      description: "Limit to 'read' tools (run without a confirmation) or 'write' tools (each call asks the user).",
      values: ['read', 'write'],
    },
    limit: {
      kind: 'integer',
      description: `How many matches to return, from 1 to ${SEARCH_LIMIT_MAX}. Defaults to ${SEARCH_LIMIT_DEFAULT}.`,
      minimum: 1,
      maximum: SEARCH_LIMIT_MAX,
    },
  },
  required: ['query'],
};

/** The registry entry for `tool.search`, in the shape the harness reads. */
export const TOOL_SEARCH_ENTRY: ToolSearchEntry = {
  kind: 'port',
  meta: TOOL_SEARCH_META,
  params: TOOL_SEARCH_PARAMS,
  port: TOOL_SEARCH_NAME,
};

/**
 * A loaded tool, and the candidate hash it was shown under. `tool.search` loads with the hash, so the call that follows
 * can be bound to the definition the turn saw (extensibility §4 rule 3, §6 `expectedPins`). A name loaded alone has none.
 */
export interface LoadedTool {
  readonly qualifiedName: string;
  readonly candidateHash?: string;
}

/** Which tools a turn has loaded. One active turn at a time; `beginTurn` clears the set, as a turn ends with `endTurn`. */
export interface LoadedTools {
  beginTurn(turnId: string): void;
  endTurn(): void;
  /**
   * Loads tools for the turn. A search passes each match with the hash it showed; a bare name loads it without one.
   * A name loaded again takes the newer entry, and a bare name keeps the hash it already has.
   */
  load(tools: readonly (LoadedTool | string)[]): void;
  isLoaded(qualifiedName: string): boolean;
  /** The candidate hash the tool was shown under when it was loaded, or undefined when it was loaded by name alone. */
  hashOf(qualifiedName: string): string | undefined;
  /** The loaded tools, sorted by qualified name. */
  entries(): readonly LoadedTool[];
  names(): readonly string[];
  readonly turnId: string | undefined;
}

export function createLoadedTools(): LoadedTools {
  let turn: string | undefined;
  let loaded = new Map<string, LoadedTool>();
  return {
    beginTurn(turnId) {
      turn = turnId;
      loaded = new Map();
    },
    endTurn() {
      turn = undefined;
      loaded = new Map();
    },
    load(tools) {
      for (const tool of tools) {
        const entry: LoadedTool = typeof tool === 'string' ? { qualifiedName: tool } : tool;
        const previous = loaded.get(entry.qualifiedName);
        loaded.set(entry.qualifiedName, entry.candidateHash === undefined && previous !== undefined ? previous : entry);
      }
    },
    isLoaded: (qualifiedName) => loaded.has(qualifiedName),
    hashOf: (qualifiedName) => loaded.get(qualifiedName)?.candidateHash,
    entries: () => [...loaded.values()].sort((a, b) => (a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0)),
    names: () => [...loaded.keys()].sort(),
    get turnId() {
      return turn;
    },
  };
}

/** The one-line L0 addendum (context-assembly §2) naming the external tools loaded this turn. Undefined when none are. */
export function loadedAddendum(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  return `External tools loaded this turn, callable by their qualified name: ${names.join(', ')}.`;
}

export interface SearchMatch {
  readonly qualifiedName: string;
  readonly serverKey: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly excerpt: string;
  readonly risk: 'read' | 'write';
}

export interface ToolSearchValue {
  /** The JSON the model reads: the matches and the names surfaced. */
  readonly data: { readonly matches: readonly SearchMatch[]; readonly surfaced: readonly string[] };
  readonly summary: string;
  readonly notes: readonly string[];
  /**
   * The full descriptors of the matches (§5). They are the loaded set's entries, and the harness reads them back from
   * the index (`loadedExternalTools`) to put each one's name, description and schema in front of the model for this turn.
   */
  readonly surfaced: readonly ExternalToolDescriptor[];
}

export interface ToolSearchContext {
  readonly index: () => IndexedTools;
  readonly loaded: LoadedTools;
}

/** The handler. Refusals are `invalid-params`; an empty result, a server that is off, and an unhealthy server are results with notes. */
export function toolSearch(params: unknown, context: ToolSearchContext): Result<ToolSearchValue, CommandError> {
  const parsed = parseParams(params);
  if (!parsed.ok) return parsed;
  const { query, server, risk, limit } = parsed.value;

  const index = context.index();
  let candidates = index.tools.filter((tool) => server === undefined || tool.serverKey === server);
  if (risk !== undefined) candidates = candidates.filter((tool) => riskBadge(tool) === risk);
  const needle = query.trim().toLowerCase();
  if (needle !== '') {
    candidates = candidates.filter((tool) =>
      [tool.qualifiedName, tool.toolName, tool.description].some((text) => text.toLowerCase().includes(needle)),
    );
  }

  const picked = candidates.slice(0, limit);
  const notes: string[] = [...index.notes];
  if (candidates.length > picked.length) {
    notes.push(`${candidates.length - picked.length} more matched; narrow the query, or raise limit up to ${SEARCH_LIMIT_MAX}`);
  }
  if (server !== undefined && candidates.length === 0) {
    notes.push(`no searchable tool on server ${server}`);
  }

  // Each match is loaded under the candidate hash it is shown with, so a call that follows is bound to this definition.
  context.loaded.load(picked.map((tool) => ({ qualifiedName: tool.qualifiedName, candidateHash: tool.candidateHash })));
  const matches: SearchMatch[] = picked.map((tool) => ({
    qualifiedName: tool.qualifiedName,
    serverKey: tool.serverKey,
    serverName: tool.serverName,
    toolName: tool.toolName,
    excerpt: clipChars(tool.description, EXCERPT_CHARS),
    risk: riskBadge(tool),
  }));

  const summary =
    picked.length === 0
      ? `no external tool matched${needle === '' ? '' : ` '${query.trim()}'`}; re-search with terms from the task`
      : `loaded ${picked.length} external tool${picked.length === 1 ? '' : 's'} for this turn: ${picked.map((tool) => tool.qualifiedName).join(', ')}`;

  return ok({
    data: { matches, surfaced: picked.map((tool) => tool.qualifiedName) },
    summary,
    notes,
    surfaced: picked,
  });
}

/** The badge a model or a person reads: `read` for an auto-run tool, `write` for one that asks first. */
export function riskBadge(tool: Pick<ExternalToolDescriptor, 'effectiveRisk'>): 'read' | 'write' {
  return tool.effectiveRisk === 'read-auto' ? 'read' : 'write';
}

interface SearchParams {
  readonly query: string;
  readonly server: string | undefined;
  readonly risk: 'read' | 'write' | undefined;
  readonly limit: number;
}

const ACCEPTED_PARAMS = ['query', 'server', 'risk', 'limit'];

function parseParams(params: unknown): Result<SearchParams, CommandError> {
  const refuse = (message: string, correctiveHint: string): Result<never, CommandError> =>
    err({ code: 'invalid-params', message, target: TOOL_SEARCH_NAME, correctiveHint });
  if (!isRecord(params)) return refuse('tool.search takes an object of named parameters', 'send { "query": "…" }');
  const extra = Object.keys(params).find((key) => !ACCEPTED_PARAMS.includes(key));
  if (extra !== undefined) {
    return refuse(`"${extra}" is not a parameter of tool.search`, `accepted parameters: ${ACCEPTED_PARAMS.join(', ')}`);
  }
  if (!hasOwn(params, 'query') || typeof params['query'] !== 'string') {
    return refuse('"query" is required and must be a string', 'pass an empty string to list the first matches');
  }
  const query = params['query'];
  if (query.length > QUERY_MAX) return refuse(`"query" is longer than ${QUERY_MAX} characters`, 'search for fewer, shorter terms');
  let server: string | undefined;
  if (params['server'] !== undefined) {
    if (typeof params['server'] !== 'string' || params['server'].trim() === '') return refuse('"server" must be a server key', 'use the s_ key from the server list');
    server = params['server'];
  }
  let risk: 'read' | 'write' | undefined;
  if (params['risk'] !== undefined) {
    if (params['risk'] !== 'read' && params['risk'] !== 'write') return refuse('"risk" must be "read" or "write"', 'omit it to search both');
    risk = params['risk'];
  }
  let limit = SEARCH_LIMIT_DEFAULT;
  if (params['limit'] !== undefined) {
    const value = params['limit'];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > SEARCH_LIMIT_MAX) {
      return refuse(`"limit" must be an integer from 1 to ${SEARCH_LIMIT_MAX}`, `use a number from 1 to ${SEARCH_LIMIT_MAX}, or omit it`);
    }
    limit = value;
  }
  return ok({ query, server, risk, limit });
}
