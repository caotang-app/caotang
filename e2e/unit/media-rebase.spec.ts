import { expect, test } from '@playwright/test';

import { caretAfterEdit, isOwnWrite } from '../../apps/desktop/src/media/rebase-model.js';

test.describe("a media view tells its own write from a change made under it", () => {
  test("the write the session stored, at the revision the store holds, is the view's own", () => {
    expect(isOwnWrite({ body: 'AAA', revision: 1 }, 'AAA', 1)).toBe(true);
  });

  test('no record of a write is never the view\'s own', () => {
    expect(isOwnWrite(null, 'AAA', 1)).toBe(false);
  });

  test('a change to another revision is not the view\'s own, whichever way the revision moved', () => {
    expect(isOwnWrite({ body: 'AAA', revision: 1 }, '', 0)).toBe(false);
    expect(isOwnWrite({ body: 'AAA', revision: 1 }, 'AAA', 2)).toBe(false);
  });

  test('a change on the same revision with another body is not the view\'s own, so the other text is adopted', () => {
    // The view's record is AAAB at revision 2. A change that lands on revision 2 over other text (ZZZ) is not that write, and a
    // check on the revision alone would call it the view's own. An undo no longer reaches the same number over other text (it
    // moves the revision up), but a record and a store that disagree on the body are still not the view's own write.
    const lastWritten = { body: 'AAAB', revision: 2 };
    expect(isOwnWrite(lastWritten, 'ZZZ', 2)).toBe(false);
    expect(isOwnWrite(lastWritten, 'AAAB', 2)).toBe(true);
  });
});

test.describe('the caret keeps its place when the idle mint rewrites the text under it', () => {
  test('a caret before the change stays where it is', () => {
    expect(caretAfterEdit('Alice: Hi.\nBob: Yo.', 'Alice: Hi. # lineId: l_A\nBob: Yo.', 3)).toBe(3);
  });

  test('a caret after the change moves by the change in length, so it stays inside the same words', () => {
    const before = 'Alice: Hi.\nBob: Yo.';
    const after = 'Alice: Hi. # lineId: l_A\nBob: Yo.';
    // The caret sits inside "Bob" on the second line, which the first line's new id pushes along.
    expect(caretAfterEdit(before, after, before.indexOf('Bob') + 1)).toBe(after.indexOf('Bob') + 1);
  });

  test('a caret inside a span the mint replaced goes to the end of the new span', () => {
    expect(caretAfterEdit('abcd', 'aXYZd', 2)).toBe(4);
  });

  test('a caret at the end of a replaced span moves by the change in length', () => {
    expect(caretAfterEdit('abcd', 'aXYZd', 4)).toBe(5);
  });

  test('unchanged text leaves the caret alone', () => {
    expect(caretAfterEdit('same', 'same', 2)).toBe(2);
  });
});
