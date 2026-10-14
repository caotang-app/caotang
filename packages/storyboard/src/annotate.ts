/**
 * `shots.annotate` — [storyboard.md](../../../docs/architecture/storyboard.md) §4, tool 19.
 *
 * A batch write over existing shots: the image, the camera spec and the action. The whole batch is
 * planned and validated first, and the plan is data: it carries one `shot.setMeta` command per shot that
 * changes, in request order, and nothing is written here. The bus applies the list as one undo group. A
 * refused plan has no commands, so a batch with one bad shot leaves all of them as they were.
 *
 * The write is idempotent. Naming a shot again with the values it already has is reported as
 * unchanged, not as an error, so a retried call is safe. Each command carries the stored value it
 * replaces, so the bus can build the inverse exactly, including any value the load had kept as unknown.
 */

import { nodeById, type ProjectState, type TreeNode } from '@caotang/store';

import type { ShotCommand } from './commands.js';
import { isAssetId } from './ids.js';
import { ANNOTATE_MAX_SHOTS, isShotNode, isStoryboardFolder, type ShotMeta } from './model.js';
import { shotFieldOf } from './nodes.js';
import { storyboardFolders } from './ordering.js';
import { checkEnum, checkShotMeta, isPlainObject, readShotMeta, writeShotMeta } from './shot-meta.js';
import { ok, refuse, type StoryboardResult } from './result.js';

/** The camera fields `spec` may set. Closed: a field outside this list is refused, not ignored. */
export const SPEC_FIELDS = ['shotSize', 'cameraAngle', 'cameraMovement', 'lens', 'transition'] as const;

/**
 * A type alias, not an interface, on purpose: an alias has an implicit index signature, so the
 * field-by-field walk below can read it as a `Record`, the way the bus reads its own params.
 */
export type SpecPatch = {
  readonly shotSize?: string;
  readonly cameraAngle?: string;
  readonly cameraMovement?: string;
  readonly lens?: string;
  readonly transition?: string;
};

export interface AnnotateRequest {
  /** Shot ids, at most {@link ANNOTATE_MAX_SHOTS}, each named once. */
  readonly shots: readonly string[];
  /** An asset already in `assets/`. The refusal names the import step when it is missing. */
  readonly image?: { readonly assetId: string };
  readonly spec?: SpecPatch;
  readonly action?: string;
}

export interface AnnotateChange {
  readonly nodeId: string;
  /** The stored value before the write, `undefined` when the shot had none. */
  readonly before: unknown;
  /** The stored value the write produces. */
  readonly after: Record<string, unknown>;
}

export interface AnnotatePlan {
  readonly changes: readonly AnnotateChange[];
  /** Shots the request would not change. Naming them is correct and is not an error. */
  readonly unchanged: readonly string[];
  /** One `shot.setMeta` per entry of `changes`, in the same order. The bus applies them as one group. */
  readonly commands: readonly ShotCommand[];
}

function unknownShotMessage(state: ProjectState, id: string): string {
  const folders = storyboardFolders(state);
  if (folders.length === 0) {
    return `no shot "${id}" exists, and there is no storyboard folder yet. Derive shots from a scene with shots.derive first.`;
  }
  const listed = folders.map((folder) => `"${folder.title}" (${folder.id})`).join(', ');
  return `no shot "${id}". The storyboards are ${listed}. Read their shots with binder.read_tree, then name a shot id.`;
}

/** Names the storyboard a non-shot node sits in, so the caller can name that storyboard's shots instead. */
function notAShotMessage(state: ProjectState, node: TreeNode): string {
  const parent = node.parentId === null ? undefined : nodeById(state, node.parentId);
  const where =
    parent !== undefined && isStoryboardFolder(parent)
      ? ` It sits in the storyboard "${parent.title}" (${parent.id}); name that storyboard's shots instead.`
      : '';
  return `"${node.title}" (${node.id}) is a ${node.type}, not a shot.${where}`;
}

/**
 * The plan for one annotate call: every named shot checked, every value checked against its closed
 * list, and the stored value each shot would hold. Pure: `state` is not changed.
 */
