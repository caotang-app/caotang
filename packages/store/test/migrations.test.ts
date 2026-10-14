/**
 * §6 migration registry — [project-format.md §6](docs/architecture/project-format.md).
 *
 * §6 requires two things this suite has to prove: the registry is a *fixed* one
 * of `v(n) → v(n+1)` steps, and "each" step comes with "a unit test fixture pair".
 *
 * The production registry is empty on purpose (§6's own first line: "v1 is the
 * first stable format" — and §2: "no wild artifacts exist before implementation",
 * so there has never been a v0). An empty registry means the requirement is
 * vacuous, so the fixtures below are attached to a *synthetic* two-step registry
 * and the machinery is exercised against that. The fixture-coverage test then
 * makes the requirement real rather than decorative: it walks the production
 * registry and fails if any registered migration lacks a fixture, so the day
 * someone adds the first genuine v1 → v2 step, this file has to grow with it.
 */

import { describe, expect, it } from 'vitest';
import { MemoryArtifactFs, MANIFEST_FILE, readProject } from '../src/index.js';
import {
  FORMAT_VERSION,
  MIGRATIONS,
  MigrationError,
  createEmptyManifest,
  migrateToCurrent,
  runMigrations,
  serializeManifest,
  validateManifest,
  type Migration,
  type MigrationRegistry,
  type Manifest,
} from '../src/index.js';

/** §6: "a fixed registry, each with a unit test fixture pair". */
interface FixturePair {
  readonly from: number;
  readonly describe: string;
  /** the manifest as it exists at `from` */
  readonly input: Record<string, unknown>;
  /** what the step must produce, content-wise, at `from + 1` */
  readonly expected: Record<string, unknown>;
}

/** v1 → v2: `tree[].synopsis` is renamed to `tree[].summary`. */
const v1ToV2: Migration = {
  from: 1,
  to: 2,
  describe: 'rename tree[].synopsis to tree[].summary',
  run(input) {
    const tree = (input.tree as Record<string, unknown>[]).map((node) => {
      const { synopsis, ...rest } = node;
      return { ...rest, summary: synopsis };
    });
    return { ...input, tree };
  },
};

/** v2 → v3: a scalar is added to `derived`. */
const v2ToV3: Migration = {
  from: 2,
  to: 3,
  describe: 'add derived.savedAt',
  run(input) {
    const derived = input.derived as Record<string, unknown>;
    return { ...input, derived: { ...derived, savedAt: '2026-09-30T00:00:00.000Z' } };
  },
};

const FIXTURES: readonly FixturePair[] = [
  {
    from: 1,
    describe: v1ToV2.describe,
    input: {
      app: 'caotang',
      formatVersion: 1,
      tree: [{ id: 'root', synopsis: 'the whole book' }],
    },
    expected: {
      app: 'caotang',
      formatVersion: 2,
      tree: [{ id: 'root', summary: 'the whole book' }],
    },
  },
  {
    from: 2,
    describe: v2ToV3.describe,
    input: {
      app: 'caotang',
      formatVersion: 2,
      tree: [{ id: 'root', summary: 'the whole book' }],
    },
    expected: {
      app: 'caotang',
      formatVersion: 3,
      tree: [{ id: 'root', summary: 'the whole book' }],
      derived: { savedAt: '2026-09-30T00:00:00.000Z' },
    },
  },
];

const SYNTHETIC: MigrationRegistry = [v1ToV2, v2ToV3];

const at = (version: number): Record<string, unknown> => {
  const base = createEmptyManifest('K', new Date('2026-09-30T00:00:00.000Z'));
  return { ...(base as unknown as Record<string, unknown>), formatVersion: version };
};

