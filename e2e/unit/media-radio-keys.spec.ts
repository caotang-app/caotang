import { expect, test } from '@playwright/test';

import { radioStep } from '../../apps/desktop/src/components/radio-keys.js';

/**
 * The keys of a radio group (WAI-ARIA radio pattern): the mode switches of the screenplay and the storyboard, and the card size control
 * the corkboard and the shot board share (F-07, ui-modules §0.4). The caller moves the focus with the choice, so this is the key rule only.
 */

const ITEMS = ['Script', 'Source', 'Pages'];

test('an arrow key moves the choice to the next or the previous item, and wraps at the ends', () => {
  expect(radioStep(ITEMS, 'Script', 'ArrowRight')).toBe('Source');
  expect(radioStep(ITEMS, 'Script', 'ArrowDown')).toBe('Source');
  expect(radioStep(ITEMS, 'Pages', 'ArrowRight')).toBe('Script');
  expect(radioStep(ITEMS, 'Source', 'ArrowLeft')).toBe('Script');
  expect(radioStep(ITEMS, 'Source', 'ArrowUp')).toBe('Script');
  expect(radioStep(ITEMS, 'Script', 'ArrowLeft')).toBe('Pages');
});

test('Home and End go to the first and the last item', () => {
  expect(radioStep(ITEMS, 'Source', 'Home')).toBe('Script');
  expect(radioStep(ITEMS, 'Source', 'End')).toBe('Pages');
});

test('any other key keeps its meaning, and a choice the group does not have moves nothing', () => {
  expect(radioStep(ITEMS, 'Script', 'Enter')).toBeNull();
  expect(radioStep(ITEMS, 'Script', 'Tab')).toBeNull();
  expect(radioStep(ITEMS, 'Script', 'a')).toBeNull();
  expect(radioStep(ITEMS, 'Board', 'ArrowRight')).toBeNull();
});
