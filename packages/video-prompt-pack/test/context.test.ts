/**
 * The shot-scoped context (video-prompt-pack.md §7, context-assembly.md §2–§3): the four layers, their
 * budgets, their prune order, and the explicit marker when covered script has to be cut.
 */
import { describe, expect, it } from 'vitest';

import {
  SHOT_CONTEXT_BUDGET,
  assembleShotContext,
  promptLine,
  shotNumbers,
  storyboardRank,
  type ContextInput,
  type ShotContext,
  type ShotNode,
  type StoryboardSnapshot,
  type VideoReference,
  type VideoShotRef,
} from '../src/index.js';

import { FERRY, HARBOUR, SHOTS, codexEntry, refFor, storyboard } from './fixtures.js';

const NO_PROMPTS = (): VideoShotRef | undefined => undefined;

function contextFor(
  shotId: string,
  options: { storyboard?: StoryboardSnapshot; promptOf?: (id: string) => VideoShotRef | undefined; override?: VideoReference[]; shot?: ShotNode } = {},
): ShotContext {
  const board = options.storyboard ?? storyboard();
  const shot = options.shot ?? board.shots.find((candidate) => candidate.id === shotId);
  if (shot === undefined) throw new Error(`no shot ${shotId}`);
  const input: ContextInput = {
    shot,
    storyboard: board,
    vendor: 'runway-gen4',
    shotNumbers: shotNumbers(board),
    storyboardRank: storyboardRank(board),
    promptOf: options.promptOf ?? NO_PROMPTS,
    ...(options.override === undefined ? {} : { override: options.override }),
  };
  return assembleShotContext(input);
}

describe('L2, the codex layer: the entries the shot’s references come from (§7, §3)', () => {
  it('holds the entries the shot names that have a visual reference, in codex order, with their descriptions', () => {
    const context = contextFor('s1');
    expect(context.codex).toBe(['## Elena (character)', 'A cartographer who maps the harbour. Dark red coat.', '', '## Ferry (object)', 'The ferry Maren.'].join('\n'));
    expect(context.codexEntryIds).toEqual(['c_elena', 'c_ferry']);
  });

  it('leaves out an always entry with no visual reference, since it supplies no reference', () => {
    expect(contextFor('s1').codex).not.toContain('Style guide');
  });

  it('leaves out an attached entry the shot does not name, since no reference comes from it', () => {
    // Ferry is attached to this shot's folder, but "Fog over the water." does not name it.
    const context = contextFor('s3');
    expect(context.codex).toBe('');
    expect(context.codexEntryIds).toEqual([]);
  });

  it('leaves out a mentioned entry that has no visual reference, since it has nothing to send', () => {
    const bare = codexEntry('Harbour', { ...HARBOUR, visualRefs: undefined });
    const codex = storyboard().codex.map((entry) => (entry.id === HARBOUR.id ? bare : entry));
    const context = contextFor('s2', { storyboard: storyboard({ codex }) });
    expect(context.codexEntryIds).toEqual([]);
  });

  it('never sends a `never` entry, even when the shot names it', () => {
    const context = contextFor('s4');
    expect(context.codex).toContain('## Harbour (location)');
    expect(context.codex).not.toContain('Wolf');
    expect(context.codex).not.toContain('Spoiler');
  });

  it('drops an entry with an empty description, even when it is always included', () => {
    expect(contextFor('s1').codex).not.toContain('Lantern');
  });

  it('drops a mentioned entry whose description is empty, even when it has a visual reference', () => {
    const blank = { ...FERRY, description: '   ' };
    const codex = storyboard().codex.map((entry) => (entry.id === FERRY.id ? blank : entry));
    const context = contextFor('s1', { storyboard: storyboard({ codex }) });
    expect(context.codexEntryIds).toEqual(['c_elena']);
    expect(context.codex).not.toContain('Ferry');
  });

  it('includes the entry the override names, even when the text does not mention it', () => {
    const context = contextFor('s3', { override: [{ type: 'character', entryId: 'c_elena' }] });
    expect(context.codex).toContain('## Elena (character)');
    expect(context.codexEntryIds).toEqual(['c_elena']);
  });

  it('leaves out an entry the override names when the codex rules withhold it, so L2 and the references agree', () => {
    const context = contextFor('s3', { override: [{ type: 'character', entryId: 'c_wolf' }] });
    expect(context.codex).toBe('');
    expect(context.codexEntryIds).toEqual([]);
  });

  it('prunes whole entries by rank when the budget runs out: always first, then mentioned, never mid-body', () => {
    const alpha = codexEntry('Alpha', { includePolicy: 'always', description: 'a'.repeat(1500), visualRefs: ['a_elena'] });
    const beta = codexEntry('Beta', { includePolicy: 'detected', description: 'b'.repeat(1500), visualRefs: ['a_elena'] });
    const gamma = codexEntry('Gamma', { includePolicy: 'detected', description: 'g'.repeat(1500), visualRefs: ['a_elena'] });
    const board = storyboard({
      shots: [{ ...SHOTS[0], action: 'Alpha, Beta and Gamma wait on the quay.' } as ShotNode, ...SHOTS.slice(1)],
      codex: [alpha, beta, gamma],
    });
    const context = contextFor('s1', { storyboard: board });
    const layer = context.layers.find((candidate) => candidate.layer === 'L2');
    expect(layer?.included).toEqual(['Alpha', 'Beta']);
    expect(layer?.pruned).toEqual(['Gamma']);
    expect(context.codex).not.toContain('g'.repeat(20));
    expect(layer?.tokens).toBeLessThanOrEqual(SHOT_CONTEXT_BUDGET.codex);
  });
});

