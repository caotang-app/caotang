/**
 * A playthrough helper for the tests: what a body prints on the paths it can take. Shared by the
 * draft tests, which assert that a drafted line plays (or that it does not), and by the line-id tests.
 */

import { Story } from 'inkjs';

import { compileInk } from '../src/index.js';

/**
 * Every line the body prints on any path that makes up to `depth` choices, trimmed. A playthrough
 * that always takes the first choice misses the branches a draft may sit on, so every choice index
 * is tried at every step.
 */
export function printedOnAnyPath(body: string, depth = 6): Set<string> {
  const compiled = compileInk(body);
  if (compiled.json === null) throw new Error(`the body does not compile: ${compiled.errors.map((e) => e.text).join('; ')}`);
  const json = compiled.json;
  const printed = new Set<string>();

  /** Plays one path: each pick is the choice taken after the text before it has printed. */
  const run = (picks: readonly number[]): { readonly lines: string[]; readonly options: number } => {
    const story = new Story(json);
    const lines: string[] = [];
    const drain = (): void => {
      while (story.canContinue) lines.push((story.Continue() ?? '').trim());
    };
    for (const pick of picks) {
      drain();
      story.ChooseChoiceIndex(pick);
    }
    drain();
    return { lines, options: story.currentChoices.length };
  };

  const explore = (picks: readonly number[]): void => {
    const { lines, options } = run(picks);
    for (const line of lines) if (line !== '') printed.add(line);
    if (picks.length >= depth) return;
    for (let i = 0; i < options; i += 1) explore([...picks, i]);
  };

  explore([]);
  return printed;
}
