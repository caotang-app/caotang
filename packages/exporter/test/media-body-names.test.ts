/**
 * The store names a body file by its kind (`docs/<id>.fountain`, `docs/<id>.ink`, `docs/<id>.md`), and the engines name
 * the same extensions with their dots. The store cannot import the engines (they depend on it), so the two spellings
 * are pinned here, in the one package that depends on all of them.
 */

import { INK_BODY_EXTENSION } from '@caotang/dialogue';
import { FOUNTAIN_EXTENSION } from '@caotang/screenplay';
import { FOUNTAIN_BODY_EXT, INK_BODY_EXT, PROSE_BODY_EXT, bodyExtensionOf, bodyFileName } from '@caotang/store';
import { describe, expect, it } from 'vitest';

describe('the body file extensions agree across the store and the engines', () => {
  it('the screenplay extension is the store\'s .fountain', () => {
    expect(FOUNTAIN_EXTENSION).toBe(`.${FOUNTAIN_BODY_EXT}`);
  });

  it('the dialogue extension is the store\'s .ink', () => {
    expect(INK_BODY_EXTENSION).toBe(`.${INK_BODY_EXT}`);
  });

  it('prose keeps .md, and a node is named by its kind', () => {
    expect(PROSE_BODY_EXT).toBe('md');
    expect(bodyExtensionOf({ type: 'document' })).toBe(PROSE_BODY_EXT);
    expect(bodyExtensionOf({ type: 'document', kind: 'screenplay' })).toBe(FOUNTAIN_BODY_EXT);
    expect(bodyExtensionOf({ type: 'dialogue', kind: 'branching' })).toBe(INK_BODY_EXT);
    expect(bodyFileName({ id: 'n_3W8RN2TQ6C', type: 'dialogue' })).toBe('n_3W8RN2TQ6C.ink');
  });
});
