import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The Tiptap preflight bundle audit's build config.
 *
 * A library build of `bundle-entry.ts` — the §10 extension set plus the anchor
 * ladder — so the emitted chunks can be grepped for Tiptap Cloud / Pro network
 * calls. `minify: false` is deliberate: §2's claim is about *what code is
 * present*, and readable output is what makes a grep result reviewable rather
 * than a yes/no from a minifier.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'bundle-entry.ts'),
      formats: ['es'],
      fileName: () => 'audit.js',
    },
    rollupOptions: {
      // Keep the lazy dependency in its own chunk so "lazy-loaded" is a
      // property of the emitted artifact, checkable by the test.
      output: {
        manualChunks: (id) =>
          id.includes('diff-match-patch') ? 'diff-match-patch' : undefined,
      },
    },
  },
});
