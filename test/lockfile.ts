/**
 * The project lockfile, out of a file that is no longer one document.
 *
 * ## Why this exists
 *
 * **pnpm 12 writes `pnpm-lock.yaml` as a two-document YAML file.** As measured on
 * 12.8.1:
 *
 * - **Document 1** (lines 2–157, after the `---` on line 1) — pnpm's
 *   *self-management* record. It exists because pnpm 12 manages its own version
 *   as a dependency (`importers['.'].packageManagerDependencies.pnpm`), so the
 *   file leads with that record's **15** resolutions: **14 `@pnpm/exe.*` platform
 *   binaries plus `pnpm@12.9.1` itself**, and their `snapshots:`. The 15th is
 *   not a binary — a guard that files an advisory against the meta-package finds
 * no `pnpm` row here.
 * - **Document 2** (line 158, after a second `---`) — **the actual project
 *   lockfile**: `settings:`, the workspace `importers:` with the root's
 *   `devDependencies`, and the real **332-entry** `packages:` block.
 *
 * Both documents are `lockfileVersion: '9.0'` and both contain a `packages:`
 * and a `snapshots:` block, so **nothing about the shape distinguishes them.**
 * A parser that takes the first `packages:` it finds reads the wrong document
 * and reports a 15-package tree.
 *
 * ## Why the guards catch it
 *
 * **`test/toolchain-floor.test.ts`'s own control names the cause**: `parses the
 * resolutions — a parse that matches nothing fails, not passes` reports
 * `expected 15 to be greater than or equal to 300` against a first-document
 * read. That control exists because a parser matching nothing and a parser
 * matching everything produce the same green, so a wrong read is a red test
 * rather than a silently-healthy tree.
 *
 * ## The discriminator is semantic, not positional
 *
 * "The second document" is an ordering claim that a future pnpm could break.
 * What actually identifies the project lockfile is that **its `importers:`
 * block declares `devDependencies:`** for the workspace root, which pnpm's
 * self-management record never does (it carries `configDependencies` and
 * `packageManagerDependencies` instead). So the selector asks that question,
 * and **throws if the answer is not exactly one document** — a format change
 * must be decided by a human here rather than absorbed by a parser that
 * quietly returns whatever it found first.
 *
 * Both guards import this rather than each carrying a copy: two hand-rolled
 * lockfile parsers is the same trap as two hand-copied pin tables, and only one
 * of them would be fixed next time the format moves.
 */

/**
 * The project document of `pnpm-lock.yaml`, or a throw.
 *
 * Split on the YAML document separator, keep the documents that carry a
 * `packages:` block, then keep the one that declares root `devDependencies:`.
 *
 * **The split yields three chunks from a two-document file, and that is not a
 * bug**: the file opens with `---` on line 1,
 * so the text *before* the first separator is the empty string. The `packages:`
 * filter is what discards it, and the count the throw reports is of documents
 * *carrying a block*, so a reader counting chunks and expecting two is looking
 * at the right number for the wrong reason — the guard over this file's own
 * count is in `test/lockfile.test.ts`.
 */
export function projectLockfile(raw: string): string {
  const withPackages = raw.split(/^---\s*$/m).filter((doc) => /^packages:\s*$/m.test(doc));
  const project = withPackages.filter((doc) => /^\s+devDependencies:\s*$/m.test(doc));

  if (project.length !== 1) {
    throw new Error(
      `pnpm-lock.yaml: expected exactly one project document, found ${project.length} ` +
        `of ${withPackages.length} document(s) carrying a \`packages:\` block. ` +
        `A lockfile format change must be decided in test/lockfile.ts — a parser ` +
        `that picks whichever document it finds first is how a 15-package tree ` +
        `reads as the whole tree.`,
    );
  }
  return project[0]!;
}