describe('§6 registry shape', () => {
  it('ships an empty production registry, because v1 is the first format', () => {
    // Asserted deliberately. It is not a placeholder to be filled in: §2 says no
    // wild artifacts exist pre-implementation, so a `v0 → v1` step would be a
    // migration for a version that never shipped. This test flips the day
    // format v2 exists — and the fixture-coverage test below then bites.
    expect(MIGRATIONS).toEqual([]);
  });

  it('gives every registered migration a fixture pair', () => {
    const covered = new Set(FIXTURES.map((f) => f.from));
    for (const migration of [...MIGRATIONS, ...SYNTHETIC]) {
      expect(
        covered.has(migration.from),
        `migration v${migration.from} → v${migration.to} has no fixture pair in this file`,
      ).toBe(true);
    }
  });

  it('rejects a step that is not v(n) → v(n+1)', () => {
    const bad: MigrationRegistry = [{ from: 1, to: 3, describe: 'skips v2', run: (i) => i }];
    expect(() => runMigrations(bad, at(1), 3)).toThrow(MigrationError);
    expect(() => runMigrations(bad, at(1), 3)).toThrow(/every step at v\(n\) → v\(n\+1\)/);
  });

  it('rejects two migrations claiming the same version', () => {
    const dup: MigrationRegistry = [
      { from: 1, to: 2, describe: 'a', run: (i) => i },
      { from: 1, to: 2, describe: 'b', run: (i) => i },
    ];
    expect(() => runMigrations(dup, at(1), 2)).toThrow(/exactly one step/);
  });
});

describe('§6 fixture pairs', () => {
  it.each(FIXTURES.map((f) => [f.from, f] as const))(
    'round-trips the v%d fixture to its expected content',
    (from, fixture) => {
      const step = SYNTHETIC.find((m) => m.from === from);
      const registry: MigrationRegistry = step ? [step] : [];
      const result = runMigrations(registry, fixture.input, from + 1);
      expect(result.manifest).toEqual(fixture.expected);
      expect(result.applied).toEqual([{ from, to: from + 1, describe: fixture.describe }]);
    },
  );
});

describe('§6 chain', () => {
  it('walks a v1 manifest up to the target one version at a time', () => {
    const result = runMigrations(SYNTHETIC, at(1), 3);
    expect(result.manifest.formatVersion).toBe(3);
    expect(result.applied.map((a) => `${a.from}→${a.to}`)).toEqual(['1→2', '2→3']);
  });

  it('fails loudly on a gap rather than skipping the missing step', () => {
    // The registry can reach v3 but not v2. A chain that quietly stopped at the
    // first gap would return a manifest claiming to be v2 — the one outcome §2's
    // "never guess-upgrade" exists to prevent.
    const gapped: MigrationRegistry = [v2ToV3];
    expect(() => runMigrations(gapped, at(1), 3)).toThrow(MigrationError);
    expect(() => runMigrations(gapped, at(1), 3)).toThrow(/no migration registered from v1 to v2/);
  });

  it('stamps the version itself, so a migration cannot desync the chain', () => {
    const liar: MigrationRegistry = [
      {
        from: 1,
        to: 2,
        describe: 'claims v99',
        run: (input) => ({ ...input, formatVersion: 99 }),
      },
    ];
    const result = runMigrations(liar, at(1), 2);
    expect(result.manifest.formatVersion).toBe(2);
  });

  it('rejects a migration that returns something other than a manifest', () => {
    const bad: MigrationRegistry = [{ from: 1, to: 2, describe: 'returns a string', run: () => 'nope' as never }];
    expect(() => runMigrations(bad, at(1), 2)).toThrow(/returned string, expected a manifest object/);
  });
});

