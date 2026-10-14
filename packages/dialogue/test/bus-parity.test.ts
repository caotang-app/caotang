/**
 * The bus carries two copies of this package's container settings (`DIALOGUE_ENGINE_TARGETS` and `DIALOGUE_META_KEYS`), because
 * the bus cannot import the dialogue package, which depends on it. This pins those copies to the originals, so a change to
 * one side fails here rather than letting `dialogue.setMeta` accept a value the reader would drop, or refuse one it reads.
 */
import { describe, expect, it } from 'vitest';

import { DIALOGUE_ENGINE_TARGETS, DIALOGUE_META_KEYS } from '@caotang/bus';

import { ENGINE_TARGETS, readDialogueMeta, type DialogueContainerMeta } from '../src/index.js';

describe('the container settings the bus and the dialogue package share', () => {
  it('names the same engine targets, in the same order', () => {
    expect([...DIALOGUE_ENGINE_TARGETS]).toEqual([...ENGINE_TARGETS]);
  });

  it('names exactly the settings the container metadata reads', () => {
    // Every key the reader keeps is a key the command may set, and the reader's own type names no other.
    const read = readDialogueMeta({
      speaker: 'c_ANNA000001',
      locBaseline: 'en',
      engineTarget: 'ink-json',
      autoLineIds: true,
    }).meta;
    const keys = Object.keys(read).sort();
    expect(keys).toEqual([...DIALOGUE_META_KEYS].sort());
    const typed: Record<keyof DialogueContainerMeta, true> = { speaker: true, locBaseline: true, engineTarget: true, autoLineIds: true };
    expect(Object.keys(typed).sort()).toEqual([...DIALOGUE_META_KEYS].sort());
  });
});
