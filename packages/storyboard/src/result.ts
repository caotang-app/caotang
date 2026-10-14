/**
 * Results and refusals for the storyboard engine.
 *
 * A refusal is written for the caller that reads it next. It names what was wrong and the
 * corrective step, because a bare error sends a model looking for a way round (the same
 * posture coherence's tools take). `askBack` marks the two refusals that are a question for
 * the writer rather than a retry: agent-harness §2's `needs_input` and `conflict`.
 */

export interface StoryboardRefusal {
  /** A stable identifier for the refusal, for tests and for the activity log. */
  readonly code: string;
  readonly message: string;
  readonly askBack?: 'needs_input' | 'conflict';
}

export type StoryboardResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: StoryboardRefusal };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function refuse(
  code: string,
  message: string,
  askBack?: StoryboardRefusal['askBack'],
): { readonly ok: false; readonly refusal: StoryboardRefusal } {
  return askBack === undefined
    ? { ok: false, refusal: { code, message } }
    : { ok: false, refusal: { code, message, askBack } };
}

/** Code points, not UTF-16 units: the unit `ACTION_MAX_CHARS` is written in. */
export function codePointCount(text: string): number {
  return [...text].length;
}
