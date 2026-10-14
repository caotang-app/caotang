/**
 * The Tiptap preflight's bundle audit — §2's zero-cloud claim, measured.
 *
 * §2 says: "MIT core, fully offline, zero cloud calls confirmed at the policy
 * level (paid surface = Cloud/AI-Toolkit/Tracked-Changes — none in our
 * stack)". That is a claim about a *policy*, and a policy is not evidence. The
 * gate's job is to turn it into a measurement: build the §10 extension set for
 * real, then look at the bytes.
 *
 * The build runs in `beforeAll` and its output is read from disk, so the
 * assertions are about the emitted artifact rather than about the source that
 * produced it. A grep of the source would pass while the bundle pulled in a
 * cloud SDK transitively — which is the whole class of bug this catches.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(__dirname, '..');
const distDir = join(packageRoot, 'dist');

/**
 * The needles. Each is a Tiptap Cloud / Pro surface named in §2, plus the
 * generic network primitives a cloud call would have to go through. A cloud SDK
 * can rename its package; it cannot avoid `fetch`/`XMLHttpRequest`/`WebSocket`.
 *
 * **Substring needles are a trap here, and the first cut of this audit fell
 * into it.** Measured false positives, all from the shipped stack:
 *   - `collaboration` — matches a doc comment in prosemirror-history
 *     ("During collaboration, these naturally accumulate") and UndoRedo's own
 *     `editor.storage.collaboration` disable flag. No collaboration *code*.
 *   - `yjs` — matches inside `linkifyjs`, which `@tiptap/extension-link` pulls
 *     in as a direct dependency.
 * Both are matched as whole words with a boundary that excludes a longer
 * identifier, so `linkifyjs` no longer reads as `yjs`. A needle list that
 * cries wolf gets deleted by the next change, and a deleted needle list is
 * how a real cloud SDK gets shipped.
 */
const CLOUD_NEEDLES = [
  // Tiptap Cloud / Pro by name, as whole identifiers.
  { needle: '@tiptap-cloud', why: 'Tiptap Cloud SDK' },
  { needle: '@hocuspocus', why: 'Tiptap Cloud collaboration server client' },
  { needle: 'tiptap.cloud', why: 'Tiptap Cloud host' },
  { needle: 'api.tiptap.cloud', why: 'Tiptap Cloud API host' },
  { needle: 'cloud.tiptap.dev', why: 'Tiptap Cloud dev host' },
  { needle: '@tiptap-pro', why: 'Tiptap Pro paid namespace' },
  // Collaboration runtime. `collaboration` alone is NOT a needle — see above.
  { needle: 'y-prosemirror', why: 'Yjs ProseMirror binding' },
  { needle: 'y-websocket', why: 'Yjs websocket provider' },
  { needle: 'y-indexeddb', why: 'Yjs persistence provider' },
  { needle: 'HocuspocusProvider', why: 'Tiptap Cloud provider class' },
  { needle: 'CollaborationExtension', why: 'Tiptap paid collaboration extension' },
  // Tiptap's paid extensions, which §2 says are absent from this stack.
  { needle: '@tiptap/extension-collaboration', why: 'paid collaboration extension' },
  { needle: '@tiptap/extension-ai', why: 'paid AI Toolkit extension' },
  { needle: '@tiptap/suggestion', why: 'paid suggestion layer' },
  { needle: 'TrackedChanges', why: 'paid Tracked Changes surface' },
  { needle: 'tracked-changes', why: 'paid Tracked Changes module' },
];

/** Network primitives a cloud call must go through. */
const NETWORK_NEEDLES = [
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'navigator.sendBeacon',
];

/** `yjs` / `Yjs` as standalone identifiers, not as a tail of `linkifyjs`. */
const YJS_NEEDLES = [/\by-?js\b/i, /\bYjs\b/];

