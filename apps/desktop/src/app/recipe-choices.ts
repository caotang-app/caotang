/**
 * The recipes the export dialog offers, one per name (exporter.md §2, §4).
 *
 * A project can hold one name twice: a project made before recipes holds the default one, and a list saved beside it can name it again.
 * The dialog keys its options by name, so two options with one key are a React warning and two choices the writer cannot tell apart. The
 * first recipe of each name is the one offered, which is the one the exporter finds first when a compile names it.
 */

import type { ExportRecipe } from '@caotang/exporter';

/** The recipes with a repeated name dropped after its first, in the order the project holds them. */
export function recipeChoicesOf(recipes: readonly ExportRecipe[]): ExportRecipe[] {
  const seen = new Set<string>();
  const choices: ExportRecipe[] = [];
  for (const recipe of recipes) {
    if (seen.has(recipe.name)) continue;
    seen.add(recipe.name);
    choices.push(recipe);
  }
  return choices;
}
