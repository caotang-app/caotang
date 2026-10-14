/**
 * Errors the prompt pack throws. Each carries a stable `code`, so a caller branches
 * without parsing prose, and a message written for whoever reads it next: the writer
 * in the plan card, or the model in a tool result.
 */

export class PromptPackError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PromptPackError';
    this.code = code;
  }
}

/** A model reply that is not the JSON the stage's output contract asks for. */
export class MalformedReplyError extends PromptPackError {
  constructor(stage: string, detail: string) {
    super('reply-malformed', `${stage} reply is not usable: ${detail}`);
    this.name = 'MalformedReplyError';
  }
}

/** The draft and variant tools call a model, and the app has not configured one. */
export class NoModelError extends PromptPackError {
  constructor(tool: string) {
    super('no-model', `No provider is configured, so ${tool} cannot run. Name a provider profile in settings, then run ${tool} again.`);
    this.name = 'NoModelError';
  }
}
