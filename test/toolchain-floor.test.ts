/**
 * The toolchain floor an earlier change landed, and the two facts `pnpm audit` cannot see.
 *
 * ## Why this file exists
 *
 * An earlier change moved three declarations in the root manifest —
 * `vitest` 2.1.9 → 5.0.3, `vite` `^6.0.7` → `^6.4.0`, `engines.node` → vitest 5's
 * own floor — and cleared all seven advisories in one command. Its acceptance
 * criterion 4 required the vulnerable subtree's absence to be *"proved rather than
 * asserted"*, and its Delegated 2 recorded the proof as **a lockfile read plus
 * `pnpm audit`**, declining to add a test.
 *
 * Two things were true of that record when it was written and one of them is no
 * longer:
 *
 * 1. **The stated blocker was removed six hours later.** Delegated 2's reason for
 *    adding no test was that *"a lockfile-reading unit test would be scoped by the
 *    test glob to `packages/*`...*, so it would have needed a new workspace package
 *    to live in — which is a different slice."* That was correct at 04:05, when
 *    `vitest.config.ts` collected package tests only. At 10:32 the same day, review
 *    A review added the root `test` suite to that `include` — and wrote the lesson into the
 *    comment beside it: *"a guard that verify never collects is a guard that is green
 *    because it never ran."* The premise died; the conclusion stayed on the page, so
 *    a reader today would re-decide on a false fact. This file is the correction: the
 *    guard lives in the root suite, so **no new package was needed**, which was the
 *    whole of the objection.
 *
 * 2. **The nominated continuous check is blind to the trap.** Delegated 2 records
 *    that *"the continuous check is `pnpm audit` itself"*, and the commit message
 *    names what an earlier change avoided: `@vitejs/plugin-react` 6.1.1 peers `vite ^8.0.0` and
 *    would have turned a three-declaration slice into a Vite-major migration.
 *    **That is a peer-range fact, and no advisory database will ever carry it.**
 *    Measured in a clean-room `%TEMP%` project, not argued: `pnpm add -D
 *    @vitejs/plugin-react@6.1.1` followed by `pnpm audit` reports
 *    **`No known vulnerabilities found`** — the exact version an earlier change avoided audits
 *    clean, on its own. A clean `pnpm audit` therefore proves nothing about the
 *    constraint the commit was written around, which makes the peer assertions
 *    below the part of this file that is not a duplicate of `pnpm audit`.
 *
 * ## The technique
 *
 * **Read the fact out of the lockfile; never transcribe it.** The peer ranges and
 * engine floors this file checks are all recorded in `pnpm-lock.yaml` — `vitest@5.0.3`
 * carries `engines: {node: …}` and a `vite` peer range, and so does
 * `@vitejs/plugin-react@4.7.0`. So a floor that moves is *checked against the new
 * fact* rather than against a copy of the old one, and the legitimate future
 * migration this repo has already scoped (Vite 8, or plugin-react 5.x/6.x) makes
 * these assertions pass on its merits instead of needing an exemption.
 *
 * That is also why no version is written as a literal here. docs/decisions.md
 * (14:00) already corrected *"plugin-react stays on 4.x"* to its reason — **the
 * reason is durable and the version is not** — and a guard built on the version
 * would re-freeze the over-broad form the same entry rejected.
 *
 * Every absence assertion in this file passes vacuously against an empty parse, so
 * the parse is asserted first, in its own test, exactly as the queue guard does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectLockfile } from './lockfile';

const repoRoot = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  engines: { node: string };
  devDependencies: Record<string, string>;
};

/**
 * The build allowlist, read from **pnpm-workspace.yaml**.
 *
 * It was a `pnpm` block in package.json until 2026-10-02, and reading it from
 * there is now a silent wrong answer rather than an error: pnpm 12 does not read
 * that key at all, so a manifest that still carried it would satisfy this
 * helper's old home while pnpm ignored the entry entirely — and, as measured,
 * failed the install with ERR_PNPM_IGNORED_BUILDS.
 *
 * Parsed by hand because the repo reads its own lockfile by hand for the same
 * reason, and because a YAML parser for one optional list is a dependency this
 * guard does not justify. Absent means "no allowlist", which is a legitimate
 * state, not a parse failure.
 */
