/**
 * codex.md §2's eight field contracts, on the manifest.
 *
 * ## Why this file exists
 *
 * Without a `codex` subsection in `validate.ts` step 3 (probe over
 * `validateManifest`), **24 of 24 probed violations produced no error and no
 * warning**, including `codex: "not-an-array"`, a blank name, an unknown
 * `includePolicy` and 33 keywords. The gap is not latent:
 * `the-trigger-has-already-fired` below drives the shipped `codex.upsert`
 * through the real pipeline.
 *
 * ## How these tests are written
 *
 * **Every limit is tested from both sides** (the rule): a limit checked only
 * from the refusing side passes whether the comparison is `>` or `>=`, so each
 * pair asserts the boundary value is *accepted* and boundary+1 is not. The
 * **lenient** halves are asserted as loudly as the strict ones, because §2
 * states a failure behaviour for most of these rows and the behaviour is
 * usually "coerce" or "keep", not "refuse" — a validator that invented a
 * stricter rule would refuse projects §2 says load.
 *
 * The two *referential* contracts (`attachments`, `sources[].docId`) are
 **deliberately not validated here** and are tested through `readProject`:
 * `referential-rules-live-in-the-loader` is the test that says why, and it is
 * the one that would fail loudly if somebody moved them.
 */

import { describe, expect, it } from 'vitest';
import {
  CODEX_INCLUDE_POLICIES,
  CODEX_ORIGINS,
  CODEX_TYPES,
  createEmptyManifest,
  parseCodexFile,
  validateManifest,
  type CodexEntry,
  type Manifest,
} from '../src/index.js';
import {
  CODEX_ALIASES_MAX,
  CODEX_DESCRIPTION_MAX,
  CODEX_EXCLUDE_MAX,
  CODEX_NAME_MAX,
  CODEX_SOURCES_MAX,
} from '@caotang/bus';

const ENTRY = 'c_0000000001';
const ENTRY_TWO = 'c_0000000002';
const DOC = 'n_0000000001';

/** A legal entry, with only the field under test overridden. */
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ENTRY,
  name: 'Elena',
  aliases: [],
  type: 'character',
  description: 'A keeper.',
  includePolicy: 'detected',
  caseSensitive: false,
  exclude: [],
  attachments: [],
  keywords: [],
  origin: 'manual',
  sources: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const withCodex = (codex: unknown): Manifest => {
  const m = createEmptyManifest('Probe') as unknown as Record<string, unknown>;
  m.codex = codex;
  return m as unknown as Manifest;
};

const report = (codex: unknown) => validateManifest(withCodex(codex), { docFiles: [`${DOC}.md`] });
const all = (codex: unknown) => {
  const r = report(codex);
  return { ok: r.ok, errors: r.errors, warnings: r.warnings, complaints: [...r.errors, ...r.warnings] };
};
/**
 * Complaints at one path.
 *
 * The fixture is **deep-cloned first**, and that is not hygiene: `validateCodex`
 * coerces in place — that is precisely how a coercion reaches the state the
 * loader builds — so validating the same array twice judges the first run's
 * *output* the second time and reports nothing. Without the clone, "validates
 * and warns" and "was validated once and warned once" are indistinguishable, and
 * every lenient-here assertion below would pass against a validator that warns
 * only when it happens to run first.
 */
const at = (codex: unknown, path: string) =>
  all(structuredClone(codex)).complaints.filter((c) => c.path === path);

