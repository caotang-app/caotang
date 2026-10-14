/**
 * `prompt.draft`: the staging half calls the injected model once per shot and writes nothing; the commit
 * half applies an approved proposal, and refuses it whole when a shot has moved since it was drafted.
 */
import { describe, expect, it } from 'vitest';

import {
  PromptPackError,
  cameraPhrase,
  commitPromptDraft,
  stagePromptDraft,
  type ShotNode,
  type StoryboardSnapshot,
  type VideoShotRef,
} from '../src/index.js';

import { SHOTS, draftReply, fakeModel, refFor, storyboard, withRef } from './fixtures.js';

const S1_FIELDS = {
  camera: 'ignored camera',
  subject: 'Elena',
  action: 'walks down the quay',
  context: 'Harbour at dusk',
  style: 'Film grain',
  dialogue: '"We leave at dawn."',
};
const S2_FIELDS = { subject: 'The ferryman', action: 'points at the harbour', style: 'Grey light' };

function replies(): ReturnType<typeof draftReply> {
  return draftReply({ 1: S1_FIELDS, 2: S2_FIELDS });
}

describe('stagePromptDraft drafts in storyboard order and writes nothing', () => {
  it('returns one item per shot, in storyboard order, even when the call named them the other way round', async () => {
    const board = storyboard();
    const model = fakeModel((request) => replies()(request));
    const proposal = await stagePromptDraft({ shotIds: ['s2', 's1'], vendor: 'runway-gen4', instruction: 'Keep it quiet.' }, board, model);
    expect(proposal.items.map((item) => item.shotNumber)).toEqual([1, 2]);
    expect(proposal).toMatchObject({ vendor: 'runway-gen4', displayName: 'Runway Gen-4', model: 'fake-1', instruction: 'Keep it quiet.' });
  });

  it('leaves the storyboard untouched', async () => {
    const board = storyboard();
    await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4' }, board, fakeModel((request) => replies()(request)));
    expect(SHOTS.every((shot) => shot.vendorRefs === undefined)).toBe(true);
  });

  it('takes the camera from the shot’s parameters, and asks the model not to write camera movement then', async () => {
    const model = fakeModel((request) => replies()(request));
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, storyboard(), model);
    expect(proposal.items[0]?.ref.prompt.camera).toBe('medium close-up, eye-level, slow dolly-in, 35mm lens');
    expect(model.calls[0]?.system).toContain('Do not write camera movement: the shot parameters set it.');
    expect(model.calls[0]?.user).toContain('Shot parameters: medium close-up, eye-level, slow dolly-in, 35mm lens.');
  });

  it('takes the camera from the model when the shot has no parameters, and asks it for camera then', async () => {
    const model = fakeModel(() => JSON.stringify({ ...S2_FIELDS, camera: 'Slow pan left' }));
    const proposal = await stagePromptDraft({ shotIds: ['s2'], vendor: 'runway-gen4' }, storyboard(), model);
    expect(proposal.items[0]?.ref.prompt.camera).toBe('Slow pan left');
    expect(model.calls[0]?.system).toContain('Write camera movement only when the shot needs it.');
  });

  it('sends one model call per shot, each with the codex entries and the prompts of the shots before it', async () => {
    const model = fakeModel((request) => replies()(request));
    await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4', instruction: 'Keep it quiet.' }, storyboard(), model);
    expect(model.calls).toHaveLength(2);
    const second = model.calls[1]?.user ?? '';
    expect(second).toContain('Keep it quiet.');
    expect(second).toContain('## Harbour (location)');
    expect(second).toContain('Scene 1 — Shots, shot 1: medium close-up, eye-level, slow dolly-in, 35mm lens; Elena walks down the quay; Film grain.');
  });

  it('keeps the drafted fields and the storyboard duration, and says what it could not place', async () => {
    const model = fakeModel((request) => replies()(request));
    const proposal = await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4' }, storyboard(), model);
    const [first, second] = proposal.items;
    expect(first?.ref).toMatchObject({
      vendor: 'runway-gen4',
      mode: 't2v',
      durationSec: 5,
      prompt: {
        camera: 'medium close-up, eye-level, slow dolly-in, 35mm lens',
        subject: 'Elena',
        action: 'walks down the quay',
        context: 'Harbour at dusk',
        style: 'Film grain',
      },
    });
    expect(first?.ref.audio).toBeUndefined();
    // Runway does not take 8 seconds, so the draft does not choose one for it, and the validator says so.
    expect(second?.ref.durationSec).toBeUndefined();
    expect(second?.issues.find((issue) => issue.code === 'missing-field' && issue.field === 'durationSec')).toMatchObject({ severity: 'error' });
  });

  it('records the spend from the provider’s usage, and the reply keys it did not use', async () => {
    const model = fakeModel(() => JSON.stringify({ ...S2_FIELDS, mood: 'calm' }));
    const proposal = await stagePromptDraft({ shotIds: ['s2'], vendor: 'runway-gen4' }, storyboard(), model);
    expect(proposal.spend).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(proposal.items[0]?.ignored).toEqual(['mood']);
  });

  it('passes the abort signal to the model on every call', async () => {
    const controller = new AbortController();
    const model = fakeModel(() => JSON.stringify(S2_FIELDS));
    await stagePromptDraft({ shotIds: ['s2'], vendor: 'runway-gen4' }, storyboard(), model, controller.signal);
    expect(model.calls[0]?.signal).toBe(controller.signal);
  });

  it('keeps the writer’s hand-set fields when the shot is drafted again', async () => {
    const existing: VideoShotRef = refFor('runway-gen4', {
      mode: 't2v',
      durationSec: 10,
      aspectRatio: '16:9',
      seed: 42,
      notes: 'keep the grain',
      bestTake: { seed: 42, model: 'gen4', vendorParams: { cfg: 0.5 } },
    });
    const board = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, existing), ...SHOTS.slice(1)] });
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, board, fakeModel((request) => replies()(request)));
    expect(proposal.items[0]?.ref).toMatchObject({ durationSec: 10, aspectRatio: '16:9', seed: 42, notes: 'keep the grain', bestTake: { seed: 42 } });
  });
});

