import { expect, test } from '@playwright/test';

import { EDITABLE_FIELDS, draftAfterStoredChange, type ShotDraft } from '../../apps/desktop/src/media/storyboard-model.js';

/** A shot the writer has not filled in: every editable field is empty. */
const EMPTY: ShotDraft = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, ''])) as unknown as ShotDraft;

test('a stored change that is not an editable field keeps every typed value', () => {
  // A prompt save or a coverage change moves the card's stored value without moving any editable field.
  const typed: ShotDraft = { ...EMPTY, action: 'Elena walks down the quay.', lens: '50mm' };
  expect(draftAfterStoredChange(typed, EMPTY, EMPTY)).toEqual(typed);
});

test('a stored change to one field resets that field only, and keeps the writer’s text in the others', () => {
  const typed: ShotDraft = { ...EMPTY, action: 'Elena walks down the quay.' };
  // The stored lens changed (an undo, or another writer): the lens takes the stored value, the unsaved action stays.
  expect(draftAfterStoredChange(typed, EMPTY, { ...EMPTY, lens: '35mm' })).toEqual({ ...typed, lens: '35mm' });
});

test('a stored action that changed replaces the typed one, because the stored value is what the shot now holds', () => {
  const typed: ShotDraft = { ...EMPTY, action: 'A draft that was never saved' };
  expect(draftAfterStoredChange(typed, EMPTY, { ...EMPTY, action: 'Saved text' }).action).toBe('Saved text');
});
