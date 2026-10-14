/**
 * `prompt.draft` — drafts one vendor's prompt for each named shot ([video-prompt-pack.md §6–§7](../../../docs/architecture/video-prompt-pack.md)).
 *
 * The work is two phases, and the split is the safety property the spec asks for:
 *
 *  - `stagePromptDraft` calls the model, one shot at a time, in storyboard order. It writes nothing.
 *    Its output is a proposal the plan card shows: each shot's proposed prompt, the codex entries
 *    that supplied its references, its validation rows, and any shot it refused.
 *  - `commitPromptDraft` applies an approved proposal as one write per shot. It refuses, with no partial
 *    writes, when a shot changed after the draft was staged. An approval never lands on text the writer
 *    has since edited.
 *
 * The camera field comes from the shot's parameters when it has any (storyboard.md §2.2). The model is
 * asked not to write camera movement in that case, so the storyboard and the prompt cannot disagree.
 */

import { estimateTokens } from '@caotang/codex';

import { PromptPackError, MalformedReplyError } from './errors.js';
import { clean } from './compose.js';
import { assembleShotContext, type LayerPreview } from './context.js';
import { parseDraftReply, type DraftField, type DraftReply } from './parse.js';
import type { PromptModel, PromptModelRequest } from './port.js';
import { resolveReferences, type ReferenceProvenance } from './references.js';
import { shotById, shotNumbers, storyboardRank, vendorRefOf, withVendorRef } from './shot.js';
import type { VideoVendorTemplate } from './template.js';
import type {
  ResolvedReference,
  ShotNode,
  StoryboardSnapshot,
  ValidationIssue,
  VideoAudio,
  VideoDurationSec,
  VideoPrompt,
  VideoShotRef,
} from './model.js';
import { templateById, VIDEO_TEMPLATE_IDS } from './templates/index.js';

/** §6: a draft call names at most this many shots. A longer list is split, never silently cut. */
export const DRAFT_SHOT_LIMIT = 30;

export interface PromptDraftRequest {
  readonly shotIds: readonly string[];
  /** A template id, for example `runway-gen4`. */
  readonly vendor: string;
  /** The writer's creative direction, applied to every shot in the call. */
  readonly instruction?: string;
}

/** One shot the draft produced. `ref` is what the commit writes, and `base` is what it was drafted against. */
export interface ShotDraft {
  readonly shotId: string;
  readonly shotNumber: number;
  readonly ref: VideoShotRef;
  /** The shot's `vendorRefs` as they stood at staging, as JSON. The commit refuses if they have moved. */
  readonly base: string;
  readonly references: readonly ResolvedReference[];
  readonly provenance: ReferenceProvenance;
  readonly issues: readonly ValidationIssue[];
  readonly layers: readonly LayerPreview[];
  /** Reply keys the draft did not use. */
  readonly ignored: readonly string[];
}

/** A shot the draft did not draft. The options are the next actions, in the harness's ask-back shape. */
export interface ShotRefusal {
  readonly shotId: string;
  readonly shotNumber: number;
  readonly code: 'i2v-needs-reference' | 'reply-malformed';
  readonly message: string;
  readonly options: readonly string[];
}

export interface PromptDraftProposal {
  readonly vendor: string;
  readonly displayName: string;
  readonly model: string;
  readonly instruction?: string;
  readonly items: readonly ShotDraft[];
  readonly refusals: readonly ShotRefusal[];
  /** The estimated tokens of the calls, or the provider's reported usage where it gave one. */
  readonly spend: { readonly promptTokens: number; readonly completionTokens: number };
}

/** The template for an id, or the refusal that names the installed ones. */
export function requireTemplate(vendor: string): VideoVendorTemplate {
  const template = templateById(vendor);
  if (template === undefined) {
    throw new PromptPackError('unknown-vendor', `"${vendor}" is not an installed vendor template. The installed templates are ${VIDEO_TEMPLATE_IDS.join(', ')}.`);
  }
  return template;
}

