/**
 * `@caotang/screenplay` declares `FlatBlock` structurally, because importing it from this package
 * would make the two packages a workspace cycle (the exporter depends on the screenplay engine for
 * Fountain and FDX). This pins the two declarations to the same type: a change to either side
 * fails the typecheck here instead of drifting.
 */

import { describe, expect, it } from 'vitest';
import type { FlatBlock as ScreenplayFlatBlock } from '@caotang/screenplay';
import type { FlatBlock } from '../src/index.js';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('the flattened block shape', () => {
  it('is the same type in the exporter and in the screenplay engine', () => {
    const same: Same<FlatBlock, ScreenplayFlatBlock> = true;
    expect(same).toBe(true);
  });

  it('carries a section\'s synopsis on the chapter block, in both declarations (screenplay.md §2.2)', () => {
    // Each side must accept the other's chapter block, with and without a synopsis: a field missing on either side fails the typecheck here.
    const fromEngine: ScreenplayFlatBlock = { kind: 'chapter', title: 'ACT ONE', level: 1, number: 1, synopsis: 'The setup.' };
    const asExporter: FlatBlock = fromEngine;
    const fromExporter: FlatBlock = { kind: 'chapter', title: 'ACT TWO', level: 1, number: 2 };
    const asEngine: ScreenplayFlatBlock = fromExporter;
    expect(asExporter).toEqual(fromEngine);
    expect(asEngine).toEqual(fromExporter);
  });
});