describe('codex[] shape', () => {
  it('accepts a manifest with no codex at all — additive in v1', () => {
    const m = createEmptyManifest('Probe') as unknown as Record<string, unknown>;
    delete m.codex;
    expect(validateManifest(m).ok).toBe(true);
  });

  it('accepts an empty codex array', () => {
    expect(report([]).ok).toBe(true);
  });

  it('refuses codex that is present but not an array', () => {
    // The fatal half of the shape check. Without it every contract below reads
    // `entry.field` off a string and the manifest reaches the loader as
    // something no loop can iterate.
    for (const wrong of ['not-an-array', 42, {}, null]) {
      const r = report(wrong);
      expect(r.ok, `${JSON.stringify(wrong)} should be refused`).toBe(false);
      expect(r.errors.map((e) => e.path)).toContain('codex');
    }
  });

  it('refuses an entry that is not an object, and names its position', () => {
    const r = report([entry(), 42]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toContain('codex[1]');
  });

  it('numbers a later entry by its real array position, not by its place among the objects', () => {
    // The guard against a path built from a filtered list: `42` at index 0 is
    // skipped, so the broken entry after it is index **2** and a filtered
    // counter would call it `codex[1]`.
    const r = report([42, 43, entry({ name: '   ' })]);
    expect(r.errors.map((e) => e.path)).toContain('codex[2].name');
  });
});

describe('name (codex.md §2)', () => {
  it('refuses a blank name, both spellings of blank', () => {
    expect(at([entry({ name: '   ' })], 'codex[0].name')[0]?.message).toContain('after trim');
    expect(at([entry({ name: '\t\n' })], 'codex[0].name')[0]?.message).toContain('after trim');
  });

  it('refuses a missing or non-string name', () => {
    const missing = entry();
    delete missing.name;
    expect(at([missing], 'codex[0].name')[0]?.fatal).toBe(true);
    expect(at([entry({ name: 42 })], 'codex[0].name')[0]?.fatal).toBe(true);
  });

  it('keeps both entries on a case-insensitive duplicate and renames nothing', () => {
    // §2 verbatim: "keep both, surface 'duplicate codex name' warning chip;
    // writer never silently renames". The load must therefore stay `ok` — a
    // duplicate is a thing for a human to resolve, not a reason to refuse a
    // project open.
    const codex = [entry(), entry({ id: ENTRY_TWO, name: 'ELENA' })];
    const r = report(codex);
    expect(r.ok, 'a duplicate name must not refuse the load').toBe(true);
    const w = at(codex, 'codex[1].name');
    expect(w).toHaveLength(1);
    expect(w[0]?.fatal).toBe(false);
    // **Anchored, not a substring.** `toContain('duplicate codex name')` alone
    // is satisfied by any message that merely *includes* those words —
    // measured: rewriting it to "renamed duplicate codex name …" passes 44/44
    // while describing the exact opposite of what §2 requires. Anchoring at the
    // start of the message is what makes the assertion about this sentence
    // rather than about these words appearing somewhere in it.
    expect(w[0]?.message).toMatch(/^duplicate codex name/);
    expect(w[0]?.message).toContain('nothing is renamed');
    const loaded = (r.manifest as Manifest).codex as CodexEntry[];
    expect(loaded.map((e) => e.name)).toEqual(['Elena', 'ELENA']);
  });

  it('names the position of the first entry when it is the duplicate', () => {
    // Position, not string: with the owner map holding only the *first* name
    // seen, an entry repeated verbatim would compare equal to itself and report
    // nothing. This is the assertion that catches that.
    const codex = [entry(), entry({ id: ENTRY_TWO, name: 'elena' })];
    expect(at(codex, 'codex[0].name')).toHaveLength(0);
    expect(at(codex, 'codex[1].name')).toHaveLength(1);
  });

  it('accepts a name at the limit and warns one character over it', () => {
    const atLimit = 'x'.repeat(CODEX_NAME_MAX);
    expect(report([entry({ name: atLimit })]).ok).toBe(true);
    const over = 'x'.repeat(CODEX_NAME_MAX + 1);
    const w = at([entry({ name: over })], 'codex[0].name');
    expect(report([entry({ name: over })]).ok, 'over the limit is kept, not refused').toBe(true);
    expect(w[0]?.message).toContain(`over the ${CODEX_NAME_MAX} limit`);
    // The value is not truncated — measured on the manifest the loader got.
    const r = report([entry({ name: over })]);
    expect(((r.manifest as Manifest).codex as CodexEntry[])[0]!.name).toBe(over);
  });
});

describe('aliases (codex.md §2)', () => {
  it('dedupes case-insensitively against the name and each other', () => {
    // The fixture is rebuilt per assertion because `report` coerces in place —
    // asking a second question of the first call's output would answer it about
    // the deduped array rather than about the manifest as written.
    const build = () => [entry({ aliases: ['Elena', 'elena', 'Lena', 'LENA', 'Kestrel'] })];
    const r = report(build());
    expect((r.manifest as Manifest).codex![0]!.aliases).toEqual(['Lena', 'Kestrel']);

    expect(at(build(), 'codex[0].aliases[0]')[0]?.message).toContain("duplicates this entry's own name");
    expect(at(build(), 'codex[0].aliases[1]')[0]?.message).toContain("duplicates this entry's own name");
    // 'LENA' is a repeat of 'Lena' — a *different* reason from the name one.
    expect(at(build(), 'codex[0].aliases[3]')[0]?.message).toContain('duplicate alias');
    // 'Kestrel' survives: an alias that is not a duplicate is not a complaint.
    expect(at(build(), 'codex[0].aliases[4]')).toEqual([]);
  });

  it('keeps an alias that is another entry’s name, and says which entry wins detection', () => {
    // §2: "alias equal to another entry's name → load warning, detection resolves
    // to the entry owning it as `name`". Kept — a validator that dropped it
    // would make the resolution §2 promises impossible.
    const codex = [entry({ aliases: ['Sten'] }), entry({ id: ENTRY_TWO, name: 'Sten' })];
    const r = report(codex);
    expect((r.manifest as Manifest).codex![0]!.aliases).toEqual(['Sten']);
    const w = at(codex, 'codex[0].aliases[0]');
    expect(w[0]?.message).toContain('codex[1]');
  });

  it('accepts 10 aliases and warns at 11', () => {
    const build = (n: number) => Array.from({ length: n }, (_, i) => `alias-${i}`);
    expect(report([entry({ aliases: build(CODEX_ALIASES_MAX) })]).ok).toBe(true);
    const over = build(CODEX_ALIASES_MAX + 1);
    const w = at([entry({ aliases: over })], 'codex[0].aliases');
    expect(report([entry({ aliases: over })]).ok).toBe(true);
    expect(w[0]?.message).toContain(`over the ${CODEX_ALIASES_MAX} limit`);
  });

  it('accepts a 64-char alias and warns at 65', () => {
    const long = (n: number) => 'a'.repeat(n);
    expect(report([entry({ aliases: [long(64)] })]).ok).toBe(true);
    const w = at([entry({ aliases: [long(65)] })], 'codex[0].aliases[0]');
    expect(w[0]?.message).toContain('must be 1–64');
    // Over-long aliases are KEPT — the count dedupe is the only thing §2 says
    // to drop, and dropping an alias deletes a name the author typed.
    const r = report([entry({ aliases: [long(65)] })]);
    expect((r.manifest as Manifest).codex![0]!.aliases).toHaveLength(1);
  });

  it('refuses an alias list that is not an array of strings', () => {
    expect(at([entry({ aliases: 'Lena' })], 'codex[0].aliases')[0]?.fatal).toBe(true);
    expect(at([entry({ aliases: [42] })], 'codex[0].aliases[0]')[0]?.fatal).toBe(true);
  });
});

describe('description (codex.md §2)', () => {
  it('accepts a description at the limit and warns one character over, without truncating', () => {
    const atLimit = 'd'.repeat(CODEX_DESCRIPTION_MAX);
    expect(report([entry({ description: atLimit })]).ok).toBe(true);
    const over = 'd'.repeat(CODEX_DESCRIPTION_MAX + 1);
    const r = report([entry({ description: over })]);
    expect(r.ok, 'an over-long description is reported, not fatal').toBe(true);
    expect(at([entry({ description: over })], 'codex[0].description')[0]?.message).toContain('kept whole, not truncated');
    expect(((r.manifest as Manifest).codex as CodexEntry[])[0]!.description).toBe(over);
  });

  it('refuses a non-string description', () => {
    expect(at([entry({ description: 42 })], 'codex[0].description')[0]?.fatal).toBe(true);
  });
});

describe('includePolicy and origin (codex.md §2, closed enums)', () => {
  it('coerces every unknown policy to "detected", and says which value it saw', () => {
    const r = report([entry({ includePolicy: 'sometimes' })]);
    expect(r.ok).toBe(true);
    expect((r.manifest as Manifest).codex![0]!.includePolicy).toBe('detected');
    // The message names the value that arrived, NOT the value written — the
    // mutant that assigns before reading prints "unknown policy detected".
    const w = at([entry({ includePolicy: 'sometimes' })], 'codex[0].includePolicy');
    expect(w[0]?.message).toContain('"sometimes"');
    expect(w[0]?.message).not.toContain('unknown policy "detected"');
  });

  it('coerces a non-string policy the same way', () => {
    const r = report([entry({ includePolicy: 7 })]);
    expect((r.manifest as Manifest).codex![0]!.includePolicy).toBe('detected');
  });

  it('accepts every member of the closed policy enum without a word', () => {
    for (const policy of CODEX_INCLUDE_POLICIES) {
      const r = report([entry({ includePolicy: policy })]);
      expect(r.ok).toBe(true);
      expect(r.warnings.filter((w) => w.path === 'codex[0].includePolicy')).toEqual([]);
      expect((r.manifest as Manifest).codex![0]!.includePolicy).toBe(policy);
    }
  });

  it('coerces an unknown origin to "agent", not to "manual"', () => {
    // §2 verbatim, and the direction matters: codex.md ranks hand-authored above
    // agent-inferred, so an unrecognised provenance must not acquire 'manual'.
    const r = report([entry({ origin: 'robot' })]);
    expect((r.manifest as Manifest).codex![0]!.origin).toBe('agent');
    expect(at([entry({ origin: 'robot' })], 'codex[0].origin')[0]?.message).toContain('"robot"');
  });

  it('defaults an ABSENT origin to "manual" — a stated default, not a coercion, and silent', () => {
    // project-format §2: "missing `origin` = 'manual'". Silence is the
    // assertion: absence is normal (every §5.4-rebuilt entry lacks it) and a
    // warning on every rebuild would be noise the user learns to ignore.
    const without = entry();
    delete without.origin;
    const r = report([without]);
    expect(r.ok).toBe(true);
    expect((r.manifest as Manifest).codex![0]!.origin).toBe('manual');
    expect(r.warnings.filter((w) => w.path === 'codex[0].origin')).toEqual([]);
  });

  it('accepts every member of the closed origin enum without a coercion', () => {
    for (const origin of CODEX_ORIGINS) {
      const r = report([entry({ origin })]);
      expect((r.manifest as Manifest).codex![0]!.origin).toBe(origin);
      expect(r.warnings.filter((w) => w.path === 'codex[0].origin')).toEqual([]);
    }
  });
});

describe('type (codex.md §2 — a closed enum that is NOT closed on load)', () => {
  it('keeps an unknown type, because a custom type is v0.2 and never dropped', () => {
    const r = report([entry({ type: 'deity' })]);
    expect(r.ok).toBe(true);
    expect((r.manifest as Manifest).codex![0]!.type).toBe('deity');
    expect(at([entry({ type: 'deity' })], 'codex[0].type')[0]?.message).toContain('kept');
  });

  it('writes "other" for a missing type and warns, naming the enum', () => {
    const without = entry();
    delete without.type;
    const r = report([without]);
    expect((r.manifest as Manifest).codex![0]!.type).toBe('other');
    const w = r.warnings.find((x) => x.path === 'codex[0].type');
    for (const member of CODEX_TYPES) expect(w?.message).toContain(member);
  });

  it('accepts every member of the v0.1 enum with no complaint', () => {
    for (const type of CODEX_TYPES) {
      expect(report([entry({ type })]).warnings.filter((w) => w.path === 'codex[0].type')).toEqual([]);
    }
  });
});

describe('keywords and exclude (codex.md §2 limits)', () => {
  it('uses the NODE keyword limits, as §2 states', () => {
    const over = Array.from({ length: 33 }, (_, i) => `k${i}`);
    const w = at([entry({ keywords: over })], 'codex[0].keywords');
    expect(report([entry({ keywords: Array.from({ length: 32 }, (_, i) => `k${i}`) })]).ok).toBe(true);
    expect(w[0]?.message).toContain('over the 32 limit');
    expect(w[0]?.message).not.toContain('over the 64 limit');
  });

  it('keeps over-limit keywords rather than dropping tags', () => {
    const over = Array.from({ length: 33 }, (_, i) => `k${i}`);
    const r = report([entry({ keywords: over })]);
    expect((r.manifest as Manifest).codex![0]!.keywords).toHaveLength(33);
  });

  it('accepts a 64-char keyword and warns at 65', () => {
    expect(report([entry({ keywords: ['k'.repeat(64)] })]).ok).toBe(true);
    expect(at([entry({ keywords: ['k'.repeat(65)] })], 'codex[0].keywords[0]')[0]?.message).toContain('over the 64 limit');
  });

  it('accepts 20 exclude phrases and warns at 21', () => {
    const build = (n: number) => Array.from({ length: n }, (_, i) => `phrase ${i}`);
    expect(report([entry({ exclude: build(CODEX_EXCLUDE_MAX) })]).ok).toBe(true);
    const w = at([entry({ exclude: build(CODEX_EXCLUDE_MAX + 1) })], 'codex[0].exclude');
    expect(report([entry({ exclude: build(CODEX_EXCLUDE_MAX + 1) })]).ok).toBe(true);
    expect(w[0]?.message).toContain(`over the ${CODEX_EXCLUDE_MAX} limit`);
  });
});

describe('sources (codex.md §2)', () => {
  it('accepts 5 sources and warns at 6, keeping them all', () => {
    const build = (n: number) => Array.from({ length: n }, () => ({ docId: DOC, quote: 'q' }));
    expect(report([entry({ sources: build(CODEX_SOURCES_MAX) })]).ok).toBe(true);
    const r = report([entry({ sources: build(CODEX_SOURCES_MAX + 1) })]);
    expect(r.ok).toBe(true);
    expect(r.warnings.find((w) => w.path === 'codex[0].sources')?.message).toContain(
      `over the ${CODEX_SOURCES_MAX} limit`,
    );
    expect((r.manifest as Manifest).codex![0]!.sources).toHaveLength(CODEX_SOURCES_MAX + 1);
  });

  it('refuses a malformed source object', () => {
    expect(at([entry({ sources: [42] })], 'codex[0].sources[0]')[0]?.fatal).toBe(true);
    expect(at([entry({ sources: [{ quote: 'q' }] })], 'codex[0].sources[0].docId')[0]?.fatal).toBe(true);
    expect(at([entry({ sources: [{ docId: DOC }] })], 'codex[0].sources[0].quote')[0]?.fatal).toBe(true);
  });
});

describe('ids and timestamps', () => {
  it('refuses a codex id that is not "c_" + 10 Crockford, because the id is a filename', () => {
    expect(at([entry({ id: 'c_x' })], 'codex[0].id')[0]?.message).toContain('Crockford');
    expect(at([entry({ id: 'n_0000000001' })], 'codex[0].id')[0]?.fatal).toBe(true);
  });

  it('refuses a duplicate entry id — two entries on one id is one redundancy file', () => {
    const r = report([entry(), entry({ name: 'Sten' })]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toContain('codex[1].id');
  });

  it('warns on a malformed timestamp and says the field is ignored, never refusing', () => {
    const r = report([entry({ createdAt: 'not-a-date' })]);
    expect(r.ok).toBe(true);
    expect(r.warnings.find((w) => w.path === 'codex[0].createdAt')?.message).toContain('ignoring field');
  });

  it('accepts an entry carrying no timestamps at all — the §5.4 rebuild case', () => {
    const without = entry();
    delete without.createdAt;
    delete without.updatedAt;
    const r = report([without]);
    expect(r.ok).toBe(true);
    expect(r.warnings.filter((w) => w.path.startsWith('codex'))).toEqual([]);
  });
});

describe('the manifest path is reached, and named', () => {
  it('names the field path of a violation in a caotang.json that would have loaded before', () => {
    const report0 = report([entry({ includePolicy: 'sometimes' })]);
    const w = report0.warnings.find((x) => x.path === 'codex[0].includePolicy');
    // §2.3: "First violation reported with node id and field path".
    expect(w?.path).toBe('codex[0].includePolicy');
    expect(report0.ok).toBe(true);
  });

  it('is reached for an entry beyond the first, with its own index', () => {
    const codex = [entry(), entry({ id: ENTRY_TWO, name: 'Sten', keywords: ['k'.repeat(65)] })];
    expect(at(codex, 'codex[1].keywords[0]')).toHaveLength(1);
    expect(at(codex, 'codex[0].keywords[0]')).toHaveLength(0);
  });
});

describe('referential rules live in the loader, not in step 3', () => {
  // **This is the test that says where the two referential contracts belong.**
  // §2 step 4 imports orphan `docs/*.md` as "Recovered" documents *after*
  // validation returns, so an attachment naming a document that exists only as a
  // file is dangling to `validateManifest` and resolved a step later. A
  // validator that dropped it would delete the link §2 step 4 exists to
  // preserve — and the load would still report `ok`, because nothing refuses a
  // load for a link it dropped silently.
  it('keeps an attachment to a document that step 4 has not adopted yet', async () => {
    const { MemoryArtifactFs, addDocument, createProjectState, readProject, writeProject } = await import(
      '../src/index.js'
    );
    const T0 = new Date('2026-09-29T02:00:00.000Z');
    const state = createProjectState(createEmptyManifest('Keeper', T0));
    // The document has to **exist as a file** for §2 step 4 to have anything to
    // import; removing only its tree entry would leave an attachment pointing at
    // nothing and the test would pass for the wrong reason.
    addDocument(state, { parentId: 'manuscript', title: 'Adrift', body: 'x', now: T0, id: 'n_0RPHAN0001' });
    state.manifest.codex = [{ ...(entry() as unknown as CodexEntry), attachments: ['n_0RPHAN0001'] }];
    const fs = new MemoryArtifactFs();
    await writeProject(fs, state, { now: T0 });

    // Now make it an orphan: the file stays, the tree entry goes.
    const manifest = JSON.parse(await fs.read('caotang.json')) as Record<string, unknown>;
    const tree = manifest['tree'] as Array<Record<string, unknown>>;
    manifest['tree'] = tree.filter((n) => n['id'] !== 'n_0RPHAN0001');

    const { state: loaded } = await readProject(fs, {
      manifestText: JSON.stringify(manifest, null, 2),
      now: T0,
    });
    // The orphan was imported, so the attachment now resolves and survives.
    expect(loaded.documents.has('n_0RPHAN0001')).toBe(true);
    expect(loaded.manifest.codex![0]!.attachments).toEqual(['n_0RPHAN0001']);
  });

  it('drops a genuinely dangling attachment, with a notice, and never blocks the load', async () => {
    const { MemoryArtifactFs, createProjectState, readProject, writeProject } = await import('../src/index.js');
    const T0 = new Date('2026-09-29T02:00:00.000Z');
    const state = createProjectState(createEmptyManifest('Keeper', T0));
    state.manifest.codex = [
      { ...(entry() as unknown as CodexEntry), attachments: ['n_NOSUCHNODE'], sources: [{ docId: 'n_ALSONO', quote: 'q' }] },
    ];
    const fs = new MemoryArtifactFs();
    await writeProject(fs, state, { now: T0 });
    const { state: loaded, notices } = await readProject(fs, { now: T0 });
    expect(loaded.manifest.codex![0]!.attachments).toEqual([]);
    expect(loaded.manifest.codex![0]!.sources).toEqual([]);
    expect(notices.some((n) => n.path === 'codex.c_0000000001.attachments')).toBe(true);
    expect(notices.some((n) => n.path === 'codex.c_0000000001.sources')).toBe(true);
  });

  it('leaves a resolving attachment and a resolving source entirely alone', async () => {
    const { MemoryArtifactFs, addDocument, createProjectState, readProject, writeProject } = await import(
      '../src/index.js'
    );
    const T0 = new Date('2026-09-29T02:00:00.000Z');
    const state = createProjectState(createEmptyManifest('Keeper', T0));
    addDocument(state, { parentId: 'manuscript', title: 'Landing', body: 'x', now: T0, id: DOC });
    state.manifest.codex = [
      { ...(entry() as unknown as CodexEntry), attachments: [DOC], sources: [{ docId: DOC, quote: 'q' }] },
    ];
    const fs = new MemoryArtifactFs();
    await writeProject(fs, state, { now: T0 });
    const { state: loaded, notices } = await readProject(fs, { now: T0 });
    expect(loaded.manifest.codex![0]!.attachments).toEqual([DOC]);
    expect(loaded.manifest.codex![0]!.sources).toEqual([{ docId: DOC, quote: 'q' }]);
    expect(notices.filter((n) => n.path.includes('codex'))).toEqual([]);
  });
});

describe('the trigger has already fired', () => {
  it('the row said nothing could write a codex[] entry; codex.upsert does, and validates nothing', async () => {
    const { createProjectState } = await import('../src/state.js');
    const { createProjectCommandRegistry } = await import('../src/commands.js');
    const { execute } = await import('@caotang/bus');
    const { createUndoStore, createViewState, createActivityLog, createIdempotencyCache } = await import(
      '@caotang/bus'
    );

    const TICK = 1_760_000_000_000;
    const state = createProjectState(createEmptyManifest('Probe'), { now: new Date(TICK) });
    const registry = createProjectCommandRegistry({ clock: { now: () => TICK } });
    // The undo store needs the bus it dispatches into and the bus needs the undo
    // store — the closure only *reads* `bus`, and only at undo time, long after
    // this initialises. The same shape an app has, and the same one
    // `commands.test.ts`'s harness uses.
    const undo = createUndoStore({ dispatch: (c) => execute(c, bus, registry) });
    const bus = {
      state,
      view: createViewState(),
      read: () => state,
      permission: { approvedPlan: false, confirmed: true },
      undo,
      log: createActivityLog(),
      idempotency: createIdempotencyCache(),
      notify: () => {},
    } as unknown as Parameters<typeof execute>[1];

    // An op the command still accepts and §2 forbids: aliases duplicated
    // case-insensitively against the name. The command does not dedupe aliases —
    // the loader does — so this is the case that still needs the load-time step.
    const result = execute(
      {
        id: 'cmd_1',
        createdAt: TICK,
        name: 'codex.upsert',
        issuedBy: 'user',
        params: {
          entries: [
            {
              action: 'create',
              name: 'Elena',
              aliases: ['Elena', 'elena', 'Lena'],
              type: 'character',
              description: 'A keeper.',
            },
          ],
        },
      },
      bus,
      registry,
    );
    expect(result.ok).toBe(true);
    expect(state.manifest.codex).toHaveLength(1);

    // The loader sees it, and this slice's step is what makes the aliases dedupe.
    const r = validateManifest(state.manifest, { docFiles: [] });
    expect(r.ok).toBe(true);
    expect((r.manifest as Manifest).codex![0]!.aliases).toEqual(['Lena']);

    // 21 exclude phrases (≤ 20, codex.md §2) used to take this same path: the
    // command wrote them and the loader warned on the next load. The command now
    // refuses the batch, so nothing is written and the loader never has to say so
    // (bus validate, "holds the exclude limits on both edges"). The loader's own
    // warning stays for a manifest a hand edit or a sync conflict wrote.
    const tooMany = execute(
      {
        id: 'cmd_2',
        createdAt: TICK,
        name: 'codex.upsert',
        issuedBy: 'user',
        params: {
          entries: [
            {
              action: 'create',
              name: 'Mara',
              exclude: Array.from({ length: 21 }, (_, i) => `phrase ${i}`),
              type: 'character',
            },
          ],
        },
      },
      bus,
      registry,
    );
    expect(tooMany.ok).toBe(false);
    expect(state.manifest.codex).toHaveLength(1);

    const handWritten = structuredClone(state.manifest);
    handWritten.codex![0]!.exclude = Array.from({ length: 21 }, (_, i) => `phrase ${i}`);
    const warned = validateManifest(handWritten, { docFiles: [] });
    expect(warned.warnings.find((w) => w.path === 'codex[0].exclude')?.message).toContain('over the 20 limit');
  });
});

describe('one implementation of each coercion', () => {
  it('the manifest path and the redundancy-file path agree on the same unknown value', () => {
    // If either surface grows a second copy of §2's coercion, this stops being
    // true and nothing else in the file notices — the guard for the refactor
    // rather than for the rule.
    const file = parseCodexFile(
      ['---', 'id: c_0000000001', 'name: Elena', 'includePolicy: sometimes', '---', '', 'A keeper.', ''].join('\n'),
    );
    const r = report([entry({ includePolicy: 'sometimes' })]);
    expect(file.frontMatter.includePolicy).toBe('detected');
    expect((r.manifest as Manifest).codex![0]!.includePolicy).toBe(file.frontMatter.includePolicy);
  });

  it('the file path keeps an unknown type and defaults an empty one, like the manifest path', () => {
    const unknown = parseCodexFile(
      ['---', 'id: c_0000000001', 'name: Elena', 'type: deity', '---', '', 'x', ''].join('\n'),
    );
    expect(unknown.frontMatter.type).toBe('deity');
    const empty = parseCodexFile(
      ['---', 'id: c_0000000001', 'name: Elena', 'type:', '---', '', 'x', ''].join('\n'),
    );
    expect(empty.frontMatter.type).toBe('other');
    expect((report([entry({ type: 'deity' })]).manifest as Manifest).codex![0]!.type).toBe('deity');
  });
});