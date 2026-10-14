import { expect, test } from '@playwright/test';

import { TARGET_MAX_WORDS } from '../../apps/desktop/src/app/settings.js';
import { targetDraftOf } from '../../apps/desktop/src/app/target-draft.js';

test.describe('the daily target typed into the editor (goals-progress §4)', () => {
  test('a whole number of words is saved, and zero means no target', () => {
    expect(targetDraftOf('800')).toEqual({ ok: true, words: 800 });
    expect(targetDraftOf(' 1200 ')).toEqual({ ok: true, words: 1200 });
    expect(targetDraftOf('0')).toEqual({ ok: true, words: 0 });
    expect(targetDraftOf(String(TARGET_MAX_WORDS))).toEqual({ ok: true, words: TARGET_MAX_WORDS });
  });

  test('anything else is refused, with the sentence the Settings field says too', () => {
    for (const text of ['', '   ', 'lots', '12.5', '-3', 'NaN', String(TARGET_MAX_WORDS + 1)]) {
      const draft = targetDraftOf(text);
      expect(draft.ok, `"${text}" is refused`).toBe(false);
      if (!draft.ok) expect(draft.message).toContain('0 means no target');
    }
  });
});
