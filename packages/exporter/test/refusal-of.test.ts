/**
 * `refusalOf` is the apply's own checks run with nothing reserved or written (exporter.md §5). A caller that asks the writer first (the MCP
 * server's write-confirm) uses it, so these tests hold it to the apply: the refusal it returns is the one the apply would throw, and a
 * compile it accepts is one the apply would make.
 */

import { describe, expect, it } from 'vitest';
import { MemoryArtifactFs } from '@caotang/store';

import { createExporter, type ExportDispatch } from '../src/index.js';
import { COMPILED_AT, IDS, makeProject } from './fixture.js';

const fountain: ExportDispatch = { name: 'export.compile', params: { format: 'fountain' } };

describe('refusalOf', () => {
  it('returns the screenplay refusal for a Fountain compile of a prose-only book, and reserves and writes nothing', async () => {
    const artifacts = new MemoryArtifactFs();
    const state = makeProject();
    const exporter = createExporter({ readState: () => state, artifacts, clock: { now: () => COMPILED_AT } });
    await exporter.ready();
    const refusal = exporter.refusalOf(state, fountain, COMPILED_AT);
    expect(refusal?.code).toBe('invalid-params');
    expect(refusal?.message).toContain('the selection holds no screenplay scene');
    expect(await artifacts.listFiles('exports')).toEqual([]);
  });

  it('refuses a part the same way, for the part the writer named', () => {
    const state = makeProject();
    const exporter = createExporter({ readState: () => state, artifacts: new MemoryArtifactFs(), clock: { now: () => COMPILED_AT } });
    const part: ExportDispatch = { name: 'export.compileSelection', params: { format: 'fdx', includeRootIds: [IDS.chapterOne] } };
    expect(exporter.refusalOf(state, part, COMPILED_AT)?.message).toContain('the selection holds no screenplay scene');
  });

  it('returns nothing for a prose compile the apply would make', () => {
    const state = makeProject();
    const exporter = createExporter({ readState: () => state, artifacts: new MemoryArtifactFs(), clock: { now: () => COMPILED_AT } });
    expect(exporter.refusalOf(state, { name: 'export.compile', params: { format: 'md' } }, COMPILED_AT)).toBeUndefined();
  });

  it('returns the not-found refusal for a recipe the project does not hold, as the apply would', () => {
    const state = makeProject();
    const exporter = createExporter({ readState: () => state, artifacts: new MemoryArtifactFs(), clock: { now: () => COMPILED_AT } });
    const refusal = exporter.refusalOf(state, { name: 'export.compile', params: { format: 'md', recipeName: 'Missing' } }, COMPILED_AT);
    expect(refusal?.code).toBe('not-found');
    expect(refusal?.message).toContain('"Missing"');
  });
});
