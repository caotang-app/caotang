/**
 * The shared ask-back envelope (agent-harness §2): one type with four codes, each produced from the
 * error it describes, with the drift and the candidates carried through when the error has them.
 */

import { describe, expect, it } from 'vitest';

import { askBackFor, type AskBackCode } from '../../src/index.js';

describe('askBackFor: one envelope, four codes', () => {
  it('maps a revision conflict to conflict, carrying the drift', () => {
    const askBack = askBackFor({ code: 'revision-conflict', message: 'moved', details: { expectedRevision: 1, actualRevision: 4 } });
    expect(askBack.code).toBe('conflict');
    expect(askBack.revisionDrift).toBe(3);
    expect(askBack.options.length).toBeGreaterThanOrEqual(2);
  });

  it('maps a failed postcondition, and an internal refusal, to verify_failed', () => {
    expect(askBackFor({ code: 'postcondition', message: 'mismatch' }).code).toBe('verify_failed');
    expect(askBackFor({ code: 'internal', message: 'threw' }).code).toBe('verify_failed');
  });

  it('maps an anchor the port could not place to anchor_unresolvable, with its candidates and drift', () => {
    const askBack = askBackFor({
      code: 'invalid-params',
      message: 'the selection moved',
      details: { askBackCode: 'anchor_unresolvable', candidates: [{ from: 10, to: 15, similarity: 0.91 }], revisionDrift: 2 },
    });
    expect(askBack.code).toBe('anchor_unresolvable');
    expect(askBack.candidates).toEqual([{ from: 10, to: 15, similarity: 0.91 }]);
    expect(askBack.revisionDrift).toBe(2);
  });

  it('maps everything else to needs_input, which is what the verify ladder may adjust', () => {
    expect(askBackFor({ code: 'invalid-params', message: 'mode is wrong' }).code).toBe('needs_input');
    expect(askBackFor({ code: 'not-found', message: 'no such document' }).code).toBe('needs_input');
  });

  it('has exactly the four codes of agent-harness §2', () => {
    const codes: AskBackCode[] = ['verify_failed', 'anchor_unresolvable', 'needs_input', 'conflict'];
    expect(new Set(codes).size).toBe(4);
  });
});
