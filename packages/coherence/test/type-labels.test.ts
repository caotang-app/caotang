import { describe, expect, it } from 'vitest';

import { FINDING_TYPE_LABELS, RUN_KINDS, RUN_KIND_LABELS, findingTypeLabel } from '../src/index.js';

describe('the writer’s words for a finding type and a run kind (coherence.md §8)', () => {
  it('names each subtype a check writes by its row, never by its key', () => {
    expect(findingTypeLabel('expected-absent')).toBe('Expected character missing');
    expect(findingTypeLabel('loose-end')).toBe('Loose end');
    for (const [key, label] of Object.entries(FINDING_TYPE_LABELS)) expect(label).not.toBe(key);
  });

  it('names a model subtype with no row in plain words, and an empty one as a finding', () => {
    expect(findingTypeLabel('travel-time')).toBe('Travel time');
    expect(findingTypeLabel('')).toBe('Finding');
  });

  it('names every run kind', () => {
    expect(RUN_KINDS.map((kind) => RUN_KIND_LABELS[kind])).toEqual(['Quick scan', 'Model review']);
  });
});
