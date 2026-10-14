/**
 * Replays of a tool call — command-bus §6, one level up.
 *
 * **Why the harness keeps its own cache as well as the bus's.** The bus dedupes
 * the commands a call dispatches, and it checks its cache before it validates. But
 * a harness call validates its whole batch *before* the first command, and that
 * pre-check reads the state the first run left behind. A replayed `codex.write`
 * that creates "Elena" is therefore refused by the pre-check as a name collision
 * with the entry its own first run wrote. The bus never sees that refusal, because
 * the harness refuses first. So the replay is answered here, before anything is
 * re-checked.
 *
 * **The rule is the bus's, unchanged:** an outcome is recorded only once it has
 * reached an effect. A refusal that a re-run could answer differently (a gate
 * refusal that a confirmation would clear, a validation that a fixed param would
 * pass) is not recorded, so a corrected retry under the same callId still runs.
 *
 * A callId reused for a *different* call is refused, never merged: the second
 * caller's write would otherwise be silently dropped.
 */

export interface CallRecord<T> {
  readonly fingerprint: string;
  readonly outcome: T;
}

export interface CallCache<T> {
  /** The recorded outcome for this turn and callId, or undefined when the id is new. */
  lookup(turnId: string, callId: string): CallRecord<T> | undefined;
  /** Records an outcome that reached an effect. */
  record(turnId: string, callId: string, fingerprint: string, outcome: T): void;
  /** §6: cleared at turn end. */
  endTurn(turnId: string): void;
  size(turnId?: string): number;
}

export function createCallCache<T>(): CallCache<T> {
  const turns = new Map<string, Map<string, CallRecord<T>>>();

  return {
    lookup(turnId, callId) {
      return turns.get(turnId)?.get(callId);
    },
    record(turnId, callId, fingerprint, outcome) {
      let calls = turns.get(turnId);
      if (calls === undefined) {
        calls = new Map();
        turns.set(turnId, calls);
      }
      calls.set(callId, { fingerprint, outcome });
    },
    endTurn(turnId) {
      turns.delete(turnId);
    },
    size(turnId) {
      if (turnId !== undefined) return turns.get(turnId)?.size ?? 0;
      let total = 0;
      for (const calls of turns.values()) total += calls.size;
      return total;
    },
  };
}
