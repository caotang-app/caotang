/**
 * Errors the coherence engine throws. Each carries a stable `code` so a caller
 * can branch without parsing prose, and a message written for whoever reads it
 * next: the writer in the inbox, or the model in a tool result.
 */

export class CoherenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CoherenceError';
    this.code = code;
  }
}

/** coherence.md §7 tool 16: "No provider configured → error names settings". */
export class NoProviderError extends CoherenceError {
  constructor() {
    super(
      'no-provider',
      'No provider is configured. Name a provider profile in settings, then run coherence.review again.',
    );
    this.name = 'NoProviderError';
  }
}

/** coherence.md §7 tool 16: the LLM pipeline runs only after a plan is approved. */
export class ReviewNotApprovedError extends CoherenceError {
  constructor() {
    super('not-approved', 'coherence.review runs only after its plan card is approved.');
    this.name = 'ReviewNotApprovedError';
  }
}

export class ScopeError extends CoherenceError {
  constructor(message: string) {
    super('scope-invalid', message);
    this.name = 'ScopeError';
  }
}

/** A model reply that is not the JSON the stage's output contract asks for. */
export class MalformedReplyError extends CoherenceError {
  constructor(stage: string, detail: string) {
    super('malformed-reply', `${stage} reply is not usable: ${detail}`);
    this.name = 'MalformedReplyError';
  }
}
