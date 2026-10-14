/**
 * L7 — the task — [context-assembly.md §2](../../../../docs/architecture/context-assembly.md).
 *
 * The tool instruction verbatim, then the compact parameters. It is the payload, and it is
 * never truncated, so it is also the last thing the model reads before it answers.
 */

import { LAYER_NAMES } from '../types.js';
import type { AgentTask } from '../types.js';
import { stableStringify } from '../canonical.js';

export function taskText(task: AgentTask): string {
  const params = stableStringify(task.params ?? {});
  return [`# ${LAYER_NAMES.L7}`, task.instruction, `Tool: ${task.tool}\nParameters: ${params}`].join('\n\n');
}
