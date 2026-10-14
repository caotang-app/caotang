/**
 * The shot record's codec. The load side is tolerant and the write side is strict (shot-meta.ts header),
 * and each rule below is one that storyboard.md §2.2 or project-format §6 states.
 */

import { describe, expect, it } from 'vitest';

import {
  SHOT_META_KEYS,
  checkEnum,
  checkShotMeta,
  readShotMeta,
  storedValueOf,
  writeShotMeta,
  type ShotMeta,
} from '../src/index.js';

const ASSET = 'a_7K2QX9M4A1';

const coverage = {
  kind: 'fountain-element',
  docId: 'n_3W8RN2TQ6C',
  anchor: { from: 40, to: 62, exact: 'I was gone nine years.', prefix: 'ELENA\n', suffix: '\n\nThe light', capturedRevision: 3 },
};

describe('readShotMeta: a load keeps what it can, and says what it dropped', () => {
  it('reads a missing or null value as an empty shot, which is a valid state, with no notices', () => {
    expect(readShotMeta(undefined)).toMatchObject({ meta: {}, notices: [] });
    expect(readShotMeta(null)).toMatchObject({ meta: {}, notices: [] });
  });

  it('reads a well-formed object with no notices', () => {
    const read = readShotMeta({
      image: ASSET,
      imageAlt: 'the harbour at dawn',
      shotSize: 'WS',
      cameraAngle: 'low',
      cameraMovement: 'dolly-in',
      lens: '35mm anamorphic',
      action: 'Elena crosses the quay.',
      dialogue: [coverage],
      durationSec: 2.5,
      transition: 'cut',
      vendorRefs: [{ vendor: 'example' }],
    });
    expect(read.notices).toEqual([]);
    expect(read.meta).toMatchObject({ image: ASSET, shotSize: 'WS', durationSec: 2.5, transition: 'cut', lens: '35mm anamorphic' });
    expect(read.meta.dialogue).toEqual([coverage]);
  });

  it('keeps a closed-enum value outside its list verbatim, and reports it as an unknown value (§2.2)', () => {
    const read = readShotMeta({ shotSize: 'XXL', cameraMovement: 'levitate' });
    expect(read.meta.shotSize).toBeUndefined();
    expect(read.unknownValues).toEqual({ shotSize: 'XXL', cameraMovement: 'levitate' });
    expect(read.notices.join('\n')).toContain('"XXL" is not in the v1 list');
  });

  it('writes an unknown enum value back where it was, so a save does not turn it into a missing value', () => {
    const stored = writeShotMeta(readShotMeta({ shotSize: 'XXL', action: 'kept' }));
    expect(stored).toEqual({ shotSize: 'XXL', action: 'kept' });
  });

  it('keeps an unknown field in memory and reports that it is dropped on the next save (§6)', () => {
    const read = readShotMeta({ action: 'a', mystery: 42 });
    expect(read.unknownFields).toEqual({ mystery: 42 });
    expect(read.notices.join('\n')).toContain('"mystery" is kept in memory and dropped on the next save');
    expect(writeShotMeta(read)).not.toHaveProperty('mystery');
  });

  it('drops an image that is a path rather than an asset id, and says why', () => {
    const read = readShotMeta({ image: '../../secret.png' });
    expect(read.meta.image).toBeUndefined();
    expect(read.notices.join('\n')).toContain('image is not an asset id');
  });

  it('drops a malformed dialogue entry and keeps the valid ones beside it', () => {
    const bad = { kind: 'fountain-element', docId: 'n_3W8RN2TQ6C', anchor: { from: 9, to: 4, exact: 'x', prefix: '', suffix: '', capturedRevision: 0 } };
    const read = readShotMeta({ dialogue: [coverage, bad] });
    expect(read.meta.dialogue).toEqual([coverage]);
    expect(read.notices.join('\n')).toContain('dialogue entry 2 is malformed');
  });

  it('refuses an anchor whose exact text is over the 2000-unit bound, or whose context is over 32', () => {
    const long = { ...coverage, anchor: { ...coverage.anchor, exact: 'x'.repeat(2001) } };
    const wideContext = { ...coverage, anchor: { ...coverage.anchor, prefix: 'p'.repeat(33) } };
    const read = readShotMeta({ dialogue: [long, wideContext] });
    expect(read.meta.dialogue).toEqual([]);
    expect(read.notices.filter((notice) => notice.includes('malformed'))).toHaveLength(2);
  });

  it('drops a dialogue value that is not a list, and says so', () => {
    const read = readShotMeta({ dialogue: 'ELENA' });
    expect(read.meta.dialogue).toBeUndefined();
    expect(read.notices.join('\n')).toContain('dialogue is not a list');
  });

  it('accepts a duration of zero and drops a negative, non-finite or non-numeric one', () => {
    expect(readShotMeta({ durationSec: 0 }).meta.durationSec).toBe(0);
    for (const bad of [-1, Number.NaN, '2', null]) {
      const read = readShotMeta({ durationSec: bad });
      expect(read.meta.durationSec).toBeUndefined();
      expect(read.notices.join('\n')).toContain('durationSec is not a finite number');
    }
  });

  it('keeps an action over the limit, because it is content, and says it must be shortened', () => {
    const over = 'a'.repeat(1001);
    const read = readShotMeta({ action: over });
    expect(read.meta.action).toBe(over);
    expect(read.notices.join('\n')).toContain('action is 1001 characters, over the 1000 limit');
  });

  it('counts the action limit in code points, not UTF-16 units', () => {
    const exact = '😀'.repeat(1000);
    expect(exact.length).toBe(2000);
    expect(readShotMeta({ action: exact }).notices).toEqual([]);
    expect(readShotMeta({ action: `${exact}😀` }).notices.join('\n')).toContain('action is 1001 characters');
  });

  it('carries vendorRefs verbatim, because the M4 prompt pack types them and this module must not drop them', () => {
    const refs = [{ vendor: 'example', seed: 7, nested: { keep: true } }];
    const read = readShotMeta({ vendorRefs: refs });
    expect(read.meta.vendorRefs).toEqual(refs);
    expect(readShotMeta({ vendorRefs: 'nope' }).notices.join('\n')).toContain('vendorRefs is not a list');
  });

  it('drops text fields of the wrong type, and says which', () => {
    const read = readShotMeta({ lens: 35, imageAlt: true, action: ['a'] });
    expect(read.meta).toEqual({});
    expect(read.notices.join('\n')).toContain('lens is not text');
    expect(read.notices.join('\n')).toContain('imageAlt is not text');
    expect(read.notices.join('\n')).toContain('action is not text');
  });

  it('keeps a metadata value that is not an object whole, so it is never lost to a read', () => {
    const read = readShotMeta('a bare string');
    expect(read.rawPreserved).toBe('a bare string');
    expect(storedValueOf(read)).toBe('a bare string');
    expect(read.notices.join('\n')).toContain('not an object');
  });
});