/**
 * A needle that names an **npm package** has to be matched where a package would
 * actually be referenced, not as bare text.
 *
 * Under Vite 8 a bare-text match fires on
 * `@tiptap/extension-collaboration` — a **paid** extension, and precisely what
 * the bundle audit exists to catch. It is not in the bundle. The string sits inside
 * Tiptap's own JSDoc on `undo-redo`:
 *
 * > **Important**: If the `@tiptap/extension-collaboration` package is used, make
 * > sure to remove the `undo-redo` extension, as it is not compatible …
 *
 * Vite 6 bundled with esbuild, which dropped that comment; **Vite 8 bundles with
 * rolldown/oxc, which keeps it.** So the bundle did not gain a paid surface — it
 * gained a sentence *about* one.
 *
 * The rule for this situation is the warning above the needle list: *"a needle
 * list that cries wolf gets deleted by the next change, and a deleted needle
 * list is how a real cloud SDK gets shipped."* So the needle is **made precise,
 * not deleted**: a package needle now matches only in a module-specifier
 * position (`from '…'`, `import('…')`, `require('…')`), the only place a
 * bundled package can appear. A real inclusion still trips it, and
 * `the needle matcher still has teeth` proves both halves — it fires on an
 * import statement and stays quiet on the JSDoc prose that caused the false
 * positive.
 *
 * Needles that are not package names — hostnames (`tiptap.cloud`), class names
 * (`HocuspocusProvider`), network primitives — keep the substring match, because
 * those are exactly the surfaces that show up as loose text.
 */
function isPackageNeedle(needle: string): boolean {
  return needle.includes('/') && !needle.includes('.');
}

