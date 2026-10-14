/**
 * The MCP bundle is packed with `pnpm --filter @caotang/mcp-server run pack`. The bare `pack` is pnpm's built-in tarball
 * command, so a document or a script that names it sends the reader to a tarball, not a `.mcpb` bundle. CI and the README
 * named it that way once, and the wrong form still reads as a plausible command. These tests read every file that
 * names the bundle command and fail on the bare form.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..');

/** The documents and scripts that tell a reader or CI how to pack the bundle. */
const FILES = [
  'README.md',
  'CHANGELOG.md',
  'docs/USER-GUIDE.md',
  'docs/architecture/extensibility.md',
  'packages/mcp-server/README.md',
  'packages/mcp-server/scripts/pack-mcpb.mjs',
  '.github/workflows/ci.yml',
];

/** The bare form: the package filter, then `pack` with nothing between them. `run pack` does not match it. */
const BARE_PACK = /@caotang\/mcp-server pack\b/;
const RUN_PACK = /@caotang\/mcp-server run pack\b/;

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('the MCP bundle is packed with the run form', () => {
  it.each(FILES)('%s never names the bare pack, which is pnpm’s tarball command', (path) => {
    expect(read(path)).not.toMatch(BARE_PACK);
  });

  it('the CI step and the readme name the run form, so the check above is not vacuous', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(RUN_PACK);
    expect(read('README.md')).toMatch(RUN_PACK);
  });
});
