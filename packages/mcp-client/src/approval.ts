/**
 * The approval card's data — [extensibility.md §4 rule 5](../../../docs/architecture/extensibility.md),
 * the approval-card content contract for external calls.
 *
 * The card is data, not markup, so the rule that matters can be tested: the description is the
 * server's text in full, the arguments are the whole JSON with nothing elided, the server's name
 * and trust state and risk badge are always present, and a call that is not `read-auto` says it
 * still needs a confirmation. Cursor's dialog hid the tool input, and that gap is what this file
 * exists to close (E4).
 */

import type { ExternalToolDescriptor } from './client.js';
import type { PinState } from './pins.js';
import type { EffectiveRisk } from './risk.js';

export interface ApprovalCard {
  readonly serverName: string;
  readonly serverKey: string;
  readonly trustState: 'trusted for reads' | 'not trusted for reads';
  readonly badge: 'read' | 'write';
  readonly risk: EffectiveRisk;
  readonly requiresConfirm: boolean;
  readonly qualifiedName: string;
  readonly toolName: string;
  readonly pinState: PinState;
  /** The server's own description, in full. Never truncated, and never summarised by Caotang. */
  readonly description: string;
  /** Every argument the model sent, pretty-printed. Never truncated. */
  readonly argumentsJson: string;
  /** Said on every card: the text came from an external server and was shown as received. */
  readonly notice: string;
}

export const APPROVAL_NOTICE = 'This text comes from an external server and is shown exactly as the server sent it.';

/** The card for one call: the tool's descriptor from the client, the arguments the model sent, and the server's trust grant. */
export function approvalCardFor(tool: ExternalToolDescriptor, args: Record<string, unknown>, trustReads: boolean): ApprovalCard {
  return {
    serverName: tool.serverName,
    serverKey: tool.serverKey,
    trustState: trustReads ? 'trusted for reads' : 'not trusted for reads',
    badge: tool.effectiveRisk === 'read-auto' ? 'read' : 'write',
    risk: tool.effectiveRisk,
    requiresConfirm: tool.effectiveRisk !== 'read-auto',
    qualifiedName: tool.qualifiedName,
    toolName: tool.toolName,
    pinState: tool.pinState,
    description: tool.description,
    argumentsJson: JSON.stringify(args, null, 2),
    notice: APPROVAL_NOTICE,
  };
}
