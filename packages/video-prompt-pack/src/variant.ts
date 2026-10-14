/**
 * `prompt.variant` — three alternatives for one axis of a shot's prompt ([video-prompt-pack.md §6](../../../docs/architecture/video-prompt-pack.md)).
 *
 * Staging is read-only: the alternatives come back as a list the writer picks from, each with the
 * validation rows that value would raise. A pick must be one of those values. It then becomes a one-item
 * draft proposal and lands only through the same commit `prompt.draft` uses, so the conflict check and the
 * one undo group are shared, and nothing is written from the variant call itself.
 *
 * The axes map to fields of the normalized schema. `camera` is `prompt.camera`. `lighting` and `style` both
 * rewrite `prompt.style`, because lighting is part of the style field (§2). `audio` is `audio.ambient`,
 * since the dialogue is the script's and not the writer's to vary.
 */

import { isPromptEmpty } from './compose.js';
import { PromptPackError } from './errors.js';
import { requireTemplate, type PromptDraftProposal } from './draft.js';
import type { PromptModel } from './port.js';
import { parseVariantReply } from './parse.js';
import { resolveReferences } from './references.js';
import { shotById, shotNumbers, vendorRefOf } from './shot.js';
import type { ShotNode, StoryboardSnapshot, ValidationIssue, VideoShotRef } from './model.js';

export const VARIATIONS = ['camera', 'lighting', 'style', 'audio'] as const;
export type Variation = (typeof VARIATIONS)[number];

/** The normalized field an axis rewrites, in the schema's own names. */
export function fieldOf(variation: Variation): 'prompt.camera' | 'prompt.style' | 'audio.ambient' {
  if (variation === 'camera') return 'prompt.camera';
  if (variation === 'audio') return 'audio.ambient';
  return 'prompt.style';
}

/** The current value of the axis's field. Empty when the record does not set it. */
export function currentValueOf(ref: VideoShotRef, variation: Variation): string {
  if (variation === 'camera') return ref.prompt.camera ?? '';
  if (variation === 'audio') return ref.audio?.ambient ?? '';
  return ref.prompt.style ?? '';
}

/** The record with the axis's field set to `value`. Every other field is left as it was. */
export function applyVariation(ref: VideoShotRef, variation: Variation, value: string): VideoShotRef {
  const text = value.trim();
  if (variation === 'camera') return { ...ref, prompt: { ...ref.prompt, camera: text } };
  if (variation === 'audio') return { ...ref, audio: { ...ref.audio, ambient: text } };
  return { ...ref, prompt: { ...ref.prompt, style: text } };
}

export interface VariantAlternative {
  readonly value: string;
  /** The rows this value would raise on the shot. The card shows them beside the value. */
  readonly issues: readonly ValidationIssue[];
}

export interface VariantProposal {
  readonly shotId: string;
  readonly shotNumber: number;
  readonly vendor: string;
  readonly variation: Variation;
  readonly field: 'prompt.camera' | 'prompt.style' | 'audio.ambient';
  readonly current: string;
  readonly alternatives: readonly VariantAlternative[];
  /** The shot's `vendorRefs` at staging, as JSON. A pick that lands after the shot changed is a conflict. */
  readonly base: string;
  readonly model: string;
}

export interface VariantRequest {
  readonly shot: string;
  readonly vendor: string;
  readonly variation: Variation;
}

/**
 * Stages three alternatives for one axis. It refuses a shot with no prompt for the vendor,
 * because there is nothing to vary: the writer should run `prompt.draft` first.
 */
export async function stagePromptVariant(request: VariantRequest, storyboard: StoryboardSnapshot, model: PromptModel, signal?: AbortSignal): Promise<VariantProposal> {
  const template = requireTemplate(request.vendor);
  const shot = shotById(storyboard, request.shot);
  if (shot === undefined) throw new PromptPackError('unknown-shot', `No storyboard shot has the id ${request.shot}. Name the shot by its id in its storyboard folder.`);
  const number = shotNumbers(storyboard).get(shot.id) ?? 0;
  const ref = vendorRefOf(shot, template.id);
  if (ref === undefined || isPromptEmpty(ref.prompt)) {
    throw new PromptPackError('no-prompt', `Shot ${number} has no prompt for ${template.id} yet. Run prompt.draft on it first, then ask for variants.`);
  }

  const current = currentValueOf(ref, request.variation);
  const system = [
    `You offer alternatives for one part of an AI-video shot prompt, for ${template.displayName}.`,
    'Keep the subject and the action as they are, and change only the requested part.',
    'Reply with one JSON object and nothing else: {"alternatives": [three complete values for that part]}. Keep each value short.',
  ].join('\n');
  const user = [`Shot ${number}.`, `The part to vary is the ${request.variation}, now: ${current === '' ? '(empty)' : current}.`].join('\n');
  const reply = await model.complete({
    system,
    user,
    jsonSchemaHint: {
      type: 'object',
      properties: { alternatives: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
      required: ['alternatives'],
      additionalProperties: false,
    },
    maxOutputTokens: 400,
    ...(signal === undefined ? {} : { signal }),
  });
  const values = parseVariantReply(reply.content);
  const references = resolveReferences({ shot, override: ref.references, storyboard }).references;

  return {
    shotId: shot.id,
    shotNumber: number,
    vendor: template.id,
    variation: request.variation,
    field: fieldOf(request.variation),
    current,
    alternatives: values.map((value) => ({
      value,
      issues: template.accepts(applyVariation(ref, request.variation, value), { shotId: shot.id, references }),
    })),
    base: JSON.stringify(shot.vendorRefs ?? []),
    model: model.model,
  };
}

/**
 * Turns a picked alternative into a one-item draft proposal, which the same commit as `prompt.draft`
 * writes. A value that is not one of the proposal's alternatives is refused.
 */
export function variantPickProposal(proposal: VariantProposal, value: string, storyboard: StoryboardSnapshot): PromptDraftProposal {
  const template = requireTemplate(proposal.vendor);
  const shot: ShotNode | undefined = shotById(storyboard, proposal.shotId);
  if (shot === undefined) throw new PromptPackError('unknown-shot', `No storyboard shot has the id ${proposal.shotId}.`);
  const ref = vendorRefOf(shot, template.id);
  if (ref === undefined) throw new PromptPackError('no-prompt', `Shot ${proposal.shotNumber} has no prompt for ${template.id}.`);
  if (!proposal.alternatives.some((alternative) => alternative.value === value)) {
    throw new PromptPackError('not-an-alternative', `"${value}" is not one of the three alternatives this proposal offered.`);
  }
  const next = applyVariation(ref, proposal.variation, value);
  const resolution = resolveReferences({ shot, override: ref.references, storyboard });
  return {
    vendor: template.id,
    displayName: template.displayName,
    model: proposal.model,
    items: [
      {
        shotId: shot.id,
        shotNumber: proposal.shotNumber,
        ref: next,
        base: proposal.base,
        references: resolution.references,
        provenance: resolution.provenance,
        issues: template.accepts(next, { shotId: shot.id, references: resolution.references }),
        layers: [],
        ignored: [],
      },
    ],
    refusals: [],
    spend: { promptTokens: 0, completionTokens: 0 },
  };
}
