/**
 * The codex scenario set — codex.md §9, the five scenarios the harness suite names, run through the
 * real context assembly (`@caotang/codex`'s detection and policies, assembled and budgeted by
 * `@caotang/context`) and the real loop. The assertions are on what the model was sent, what was dropped
 * and why, and what the project holds afterwards. The planner is a `meta` call, which carries no codex
 * (context-assembly §3), so the scenarios that concern codex in a prompt assert on the drafting call.
 */

import { describe, expect, it } from 'vitest';

import type { CodexEntry, ProjectState } from '@caotang/store';

import { evaluate, runScenario, type Scenario } from '../../src/agent/eval.js';
import { FRIEND, makeState } from '../fixtures.js';
import { mockGateway } from '../agent/gateway.js';
import { prose, steps, transcript } from '../agent/scripts.js';
import { DRAFT_PREFIX } from '@caotang/gateway/mock';
import type { MockScript } from '@caotang/gateway/mock';

function entry(partial: Partial<CodexEntry> & Pick<CodexEntry, 'id' | 'name' | 'type' | 'description'>): CodexEntry {
  return {
    aliases: [],
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    ...partial,
  } as CodexEntry;
}

/** The fixture project, with more codex entries added to it. */
function withCodex(...entries: CodexEntry[]): () => ProjectState {
  return () => {
    const state = makeState();
    for (const item of entries) state.manifest.codex?.push(item);
    return state;
  };
}

const FERRYMAN = entry({ id: 'c_FERRYMN001', name: 'Ferryman', type: 'character', description: 'The ferryman keeps a secret he has not told Elena.', includePolicy: 'never' });
const STYLE = entry({ id: 'c_STYLEGD001', name: 'Style guide', type: 'lore', description: 'Plain sentences, no adverbs, and the weather is never decoration.', includePolicy: 'always' });

const scripts = (...extra: MockScript[]) => () => mockGateway(extra);

const codexScenarios: Scenario[] = [
  {
    name: 'codex 1: a mention pulls the entry into the scene draft’s context',
    category: 'codex',
    intent: 'Draft the storm with Elena in it.',
    project: makeState,
    gateway: scripts(
      transcript('Draft the storm with Elena in it.', [
        steps({ tool: 'scene.draft', params: { doc: 'The Storm', instruction: 'Elena watches the lamp fail.', mode: 'continue' }, expect: 'The Storm continues' }),
      ]),
      prose('Brief: Elena watches the lamp fail.', 'She watches it go.'),
    ),
    expect: {
      status: 'applied',
      requests: [{ system: DRAFT_PREFIX, includes: ['Brief: Elena watches the lamp fail.', '## Elena (character)', 'The keeper.'] }],
      cards: { matcher: 'strict', items: [{ kind: 'confirm', tools: ['scene.draft'], decision: 'approved' }] },
    },
  },
  {
    name: 'codex 2: a `never` entry is excluded from the draft even when the brief mentions it',
    category: 'codex',
    intent: 'Draft the meeting at the wreck.',
    project: withCodex(FERRYMAN),
    gateway: scripts(
      transcript('Draft the meeting at the wreck.', [
        steps({ tool: 'scene.draft', params: { doc: 'The Storm', instruction: 'Elena meets the Ferryman at the wreck.', mode: 'continue' }, expect: 'The Storm continues' }),
      ]),
      prose('Brief: Elena meets the Ferryman', 'They talk in the rain.'),
    ),
    expect: {
      status: 'applied',
      requests: [{ system: DRAFT_PREFIX, includes: ['## Elena (character)'], excludes: ['## Ferryman'] }],
      dropped: ['Ferryman: disabled by include policy (never)'],
    },
  },
  {
    // The planner is a `meta` call (context-assembly §3), which carries no codex layer. `always` belongs to every
    // generation call (codex.md §2), so the entry is asserted on the drafting call the planner starts.
    name: 'codex 3: an `always` entry is present in a generation call without any mention',
    category: 'codex',
    intent: 'Draft a line for The Friend.',
    project: withCodex(STYLE),
    gateway: scripts(
      transcript('Draft a line for The Friend.', [
        steps({ tool: 'scene.draft', params: { doc: 'The Friend', instruction: 'The friend says nothing.', mode: 'continue' }, expect: 'The Friend continues' }),
      ]),
      prose('Brief: The friend says nothing.', 'He waits.'),
    ),
    expect: {
      status: 'applied',
      requests: [{ system: DRAFT_PREFIX, includes: ['## Style guide (lore)', 'Plain sentences, no adverbs'] }],
      cards: { matcher: 'strict', items: [{ kind: 'confirm', tools: ['scene.draft'], decision: 'approved' }] },
    },
  },
  {
    name: 'codex 5: a codex batch that fails validation is refused on its card before anything runs',
    category: 'codex',
    intent: 'Add a second Elena and move The Friend to Act 2.',
    project: makeState,
    gateway: scripts(
      transcript('Add a second Elena and move The Friend to Act 2.', [
        steps(
          // The name collides with the existing "Elena" entry, which the batch validation refuses before anything runs.
          { tool: 'codex.write', params: { entries: [{ action: 'create', name: 'Elena', type: 'character', description: 'A second Elena.' }] }, expect: 'a second Elena exists' },
          { tool: 'meta.set', params: { targets: [FRIEND], label: 'act-2' }, expect: 'The Friend is labelled act-2' },
        ),
      ]),
    ),
    decisions: [{ action: 'cancel' }],
    expect: {
      status: 'cancelled',
      cards: { matcher: 'strict', items: [{ kind: 'plan', tools: ['codex.write', 'meta.set'], decision: 'cancelled' }] },
      trace: { matcher: 'strict', calls: [] },
      state: (state) => (state.manifest.codex?.length === 2 ? [] : ['a codex entry was written although its batch was refused']),
    },
  },
];

