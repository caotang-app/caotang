/**
 * Emits §2's per-construct result table from a live run.
 *
 * Run: `pnpm vitest run packages/editor-audit/test/emit-table.test.ts`
 * with `C16_TABLE=1` set. Deliberately inert by default — the table in §2 is
 * committed prose, and a test that rewrote a spec file on every `pnpm verify`
 * would be a surprising side effect for a gate. The measurement is in
 * `trace.ts`; this only formats it.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'vitest';
import { CORPUS } from '../src/corpus.js';
import { measure } from '../src/trace.js';

describe('C16 table emitter', () => {
  it('writes the per-construct table when C16_TABLE=1', async () => {
    if (process.env.C16_TABLE !== '1') return;

    const rows: string[] = [];
    for (const group of [...new Set(CORPUS.map((entry) => entry.group))]) {
      rows.push(`\n**${group}**\n`);
      rows.push('| Construct | Spec class | Measured | Bytes | What happened |');
      rows.push('|---|---|---|---|---|');
      for (const entry of CORPUS.filter((e) => e.group === group)) {
        const r = await measure(entry);
        const bytes = r.threw ? '—' : r.byteIdentical ? 'identical' : 'normalized';
        const what = r.threw ? `**throws** \`${r.threw}\`` : (r.note || 'byte-identical');
        rows.push(`| \`${entry.name}\` | ${entry.expect} | ${r.outcome} | ${bytes} | ${what} |`);
      }
    }
    const out = join(resolve(__dirname, '..'), 'RESULT-TABLE.md');
    writeFileSync(out, rows.join('\n'), 'utf8');
    console.error(`wrote ${out}`);
  }, 120_000);
});