function buildAllowlist(): string[] {
  const yaml = readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const block = /^onlyBuiltDependencies:\s*$/m.exec(yaml);
  if (!block) return [];
  return yaml
    .slice(block.index + block[0].length)
    .split(/\r?\n/)
    .map((line) => /^\s+-\s+(\S+)\s*$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}
const lockfile = projectLockfile(readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8'));

/**
 * The lockfile's `packages:` block — the **resolutions**, which is what actually
 * installs. `importers:` records declared specs and `snapshots:` records peer-
 * suffixed duplicates of the same resolutions, so neither is the complete set
 *. Reading only one of the three audits a subset.
 *
 * Scoped names are single-quoted in the lockfile, and the quotes are stripped here
 * because an unstripped quote makes `@scope/pkg` fail every filter and report as
 * **absent** — the useful direction to fail in, and the one this file's own first
 * test exists to catch.
 */
interface PackageEntry {
  name: string;
  version: string;
  /** Raw block text, for the `engines` and `peerDependencies` a floor is read from. */
  block: string;
}

function parseResolutions(): PackageEntry[] {
  const lines = lockfile.split(/\r?\n/);
  const entries: PackageEntry[] = [];
  let inPackages = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    // Any other top-level key ends the block; `snapshots:` is one of them.
    if (inPackages && /^\S/.test(line)) break;
    if (!inPackages) continue;

    const header = /^ {2}(\S.*?):\s*$/.exec(line);
    if (!header) continue;
    const key = header[1]!.replace(/^'(.*)'$/, '$1');
    const body = key.startsWith('@') ? key.slice(1) : key;
    const at = body.lastIndexOf('@');
    if (at <= 0) continue;
    entries.push({
      name: key.startsWith('@') ? `@${body.slice(0, at)}` : body.slice(0, at),
      version: body.slice(at + 1),
      block: lines.slice(i + 1, i + 60).join('\n'),
    });
  }
  return entries;
}

const resolutions = parseResolutions();

/** Every resolved version of `name`, sorted. */
function resolvedVersions(name: string): string[] {
  return [...new Set(resolutions.filter((r) => r.name === name).map((r) => r.version))].sort();
}

/** The lockfile block for the single resolved `name@version`. */
function entryFor(name: string, version: string): string {
  const hit = resolutions.find((r) => r.name === name && r.version === version);
  if (!hit) throw new Error(`no lockfile entry for ${name}@${version}`);
  return hit.block;
}

const majorOf = (version: string): number => Number(version.split('.')[0]);

/**
 * The majors a `^`-rooted peer range admits, read out of the package's own
 * declared `peerDependencies` line.
 *
 * Deliberately narrow: `vite: ^6.4.0 || ^7.0.0 || ^8.0.0` yields `{6,7,8}`. A
 * range it cannot read yields an **empty set and a thrown error**, never a
 * permissive one — the shape this repo has now found three times, where a parse
 * that silently matches nothing is indistinguishable from a guard that silently
 * checks nothing.
 */
function peerMajors(name: string, version: string, peer: string): Set<number> {
  const block = entryFor(name, version);
  const section = /peerDependencies:\n((?: {4,}\S.*\n?)+)/.exec(block);
  if (!section) throw new Error(`${name}@${version} declares no peerDependencies to read`);
  const line = new RegExp(`^\\s+'?${peer}'?:\\s*(.+)$`, 'm').exec(section[1]!);
  if (!line) throw new Error(`${name}@${version} declares no '${peer}' peer`);
  const majors = [...line[1]!.matchAll(/\^\s*(\d+)/g)].map((m) => Number(m[1]));
  if (majors.length === 0) {
    throw new Error(`${name}@${version} '${peer}' peer is not caret-rooted: ${line[1]}`);
  }
  return new Set(majors);
}

/** The `node` floor a package declares, read out of its lockfile entry. */
function declaredEngines(name: string, version: string): string {
  const block = entryFor(name, version);
  const engines = /engines:\s*\{node:\s*([^}]+)\}/.exec(block);
  if (!engines) throw new Error(`${name}@${version} declares no engines in the lockfile`);
  return engines[1]!.trim();
}

