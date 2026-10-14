/**
 * `prompt.variant`: three alternatives for one axis, read-only; a pick must be one of them, and it lands
 * through the same commit as a draft.
 */
import { describe, expect, it } from 'vitest';

import {
  PromptPackError,
  applyVariation,
  commitPromptDraft,
  fieldOf,
  stagePromptVariant,
  variantPickProposal,
  type ShotNode,
  type StoryboardSnapshot,
} from '../src/index.js';

import { SHOTS, fakeModel, refFor, storyboard, withRef } from './fixtures.js';

const PROMPT = { camera: 'Slow dolly-in', subject: 'Elena', action: 'walks down the quay', context: 'Harbour at dusk', style: 'Film grain' };

function withPrompt(board: StoryboardSnapshot = storyboard()): StoryboardSnapshot {
  return { ...board, shots: [withRef(SHOTS[0] as ShotNode, refFor('runway-gen4', { prompt: PROMPT, durationSec: 5 })), ...SHOTS.slice(1)] };
}

const ALTERNATIVES = JSON.stringify({ alternatives: ['Wide orbit', 'Handheld drift', 'Static frame'] });

describe('stagePromptVariant offers three alternatives and writes nothing', () => {
  it('returns three values for the axis, with the current value and the field it would set', async () => {
    const board = withPrompt();
    const model = fakeModel(() => ALTERNATIVES);
    const proposal = await stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, board, model);
    expect(proposal).toMatchObject({ shotId: 's1', shotNumber: 1, variation: 'camera', field: 'prompt.camera', current: 'Slow dolly-in' });
    expect(proposal.alternatives.map((alternative) => alternative.value)).toEqual(['Wide orbit', 'Handheld drift', 'Static frame']);
    expect(model.calls[0]?.system).toContain('Keep the subject and the action as they are');
  });

  it('gives each alternative the validation rows it would raise on the shot', async () => {
    const long = 'x'.repeat(600);
    const proposal = await stagePromptVariant(
      { shot: 's1', vendor: 'runway-gen4', variation: 'style' },
      withPrompt(),
      fakeModel(() => JSON.stringify({ alternatives: [long, 'Grey light', 'Warm light'] })),
    );
    expect(proposal.alternatives[0]?.issues.some((issue) => issue.code === 'over-cap')).toBe(true);
    expect(proposal.alternatives[1]?.issues).toEqual([]);
  });

  it('leaves the storyboard as it was', async () => {
    const board = withPrompt();
    const before = JSON.stringify(board.shots);
    await stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, board, fakeModel(() => ALTERNATIVES));
    expect(JSON.stringify(board.shots)).toBe(before);
  });

  it('refuses a shot that has no prompt for the vendor, and says to draft first, with no call made', async () => {
    const model = fakeModel(() => ALTERNATIVES);
    await expect(stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, storyboard(), model)).rejects.toMatchObject({
      code: 'no-prompt',
      message: expect.stringContaining('prompt.draft'),
    });
    expect(model.calls).toHaveLength(0);
  });

  it('refuses a reply without three usable alternatives', async () => {
    await expect(
      stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, withPrompt(), fakeModel(() => JSON.stringify({ alternatives: ['one', 'two'] }))),
    ).rejects.toMatchObject({ code: 'reply-malformed' });
  });

  it('refuses an unknown shot', async () => {
    await expect(stagePromptVariant({ shot: 'nope', vendor: 'runway-gen4', variation: 'camera' }, storyboard(), fakeModel(() => ALTERNATIVES))).rejects.toBeInstanceOf(
      PromptPackError,
    );
  });
});

describe('the axes and the pick', () => {
  it('maps each axis to its field in the normalized schema', () => {
    expect(fieldOf('camera')).toBe('prompt.camera');
    expect(fieldOf('lighting')).toBe('prompt.style');
    expect(fieldOf('style')).toBe('prompt.style');
    expect(fieldOf('audio')).toBe('audio.ambient');
  });

  it('sets only the axis’s field when it applies an alternative', () => {
    const ref = refFor('runway-gen4', { prompt: PROMPT, durationSec: 5 });
    expect(applyVariation(ref, 'lighting', 'Low amber light').prompt).toEqual({ ...PROMPT, style: 'Low amber light' });
    expect(applyVariation(ref, 'audio', 'Foghorn').audio).toEqual({ ambient: 'Foghorn' });
    expect(applyVariation(ref, 'camera', 'Handheld drift').prompt.camera).toBe('Handheld drift');
  });

  it('lands a pick through the same commit as a draft, once the writer has picked one of the three', async () => {
    const board = withPrompt();
    const proposal = await stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, board, fakeModel(() => ALTERNATIVES));
    const picked = variantPickProposal(proposal, 'Handheld drift', board);
    const outcome = commitPromptDraft(picked, board);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.writes[0]?.vendorRefs[0]?.prompt.camera).toBe('Handheld drift');
    expect(outcome.writes[0]?.vendorRefs[0]?.prompt.subject).toBe('Elena');
  });

  it('refuses a pick that is not one of the three the card offered', async () => {
    const board = withPrompt();
    const proposal = await stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, board, fakeModel(() => ALTERNATIVES));
    expect(() => variantPickProposal(proposal, 'Something else', board)).toThrow(PromptPackError);
  });

  it('refuses the pick when the shot has changed since the alternatives were offered', async () => {
    const board = withPrompt();
    const proposal = await stagePromptVariant({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, board, fakeModel(() => ALTERNATIVES));
    const picked = variantPickProposal(proposal, 'Wide orbit', board);
    const moved = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, refFor('runway-gen4', { prompt: { subject: 'Someone else' } })), ...SHOTS.slice(1)] });
    expect(commitPromptDraft(picked, moved).ok).toBe(false);
  });
});
