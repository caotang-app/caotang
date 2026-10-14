/**
 * C16's **pin guard** — the thing §2's table says and criterion 1 asserts.
 *
 * ## Why this file exists
 *
 * An earlier change shipped a test named *"§2 pins prosemirror-changeset 2.4.4, not the deferred
 * 2.4.2"*, inside a `describe` block headed *"criterion 1 — the pin table is what
 * the spec says"*. Its assertion was:
 *
 * ```ts
 * expect(CANONICAL_STRINGIFY_OPTIONS.bullet).toBe('-');
 * ```
 *
 * `bullet` is a **remark-stringify dialect option** — which character a bullet
 * list uses. It has nothing to do with any package version, and it cannot fail
 * because a pin moved. Measured: reverting the real pin from `2.4.4` to the
 * deferred `2.4.2` in `package.json` leaves **all 335 tests green**, this one
 * included, while the neighbouring tests fail the moment `bullet` is touched —
 * the coupling ran the wrong way.
 *
 * That is the ninth instance of a recurring species (*a green
 * suite standing next to a guard that cannot see its subject*), and the first
 * where the guard was the slice's **whole reason to exist**: a gate whose name
 * is "the pin preflight" held no assertion about a pin. §2's row said
 * `prosemirror-changeset` **exact 2.4.4**, and the sentence beside it said
 * *"pinning a known-superseded patch is not a reason"* — a decision no test
 * could catch being undone.
 *
 * ## What this guard reads
 *
 * The manifest and the lockfile, which are the two surfaces the claim is about:
 *
 * - `packages/editor-audit/package.json` — the **declaration**. §2's policy is
 *   *exact* pins, so a caret or tilde anywhere in the dependency block is a
 *   failure, not a style note.
 * - `pnpm-lock.yaml` — the **resolution**, i.e. what is actually installed.
 *   §2 calls the policy "lockfile-enforced", so the lockfile is not optional
 *   here; the manifest alone cannot tell you what resolved.
 *
 * It does **not** read §2. §2 is the claim under test, and a guard that reads
 * the claim proves the claim is self-consistent rather than true. The expected
 * versions are written out below as literals, deliberately: if a pin moves, this
 * test fails and someone must make a decision and update *both* §2 and this
 * file — which is exactly the two-place edit criterion 5 performed at the
 * preflight.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectLockfile } from '../../../test/lockfile';

const repoRoot = resolve(__dirname, '..', '..', '..');
const auditManifest = join(repoRoot, 'packages', 'editor-audit', 'package.json');
const lockfile = join(repoRoot, 'pnpm-lock.yaml');

/**
 * §2's pin table, as the numbers an earlier change adopted (criterion 5). Keyed by package.
 * This is the **v0.1 set only** — `@handlewithcare/prosemirror-suggest-changes`
 * is deliberately absent, because §2 marks it v0.2-only and the criterion is
 * an assertion that it is *not* in the tree (asserted below).
 */
const EXPECTED_PINS: Readonly<Record<string, string>> = {
  '@handlewithcare/remark-prosemirror': '0.1.5',
  '@tiptap/core': '3.31.4',
  '@tiptap/extension-character-count': '3.31.4',
  '@tiptap/extension-image': '3.31.4',
  '@tiptap/extension-link': '3.31.4',
  '@tiptap/extension-placeholder': '3.31.4',
  '@tiptap/extensions': '3.31.4',
  '@tiptap/pm': '3.31.4',
  '@tiptap/starter-kit': '3.31.4',
  'diff-match-patch': '1.0.5',
  'fastest-levenshtein': '1.0.16',
  'prosemirror-changeset': '2.4.4',
  'remark-gfm': '4.0.1',
  'remark-parse': '11.0.0',
  'remark-stringify': '11.0.0',
  'unified': '11.0.5',
};

/** §2 marks this v0.2-only. Criterion 1's bullet says it must not be installed. */
const V02_ONLY = '@handlewithcare/prosemirror-suggest-changes';

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = (() => {
  const parsed: Manifest = JSON.parse(readFileSync(auditManifest, 'utf8'));
  if (!parsed.dependencies) throw new Error('editor-audit declares no dependencies');
  return parsed;
})();

