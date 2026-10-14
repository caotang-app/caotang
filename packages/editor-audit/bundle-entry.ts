/**
 * The §10 extension set, mounted for the **bundle audit** and nothing else.
 *
 * This is the entry point `vite build` compiles so the editor preflight can grep
 * the emitted bundle for Tiptap Cloud / Pro network calls. §2's claim — "MIT
 * core, fully offline, zero cloud calls" — is a *policy-level* claim until a
 * build says otherwise, and this file is the build.
 *
 * It deliberately does NOT construct an `Editor`, does not mount a view, and
 * is not imported by the app. This package is a gate, not the editor (`@caotang/editor`): the extensions
 * are referenced so the bundler pulls them in, and the exports are read back
 * only to prove the tree is non-empty.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { CharacterCount, Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { ChangeSet } from '@tiptap/pm/changeset';
import { diffMatchPatch } from './src/dmp-lazy.js';

/**
 * §10's extension set. Two things about this list are worth stating:
 *
 * 1. **`@tiptap/starter-kit` is mounted, not its parts.** §10 names the
 *    StarterKit *subset* by component (Document, Paragraph, Text, Bold, …) and
 *    says components that do not fit the schema are disabled. StarterKit 3.x
 *    is one package that depends on 23 `@tiptap/extension-*` packages at the
 *    same exact version, so the "single version across every `@tiptap/*`"
 *    policy in §2 is enforced structurally by upstream packaging rather than
 *    by our lockfile alone.
 * 2. **The schema does not fit inside StarterKit's defaults**, so `underline`
 *    is disabled — §3.2 has no `underline` mark, and a mark the schema cannot
 *    hold is a round-trip failure waiting to happen. This is the §10
 *    "components that don't fit the schema are disabled" clause, applied.
 */
/**
 * The extension set as Tiptap's own `Extensions` type rather than a hand-rolled
 * `Extension[]`. `Image` and `Link` are node and mark extensions and do not
 * structurally satisfy the base `Extension` class's `this`-typed command
 * signatures, so the inferred union is the honest type — it is what `Editor`
 * actually accepts.
 */
export const extensionSet = [
  StarterKit.configure({
    // §3.2 defines exactly five marks; StarterKit 3.x also ships `underline`.
    underline: false,
  }),
  Link,
  Image,
  Placeholder.configure({ placeholder: 'Begin the scene…' }),
  Dropcursor,
  Gapcursor,
  // §10 names "History/UndoRedo (Lane 1)" and leaves the exact v3 export
  // name to be confirmed by the preflight: the v3 name is `UndoRedo`, and
  // this line is that confirmation.
  UndoRedo,
  CharacterCount,
];

/**
 * The changeset module §8's ghost-diff rendering depends on, plus the lazy
 * `diff-match-patch` §2 pins for the anchor ladder. Both are referenced so the
 * bundler includes them: a bundle audit that excluded them would be auditing
 * less than the editor ships.
 *
 * `@tiptap/pm/changeset` re-exports `prosemirror-changeset` wholesale — the
 * real surface is `Change`, `ChangeSet`, `Span`, `simplifyChanges`, and there
 * is no `prosemirrorChangeset` binding. §8's diff rendering needs `ChangeSet`.
 */
export const anchorLadder = {
  changeset: ChangeSet,
  diffMatchPatch,
};

/**
 * Build the extension list without a DOM. `Editor` is constructed with
 * `element: null`, which is the headless form — it exercises every extension's
 * `addExtensions`/`addGlobalAttributes` so their code is really in the bundle,
 * without a view. This is an audit artefact; `@caotang/editor` owns the real editor.
 */
export const buildHeadlessEditor = (): Editor =>
  new Editor({
    element: null,
    extensions: extensionSet,
    content: '<p>audit</p>',
  });

export const mountedExtensionNames = (): string[] => {
  const editor = buildHeadlessEditor();
  const names = editor.extensionManager.extensions.map((extension) => extension.name);
  editor.destroy();
  return names;
};

/**
 * Touching the lazy loader keeps `diff-match-patch` in the graph. Without a
 * reachable call the dynamic import is elided and the manual chunk comes out
 * empty — which is precisely the "guard that cannot fire" shape: the audit
 * would report the dependency as split-out and lazy while auditing nothing.
 */
export const loadAnchorLadderDiff = (): Promise<unknown> => diffMatchPatch();