describe("the toolchain floor, read out of the lockfile", () => {
  it('parses the resolutions -- a parse that matches nothing fails, not passes', () => {
    // The control assertion, and it is load-bearing rather than decorative: every
    // `absent` claim below is satisfied by an empty map, so without this a broken
    // parser would report a clean tree for the wrong reason.
    //
    // It earned its keep on 2026-10-02: pnpm 12 writes the lockfile as TWO
    // documents (see test/lockfile.ts), this file read the first, and the
    // control reported `expected 15 to be greater than or equal to 300`. The
    // guard below the control could not have noticed on its own — every
    // assertion it makes is an `absent` claim, and an empty map satisfies all
    // of them.
    expect(resolutions.length).toBeGreaterThanOrEqual(300);
    for (const name of ['vitest', 'vite', '@vitejs/plugin-react', 'typescript']) {
      expect(resolvedVersions(name), `${name} must resolve somewhere in the tree`).not.toEqual([]);
    }
    // Spot-check the two exact resolutions the commit message names.
    expect(resolvedVersions('vitest')).toEqual(['5.0.3']);
  });

  it("carries no resolution of vite below major 6 -- criterion 4's subtree absence", () => {
    // An earlier change claimed `vite@5.4.21` and `esbuild@0.21.5` are absent because *the edge
    // that nested them is gone*, not because anything was upgraded past them. The
    // durable form of that claim is a floor, not two versions: a later toolchain
    // slice may move either one upward, and must not move either one downward
    // without deciding to.
    const vite = resolvedVersions('vite');
    expect(vite.filter((v) => majorOf(v) < 6), `vite below 6 resolved: ${vite.join(', ')}`).toEqual([]);

    // The esbuild half is now stronger than a version floor: since Vite 8,
    // **esbuild is not in the tree at all** (it bundled with esbuild; Vite 8
    // bundles with rolldown/oxc). Measured 2026-10-02 — 0 resolutions in the
    // lockfile, and `pnpm install` completes with no build allowlist, which is
    // why pnpm-workspace.yaml no longer names it. Asserted as an absence rather
    // than left to the floor above, because "esbuild is gone entirely" is the
    // fact a future slice would otherwise have to re-derive.
    expect(resolvedVersions('esbuild'), 'esbuild no longer resolves: Vite 8 bundles with rolldown/oxc').toEqual(
      [],
    );
  });

  it('resolves one vite major, because a second one is a nested vulnerable edge again', () => {
    // The subject is **one** major, not a particular one. An earlier change wrote `[6]` as a
    // literal, and the Vite-8 toolchain slice (2026-10-02) failed it for being a
    // fossil: the rule is "no second, nested vite edge", so the number to
    // compare against is the major the root manifest *declares*, which moves
    // only when someone decides to move it.
    const declared = majorOf(manifest.devDependencies.vite.replace(/^\D*/, ''));
    const majors = [...new Set(resolvedVersions('vite').map(majorOf))].sort();
    expect(majors, `vite majors in the tree: ${majors.join(', ')}`).toEqual([declared]);
  });

  it("has vitest's resolved vite inside vitest's own declared peer range", () => {
    const version = resolvedVersions('vitest')[0]!;
    const viteMajor = majorOf(resolvedVersions('vite')[0]!);
    const admitted = peerMajors('vitest', version, 'vite');
    expect(
      admitted.has(viteMajor),
      `vitest@${version} admits vite majors {${[...admitted].sort().join(',')}}, ` +
        `but the tree resolves vite ${viteMajor}. The structural claim is that vitest 5 takes vite as a peer ` +
        `(^6.4.0 || ^7 || ^8) rather than a dependency, so the resolution must satisfy the peer.`,
    ).toBe(true);
  });

  it('has plugin-react inside its own declared vite peer range -- the trap pnpm audit cannot see', () => {
    // The constraint, stated as its reason. `@vitejs/plugin-react` 4.7.0 admits
    // vite majors {4,5,6,7}; 6.1.1 admits only {8} and would force the root Vite
    // major with it. Asserting "stays on 4.x" would freeze the version the 14:00
    // entry rejected; asserting the peer range keeps the real rule and lets the
    // Vite-8 migration pass on its merits.
    const viteMajor = majorOf(resolvedVersions('vite')[0]!);
    const version = resolvedVersions('@vitejs/plugin-react')[0]!;
    const admitted = peerMajors('@vitejs/plugin-react', version, 'vite');
    expect(
      admitted.has(viteMajor),
      `@vitejs/plugin-react@${version} admits vite majors {${[...admitted].sort().join(',')}}, but the tree ` +
        `resolves vite ${viteMajor}. Moving plugin-react to 6.x is only safe alongside a Vite-major migration, ` +
        `and "pnpm audit" will not report it: 6.1.1 audits clean on its own.`,
    ).toBe(true);
  });

  it('declares engines.node as vitest does, because vitest is what sets the floor', () => {
    // The third declaration was vitest 5's own `engines`, copied verbatim. If
    // vitest moves, the user-facing support claim has to move with it — and this
    // is the assertion that says so, in the failure direction the repo wants:
    // loud, on the day the floor moves.
    expect(manifest.engines.node).toBe(declaredEngines('vitest', resolvedVersions('vitest')[0]!));
  });

  it('names no build-allowlist entry that is not installed -- Delegated 1, as a rule', () => {
    // An earlier change kept `esbuild` in the build allowlist and, correctly, argued from the
    // *package* rather than from the version that had just left: dropping the
    // entry would suppress a build step the install still needs. This states the
    // conditional itself, so a later toolchain slice that removes a package is
    // told to remove the entry too.
    //
    // Two facts moved it, both on 2026-10-02. **The allowlist is no longer in
    // package.json** — pnpm 12 reads it from pnpm-workspace.yaml, and leaving it
    // in package.json made pnpm treat esbuild's install script as an *ignored*
    // build (ERR_PNPM_IGNORED_BUILDS). And **esbuild is no longer installed at
    // all**, since Vite 8 bundles with rolldown/oxc — so the entry is gone rather
    // than stale, and this asserts the rule against a list that may be empty.
    const allowlist = buildAllowlist();
    const orphan = allowlist.filter((name) => resolvedVersions(name).length === 0);
    expect(orphan, 'the build allowlist names packages that are not resolved').toEqual([]);
  });
});
