/**
 * The prompt a scene draft would send, previewed for the Context section (context-assembly §5): the budgets the writer sets reach the
 * preview's layers, the focus is the scene's own text, and a folder, a container or a missing node has no scene prompt to show.
 */

import { describe, expect, it } from 'vitest';

import { addDocument } from '@caotang/store';

import { scenePromptPreview } from '../../src/index.js';
import { CHAPTER_ONE, MISSING, OPENED, STORM, makeState } from '../fixtures.js';

describe('scenePromptPreview (context-assembly §5, the Context section’s prompt view)', () => {
  it('shows the prompt a scene draft would send, with each layer against the budget the writer set', () => {
    // L2 takes no flow-up from the layers above it (context-assembly §3), so its budget is the one the writer typed.
    const preview = scenePromptPreview(makeState(), STORM, { mode: 'continue', instruction: 'Go on.', config: { layerBudgets: { L2: 900 } } });
    expect(preview).toBeDefined();
    expect(preview?.layers.find((layer) => layer.id === 'L2')?.budget).toBe(900);
    expect(preview?.promptTokens).toBeGreaterThan(0);
  });

  it('carries the scene’s own text in its focus, so the writer sees what the model would read', () => {
    const preview = scenePromptPreview(makeState(), STORM, { mode: 'continue', instruction: 'Go on.' });
    expect(JSON.stringify(preview?.payload)).toContain('The lamp failed.');
  });

  it('has no scene prompt for a folder, a dialogue container or a missing node', () => {
    const state = makeState();
    addDocument(state, { id: 'n_TAVERN0001', parentId: 'manuscript', title: 'Tavern', type: 'dialogue', body: '', now: OPENED });
    expect(scenePromptPreview(state, CHAPTER_ONE, { mode: 'continue', instruction: 'Go on.' })).toBeUndefined();
    expect(scenePromptPreview(state, 'n_TAVERN0001', { mode: 'continue', instruction: 'Go on.' })).toBeUndefined();
    expect(scenePromptPreview(state, MISSING, { mode: 'continue', instruction: 'Go on.' })).toBeUndefined();
  });
});