describe('the codex scenario set (codex.md §9)', () => {
  for (const scenario of codexScenarios) {
    it(scenario.name, async () => {
      const result = await evaluate(scenario);
      expect(result.failures).toEqual([]);
    });
  }

  it('codex 4: budget pruning is deterministic — the same entries and the same tiny budget give the same drop list, and `always` entries survive', async () => {
    const long = (name: string, id: string) =>
      entry({ id, name, type: 'character', description: `${name} is described at length here. `.repeat(12) });
    const scenario: Scenario = {
      name: 'codex 4: budget prune determinism',
      category: 'codex',
      intent: 'Compare Elena, Kestrel and Ferryman.',
      project: withCodex(long('Ferryman', 'c_FERRYLG001'), long('Lantern', 'c_LANTERN001'), STYLE),
      // A drafting call, not the planner: the planner's `meta` call carries no codex (context-assembly §3). The brief
      // names the three detected entries, so all three are candidates and the budget decides what stays.
      gateway: scripts(
        transcript('Compare Elena, Kestrel and Ferryman.', [
          steps({ tool: 'scene.draft', params: { doc: 'The Storm', instruction: 'Elena, Kestrel and Ferryman watch the lamp.', mode: 'continue' }, expect: 'The Storm continues' }),
        ]),
        prose('Brief: Elena, Kestrel and Ferryman watch the lamp.', 'They watch it.'),
      ),
      contextOptions: { config: { layerBudgets: { L2: 120 } } },
      // The detected entries are pruned against the 120-token codex budget, and the `always` entry is never pruned.
      // Elena's block is small enough to stay, Ferryman's is not.
      expect: {
        status: 'applied',
        requests: [
          {
            system: DRAFT_PREFIX,
            includes: ['## Style guide (lore)', '## Elena (character)'],
            excludes: ['## Ferryman (character)'],
          },
        ],
        dropped: ['Ferryman: dropped budget (L2, 120 tokens'],
      },
    };
    const first = await runScenario(scenario);
    const second = await runScenario(scenario);
    expect(first.report.dropped).toEqual(second.report.dropped);
    const result = await evaluate(scenario);
    expect(result.failures).toEqual([]);
    expect(first.report.dropped.some((reason) => reason.includes('Style guide'))).toBe(false);
  });

  it('codex 5, the card: the refused batch is shown with its refusal, and it cannot be approved', async () => {
    // A holder rather than a bare `let`, so the type of what the decider records is not narrowed away at the assertions.
    const seen: { card?: { approvable: boolean; refused: string[] } } = {};
    const scenario: Scenario = {
      name: 'codex 5 card inspection',
      category: 'codex',
      intent: 'Add a second Elena and move The Friend to Act 2.',
      project: makeState,
      gateway: scripts(
        transcript('Add a second Elena and move The Friend to Act 2.', [
          steps(
            { tool: 'codex.write', params: { entries: [{ action: 'create', name: 'Elena', type: 'character', description: 'A second Elena.' }] }, expect: 'a second Elena exists' },
            { tool: 'meta.set', params: { targets: [FRIEND], label: 'act-2' }, expect: 'The Friend is labelled act-2' },
          ),
        ]),
      ),
      decisions: [
        (pending) => {
          seen.card = {
            approvable: pending.card.approvable,
            refused: pending.card.steps.filter((step) => step.status === 'refused').map((step) => step.error?.message ?? ''),
          };
          return { action: 'approve' };
        },
        { action: 'cancel' },
      ],
      expect: { status: 'cancelled' },
    };
    const run = await runScenario(scenario);
    expect(run.report.status).toBe('cancelled');
    expect(seen.card?.approvable).toBe(false);
    expect(seen.card?.refused.length).toBe(1);
    expect(seen.card?.refused[0]).toContain('Elena');
    expect(run.report.trace).toEqual([]);
  });
});