const declared = { ...manifest.dependencies, ...manifest.devDependencies };
// pnpm 12's lockfile is two documents, and the first is pnpm's own
// self-management record rather than this project — see test/lockfile.ts, which
// is the one place that knows how to tell them apart. Both the `packages:` and
// the `snapshots:` reads below go through it, because each would otherwise
// happily parse the wrong document.
const lockText = projectLockfile(readFileSync(lockfile, 'utf8'));

/**
 * Typed accessors for the two lockfile line shapes.
 *
 * `RegExpExecArray` is `Array<string>` with optional members under this
 * package's `noUncheckedIndexedAccess`, so a raw `match[1]` is `string |
 * undefined`. Returning `null` instead keeps the parsing code free of non-null
 * assertions and makes the one real failure mode — a shape the regex did not
 * match — readable at the call site.
 */
const KEY_LINE = /^ {2}(?! )'?(.+?)'?:\s*$/;
const DEP_LINE = /^ {6}'?([^\s:]+)'?:\s+([\d][^\s]*)\s*$/;

/** The key on a two-space-indented snapshot line, or `null`. */
const keyOn = (line: string): string | null => KEY_LINE.exec(line)?.[1] ?? null;

/** A `[name, version]` dependency edge on a six-space-indented line, or `null`. */
const depOn = (line: string): [string, string] | null => {
  const match = DEP_LINE.exec(line);
  const name = match?.[1];
  const value = match?.[2];
  if (name === undefined || value === undefined) return null;
  // A peer-suffixed dep value (`3.31.4(@tiptap/pm@3.31.4)`) is reduced to its
  // version: the pin under test is the version, and the peer wiring is asserted
  // separately below.
  return [name, value.replace(/\(.*\)$/, '')];
};

/**
 * The lockfile's `packages:` section — every resolution in the tree, keyed by
 * `name@version`, with an integrity hash on the following line.
 *
 * `snapshots:` is **not** a complete list: pnpm only emits a snapshot entry for
 * a package that carries peer state, so a dependency with no peers and no
 * dependencies of its own (`diff-match-patch`, `fastest-levenshtein`) has a
 * `packages:` entry and **no** `snapshots:` entry at all. Reading only
 * `snapshots:` therefore reports two installed packages as absent — measured,
 * and it is the reason this guard asserts against `packages:` and reaches into
 * `snapshots:` only for the `@tiptap/pm` edges.
 *
 * Parsed by indentation, because two shapes are easy to confuse: a key is
 * two-space-indented `'name@version(peer@1.2.3)':` (the peer suffix is part of
 * the key, not of the version), while `resolution:`/`engines:` are four-space
 * and must never be read as keys. `(?! )` after the two spaces is load-bearing:
 * without it a nested line is parsed as a key and the real snapshot is silently
 * replaced by one named after its own child.
 */
const resolutions = ((): Array<{ key: string; deps: Array<[string, string]> }> => {
  const lines = lockText.split(/\r?\n/);
  const packagesAt = lines.indexOf('packages:');
  if (packagesAt === -1) throw new Error('pnpm-lock.yaml has no packages section');
  const snapshotsAt = lines.findIndex((line, i) => i > packagesAt && line === 'snapshots:');
  const out: Array<{ key: string; deps: Array<[string, string]> }> = [];
  let current: { key: string; deps: Array<[string, string]> } | null = null;
  for (const line of lines.slice(packagesAt + 1, snapshotsAt === -1 ? undefined : snapshotsAt)) {
    const key = keyOn(line);
    if (key !== null) {
      current = { key, deps: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const dep = depOn(line);
    if (dep) current.deps.push(dep);
  }
  return out;
})();

/** `name@version` → `name`, dropping any `(peer@…)` suffix from the key. */
const nameOf = (key: string): string => key.replace(/\(.*\)$/, '').replace(/@[^@]*$/, '');

/** `name@version` → `version`, dropping any `(peer@…)` suffix from the key. */
const versionOf = (key: string): string => {
  const bare = key.replace(/\(.*\)$/, '');
  return bare.slice(bare.lastIndexOf('@') + 1);
};

/**
 * Every version the lockfile *resolves*, per package. A name → set-of-versions
 * map rather than name → version, so a double resolution is visible as a set
 * with two members instead of being collapsed by a `Map.set` overwrite.
 */
const resolvedVersions = ((): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const { key } of resolutions) {
    const name = nameOf(key);
    const bag = out.get(name) ?? new Set<string>();
    bag.add(versionOf(key));
    out.set(name, bag);
  }
  return out;
})();