describe('stagePromptDraft refuses what it cannot draft, before the model is called', () => {
  it('refuses an i2v shot with no first frame or visual reference, and makes no call for it', async () => {
    const i2v = refFor('runway-gen4', { mode: 'i2v', references: [] });
    const board = storyboard({ shots: [withRef(SHOTS[2] as ShotNode, i2v), ...SHOTS.slice(0, 2), ...SHOTS.slice(3)] });
    const model = fakeModel(() => '{}');
    const proposal = await stagePromptDraft({ shotIds: ['s3'], vendor: 'runway-gen4' }, board, model);
    expect(model.calls).toHaveLength(0);
    expect(proposal.items).toEqual([]);
    expect(proposal.refusals).toEqual([
      expect.objectContaining({ shotId: 's3', code: 'i2v-needs-reference', options: expect.arrayContaining(['attach a first-frame asset to the shot']) }),
    ]);
  });

  it('refuses one shot whose reply is malformed, and drafts the rest of the call', async () => {
    const model = fakeModel((request) => (request.user.includes('Shot 2 of') ? 'not json at all' : replies()(request)));
    const proposal = await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4' }, storyboard(), model);
    expect(proposal.items.map((item) => item.shotNumber)).toEqual([1]);
    expect(proposal.refusals).toEqual([expect.objectContaining({ shotNumber: 2, code: 'reply-malformed' })]);
  });

  it('names an unknown shot before any call is made', async () => {
    const model = fakeModel(() => '{}');
    await expect(stagePromptDraft({ shotIds: ['s1', 'nope'], vendor: 'runway-gen4' }, storyboard(), model)).rejects.toMatchObject({
      code: 'unknown-shot',
    });
    expect(model.calls).toHaveLength(0);
  });

  it('refuses more than thirty shots in one call, and asks for a split', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => `x${index}`);
    await expect(stagePromptDraft({ shotIds: ids, vendor: 'runway-gen4' }, storyboard(), fakeModel(() => '{}'))).rejects.toMatchObject({
      code: 'too-many-shots',
    });
  });

  it('refuses an unknown vendor and lists the installed templates', async () => {
    const rejected = stagePromptDraft({ shotIds: ['s1'], vendor: 'pika-1' }, storyboard(), fakeModel(() => '{}'));
    await expect(rejected).rejects.toBeInstanceOf(PromptPackError);
    await expect(rejected).rejects.toMatchObject({ code: 'unknown-vendor', message: expect.stringContaining('runway-gen4') });
  });

  it('refuses an empty call', async () => {
    await expect(stagePromptDraft({ shotIds: [], vendor: 'runway-gen4' }, storyboard(), fakeModel(() => '{}'))).rejects.toMatchObject({
      code: 'no-shots',
    });
  });

  it('lets a transport failure propagate, and drafts nothing', async () => {
    const model = fakeModel(() => new Error('network down'));
    await expect(stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, storyboard(), model)).rejects.toThrow('network down');
  });
});

describe('commitPromptDraft applies an approved proposal, or refuses it whole', () => {
  it('writes each shot’s record for the vendor, in full, and keeps the other vendors’ records', async () => {
    const other = refFor('veo-3.1', { prompt: { subject: 'Ferry' }, durationSec: 6 });
    const board = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, other), ...SHOTS.slice(1)] });
    const proposal = await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4' }, board, fakeModel((request) => replies()(request)));
    const outcome = commitPromptDraft(proposal, board);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const s1 = outcome.writes.find((write) => write.shotId === 's1');
    expect(s1?.vendorRefs.map((ref) => ref.vendor)).toEqual(['veo-3.1', 'runway-gen4']);
    expect(outcome.writes.map((write) => write.shotId)).toEqual(['s1', 's2']);
  });

  it('refuses the whole proposal when one shot has changed since the draft, and writes nothing', async () => {
    const board = storyboard();
    const proposal = await stagePromptDraft({ shotIds: ['s1', 's2'], vendor: 'runway-gen4' }, board, fakeModel((request) => replies()(request)));
    const moved = storyboard({ shots: [withRef(SHOTS[1] as ShotNode, refFor('runway-gen4', { prompt: { subject: 'Someone else' } })), SHOTS[0] as ShotNode, ...SHOTS.slice(2)] });
    const outcome = commitPromptDraft(proposal, moved);
    expect(outcome).toEqual({ ok: false, conflicts: ['shot 2 changed after the draft was made'] });
  });

  it('refuses when a drafted shot is no longer in the storyboard', async () => {
    const board = storyboard();
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, board, fakeModel((request) => replies()(request)));
    const gone: StoryboardSnapshot = { ...board, shots: SHOTS.slice(1) };
    expect(commitPromptDraft(proposal, gone)).toEqual({ ok: false, conflicts: ['shot 1 is no longer in the storyboard'] });
  });
});

describe('cameraPhrase reads the shot parameters', () => {
  it('names each parameter and keeps an unknown enum value as written', () => {
    expect(cameraPhrase(SHOTS[0] as ShotNode)).toBe('medium close-up, eye-level, slow dolly-in, 35mm lens');
    expect(cameraPhrase({ id: 'x', covered: [], cameraMovement: 'orbit' })).toBe('orbit');
    expect(cameraPhrase({ id: 'x', covered: [] })).toBeUndefined();
  });
});
