/**
 * The effective risk of one external tool — [extensibility.md §7 "Inward"](../../../docs/architecture/extensibility.md)
 * and §4 rule 2, with the pin and review states of §3.4 folded in.
 *
 * The rule is deliberately narrow. A tool is `read-auto` only when every condition holds: its
 * pin is verified, the server has no pending review, the person has granted "trusted for reads",
 * and the server itself declares `readOnlyHint: true`. Every other case is `write-confirm`.
 * `write-auto` is not a value this module can return, so an external call is never automatic
 * for a write, whatever the server claims (§4 rule 2: "NEVER `write-auto`").
 */

export type EffectiveRisk = 'write-confirm' | 'read-auto';

export interface RiskInputs {
  /** The tool's current listing matches its reviewed pin (§3.4). */
  readonly pinVerified: boolean;
  /** The server's last listing changed and has not been reviewed (§3.4 step 2c). Every tool is then confirm-only. */
  readonly pendingReview: boolean;
  /** The per-server "trusted for reads" grant (§3.1). */
  readonly trustReads: boolean;
  /** The server's self-declared hint. Attacker-controlled text: it informs the decision and nothing else (§7). */
  readonly readOnlyHint?: boolean;
}

export function effectiveRiskOf(inputs: RiskInputs): EffectiveRisk {
  if (!inputs.pinVerified || inputs.pendingReview || !inputs.trustReads) return 'write-confirm';
  return inputs.readOnlyHint === true ? 'read-auto' : 'write-confirm';
}

/** The bus's agent-risk vocabulary for a call: a read is automatic, and a confirm is a confirm card (command-bus §4). */
export function agentRiskOf(risk: EffectiveRisk): 'read' | 'write-confirm' {
  return risk === 'read-auto' ? 'read' : 'write-confirm';
}