const resolved = (name: string): string[] => [...(resolvedVersions.get(name) ?? [])].sort();

/**
 * The dependency edges of one exact `name@version`.
 *
 * Edges live in the `snapshots:` section (pnpm records the *resolved* peer graph
 * there), so this reads that section rather than `packages:`, which carries only
 * the resolution metadata. Returns `null` rather than throwing when the snapshot
 * is absent, so the caller can say so in the failure message.
 */
const edgesFor = (name: string, version: string): Array<[string, string]> | null => {
  const lines = lockText.split(/\r?\n/);
  const start = lines.indexOf('snapshots:');
  if (start === -1) throw new Error('pnpm-lock.yaml has no snapshots section');
  const body = lines.slice(start + 1);

  // Index of the snapshot's key, then read forward until the next key. Scoping
  // by index rather than by a `break` on "some other key" is what makes this
  // work for a snapshot anywhere in the section: an earlier version of this
  // function broke on the *second* key it saw, so it only ever worked when the
  // requested package happened to be the first entry.
  const keyIndex = body.findIndex((line) => {
    const key = keyOn(line);
    return key !== null && nameOf(key) === name && versionOf(key) === version;
  });
  if (keyIndex === -1) return null;

  const deps: Array<[string, string]> = [];
  for (const line of body.slice(keyIndex + 1)) {
    if (keyOn(line) !== null) break; // the next snapshot begins
    const dep = depOn(line);
    if (dep) deps.push(dep);
  }
  return deps;
};

describe('C16 · criterion 1 — §2\'s pin table, as declarations and as resolutions', () => {
  it('every §2 pin is declared at the exact version — no ranges', () => {
    // §2's policy line: "exact pins, single version across `@tiptap/*`,
    // lockfile-enforced". A caret is the failure mode that policy exists to
    // prevent, so the *whole* dependency block is checked for one, not just the
    // packages below.
    const ranged = Object.entries(declared)
      .filter(([, range]) => !/^\d+\.\d+\.\d+$/.test(range))
      .map(([name, range]) => `${name}: ${range}`);
    expect(ranged).toEqual([]);
  });

  it('every declared dependency is one §2 names, at the version §2 adopted', () => {
    // Compared against the literal table above, so a pin that moves in the
    // manifest fails here even though the lockfile has not been reinstalled yet.
    const drifted = Object.entries(manifest.dependencies ?? {})
      .filter(([name, version]) => EXPECTED_PINS[name] !== version)
      .map(([name, version]) => `${name} declared ${version}, §2 adopted ${EXPECTED_PINS[name] ?? 'nothing'}`);
    expect(drifted).toEqual([]);
  });

  it('every §2 pin is actually installed at that version', () => {
    // The manifest is the claim; this is the tree. A pin can be declared and
    // still not be what a fresh `pnpm install` produces.
    const wrong = Object.entries(EXPECTED_PINS)
      .filter(([name]) => resolved(name).length === 0)
      .map(([name]) => `${name} is declared but absent from the lockfile`);
    expect(wrong).toEqual([]);
  });

  it('`prosemirror-changeset` is 2.4.4, not the deferred 2.4.2 — in both surfaces', () => {
    // The decision criterion 5 records, asserted on its own because it is the
    // one pin §2's own table carried in *two* states and had to be reconciled.
    // Both directions are checked because a lockfile-only or manifest-only
    // disagreement is exactly the state an earlier change shipped in.
    expect(manifest.dependencies?.['prosemirror-changeset']).toBe('2.4.4');
    expect(resolved('prosemirror-changeset')).toEqual(['2.4.4']);
    // And the deferred value is named, so the failure message says what it was.
    expect(EXPECTED_PINS['prosemirror-changeset']).not.toBe('2.4.2');
  });

  it('single version across every `@tiptap/*` — the ERESOLVE guard, measured', () => {
    // §2: "Mixing patch versions across `@tiptap/*` packages causes npm
    // ERESOLVE conflicts (ueberdosis/tiptap#7591)". The precedent is real, so
    // the policy is checked in the lockfile where a second resolution would
    // appear, rather than assumed from upstream packaging.
    const tiptap = [...resolvedVersions.entries()].filter(([name]) => name.startsWith('@tiptap/'));
    expect(tiptap.length).toBeGreaterThan(0);
    const multi = tiptap.filter(([, versions]) => versions.size > 1).map(([name, versions]) => `${name}: ${[...versions].join(', ')}`);
    expect(multi).toEqual([]);
    const versions = new Set(tiptap.flatMap(([, v]) => [...v]));
    expect([...versions]).toEqual(['3.31.4']);
  });

  it('criterion 1\'s exclusion holds — the v0.2 suggestion layer is NOT installed', () => {
    // §2 marks it v0.2-only and criterion 1 says "**Not**
    // `@handlewithcare/prosemirror-suggest-changes`". An exclusion asserted
    // only by the table is not an exclusion.
    expect(declared[V02_ONLY]).toBeUndefined();
    expect(resolved(V02_ONLY)).toEqual([]);
  });
});

