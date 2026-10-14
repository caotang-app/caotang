/**
 * The egress allowlist — [extensibility.md §4 rule 6](../../../docs/architecture/extensibility.md):
 * *"the egress allowlist becomes provider endpoints + user-connected MCP server URLs"*.
 *
 * Both halves are user-configured, which is what keeps the local-first promise honest: the
 * arguments of a tool call may quote manuscript text, and they leave the machine only for a
 * server the person connected, the same trust the BYOK provider gets. The gateway owns the
 * provider half and passes its endpoints in; this module only decides.
 *
 * A target is allowed when some entry shares its origin and the entry's path is a prefix of the
 * target's path on a segment boundary. An entry with no path allows the whole origin.
 */

import type { McpServerConfig } from './config.js';

export interface EgressAllowlist {
  /** The provider base URLs in use (the gateway's profiles), each a full URL. */
  readonly providerEndpoints: readonly string[];
  /** The endpoints of the enabled, user-connected MCP servers. */
  readonly mcpServerUrls: readonly string[];
}

/** The allowlist for a settings snapshot: the enabled servers only, so a disabled server is unreachable. */
export function egressAllowlistFor(input: { readonly providerEndpoints: readonly string[]; readonly servers: readonly McpServerConfig[] }): EgressAllowlist {
  return {
    providerEndpoints: [...input.providerEndpoints],
    mcpServerUrls: input.servers.filter((server) => server.enabled).map((server) => server.url),
  };
}

/** True when a request to `target` is inside the allowlist. A target with credentials, or a non-web scheme, is never allowed. */
export function egressAllowed(target: string, allow: EgressAllowlist): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return [...allow.providerEndpoints, ...allow.mcpServerUrls].some((entry) => {
    let base: URL;
    try {
      base = new URL(entry);
    } catch {
      return false;
    }
    if (base.origin !== url.origin) return false;
    const basePath = base.pathname.replace(/\/+$/, '');
    return basePath === '' || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  });
}
