/**
 * Two loop behaviours the audit found unmet: the writer-facing summary of an applied turn names what was written and
 * never the undo group's id (agent-harness §5), and scene.draft sends a later scene's synopsis only when the step asks
 * for the forward outline (context-assembly §4). Each test drives the real session on the real bus.
 */

import { describe, expect, it } from 'vitest';

import { addDocument, type ProjectState } from '@caotang/store';
import type { ChatRequest } from '@caotang/gateway';
import { userTextOf, type MockScript } from '@caotang/gateway/mock';

import { createAgentPorts, createAgentSession, createContextPort, createHarness } from '../../src/index.js';
import { CHAPTER_TWO, FRIEND, OPENED, STORM, makeState } from '../fixtures.js';
import { mockGateway } from './gateway.js';
import { steps, transcript } from './scripts.js';

describe('the summary of a finished turn is written for the writer (agent-harness §5)', () => {
  it('an applied turn says what it wrote, and the summary carries no undo-group id', async () => {
    const harness = createHarness({ state: makeState(), ports: createAgentPorts() });
    const gateway = await mockGateway([
      transcript('Label The Friend act-2.', [
        steps({ tool: 'meta.set', params: { targets: [FRIEND], label: 'act-2' }, expect: 'The Friend is labelled act-2' }),
      ]),
    ]);
    const session = createAgentSession({
      harness,
      gateway,
      context: createContextPort({ state: harness.state }),
      decide: async () => ({ action: 'approve' }),
    });
    const report = await session.submit('Label The Friend act-2.');

    expect(report.status).toBe('applied');
    expect(report.undoGroupId).toBeDefined();
    expect(report.summary.startsWith('Applied: ')).toBe(true);
    expect(report.summary).not.toContain(report.undoGroupId ?? '');
    expect(report.summary).not.toContain('Undo group');
    expect(report.summary).not.toContain('..');
  });
});

/** The Storm, then a later scene in Chapter 2 whose synopsis only the forward outline can carry into a draft. */
function withLaterScene(): ProjectState {
  const state = makeState();
  addDocument(state, {
    parentId: CHAPTER_TWO,
    title: 'The Breakwater',
    body: 'The ferry docks.',
    synopsis: 'The storm breaks over the breakwater.',
    now: OPENED,
  });
  return state;
}

const BRIEF = 'Carry the storm into the breakwater.';

/** Runs one scene.draft step with the given flag (or none), and returns the text of each drafting request the model was sent. */
async function draftWith(flag: boolean | undefined): Promise<{ readonly status: string; readonly sent: readonly string[] }> {
  const harness = createHarness({ state: withLaterScene(), ports: createAgentPorts() });
  const seen: ChatRequest[] = [];
  const draft: MockScript = {
    match: (req) => req.responseFormat === 'text' && userTextOf(req).includes(`Brief: ${BRIEF}`),
    respond: (req) => {
      // The mock asks `match` and `respond` for the same request, so a request is recorded once.
      if (seen[seen.length - 1] !== req) seen.push(req);
      return { content: 'The lamp burned on through the rain.' };
    },
  };
  const params: Record<string, unknown> = { doc: STORM, instruction: BRIEF, mode: 'continue' };
  if (flag !== undefined) params['include_forward_outline'] = flag;
  const gateway = await mockGateway([
    transcript('Continue The Storm.', [steps({ tool: 'scene.draft', params, expect: 'The Storm continues' })]),
    draft,
  ]);
  const session = createAgentSession({
    harness,
    gateway,
    context: createContextPort({ state: harness.state }),
    decide: async () => ({ action: 'approve' }),
  });
  const report = await session.submit('Continue The Storm.');
  return { status: report.status, sent: seen.map((req) => userTextOf(req)) };
}

describe('the forward outline is an opt-in on scene.draft (context-assembly §4)', () => {
  it('a later scene’s synopsis is withheld from the drafting call when the step does not ask for it', async () => {
    const run = await draftWith(undefined);
    expect(run.status).toBe('applied');
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).not.toContain('The storm breaks over the breakwater.');
  });

  it('the same later scene’s synopsis reaches the drafting call when the step sets include_forward_outline', async () => {
    const run = await draftWith(true);
    expect(run.status).toBe('applied');
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).toContain('The storm breaks over the breakwater.');
  });
});