const CAMERA_SIZE: Readonly<Record<string, string>> = {
  WS: 'wide shot',
  FS: 'full shot',
  MFS: 'medium full shot',
  MS: 'medium shot',
  MCU: 'medium close-up',
  CU: 'close-up',
  ECU: 'extreme close-up',
  OTS: 'over-the-shoulder shot',
  POV: 'point-of-view shot',
  INSERT: 'insert shot',
};
const CAMERA_ANGLE: Readonly<Record<string, string>> = {
  eye: 'eye-level',
  low: 'low angle',
  high: 'high angle',
  birds: "bird's-eye view",
  worms: "worm's-eye view",
  dutch: 'dutch angle',
  overhead: 'overhead',
};
const CAMERA_MOVEMENT: Readonly<Record<string, string>> = {
  static: 'static camera',
  pan: 'slow pan',
  tilt: 'slow tilt',
  'dolly-in': 'slow dolly-in',
  'dolly-out': 'slow dolly-out',
  truck: 'truck shot',
  crane: 'crane shot',
  handheld: 'handheld',
  zoom: 'slow zoom',
  'rack-focus': 'rack focus',
};

/**
 * The shot's camera parameters as one phrase, or undefined when it has none. An enum value the
 * table does not name is kept as written, so an unknown storyboard value still shows.
 */
export function cameraPhrase(shot: ShotNode): string | undefined {
  const parts = [
    shot.shotSize === undefined ? undefined : (CAMERA_SIZE[shot.shotSize] ?? shot.shotSize),
    shot.cameraAngle === undefined ? undefined : (CAMERA_ANGLE[shot.cameraAngle] ?? shot.cameraAngle),
    shot.cameraMovement === undefined ? undefined : (CAMERA_MOVEMENT[shot.cameraMovement] ?? shot.cameraMovement),
    shot.lens === undefined ? undefined : `${shot.lens} lens`,
  ]
    .map((part) => clean(part))
    .filter((part) => part !== '');
  return parts.length === 0 ? undefined : parts.join(', ');
}

