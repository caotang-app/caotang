import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

/** The screenplay PDF's CJK fallback font, which the screenplay package reads from `./fonts/` beside the running module. */
const CJK_FONT = 'fonts/NotoSansMonoCJKsc-Regular.otf';

/**
 * Emits the CJK fallback font as `dist/fonts/NotoSansMonoCJKsc-Regular.otf`. A server build leaves the font's
 * `new URL('./fonts/…', import.meta.url)` as it is, so the file must sit in `fonts/` beside the bundle. It is read only when a
 * screenplay PDF holds a character Courier Prime cannot print, so the bundle still runs without it for everything else.
 */
function cjkFont(): Plugin {
  return {
    name: 'caotang-cjk-font',
    apply: 'build',
    generateBundle() {
      const source = readFileSync(fileURLToPath(new URL(`../screenplay/src/${CJK_FONT}`, import.meta.url)));
      this.emitFile({ type: 'asset', fileName: CJK_FONT, source });
    },
  };
}

/**
 * The bundle build: `src/bin.ts` to `dist/caotang-mcp.mjs`, one file a plain Node can run.
 *
 * The workspace packages are TypeScript sources whose imports end in `.js`, which Node
 * cannot resolve on its own, and the SDK's own dependencies are inlined with them, so
 * `noExternal` is true. Node's built-in modules are left as imports, which is what
 * Vite's server-side build does for them already. The shebang is added so the file can
 * be run directly as the `caotang-mcp` bin. Minification is off, so a reviewer can read
 * what is shipped. The one file beside it is the screenplay PDF's CJK fallback font (cjkFont below).
 */
export default defineConfig({
  plugins: [cjkFont()],
  build: {
    ssr: fileURLToPath(new URL('./src/bin.ts', import.meta.url)),
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'caotang-mcp.mjs',
        banner: '#!/usr/bin/env node',
        // The exporter loads DOCX and EPUB lazily. One file is the deliverable, so the lazy
        // chunks are inlined: a bundle that needs a sibling file is not a single runnable file.
        codeSplitting: false,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