describe('writeShotMeta: a fixed key order, and no unknown fields', () => {
  it('writes the keys in the spec order whatever order they were read in', () => {
    const stored = writeShotMeta(readShotMeta({ vendorRefs: [], transition: 'cut', action: 'a', image: ASSET, shotSize: 'MS' }));
    expect(Object.keys(stored)).toEqual(SHOT_META_KEYS.filter((key) => key in stored));
    expect(Object.keys(stored)).toEqual(['image', 'shotSize', 'action', 'transition', 'vendorRefs']);
  });

  it('writes a covered range in one fixed key order, so a diff of the manifest is one line', () => {
    const shuffled = {
      kind: 'fountain-element',
      anchor: { capturedRevision: 3, suffix: 's', prefix: 'p', exact: 'x', to: 2, from: 1 },
      docId: 'n_3W8RN2TQ6C',
    };
    const stored = writeShotMeta(readShotMeta({ dialogue: [shuffled] })) as { dialogue: Array<Record<string, unknown>> };
    expect(Object.keys(stored.dialogue[0] ?? {})).toEqual(['kind', 'docId', 'anchor']);
    expect(Object.keys((stored.dialogue[0] as { anchor: object }).anchor)).toEqual([
      'from',
      'to',
      'exact',
      'prefix',
      'suffix',
      'capturedRevision',
    ]);
  });

  it('is stable under a second read and write', () => {
    const raw = { action: 'a', shotSize: 'XXL', durationSec: 1, dialogue: [coverage], mystery: 1 };
    const once = writeShotMeta(readShotMeta(raw));
    const twice = writeShotMeta(readShotMeta(once));
    expect(twice).toEqual(once);
  });
});

describe('checkShotMeta and checkEnum: the strict side, for a write', () => {
  it('names the valid list when an enum value is outside it', () => {
    const refusal = checkEnum('shotSize', 'XXL');
    expect(refusal?.code).toBe('enum-invalid');
    expect(refusal?.message).toContain('WS, FS, MFS');
    expect(checkEnum('shotSize', 'WS')).toBeUndefined();
  });

  it('refuses an image that is a path, and accepts an asset id', () => {
    expect(checkShotMeta({ image: 'shots/one.png' })?.code).toBe('image-id-invalid');
    expect(checkShotMeta({ image: ASSET })).toBeUndefined();
  });

  it('refuses an action over 1000 code points and names the way out', () => {
    const refusal = checkShotMeta({ action: 'a'.repeat(1001) });
    expect(refusal?.code).toBe('action-too-long');
    expect(refusal?.message).toContain('Shorten it');
    expect(checkShotMeta({ action: 'a'.repeat(1000) })).toBeUndefined();
  });

  it('refuses a duration that is negative, and one that is not a number', () => {
    expect(checkShotMeta({ durationSec: -0.5 })?.code).toBe('duration-invalid');
    expect(checkShotMeta({ durationSec: '3' })?.code).toBe('duration-invalid');
    expect(checkShotMeta({ durationSec: 0 })).toBeUndefined();
  });

  it('refuses a lens that is not text', () => {
    expect(checkShotMeta({ lens: 35 })?.code).toBe('lens-invalid');
  });

  it('accepts a typed ShotMeta that passes every rule', () => {
    const meta: ShotMeta = { shotSize: 'CU', cameraAngle: 'eye', cameraMovement: 'static', action: 'x', durationSec: 4, transition: 'dissolve', lens: '50mm' };
    expect(checkShotMeta({ ...meta })).toBeUndefined();
  });
});