describe('L3, the folder chain', () => {
  it('renders the ancestors root first, each with its synopsis', () => {
    expect(contextFor('s1').folders).toBe('- Act 1: The harbour town wakes to fog.\n- Scene 1 — Shots: Shots for the quay.');
  });

  it('names the folders in the preview, root first', () => {
    const layer = contextFor('s1').layers.find((candidate) => candidate.layer === 'L3');
    expect(layer?.included).toEqual(['Act 1', 'Scene 1 — Shots']);
    expect(layer?.pruned).toEqual([]);
  });
});

describe('L4, the story so far: prior shots’ prompts, for this vendor', () => {
  const PROMPT = refFor('runway-gen4').prompt;

  it('gives one line per earlier shot that has a prompt, named by its folder and its number', () => {
    const context = contextFor('s2', {
      promptOf: (id) => (id === 's1' ? refFor('runway-gen4', { prompt: PROMPT }) : undefined),
    });
    expect(context.priorShots).toBe('Scene 1 — Shots, shot 1: Slow dolly-in; Elena walks down the quay; Film grain.');
  });

  it('renders earlier shots in storyboard order, and keeps out a shot that has no prompt yet', () => {
    const context = contextFor('s4', {
      promptOf: (id) => (id === 's2' ? undefined : refFor('runway-gen4', { prompt: PROMPT })),
    });
    const lines = context.priorShots.split('\n');
    expect(lines).toEqual([
      'Scene 1 — Shots, shot 1: Slow dolly-in; Elena walks down the quay; Film grain.',
      'Scene 1 — Shots, shot 3: Slow dolly-in; Elena walks down the quay; Film grain.',
    ]);
  });

  it('gives nothing for the first shot of the storyboard', () => {
    expect(contextFor('s1', { promptOf: () => refFor('runway-gen4') }).priorShots).toBe('');
  });

  it('builds the one-line prompt from camera, subject and action, then style', () => {
    expect(promptLine({ camera: 'Pan', subject: 'Ferry', action: 'docks', style: 'Grain' })).toBe('Pan; Ferry docks; Grain');
  });
});

describe('L5, the focus: covered script, action and caption', () => {
  it('renders the covered script with its label, then the action and the caption, whole', () => {
    expect(contextFor('s1').focus).toBe(
      [
        'Covered script:',
        '[Scene 1, cue ELENA]',
        'ELENA: "We leave at dawn."',
        '',
        'Shot action: Elena walks down the quay toward the ferry.',
        'Image caption: Elena on the quay, fog behind her.',
      ].join('\n'),
    );
  });

  it('cuts covered script that does not fit, marks the cut, and keeps the action whole', () => {
    const huge = { id: 's1', action: 'Elena stops.', covered: [{ label: 'Long cue', text: 'z'.repeat(30000) }], durationSec: 5 } as ShotNode;
    const context = contextFor('s1', { shot: huge });
    const layer = context.layers.find((candidate) => candidate.layer === 'L5');
    expect(layer?.truncated).toBe(true);
    expect(context.focus).toContain('cut to fit the budget');
    expect(context.focus).toContain('Shot action: Elena stops.');
    expect(layer?.tokens).toBeLessThanOrEqual(SHOT_CONTEXT_BUDGET.focus);
  });

  it('reports a clean layer as not truncated', () => {
    expect(contextFor('s1').layers.find((candidate) => candidate.layer === 'L5')?.truncated).toBe(false);
  });
});

describe('the budgets hold for the fixture, and the assembly is a pure function', () => {
  it('keeps every layer inside its budget', () => {
    const context = contextFor('s1', { promptOf: () => refFor('runway-gen4') });
    for (const layer of context.layers) {
      expect(layer.tokens, layer.name).toBeLessThanOrEqual(layer.budget);
    }
  });

  it('gives the same bytes on every call with the same storyboard', () => {
    expect(contextFor('s1')).toEqual(contextFor('s1'));
  });
});
