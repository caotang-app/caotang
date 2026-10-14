/**
 * The title page's date is the writer's own calendar day (exporter.md §4, goals-progress.md A3), not the UTC day. The two differ for part
 * of every day in most zones, so each test here fixes the zone it runs in, and names the instant and the day a writer there would read.
 * The UTC stamps the log and the EPUB's `dcterms:modified` keep are not this file's: they stay UTC (epub-metadata.md).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryArtifactFs } from '@caotang/store';

import { createExporter, type ExportSelection } from '../src/index.js';
import { localDayOf } from '../src/exporter.js';
import { makeProject } from './fixture.js';

const WHOLE_BOOK: ExportSelection = { includeRootIds: ['manuscript'] };

/** Compiles the fixture book as plain text at `instant`, and returns the title page's date line. */
async function titleDateAt(instant: string): Promise<string | undefined> {
  const state = makeProject();
  const exporter = createExporter({ readState: () => state, artifacts: new MemoryArtifactFs(), clock: { now: () => Date.parse(instant) } });
  const result = await exporter.compile(WHOLE_BOOK, 'txt');
  const lines = (await result.blob.text()).split('\n');
  return lines.find((line) => /^\d{4}-\d{2}-\d{2}$/.test(line));
}

/** Runs `body` with the process in `zone`, which Node applies to every Date from the moment the variable changes. */
function inZone(zone: string, body: () => void): void {
  describe(`in ${zone}`, () => {
    beforeEach(() => {
      vi.stubEnv('TZ', zone);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });
    body();
  });
}

describe('the title page date (exporter.md §4)', () => {
  inZone('Pacific/Pago_Pago', () => {
    // Eleven hours behind UTC: 00:30 UTC on the 14th is 13:30 on the 13th for a writer there.
    it('is the writer’s day, the 13th, when the UTC day has already become the 14th', async () => {
      expect(new Date('2026-10-14T00:30:00.000Z').getDate()).toBe(13);
      expect(await titleDateAt('2026-10-14T00:30:00.000Z')).toBe('2026-10-13');
    });

    it('is the 13th on the evening of the 13th, which is the UTC day too', async () => {
      expect(await titleDateAt('2026-10-13T23:30:00.000Z')).toBe('2026-10-13');
    });

    it('is the 14th once the writer’s own day has turned, which is the UTC day as well', async () => {
      expect(await titleDateAt('2026-10-14T11:30:00.000Z')).toBe('2026-10-14');
    });
  });

  inZone('Pacific/Auckland', () => {
    // Thirteen hours ahead of UTC in October (NZDT): 23:30 UTC on the 13th is 12:30 on the 14th for a writer there.
    it('is the writer’s day, the 14th, when the UTC day is still the 13th', async () => {
      expect(new Date('2026-10-13T23:30:00.000Z').getDate()).toBe(14);
      expect(await titleDateAt('2026-10-13T23:30:00.000Z')).toBe('2026-10-14');
    });
  });

  describe('localDayOf', () => {
    it('reads the calendar parts of the instant in the zone the process runs in, zero-padded', () => {
      vi.stubEnv('TZ', 'Pacific/Pago_Pago');
      try {
        expect(localDayOf(new Date('2026-10-14T00:30:00.000Z'))).toBe('2026-10-13');
        expect(localDayOf(new Date('2026-03-04T12:00:00.000Z'))).toBe('2026-03-04');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
