import { expect, test } from '@playwright/test';
import { DETERMINISTIC_CHECK_IDS } from '../../packages/coherence/src/index.js';

import {
  DEFAULT_COHERENCE_SETTINGS,
  DEFAULT_SETTINGS,
  applyPatch,
  enabledChecksOf,
  normalizeSettings,
  reviewScopeOf,
} from '../../apps/desktop/src/app/settings.js';

test.describe('the Coherence settings slice (ui-modules §5.2)', () => {
  test('a record with no coherence section reads as every check, the whole manuscript, and the default cap', () => {
    const settings = normalizeSettings({});
    expect(settings.coherence).toEqual({ enabledChecks: [...DETERMINISTIC_CHECK_IDS], defaultReviewScope: 'full', maxFindings: 50 });
    expect(DEFAULT_SETTINGS.coherence).toEqual(DEFAULT_COHERENCE_SETTINGS);
  });

  test('the enabled checks come back in registry order, without unknown or repeated names', () => {
    const stored = ['presence.expected', 'codex.alias-collisions', 'not.a-check', 'presence.expected'];
    expect(enabledChecksOf(stored)).toEqual(['codex.alias-collisions', 'presence.expected']);
  });

  test('an explicit empty list is kept: the writer turned every check off, and a scan then runs nothing', () => {
    expect(enabledChecksOf([])).toEqual([]);
    expect(normalizeSettings({ coherence: { enabledChecks: [] } }).coherence.enabledChecks).toEqual([]);
  });

  test('a list that is not a list reads as every check, so a damaged value never silences the scan', () => {
    expect(enabledChecksOf('presence.expected')).toEqual([...DETERMINISTIC_CHECK_IDS]);
  });

  test('the default scope is one of the three, and anything else reads as the whole manuscript', () => {
    expect(reviewScopeOf('changed')).toBe('changed');
    expect(reviewScopeOf('doc')).toBe('doc');
    expect(reviewScopeOf('everything')).toBe('full');
    expect(reviewScopeOf(undefined)).toBe('full');
  });

  test('the cap is a whole number from one to two hundred, and a bad value takes the default', () => {
    expect(normalizeSettings({ coherence: { maxFindings: 0 } }).coherence.maxFindings).toBe(1);
    expect(normalizeSettings({ coherence: { maxFindings: 999 } }).coherence.maxFindings).toBe(200);
    expect(normalizeSettings({ coherence: { maxFindings: 'lots' } }).coherence.maxFindings).toBe(50);
    expect(normalizeSettings({ coherence: { maxFindings: 12.6 } }).coherence.maxFindings).toBe(13);
  });

  test('a patch changes only the coherence fields it names, and keeps the rest', () => {
    const next = applyPatch(DEFAULT_SETTINGS, { coherence: { defaultReviewScope: 'changed', maxFindings: 20 } });
    expect(next.coherence).toEqual({ enabledChecks: [...DETERMINISTIC_CHECK_IDS], defaultReviewScope: 'changed', maxFindings: 20 });
    expect(next.editor).toEqual(DEFAULT_SETTINGS.editor);
    const off = applyPatch(next, { coherence: { enabledChecks: ['timeline.overlap'] } });
    expect(off.coherence.enabledChecks).toEqual(['timeline.overlap']);
    expect(off.coherence.maxFindings).toBe(20);
  });
});
