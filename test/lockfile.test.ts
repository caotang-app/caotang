/**
 * The project-document selector, and the throw that is the entire point of it.
 *
 * ## Why this file exists
 *
 * pnpm 12 writes `pnpm-lock.yaml` as more than one YAML document, and a lockfile
 * guard — this repo's `test/toolchain-floor.test.ts` and
 * `packages/editor-audit/test/pins.test.ts` — that reads the *first* one reads
 * pnpm's own self-management record, a 15-package tree.
 *
 * `test/lockfile.ts` is a selector that asks a **semantic** question — which
 * document declares root `devDependencies:` — and **throws unless exactly one
 * document answers it**. The throw is the point: a selector that cannot fail would
 * reproduce the very fault it exists to avoid.
 *
 * ## Why the throw needs its own tests
 *
 * **Nothing else holds the throw.** Both consumers call the selector once, at
 * module scope, on the real lockfile — which qualifies exactly once — so the
 * throw is unreachable from the rest of the suite: weakening
 * `project.length !== 1` to `project.length > 99` leaves every other test
 * green. The same mutation run on the *return* value instead (`project[0]` →
 * `withPackages[0]`) fails many tests, so the guards are not blind — they are
 * blind to the one property the selector was written to guarantee, and only to
 * that one.
 *
 * "It throws if the format changes" is a claim
 * about a *future* file, so it reads like a comment; a control that would catch
 * its removal has to be built out of synthetic input, because no real lockfile
 * in this repo can reach the branch.
 *
 * ## The control discipline this file follows
 *
 * Every negative case below is a document shape constructed **in the test**, not
 * a property of today's lockfile, and the positive case is checked against the
 * real bytes — so the suite cannot pass by agreeing with itself about a fixture
 * that only exists in the test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectLockfile } from './lockfile';

const repoRoot = resolve(__dirname, '..');
const raw = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');

/**
 * The documents of the real lockfile, split the way the selector splits them.
 *
 * Used only to *build* the cases below from real bytes. The count is asserted
 * rather than assumed, because a pnpm that stopped writing a second document
 * would otherwise turn these cases into a test of a string literal.
 */
function realDocs(): string[] {
  return raw.split(/^---\s*$/m);
}

/** A document carrying a `packages:` block, as the selector's first filter requires. */
const hasPackages = (doc: string): boolean => /^packages:\s*$/m.test(doc);

describe('the project lockfile selector', () => {
  it('resolves the project document, and that document is not the first one', () => {
    // The control, and it is load-bearing: every assertion below is about a
    // *negative*, so without a positive that proves the selector returns
    // something real, a selector that always threw would pass all of them.
    const docs = realDocs();
    expect(docs.length, 'the lockfile is expected to be a multi-document file').toBeGreaterThan(1);

    const selected = projectLockfile(raw);
    expect(selected, 'the selected document must carry a packages: block').toMatch(/^packages:\s*$/m);
    expect(selected, 'the selected document must declare root devDependencies:').toMatch(/^\s+devDependencies:\s*$/m);

    // The one assertion that makes the semantic discriminator mean something.
    // The first document carrying `packages:` is pnpm's self-management record
    // (its 15 resolutions — 14 `@pnpm/exe.*` binaries plus `pnpm` itself); if
    // these were equal, the selector would be a positional parser wearing a
    // semantic comment.
    const firstWithPackages = docs.find(hasPackages);
    expect(firstWithPackages, 'the file must still lead with a non-project document').toBeDefined();
    expect(selected).not.toBe(firstWithPackages);
    // And the difference is a real one, not a blank line between them.
    expect(projectLockfile(raw).length).toBeGreaterThan(1000);
  });

  it('throws when two documents qualify, rather than taking the first of them', () => {
    // The shape a future pnpm could produce, and the one the header names: a
    // parser that "picks whichever document it finds first" is exactly what
    // reads a 15-package tree as the whole tree.
    const project = projectLockfile(raw);
    const ambiguous = `${project}\n---\n${project}`;

    expect(() => projectLockfile(ambiguous)).toThrow(/exactly one project document, found 2/);
  });

  it('throws when no document qualifies, rather than returning whatever parsed', () => {
    // The other direction. A lockfile that kept its shape but lost the
    // discriminator — a project with no root `devDependencies:` at all, or a
    // format change that moved the key — must be refused, not answered.
    const notAProject = `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies: {}\n\npackages:\n\n  lodash@4.17.21: {}\n`;

    expect(() => projectLockfile(notAProject)).toThrow(/exactly one project document, found 0/);
  });

  it('refuses pnpm\'s own self-management record when it is the only document present', () => {
    // Built from the real file rather than written out, so this case states the
    // fact the discriminator exists for: the leading document carries a
    // `packages:` block and is still not the project lockfile.
    const selfManagement = realDocs().filter(hasPackages).find((d) => !/^\s+devDependencies:\s*$/m.test(d));
    expect(selfManagement, 'the self-management record must still be in the file').toBeDefined();

    expect(() => projectLockfile(selfManagement!)).toThrow(/exactly one project document, found 0/);
  });

  it('reports how many documents it saw, so the message says which way the format moved', () => {
    // The error is a human's decision aid — the header says a format change
    // "must be decided in test/lockfile.ts". A message that only said "invalid
    // lockfile" would leave the reader re-deriving the shape by hand, which is
    // the work the selector exists to save.
    const project = projectLockfile(raw);
    expect(() => projectLockfile(`${project}\n---\n${project}`)).toThrow(
      /found 2 of 2 document\(s\) carrying a `packages:` block/,
    );
    expect(() => projectLockfile(`packages:\n\n  lodash@4.17.21: {}\n`)).toThrow(
      /found 0 of 1 document\(s\) carrying a `packages:` block/,
    );
  });
});