export function planAnnotate(state: ProjectState, request: AnnotateRequest, present: ReadonlySet<string>): StoryboardResult<AnnotatePlan> {
  const ids = request.shots;
  if (ids.length === 0) return refuse('batch-empty', 'no shots were named. Pass the ids of the shots to annotate, read from binder.read_tree.');
  if (ids.length > ANNOTATE_MAX_SHOTS) {
    return refuse('batch-too-large', `${ids.length} shots were named; the limit is ${ANNOTATE_MAX_SHOTS} per call. Split the batch and call again.`);
  }
  const named = new Set<string>();
  for (const id of ids) {
    if (named.has(id)) return refuse('batch-duplicate', `shot "${id}" is named twice; name each shot once.`);
    named.add(id);
  }
  if (request.image === undefined && request.spec === undefined && request.action === undefined) {
    return refuse('nothing-to-set', 'nothing to set: pass an image, a spec or an action.');
  }

  const patch: Record<string, unknown> = {};
  if (request.image !== undefined) {
    const assetId = request.image.assetId;
    if (!isAssetId(assetId)) return refuse('image-id-invalid', 'image.assetId must be an asset id, as import returns it (a_ and ten characters).');
    if (!present.has(assetId)) {
      return refuse('image-missing', `there is no image "${assetId}" in assets/. Import the image first, then annotate with the id it returns.`);
    }
    patch.image = assetId;
  }
  if (request.spec !== undefined) {
    const spec: Record<string, unknown> = request.spec;
    for (const key of Object.keys(spec)) {
      if (!(SPEC_FIELDS as readonly string[]).includes(key)) {
        return refuse('spec-field-unknown', `spec has the field "${key}", which is not one of ${SPEC_FIELDS.join(', ')}.`);
      }
    }
    for (const field of ['shotSize', 'cameraAngle', 'cameraMovement', 'transition'] as const) {
      const value = spec[field];
      if (value === undefined) continue;
      const refusal = checkEnum(field, value);
      if (refusal !== undefined) return { ok: false, refusal };
      patch[field] = value;
    }
    if (spec.lens !== undefined) patch.lens = spec.lens;
  }
  if (request.action !== undefined) patch.action = request.action;

  const patchRefusal = checkShotMeta(patch);
  if (patchRefusal !== undefined) return { ok: false, refusal: patchRefusal };

  const changes: AnnotateChange[] = [];
  const unchanged: string[] = [];
  for (const id of ids) {
    const node = nodeById(state, id);
    if (node === undefined) return refuse('shot-unknown', unknownShotMessage(state, id));
    if (!isShotNode(node)) return refuse('not-a-shot', notAShotMessage(state, node));

    const before = shotFieldOf(node);
    if (before !== undefined && !isPlainObject(before)) {
      return refuse('shot-malformed', `shot "${id}" holds metadata that is not an object, so it cannot be annotated until that is fixed by hand.`);
    }
    const read = readShotMeta(before);
    // A patched field's new value is written in place of any unknown value it held, because the writer
    // prefers the known value for a key; the kept unknown value is shadowed, not carried.
    const meta = { ...read.meta, ...patch } as ShotMeta;
    const after = writeShotMeta({ meta, unknownValues: read.unknownValues, unknownFields: read.unknownFields, notices: [] });

    const normalizedBefore = before === undefined ? undefined : writeShotMeta(read);
    if (normalizedBefore !== undefined && JSON.stringify(normalizedBefore) === JSON.stringify(after)) {
      unchanged.push(id);
    } else {
      changes.push({ nodeId: id, before, after });
    }
  }
  // `before` is the stored value the plan read, `null` when there was none. The bus's guard compares it
  // with the value at apply time, and the same value is what its inverse writes back.
  const commands: ShotCommand[] = changes.map((change) => ({
    name: 'shot.setMeta',
    params: { nodeId: change.nodeId, stored: change.after, expect: change.before ?? null },
  }));
  return ok({ changes, unchanged, commands });
}
