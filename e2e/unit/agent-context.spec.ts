/**
 * The Context section's prompt preview as a pure model (ui-modules §5.2, context-assembly §5): the prompt a scene draft of the open
 * document would send under the budgets the writer typed, and the sentence that says why there is none.
 */

import { expect, test } from '@playwright/test';

import { contextPreviewOf } from '../../apps/desktop/src/app/context-preview.js';
import { IDS, project } from './fixtures.js';

test.describe('the Context section’s prompt preview (ui-modules §5.2, context-assembly §5)', () => {
  test('shows the prompt of a scene draft of the open document, under the budget the writer typed', () => {
    const view = contextPreviewOf(project(), IDS.sceneA, { layerBudgets: { L2: 700 } });
    expect(view.kind).toBe('prompt');
    if (view.kind !== 'prompt') return;
    expect(view.preview.layers.find((layer) => layer.id === 'L2')?.budget).toBe(700);
  });

  test('says in words that there is no prompt to show when no document is open, or the open one is not a scene', () => {
    const state = project();
    const budgets = { layerBudgets: {} };
    expect(contextPreviewOf(state, undefined, budgets)).toEqual({ kind: 'none', message: expect.stringContaining('Open a scene') });
    expect(contextPreviewOf(state, null, budgets)).toMatchObject({ kind: 'none' });
    expect(contextPreviewOf(state, IDS.chapterOne, { layerBudgets: {} })).toMatchObject({ kind: 'none', message: expect.stringContaining('not a scene') });
  });
});
