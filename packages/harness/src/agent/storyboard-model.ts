/**
 * The model side of the storyboard and prompt-pack tools the agent drafts (storyboard.md §4, video-prompt-pack.md §6): what
 * each call reads from the project, the role text of the one call that has none in its package (`shots.derive`), and the
 * model adapter the prompt-pack engine calls through. Nothing here writes. The engines own the rest: `planDerive` and
 * `deriveShotsTool` plan the shots, and `stagePromptDraftTool` and `stagePromptVariantTool` draft the prompts.
 */

import type { ChatMessage } from '@caotang/gateway';
import { nodeById, type ProjectState } from '@caotang/store';
import { isShotNode, readShotMeta, shotFieldOf, type DeriveGranularity } from '@caotang/storyboard';
import { VIDEO_MODES, type CoveredScript, type PromptModel, type ShotNode, type StoryboardSnapshot, type VideoShotRef } from '@caotang/video-prompt-pack';

import { DRAFT_SYSTEM_PREFIX } from './protocol.js';

/** A stored prompt record the engine can read: a vendor, a mode from the closed list, and a prompt object. Anything else is left out. */
function isPromptRecord(value: unknown): value is VideoShotRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['vendor'] === 'string' && (VIDEO_MODES as readonly unknown[]).includes(record['mode']) && typeof record['prompt'] === 'object' && record['prompt'] !== null;
}

/**
 * The storyboard the prompt-pack engine reads, for every shot in the project. The shots' prose fields are read from their stored
 * metadata, and their covered script text from the dialogue anchors as captured. No assets are listed, so a visual reference names
 * no file, and the pack says so (the app's own snapshot lists the asset store, which the harness does not hold).
 */
export function storyboardOf(state: ProjectState): StoryboardSnapshot {
  const shots = state.manifest.tree.filter(isShotNode).map((node): ShotNode => {
    const meta = readShotMeta(shotFieldOf(node)).meta;
    const covered: CoveredScript[] = (meta.dialogue ?? []).map((coverage) => ({
      label: nodeById(state, coverage.docId)?.title ?? coverage.docId,
      text: coverage.anchor.exact,
    }));
    return {
      id: node.id,
      action: meta.action,
      imageAlt: meta.imageAlt,
      shotSize: meta.shotSize,
      cameraAngle: meta.cameraAngle,
      cameraMovement: meta.cameraMovement,
      lens: meta.lens,
      durationSec: meta.durationSec,
      covered,
      vendorRefs: (meta.vendorRefs ?? []).filter(isPromptRecord),
    };
  });
  return {
    tree: state.manifest.tree,
    shots,
    codex: (state.manifest.codex ?? []) as StoryboardSnapshot['codex'],
    assets: new Map(),
  };
}

/** The role text of one `shots.derive` call: the reply's shape, and what a quote must be. The scene is sent after it. */
export function deriveRole(granularity: DeriveGranularity): string {
  const coverage =
    granularity === 'full-coverage'
      ? 'Cover every line of dialogue and every action beat in the scene, one shot for each stretch of it.'
      : 'Cover the scene with the fewest shots that still carry it.';
  return [
    `${DRAFT_SYSTEM_PREFIX} Plan the shots of the screenplay scene below. ${coverage}`,
    'Reply with JSON only, as {"shots": [...]}: one object per shot, with the fields shotSize, cameraAngle, cameraMovement, lens, action, durationSec, transition and dialogueQuotes.',
    'A dialogueQuotes entry is a line copied exactly from the scene, which the shot covers. Quote no line the scene does not hold.',
  ].join(' ');
}

/** The schema hint of the derive reply, for a provider that enforces it. */
export const DERIVE_SCHEMA_HINT: Readonly<Record<string, unknown>> = {
  type: 'object',
  properties: { shots: { type: 'array', items: { type: 'object' } } },
  required: ['shots'],
};

/** The user text of one derive call: the scene's title and body, and the style the writer asked for, if any. */
export function deriveUserText(title: string, body: string, styleNote: string | undefined): string {
  const style = styleNote === undefined || styleNote.trim() === '' ? '' : `\nStyle: ${styleNote.trim()}`;
  return `Scene "${title}":${style}\n\n${body}`;
}

/**
 * The model's reply to a derive call, read to the proposal `planDerive` checks. A reply that is not an object with a list of shots
 * is refused in words the loop returns to the model; the shots themselves are checked by the planner.
 */
export function parseDeriveReply(text: string): { readonly ok: true; readonly value: { readonly shots: readonly unknown[] } } | { readonly ok: false; readonly message: string } {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  let value: unknown;
  try {
    value = JSON.parse(fenced === null ? text.trim() : (fenced[1] ?? ''));
  } catch {
    return { ok: false, message: 'the reply was not JSON: reply with an object that holds a "shots" list, and nothing else' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Array.isArray((value as { shots?: unknown }).shots)) {
    return { ok: false, message: 'the reply has no "shots" list: reply with an object whose "shots" holds one object per shot' };
  }
  return { ok: true, value: { shots: (value as { shots: unknown[] }).shots } };
}

/** The model adapter the prompt-pack engine calls, over one generation of the turn (`complete`), so every request counts against the turn. */
export function promptModelOf(
  generate: (messages: readonly ChatMessage[], jsonSchemaHint: Readonly<Record<string, unknown>>) => Promise<string>,
  model: string,
): PromptModel {
  return {
    model,
    complete: async (request) => ({
      content: await generate([{ role: 'system', content: request.system }, { role: 'user', content: request.user }], request.jsonSchemaHint),
    }),
  };
}
