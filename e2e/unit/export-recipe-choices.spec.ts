import { expect, test } from '@playwright/test';

import type { ExportRecipe } from '../../packages/exporter/src/index.js';

import { recipeChoicesOf } from '../../apps/desktop/src/app/recipe-choices.js';

/**
 * The export dialog's recipe options (app/recipe-choices.ts). A project can hold one name twice, and the dialog keys its options by name,
 * so the choices hold one entry per name: the first the project holds.
 */

const manuscript: ExportRecipe = { name: 'Manuscript', includeRootIds: ['manuscript'], format: 'docx', templateId: 'default', options: {} };
const beta: ExportRecipe = { name: 'Beta read', includeRootIds: ['manuscript'], format: 'md', options: { titlePage: false } };

test('the export dialog offers one Manuscript when the project holds that name twice, and it is the first one', () => {
  const choices = recipeChoicesOf([manuscript, beta, { ...manuscript, format: 'md' }]);
  expect(choices.map((recipe) => recipe.name)).toEqual(['Manuscript', 'Beta read']);
  expect(choices[0]?.format).toBe('docx');
});

test('the export dialog keeps every distinct recipe, in the order the project holds them', () => {
  expect(recipeChoicesOf([beta, manuscript]).map((recipe) => recipe.name)).toEqual(['Beta read', 'Manuscript']);
  expect(recipeChoicesOf([])).toEqual([]);
});