function nonEmpty(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** The duration the storyboard gives, when this vendor takes it. Anything else is left for the writer to choose. */
function durationFrom(value: number | undefined, accepted: readonly VideoDurationSec[]): VideoDurationSec | undefined {
  return accepted.find((duration) => duration === value);
}

interface BuildRefInput {
  readonly shot: ShotNode;
  readonly template: VideoVendorTemplate;
  readonly existing: VideoShotRef | undefined;
  readonly fields: Partial<Record<DraftField, string>>;
  readonly camera: string | undefined;
}

/**
 * The record a draft writes. The drafted fields replace the old ones. Fields the writer sets by hand
 * (the vendor's mode, aspect ratio, resolution, seed, best take and notes, and any reference override)
 * carry over unchanged. A new record is text-to-video, since choosing a first frame is the writer's call.
 */
function buildRef(input: BuildRefInput): VideoShotRef {
  const { shot, template, existing, fields, camera } = input;
  const cameraText = nonEmpty(camera);
  const subject = nonEmpty(fields.subject);
  const action = nonEmpty(fields.action);
  const context = nonEmpty(fields.context);
  const style = nonEmpty(fields.style);
  const prompt: VideoPrompt = {
    ...(cameraText === undefined ? {} : { camera: cameraText }),
    ...(subject === undefined ? {} : { subject }),
    ...(action === undefined ? {} : { action }),
    ...(context === undefined ? {} : { context }),
    ...(style === undefined ? {} : { style }),
  };
  const dialogue = nonEmpty(fields.dialogue);
  const sfx = nonEmpty(fields.sfx);
  const ambient = nonEmpty(fields.ambient);
  const music = nonEmpty(fields.music);
  const audio: VideoAudio = {
    ...(dialogue === undefined ? {} : { dialogue }),
    ...(sfx === undefined ? {} : { sfx }),
    ...(ambient === undefined ? {} : { ambient }),
    ...(music === undefined ? {} : { music }),
  };
  const hasAudio = dialogue !== undefined || sfx !== undefined || ambient !== undefined || music !== undefined;
  const negative = nonEmpty(fields.negativePrompt);
  const duration = existing?.durationSec ?? durationFrom(shot.durationSec, template.limits.durations);
  return {
    vendor: template.id,
    mode: existing?.mode ?? 't2v',
    prompt,
    ...(template.limits.audio && hasAudio ? { audio } : {}),
    ...(template.limits.negativeChars !== undefined && negative !== undefined ? { negativePrompt: negative } : {}),
    ...(duration === undefined ? {} : { durationSec: duration }),
    ...(existing?.aspectRatio === undefined ? {} : { aspectRatio: existing.aspectRatio }),
    ...(existing?.resolution === undefined ? {} : { resolution: existing.resolution }),
    ...(existing?.model === undefined ? {} : { model: existing.model }),
    ...(existing?.seed === undefined ? {} : { seed: existing.seed }),
    ...(existing?.promptExtend === undefined ? {} : { promptExtend: existing.promptExtend }),
    ...(existing?.notes === undefined ? {} : { notes: existing.notes }),
    ...(existing?.bestTake === undefined ? {} : { bestTake: existing.bestTake }),
    references: existing?.references ?? [],
  };
}

function systemPrompt(template: VideoVendorTemplate, fields: readonly DraftField[], cameraFromParameters: boolean): string {
  return [
    `You draft the video prompt for one shot of an AI-video project, for ${template.displayName}. Caotang never generates video; the writer does that in their own tool.`,
    template.grammarHints,
    `Reply with one JSON object and nothing else. Its string fields may be: ${fields.join(', ')}. Leave a field out when the shot does not need it.`,
    'Name characters and places by their codex names. Describe what happens in the shot, and do not describe a reference image, which is sent with the prompt.',
    cameraFromParameters ? 'Do not write camera movement: the shot parameters set it.' : 'Write camera movement only when the shot needs it.',
  ].join('\n');
}

function userMessage(shot: ShotNode, number: number, instruction: string | undefined, camera: string | undefined, layers: { folders: string; priorShots: string; codex: string; focus: string }): string {
  return [
    `Shot ${number} of the storyboard.`,
    instruction === undefined ? '' : `Creative direction: ${instruction}`,
    camera === undefined ? '' : `Shot parameters: ${camera}.`,
    shot.durationSec === undefined ? '' : `Duration: ${shot.durationSec} s.`,
    layers.folders === '' ? '' : `Where the shot sits:\n${layers.folders}`,
    layers.priorShots === '' ? '' : `Shots before it, with their prompts:\n${layers.priorShots}`,
    layers.codex === '' ? '' : `Codex entries the shot uses:\n${layers.codex}`,
    layers.focus,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** The reply fields the template reads, as the JSON schema the provider is asked to follow. */
function fieldsFor(template: VideoVendorTemplate, cameraFromParameters: boolean): DraftField[] {
  const fields: DraftField[] = ['subject', 'action', 'context', 'style'];
  if (!cameraFromParameters) fields.unshift('camera');
  if (template.limits.audio) fields.push('dialogue', 'sfx', 'ambient', 'music');
  if (template.limits.negativeChars !== undefined) fields.push('negativePrompt');
  return fields;
}

const REFUSAL_OPTIONS_MALFORMED = ['draft this shot again', 'write its prompt by hand', 'drop this shot from the call'];
const REFUSAL_OPTIONS_I2V = [
  'attach a first-frame asset to the shot',
  'attach a visual reference to a codex entry the shot mentions',
  'switch the shot to text-to-video',
];

/**
 * Stages a draft: one model call per shot, in storyboard order, and no write. A shot whose
 * reply is malformed is refused with its reason, and the rest of the call goes on. A failed
 * transport (the provider was unreachable, the request was aborted) propagates and drafts nothing.
 */
export async function stagePromptDraft(
  request: PromptDraftRequest,
  storyboard: StoryboardSnapshot,
  model: PromptModel,
  signal?: AbortSignal,
): Promise<PromptDraftProposal> {
  const template = requireTemplate(request.vendor);
  const ids = [...new Set(request.shotIds)];
  if (ids.length === 0) throw new PromptPackError('no-shots', 'prompt.draft needs at least one shot id.');
  if (ids.length > DRAFT_SHOT_LIMIT) {
    throw new PromptPackError('too-many-shots', `prompt.draft takes at most ${DRAFT_SHOT_LIMIT} shots per call; this call names ${ids.length}. Split the list and call it again.`);
  }
  const byId = new Map(storyboard.shots.map((shot) => [shot.id, shot]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new PromptPackError('unknown-shot', `No storyboard shot has the id ${unknown.join(', ')}. Name shots by the ids in their storyboard folder.`);
  }

  const numbers = shotNumbers(storyboard);
  const rank = storyboardRank(storyboard);
  const targets = ids
    .map((id) => shotById(storyboard, id))
    .filter((shot): shot is ShotNode => shot !== undefined)
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  const pending = new Map<string, VideoShotRef>();
  const promptOf = (shotId: string): VideoShotRef | undefined => {
    const staged = pending.get(shotId);
    if (staged !== undefined) return staged;
    const shot = byId.get(shotId);
    return shot === undefined ? undefined : vendorRefOf(shot, template.id);
  };

  const items: ShotDraft[] = [];
  const refusals: ShotRefusal[] = [];
  const spend = { promptTokens: 0, completionTokens: 0 };

  for (const shot of targets) {
    const number = numbers.get(shot.id) ?? 0;
    const existing = vendorRefOf(shot, template.id);
    const override = existing?.references ?? [];
    const resolution = resolveReferences({ shot, override, storyboard });

    if (existing?.mode === 'i2v' && resolution.references.length === 0) {
      refusals.push({
        shotId: shot.id,
        shotNumber: number,
        code: 'i2v-needs-reference',
        message: `i2v needs a first-frame asset or a codex visual reference, and shot ${number} has neither, so there is nothing to draft from.`,
        options: REFUSAL_OPTIONS_I2V,
      });
      continue;
    }

    const cameraParameters = cameraPhrase(shot);
    const context = assembleShotContext({
      shot,
      storyboard,
      vendor: template.id,
      shotNumbers: numbers,
      storyboardRank: rank,
      promptOf,
      override,
    });
    const fields = fieldsFor(template, cameraParameters !== undefined);
    const user = userMessage(shot, number, request.instruction, cameraParameters, context);
    const system = systemPrompt(template, fields, cameraParameters !== undefined);
    const modelRequest: PromptModelRequest = {
      system,
      user,
      jsonSchemaHint: {
        type: 'object',
        properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
        additionalProperties: false,
      },
      maxOutputTokens: 800,
      ...(signal === undefined ? {} : { signal }),
    };
    const reply = await model.complete(modelRequest);
    spend.promptTokens += reply.usage?.promptTokens ?? estimateTokens(system + user);
    spend.completionTokens += reply.usage?.completionTokens ?? estimateTokens(reply.content);

    let parsed: DraftReply;
    try {
      parsed = parseDraftReply(reply.content);
    } catch (error) {
      if (!(error instanceof MalformedReplyError)) throw error;
      refusals.push({ shotId: shot.id, shotNumber: number, code: 'reply-malformed', message: error.message, options: REFUSAL_OPTIONS_MALFORMED });
      continue;
    }

    const ref = buildRef({
      shot,
      template,
      existing,
      fields: parsed.fields,
      camera: cameraParameters ?? parsed.fields.camera,
    });
    const issues = template.accepts(ref, { shotId: shot.id, references: resolution.references });
    items.push({
      shotId: shot.id,
      shotNumber: number,
      ref,
      base: JSON.stringify(shot.vendorRefs ?? []),
      references: resolution.references,
      provenance: resolution.provenance,
      issues,
      layers: context.layers,
      ignored: parsed.ignored,
    });
    pending.set(shot.id, ref);
  }

  return {
    vendor: template.id,
    displayName: template.displayName,
    model: model.model,
    ...(request.instruction === undefined ? {} : { instruction: request.instruction }),
    items,
    refusals,
    spend,
  };
}

export interface PromptDraftWrite {
  readonly shotId: string;
  /** The shot's `vendorRefs` after the write, in full, for the bus command to set. */
  readonly vendorRefs: readonly VideoShotRef[];
}

export type PromptDraftCommit =
  | { readonly ok: true; readonly writes: readonly PromptDraftWrite[] }
  | { readonly ok: false; readonly conflicts: readonly string[] };

/**
 * Turns an approved proposal into writes. A shot that is gone, or whose prompt records have
 * moved since the draft, is a conflict, and a conflict stops the whole commit so nothing lands
 * half-applied.
 */
export function commitPromptDraft(proposal: PromptDraftProposal, storyboard: StoryboardSnapshot): PromptDraftCommit {
  const byId = new Map(storyboard.shots.map((shot) => [shot.id, shot]));
  const conflicts: string[] = [];
  const writes: PromptDraftWrite[] = [];
  for (const item of proposal.items) {
    const shot = byId.get(item.shotId);
    if (shot === undefined) {
      conflicts.push(`shot ${item.shotNumber} is no longer in the storyboard`);
      continue;
    }
    if (JSON.stringify(shot.vendorRefs ?? []) !== item.base) {
      conflicts.push(`shot ${item.shotNumber} changed after the draft was made`);
      continue;
    }
    writes.push({ shotId: item.shotId, vendorRefs: withVendorRef(shot.vendorRefs, item.ref) });
  }
  return conflicts.length > 0 ? { ok: false, conflicts } : { ok: true, writes };
}