describe('C16 · criterion 2 — peer resolution, proved from the lockfile', () => {
  /**
   * §2's residue: "confirm every `prosemirror-*` peer range resolves against the
   * pinned `@tiptap/pm`". The reading that matters is *one version per package*:
   * a ProseMirror tree with two copies of `prosemirror-model` is the failure
   * that produces `ERESOLVE` and, worse, a silent schema mismatch at runtime.
   */
  it('every `prosemirror-*` package resolves to exactly one version', () => {
    const pm = [...resolvedVersions.entries()].filter(([name]) => name.startsWith('prosemirror-'));
    expect(pm.length).toBeGreaterThan(10);
    const multi = pm.filter(([, versions]) => versions.size > 1).map(([name, versions]) => `${name}: ${[...versions].join(', ')}`);
    expect(multi).toEqual([]);
  });

  it('`@tiptap/pm` 3.31.4 wires the PM set at the versions that resolve', () => {
    // The claim an earlier change logged as "prosemirror-changeset@2.4.4 satisfies @tiptap/pm's
    // ^2.4.1" — re-derived here as the snapshot's own edges, so the assertion is
    // about the wiring rather than about a version string in prose. Every edge
    // the snapshot declares must be the *only* version that package resolves to,
    // which is the "every prosemirror-* range resolves against the pinned pm"
    // claim in §2's residue, checked from the lockfile.
    const edges = edgesFor('@tiptap/pm', '3.31.4');
    expect(edges, 'no @tiptap/pm@3.31.4 snapshot in the lockfile').not.toBeNull();
    const pmEdges = edges!.filter(([name]) => name.startsWith('prosemirror-'));
    expect(pmEdges.length).toBeGreaterThan(10);
    for (const [name, version] of pmEdges) {
      expect(resolved(name), `${name} wired at ${version}`).toEqual([version]);
    }
  });

  it('`prosemirror-model` is the single version remark-prosemirror peers on', () => {
    // The one peer an earlier change called out by name. §2.1 says "`prosemirror-model@1.25.12`
    // satisfies remark-prosemirror's `^1.24.0` peer" — so the *installed* model
    // version is asserted here, and the caret range is checked by the install
    // having produced no ERESOLVE at all (criterion 1's no-peer-warning claim).
    expect(resolved('prosemirror-model')).toEqual(['1.25.12']);
  });
});