describe('§6 "a migration failure aborts the open with the project untouched"', () => {
  it('throws, and leaves the caller holding its own object unchanged', () => {
    // The nastiest real shape: the first step mutates its argument in place, the
    // second throws. If the chain ran on the caller's object, the caller would be
    // left holding a half-upgraded manifest — exactly the "untouched" guarantee
    // this asserts.
    const vandal: Migration = {
      from: 1,
      to: 2,
      describe: 'mutates in place',
      run(input) {
        (input.tree as Record<string, unknown>[]).push({ id: 'intruder' });
        return input;
      },
    };
    const exploding: Migration = {
      from: 2,
      to: 3,
      describe: 'throws',
      run() {
        throw new Error('boom');
      },
    };
    const input = at(1);
    const before = JSON.stringify(input);

    expect(() => runMigrations([vandal, exploding], input, 3)).toThrow(MigrationError);
    expect(() => runMigrations([vandal, exploding], input, 3)).toThrow(/boom/);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('wraps the original cause so the UI can show why', () => {
    const exploding: MigrationRegistry = [
      {
        from: 1,
        to: 2,
        describe: 'throws',
        run() {
          throw new Error('disk said no');
        },
      },
    ];
    try {
      runMigrations(exploding, at(1), 2);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      const migrationError = error as MigrationError;
      expect(migrationError.from).toBe(1);
      expect(migrationError.to).toBe(2);
      expect((migrationError.cause as Error).message).toBe('disk said no');
    }
  });

  it('leaves a current manifest completely alone', () => {
    const current = at(FORMAT_VERSION);
    const result = migrateToCurrent(current);
    expect(result.applied).toEqual([]);
    expect(result.manifest).toBe(current);
  });

  it('does not migrate a manifest newer than this build — refusing is the gate’s job', () => {
    const future = at(FORMAT_VERSION + 1);
    const result = migrateToCurrent(future);
    expect(result.applied).toEqual([]);
    expect(result.manifest).toBe(future);
  });
});

describe('§6 wired into the load path', () => {
  it('records no migration for a current manifest', () => {
    const report = validateManifest(at(FORMAT_VERSION));
    expect(report.ok).toBe(true);
    expect(report.migrations).toEqual([]);
  });

  it('refuses a version below v1 rather than inventing a migration for it', () => {
    // §2's field table bounds `formatVersion` at "integer ≥ 1" and there has
    // never been a v0, so 0 is input that never named a Caotang format.
    const report = validateManifest(at(0));
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.path).toBe('formatVersion');
    expect(report.errors[0]?.message).toContain('below v1, the first Caotang format');
  });

  it('refuses a future version without attempting a migration', () => {
    const report = validateManifest(at(FORMAT_VERSION + 1));
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.message).toContain('newer than this build');
    expect(report.migrations).toEqual([]);
  });

  // Named for what it does, not for what the slice hoped it did — see the note.
  it('hands back the exact object it validated (at the current version, where that object is the input)', () => {
    const input = at(FORMAT_VERSION);
    const report = validateManifest(input);
    expect(report.manifest).toBe(input);
  });

  // This test used to be named "hands back
  // the manifest it validated, so load and validation cannot diverge". The name
  // claimed an invariant spanning *two* files; the body checked one, and checked
  // it at the one version where the two halves cannot differ. With
  // `FORMAT_VERSION === 1` and an empty registry, `report.manifest` IS the input
  // by construction, so this assertion passes whatever `read.ts` does with it.
  //
  // Proof it is unguarded, not merely weak: reverting `read.ts` to build state
  // from the raw parse — undoing the fix this commit calls "the substance of this
  // slice" — leaves all 206 tests green. The divergence is real and correct, and
  // it is currently held in place by nothing. Guarding it needs a registry the
  // test can substitute or a `FORMAT_VERSION` above 1, so it is a build slice:
  // an assertion added here would be either skipped or vacuous, which is the
  // green lie this test's own name used to be.

  it('loads a current project with no migration notice', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(MANIFEST_FILE, serializeManifest(createEmptyManifest('K')));
    const result = await readProject(fs);
    expect(result.report.migrations).toEqual([]);
    expect(result.notices.some((n) => n.path === 'formatVersion')).toBe(false);
  });

  it('refuses to open a project claiming a version below v1', async () => {
    const fs = new MemoryArtifactFs();
    fs.putFile(MANIFEST_FILE, JSON.stringify(at(0)));
    await expect(readProject(fs)).rejects.toThrow(/below v1, the first Caotang format/);
  });
});

describe('§6 "writers always save at the current version"', () => {
  it('stamps the current version of a manifest that is already current', () => {
    // Re-cut 2026-10-04. This test used to hand the serializer a
    // v0 manifest and assert that it came back stamped v1 — i.e. it asserted the
    // defect a review found, and called it "the writer has no registry, so it cannot
    // upgrade a stale object". Proving the writer *cannot fix* a stale manifest
    // is not a reason to mislabel it: §6's parenthetical, "no rolling forward on
    // unrelated edits", is the clause that forbids exactly that, and on a v2
    // build the file it produced would have claimed a shape it did not have.
    // The refusal is the correct answer, and it is asserted in
    // `migration-path.test.ts` at a version this build does not ship — here the
    // only reachable case is the agreement, so that is what is asserted.
    const current = at(FORMAT_VERSION);
    const text = serializeManifest(current as unknown as Manifest);
    expect(text).toContain(`\n  "formatVersion": ${FORMAT_VERSION},`);
  });
});
