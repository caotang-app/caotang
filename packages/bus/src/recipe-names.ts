/**
 * The checks that a recipe name the caller names is one the project holds (exporter.md §2 and §4). They live in their own module because
 * two descriptor files need them: `recipe.delete` in `descriptors-project.ts`, and the two export commands in `descriptors.ts`,
 * which `descriptors-project.ts` itself imports from. A check both sides import cannot sit in either one without a cycle.
 */

import type { ValidationSnapshot } from './command.js';
import { notFoundError } from './params.js';
import type { CommandError } from './result.js';

/**
 * The name of the default recipe (exporter.md §4). A project that predates recipes has no `recipes` key, and it holds this one recipe,
 * as the exporter's `recipesOf` reads it. The store names its new projects' default with this same constant (create.ts imports it).
 */
export const DEFAULT_RECIPE_NAME = 'Manuscript';

/**
 * The refusal for a recipe name an export or `recipe.delete` names that the project does not hold, or `undefined` when it holds one.
 * The names held are the stored list, or the default when the manifest stores none: the same list the exporter offers. The default
 * a project holds without storing it is held here too, so `recipe.delete` of it is allowed: its apply stores the list first, then removes
 * the default from it (store commands-project.ts). An export that names a recipe is refused as not-found before anything is applied,
 * rather than failing part way through the compile. `target` names the param the caller read the name from.
 */
export function recipeNameMissing(snapshot: ValidationSnapshot, name: string, target = 'name'): CommandError | undefined {
  const stored = snapshot.manifest.recipes;
  const held = stored === undefined ? [DEFAULT_RECIPE_NAME] : stored.map((recipe) => recipe.name);
  if (held.includes(name)) return undefined;
  return notFoundError(`there is no saved recipe named "${name}"`, 'the recipes are listed in the export dialog', target);
}

