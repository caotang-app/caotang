/**
 * A plan edited in place, then approved (agent-harness §2): the edit to a step with no draft must leave the card approvable,
 * so the approval runs every step. Each scenario ends in `applied`, which the card could not reach while an edit left a
 * stale flag behind (the decision loop gives up after a run of unchanged decisions and stops the turn).
 */

import { describe, expect, it } from 'vitest';

import { evaluate, type Scenario } from '../../src/agent/eval.js';
import { FRIEND, LANDING, STORM, makeState } from '../fixtures.js';
import { mockGateway } from '../agent/gateway.js';
import { steps, transcript } from '../agent/scripts.js';

const scriptsFor = (intent: string, reply: string) => () => mockGateway([transcript(intent, [reply])]);

const scenarios: Scenario[] = [
  {
    name: 'plan edit: a label changed on a step with no draft is approved, and both steps run',
    category: 'plan-edit',
    intent: 'Label The Friend, then tag The Storm.',
    project: makeState,
    gateway: scriptsFor(
      'Label The Friend, then tag The Storm.',
      steps(
        { tool: 'meta.set', params: { targets: [FRIEND], label: 'act-2' }, expect: 'The Friend is labelled act-2' },
        { tool: 'meta.set', params: { targets: [STORM], keywords_add: ['storm'] }, expect: 'The Storm is tagged storm' },
      ),
    ),
    decisions: [{ action: 'edit', edits: [{ op: 'set', index: 0, path: ['params', 'label'], value: 'act-1' }] }, { action: 'approve' }],
    expect: {
      status: 'applied',
      cards: { matcher: 'strict', items: [{ kind: 'plan', tools: ['meta.set', 'meta.set'], decision: 'approved' }] },
      trace: {
        matcher: 'strict',
        calls: [
          { tool: 'meta.set', outcome: 'ok', params: { targets: [FRIEND], label: 'act-1' } },
          { tool: 'meta.set', outcome: 'ok', params: { targets: [STORM] } },
        ],
      },
      state: (state) => {
        const failures: string[] = [];
        if (state.manifest.tree.find((node) => node.id === FRIEND)?.label !== 'act-1') failures.push('The Friend was not labelled as the edit set');
        if (!state.manifest.tree.find((node) => node.id === STORM)?.keywords.includes('storm')) failures.push('The Storm was not tagged');
        return failures;
      },
    },
  },
  {
    name: 'plan edit: an expectation changed on the first step is approved, and both steps run',
    category: 'plan-edit',
    intent: 'Label The Friend and The Landing.',
    project: makeState,
    gateway: scriptsFor(
      'Label The Friend and The Landing.',
      steps(
        { tool: 'meta.set', params: { targets: [FRIEND], label: 'act-2' }, expect: 'The Friend is labelled' },
        { tool: 'meta.set', params: { targets: [LANDING], label: 'act-2' }, expect: 'The Landing is labelled' },
      ),
    ),
    decisions: [
      { action: 'edit', edits: [{ op: 'set', index: 0, path: ['expect'], value: 'The Friend is labelled act-2, as the writer asked' }] },
      { action: 'approve' },
    ],
    expect: {
      status: 'applied',
      cards: { matcher: 'strict', items: [{ kind: 'plan', tools: ['meta.set', 'meta.set'], decision: 'approved' }] },
      trace: {
        matcher: 'strict',
        calls: [
          { tool: 'meta.set', outcome: 'ok', params: { targets: [FRIEND] } },
          { tool: 'meta.set', outcome: 'ok', params: { targets: [LANDING] } },
        ],
      },
    },
  },
];

describe('an edited plan with no drafted step is approved and runs (agent-harness §2)', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const result = await evaluate(scenario);
      expect(result.failures).toEqual([]);
    });
  }
});
