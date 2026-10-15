/**
 * Thinking/effort mapping — one place that turns a normalised `ThinkingLevel` into the
 * wire fields a route documents, per `EffortStyle`.
 *
 * The rule the whole file defends: **a level the model's capability row does not list
 * is never sent**. When `level` is absent or not in `caps.effortLevels` the body gets
 * nothing — the provider default stands. The UI only offers listed levels, so this
 * guard is the second line, not the first.
 *
 * `thinking: 'off'` means "turn thinking off", which some models cannot do. Where the
 * row lists 'off' the style's off-value is sent; where it does not, nothing is sent.
 */

import type { ModelCaps, ThinkingLevel } from '../types.js';
import type { EffortStyle } from './types.js';

/** `thinking_budget` per level, for the `enable_thinking+budget` style. */
const BUDGETS: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  low: 1_024,
  medium: 4_096,
  high: 16_384,
  max: 32_768,
};

/**
 * Writes the effort fields for `level` onto `body`, in the shape `style` documents.
 * Mutates `body`; a no-op when the level is not offered or the style is 'anthropic'
 * (the Messages adapter maps its own `thinking`/`output_config` pair).
 */
export function applyEffort(
  body: Record<string, unknown>,
  style: EffortStyle | string | undefined,
  level: ThinkingLevel | undefined,
  caps: ModelCaps,
): void {
  if (level === undefined || style === undefined || style === 'anthropic') return;
  const levels = caps.effortLevels;
  if (levels === undefined || levels.length === 0 || !levels.includes(level)) return;
  const on = level !== 'off';

  switch (style) {
    case 'reasoning_effort':
      body.reasoning_effort = level === 'max' ? 'high' : level === 'off' ? 'none' : level;
      break;
    case 'reasoning.effort':
      body.reasoning = { effort: level === 'max' ? 'high' : level === 'off' ? 'none' : level };
      break;
    case 'max_effort':
      // Qwen3.8-max's level scale already spans low..max; 'off' is omitted (not a value it takes).
      if (on) body.max_effort = level;
      break;
    case 'thinking.type':
      body.thinking = { type: on ? (levels.length <= 2 ? 'adaptive' : 'enabled') : 'disabled' };
      break;
    case 'thinking.type+effort':
      body.thinking = { type: on ? 'enabled' : 'disabled' };
      if (on) body.reasoning_effort = level === 'max' ? 'high' : level;
      break;
    case 'enable_thinking+budget':
      body.enable_thinking = on;
      if (on) body.thinking_budget = BUDGETS[level];
      break;
    case 'reasoning.enabled':
      body.reasoning = { enabled: on };
      break;
    default:
      break;
  }
}