/** A package needle matched as a module specifier; anything else as plain text. */
function needleHits(bundle: string, needle: string): boolean {
  if (!isPackageNeedle(needle)) return bundle.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w$.])(?:from|import|require)\\s*\\(?\\s*['"\`]${escaped}['"\`]`).test(bundle);
}


let bundleFiles: string[] = [];
let bundleText = '';
let chunks: Array<{ name: string; bytes: number }> = [];

beforeAll(async () => {
  // Vite's JS API rather than a child process: `pnpm.cmd` is a shim that
  // `spawnSync` refuses without a shell (EINVAL on Windows), and shelling out
  // to run a build we can call directly would be a worse dependency than the
  // one being removed.
  await build({
    configFile: join(packageRoot, 'vite.config.ts'),
    root: packageRoot,
    logLevel: 'warn',
  });

  bundleFiles = readdirSync(distDir).filter((name) => name.endsWith('.js'));
  bundleText = bundleFiles.map((name) => readFileSync(join(distDir, name), 'utf8')).join('\n');
  chunks = bundleFiles.map((name) => ({
    name,
    bytes: statSync(join(distDir, name)).size,
  }));
}, 180_000);

describe('preflight · the bundle audit', () => {
  it('the §10 extension set actually builds', () => {
    expect(existsSync(distDir)).toBe(true);
    expect(bundleFiles.length).toBeGreaterThan(0);
    // 55 modules transformed in the manual run; a bundle this small would mean
    // the extensions were tree-shaken out and the audit audited nothing.
    expect(bundleText.length).toBeGreaterThan(100_000);
  });

  it('zero Tiptap Cloud / Pro network fetches in the bundle', () => {
    const found: string[] = [];
    for (const { needle, why } of CLOUD_NEEDLES) {
      if (needleHits(bundleText, needle)) found.push(`${needle} (${why})`);
    }
    for (const needle of NETWORK_NEEDLES) {
      if (bundleText.includes(needle)) found.push(`${needle} (network primitive)`);
    }
    for (const pattern of YJS_NEEDLES) {
      if (pattern.test(bundleText)) found.push(`${pattern.source} (Yjs runtime)`);
    }
    // Named individually so a failure says which surface appeared, rather than
    // "the grep failed".
    expect(found).toEqual([]);
  });

  it('the needle matcher still has teeth -- fires on a real import, quiet on prose', () => {
    // The control for the precision change above, and the two halves have to be
    // asserted separately, because a matcher that matches nothing and a matcher
    // that matches prose are both "no failures" and neither is a guard.
    //
    // 1. **It still fires.** A paid package genuinely referenced as a specifier
    //    must be caught, in every form a bundler emits it.
    for (const emitted of [
      `import x from "@tiptap/extension-collaboration";`,
      `import"@tiptap/extension-collaboration";`,
      `const m = await import('@tiptap/extension-collaboration');`,
      `const m = require("@tiptap-cloud/sdk");`,
    ]) {
      expect(needleHits(emitted, '@tiptap/extension-collaboration') || needleHits(emitted, '@tiptap-cloud/sdk'), emitted)
        .toBe(true);
    }

    // 2. **It is quiet on prose.** This is the JSDoc that actually broke the
    //    audit on 2026-10-02, copied from the bundle verbatim.
    const jsdoc =
      '* **Important**: If the `@tiptap/extension-collaboration` package is used, make sure to remove\n' +
      '* the `undo-redo` extension, as it is not compatible with the `collaboration` extension.';
    expect(needleHits(jsdoc, '@tiptap/extension-collaboration')).toBe(false);

    // And the classification itself: a hostname is not a package name, so it
    // keeps the substring match — otherwise `tiptap.cloud` would silently stop
    // being checked in specifier position.
    expect(isPackageNeedle('@tiptap/extension-collaboration')).toBe(true);
    expect(isPackageNeedle('tiptap.cloud')).toBe(false);
    expect(needleHits('const u = "https://tiptap.cloud/api"', 'tiptap.cloud')).toBe(true);
  });

  it('the false-positive needles are still absent — the sharp ones just are not `collaboration`', () => {
    // Recorded so the narrowing above cannot quietly become a weaker audit: the
    // three that tripped are still checked, in a form that does not match the
    // shipped stack's own strings.
    expect(bundleText).not.toMatch(/y-prosemirror|y-websocket/);
    // `collaboration` DOES legitimately appear (prosemirror-history's doc
    // comment, UndoRedo's storage key) — asserted here so a future reader
    // knows the absence is measured, not assumed.
    expect(bundleText.includes('collaboration')).toBe(true);
  });

  it('no bare `fetch(` to a remote origin — the generic cloud escape hatch', () => {
    // `fetch` appears legitimately in library code paths that never run
    // offline-first, so the assertion is on a *remote* call, not the word.
    const remoteFetches = [...bundleText.matchAll(/fetch\(\s*["'`](https?:)?\/\//g)];
    expect(remoteFetches.map((m) => m[0])).toEqual([]);
  });

  it('`diff-match-patch` really is lazy — a separate, non-empty chunk', () => {
    // §2 requires it lazy-loaded. The first cut of the audit exported only the
    // string 'diff-match-patch', the dynamic import was elided, and the chunk
    // came out 0.00 kB — an audit that would have passed while auditing nothing.
    const lazy = chunks.find((chunk) => chunk.name.startsWith('diff-match-patch'));
    expect(lazy, 'no diff-match-patch chunk emitted').toBeDefined();
    expect(lazy!.bytes).toBeGreaterThan(10_000);

    // And it is genuinely *absent* from the main chunk, not merely duplicated.
    // The first cut of this assertion read the joined text of every chunk and
    // so matched the lazy chunk's own contents — a check that could only ever
    // fail, never pass, for the wrong reason.
    //
    // The claim needs care: the main chunk legitimately *references* the
    // dependency, because the dynamic `import()` specifier has to survive
    // there or there would be no loader at all. Measured, the main chunk holds
    // 4 such lines and **zero** calls into the implementation. So the assertion
    // is on the implementation, not on the name.
    const mainChunk = bundleFiles.find((name) => name === 'audit.js');
    expect(mainChunk).toBeDefined();
    const mainText = readFileSync(join(distDir, mainChunk!), 'utf8');
    // The loader stub is present …
    expect(mainText).toMatch(/import\("\.\/diff-match-patch-[^"]+\.js"\)/);
    // … and the implementation is not.
    expect(mainText).not.toMatch(/diff_match_patch\(/);
    expect(mainText).not.toMatch(/diff_match_patch_halfMatch/);
  });

  it('the bundle is dominated by ProseMirror, not by a vendor SDK', () => {
    // A size floor with a reason: 846 kB unminified is what the PM stack plus
    // the §10 extensions cost. If a future pin swapped in something with a
    // transitive tree, this moves and the change is noticed.
    const main = chunks.find((chunk) => chunk.name === 'audit.js');
    expect(main).toBeDefined();
    expect(main!.bytes).toBeGreaterThan(500_000);
  });
});
