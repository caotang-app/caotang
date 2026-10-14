/**
 * The two agent tools: their entries in the harness's shape, their params, and the handlers' model-facing
 * refusals. The spec-parity test checks the entries against the spec's table; this file checks behaviour.
 */
import { describe, expect, it } from 'vitest';

import {
  PROMPT_PACK_TOOL_ENTRIES,
  PROMPT_PACK_TOOL_NAMES,
  VARIATIONS,
  commitPromptDraftTool,
  pickVariantTool,
  stagePromptDraftTool,
  stagePromptVariantTool,
  stagePromptDraft,
  type PromptPackToolEntry,
  type ShotNode,
} from '../src/index.js';

import { SHOTS, draftReply, fakeModel, refFor, storyboard, withRef } from './fixtures.js';

function entry(name: string): PromptPackToolEntry {
  const found = PROMPT_PACK_TOOL_ENTRIES.find((candidate) => candidate.meta.name === name);
  if (found === undefined) throw new Error(`no entry ${name}`);
  return found;
}

describe('the entries in the harness’s shape', () => {
  it('declares exactly the two tools, each as a port entry the harness can map', () => {
    expect(PROMPT_PACK_TOOL_NAMES).toEqual(['prompt.draft', 'prompt.variant']);
    expect(PROMPT_PACK_TOOL_ENTRIES.map((candidate) => [candidate.kind, candidate.port, candidate.meta.surface])).toEqual([
      ['port', 'prompt.draft', 'extension'],
      ['port', 'prompt.variant', 'extension'],
    ]);
  });

  it('gives prompt.draft the write-confirm risk and an undo group, and prompt.variant the read risk and no undo', () => {
    expect(entry('prompt.draft').meta).toMatchObject({ risk: 'write-confirm', undoable: true });
    expect(entry('prompt.variant').meta).toMatchObject({ risk: 'read', undoable: false });
  });

  it('lists the spec’s params, and requires the ones the spec does not mark optional', () => {
    const draft = entry('prompt.draft').params;
    expect(Object.keys(draft.properties).sort()).toEqual(['instruction', 'shots', 'vendor']);
    expect(draft.required).toEqual(['shots', 'vendor']);
    expect(draft.properties.shots).toMatchObject({ kind: 'array', maxItems: 30, minItems: 1, unique: true });
    const variant = entry('prompt.variant').params;
    expect(variant.required).toEqual(['shot', 'vendor', 'variation']);
    expect(variant.properties.variation).toMatchObject({ kind: 'enum', values: [...VARIATIONS] });
  });

  it('refuses a vendor that is not installed, and names the installed templates in the refusal', () => {
    const refine = entry('prompt.draft').refine;
    expect(refine?.({ vendor: 'pika-1' })).toContain('runway-gen4');
    expect(refine?.({ vendor: 'runway-gen4' })).toBeUndefined();
  });
});

describe('stagePromptDraftTool', () => {
  it('refuses with the setup step when no provider is configured, and makes no call', async () => {
    const result = await stagePromptDraftTool({ shots: ['s1'], vendor: 'runway-gen4' }, { storyboard: storyboard() });
    expect(result).toMatchObject({ ok: false, code: 'no-model' });
  });

  it('refuses an unknown vendor before it looks at the model', async () => {
    const model = fakeModel(() => '{}');
    const result = await stagePromptDraftTool({ shots: ['s1'], vendor: 'pika-1' }, { storyboard: storyboard(), model });
    expect(result).toMatchObject({ ok: false, code: 'unknown-vendor' });
    expect(model.calls).toHaveLength(0);
  });

  it('returns the proposal and a one-line summary on success', async () => {
    const model = fakeModel(draftReply({ 1: { subject: 'Elena', action: 'walks down the quay' } }));
    const result = await stagePromptDraftTool({ shots: ['s1'], vendor: 'runway-gen4' }, { storyboard: storyboard(), model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(1);
    expect(result.summary).toContain('Drafted 1 shot(s) for Runway Gen-4');
  });

  it('turns a refused name into a model-facing code and message', async () => {
    const result = await stagePromptDraftTool({ shots: ['nope'], vendor: 'runway-gen4' }, { storyboard: storyboard(), model: fakeModel(() => '{}') });
    expect(result).toMatchObject({ ok: false, code: 'unknown-shot' });
  });
});

describe('commitPromptDraftTool', () => {
  it('refuses an empty proposal, since there is nothing to write', async () => {
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, storyboard(), fakeModel(() => '{}'));
    const empty = { ...proposal, items: [] };
    expect(commitPromptDraftTool(empty, { storyboard: storyboard() })).toMatchObject({ ok: false, code: 'nothing-to-apply' });
  });

  it('writes the proposal, and reports the count in its summary', async () => {
    const board = storyboard();
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, board, fakeModel(draftReply({ 1: { subject: 'Elena' } })));
    const result = commitPromptDraftTool(proposal, { storyboard: board });
    expect(result).toMatchObject({ ok: true, summary: 'Wrote the prompt for 1 shot(s) as Runway Gen-4.' });
  });

  it('refuses a stale proposal with the conflict named, and asks for a new draft', async () => {
    const board = storyboard();
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, board, fakeModel(draftReply({ 1: { subject: 'Elena' } })));
    const moved = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, refFor('runway-gen4')), ...SHOTS.slice(1)] });
    const result = commitPromptDraftTool(proposal, { storyboard: moved });
    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    if (result.ok) return;
    expect(result.message).toContain('Draft those shots again');
  });
});

describe('the variant tool', () => {
  it('refuses a variation outside the four the spec names', async () => {
    const result = await stagePromptVariantTool({ shot: 's1', vendor: 'runway-gen4', variation: 'colour' }, { storyboard: storyboard(), model: fakeModel(() => '{}') });
    expect(result).toMatchObject({ ok: false, code: 'unknown-variation' });
  });

  it('refuses without a provider, and says so', async () => {
    const result = await stagePromptVariantTool({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, { storyboard: storyboard() });
    expect(result).toMatchObject({ ok: false, code: 'no-model' });
  });

  it('offers the alternatives, and turns a pick into a commit-ready proposal', async () => {
    const board = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, refFor('runway-gen4', { prompt: { subject: 'Elena' }, durationSec: 5 })), ...SHOTS.slice(1)] });
    const model = fakeModel(() => JSON.stringify({ alternatives: ['Wide orbit', 'Handheld drift', 'Static frame'] }));
    const staged = await stagePromptVariantTool({ shot: 's1', vendor: 'runway-gen4', variation: 'camera' }, { storyboard: board, model });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const picked = pickVariantTool(staged.data, 'Static frame', { storyboard: board });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.data.items[0]?.ref.prompt.camera).toBe('Static frame');
  });

  it('refuses a pick that was not offered', async () => {
    const board = storyboard({ shots: [withRef(SHOTS[0] as ShotNode, refFor('runway-gen4', { prompt: { subject: 'Elena' } })), ...SHOTS.slice(1)] });
    const model = fakeModel(() => JSON.stringify({ alternatives: ['a', 'b', 'c'] }));
    const staged = await stagePromptVariantTool({ shot: 's1', vendor: 'runway-gen4', variation: 'style' }, { storyboard: board, model });
    if (!staged.ok) throw new Error('staging failed');
    expect(pickVariantTool(staged.data, 'd', { storyboard: board })).toMatchObject({ ok: false, code: 'not-an-alternative' });
  });
});
