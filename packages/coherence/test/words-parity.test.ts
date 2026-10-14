/**
 * The store names the coherence checks and dismissal reasons in words (coherence.md §7.1, §8), from copies of the labels this
 * module owns. The store cannot import this module, so these tests pin each copy to its source: a label changed in one place
 * and not the other fails here.
 */

import { checkWordsOf, dismissalLabelOf } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { DETERMINISTIC_CHECK_IDS, DETERMINISTIC_CHECK_LABELS, DISMISSAL_REASONS } from '../src/index.js';

describe('the store’s words for the coherence checks and reasons match this module’s tables', () => {
  it('names every deterministic check by the label the registry gives it', () => {
    for (const id of DETERMINISTIC_CHECK_IDS) {
      expect(checkWordsOf(id), id).toBe(DETERMINISTIC_CHECK_LABELS[id]);
    }
  });

  it('labels every dismissal reason as the picker does', () => {
    for (const reason of DISMISSAL_REASONS) {
      expect(dismissalLabelOf(reason.id), reason.id).toBe(reason.label);
    }
  });

  it('names a model review’s check as the review and its category, in words', () => {
    expect(checkWordsOf('llm:timeline-plot')).toBe('model review, timeline plot');
    expect(checkWordsOf('llm:narrative-style')).toBe('model review, narrative style');
  });
});
