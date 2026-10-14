/**
 * The name each external tool is given to the model (extensibility.md §3.5).
 *
 * A model's tool name must match its own rule: letters, digits, `_` and `-`, at most 64 characters. A server's tool name may
 * carry a dot or another character, and Caotang's own MCP server names every tool that way (`project.overview`). Such a tool used
 * to be hidden from search and the model as "cannot be carried to the model", while its server read healthy. It is now given an
 * alias the rule accepts. The alias is what the model sees, what the search index holds, and what the loaded set is keyed by. The
 * server still receives its own name in `tools/call` (§3.3), so a call goes to the tool the server advertised.
 */

import { sha256Hex } from './canonical.js';

/** The characters a model's tool name may carry. A name with any other character is given an alias. */
const MODEL_SAFE = /^[A-Za-z0-9_-]+$/;

/** The hex digits of SHA-256 an alias carries when the name is changed. Six is enough to tell two punctuation variants apart. */
const DIGEST_DIGITS = 6;

/** How many digests a name is tried with before the search is given up. A free alias is found at the first, in practice. */
const DIGEST_ATTEMPTS = 16;

/**
 * The alias of each of one server's tool names, keyed by the server's own name. `maxLength` is the room the alias has once the
 * server's prefix is counted: the model's limit less the prefix.
 *
 * - A name the model's rule takes, within the room, keeps its own name. Those are placed first, so no changed name takes one.
 * - Any other name becomes its safe characters, with every other character as `_`, then `_` and the first six hex digits of
 *   SHA-256 of the name. The digest is what keeps `a.b` and `a_b` apart, and what keeps a long name short.
 * - An alias that is still taken (by an unchanged name, or by another alias) takes the digest of the name with a counter, so
 *   two tools never share a name the model is shown.
 */
export async function modelSafeAliases(toolNames: readonly string[], maxLength: number): Promise<Map<string, string>> {
  const names = [...new Set(toolNames)];
  const aliases = new Map<string, string>();
  const taken = new Set<string>();
  for (const name of names) {
    if (MODEL_SAFE.test(name) && name.length <= maxLength) {
      aliases.set(name, name);
      taken.add(name);
    }
  }
  for (const name of names) {
    if (aliases.has(name)) continue;
    const alias = await freeAliasOf(name, maxLength, taken);
    aliases.set(name, alias);
    taken.add(alias);
  }
  return aliases;
}

async function freeAliasOf(name: string, maxLength: number, taken: ReadonlySet<string>): Promise<string> {
  const base = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'tool';
  for (let attempt = 0; attempt < DIGEST_ATTEMPTS; attempt += 1) {
    const digest = (await sha256Hex(attempt === 0 ? name : `${name}#${attempt}`)).slice(0, DIGEST_DIGITS);
    const head = base.slice(0, Math.max(1, maxLength - DIGEST_DIGITS - 1));
    const alias = `${head}_${digest}`;
    if (!taken.has(alias)) return alias;
  }
  throw new Error(`no free model name for the tool "${name}" after ${DIGEST_ATTEMPTS} attempts`);
}
