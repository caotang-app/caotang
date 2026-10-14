/**
 * The format list lives twice: the exporter compiles `EXPORT_FORMATS`, and the bus validates its own copy in
 * `packages/bus/src/descriptors.ts`, because the bus cannot import the exporter. Nothing else checks the two agree,
 * so this file does: a format added to one list and not the other fails here, not in a user's compile.
 */

import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS as BUS_EXPORT_FORMATS } from '@caotang/bus';
import { EXPORT_FORMATS, EXPORT_MIME } from '../src/index.js';

describe('the export formats the bus validates', () => {
  it('are the exporter\'s own formats, in the same order', () => {
    expect([...BUS_EXPORT_FORMATS]).toEqual([...EXPORT_FORMATS]);
  });
});

describe('the export MIME types', () => {
  it('name a type for every format, so a UI that reads the table cannot miss one', () => {
    for (const format of EXPORT_FORMATS) {
      expect(EXPORT_MIME[format], format).toMatch(/^[a-z]+\/[a-z0-9.+-]+/);
    }
  });
});
