/**
 * The dialogue branch checks — [dialogue-narrative.md §5](../../../../docs/architecture/dialogue-narrative.md):
 * `branch.loose-end`, `branch.dead-end` and `dialogue.speaker-unknown`.
 *
 * The findings are computed by the dialogue module, which depends on this one, so the app runs that validation over
 * each container and passes the result in as {@link DialogueFacts}. This check takes its own id's findings from that
 * list and nothing else, so each id is one check in the registry and one row in the run report.
 */

import type { BranchCheckName } from '../model.js';

import type { CheckInput, CheckOutput } from './common.js';

/** The check for one branch id. Without dialogue facts it evaluates nothing, and the run says so (run.ts). */
export function checkBranch(id: BranchCheckName): (input: CheckInput) => CheckOutput {
  return (input) => {
    if (input.dialogue === undefined) return { drafts: [], notes: [] };
    return { drafts: input.dialogue.findings.filter((finding) => finding.checkId === id), notes: [] };
  };
}
