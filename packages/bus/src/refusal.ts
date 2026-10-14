/**
 * The model-facing refusal constructor, [command-bus.md §7](../../../docs/architecture/command-bus.md).
 *
 * A refusal is the bus's `CommandError`, so a plan card, an eval and the model all read one shape. It lives in the
 * bus, the leaf every tool package depends on, so a media module can refuse in the registry's own shape without
 * importing the harness, which imports the module. `@caotang/harness` re-exports it, so its callers are unchanged.
 *
 * Every constructor here takes a `correctiveHint`, and a refusal without one is a spec violation (§7: never a bare code).
 */

import type { CommandError, CommandErrorCode, CommandErrorDetails } from './result.js';

export interface RefusalOptions {
  readonly correctiveHint?: string;
  readonly target?: string;
  readonly details?: CommandErrorDetails;
  readonly risk?: CommandError['risk'];
}

export function refusal(code: CommandErrorCode, message: string, options: RefusalOptions = {}): CommandError {
  return {
    code,
    message,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.correctiveHint === undefined ? {} : { correctiveHint: options.correctiveHint }),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.risk === undefined ? {} : { risk: options.risk }),
  };
}
