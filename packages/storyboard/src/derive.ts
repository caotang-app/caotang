/**
 * `shots.derive` — [storyboard.md](../../../docs/architecture/storyboard.md) §4, tool 18.
 *
 * The model proposes the shots for one screenplay scene. This module decides whether the proposal
 * is well formed, captures each dialogue anchor against the scene as it stands, and produces the plan a
 * writer approves. Planning creates nothing: the plan carries the commands that create the
 * `<Scene Title> — Shots` folder and its shot cards, in order, and the bus applies them as one group.
 * The folder and shot ids are minted here, so the card names exactly what the commands create. The
 * scene's revision and parent are carried on the folder command, and the apply refuses if either moved.
 *
 * The model never supplies offsets. It quotes the scene's text, and the offsets are found here,
 * against the body the plan was made from. A quote the scene does not hold verbatim, or holds more
 * than once, gets no coverage and a note; a guessed range would be a silent mis-address (the
 * edit-anchors §3 posture, applied at capture time).
 */

import { getBody, getRevision, nodeById, type ProjectState } from '@caotang/store';
import { newId, type RandomBytes } from '@caotang/ids';

import type { ShotCommand } from './commands.js';
import { ANCHOR_MAX_EXACT_CHARS, captureTextAnchor, locateQuote } from './anchors.js';
import {
  DERIVE_FOLDER_SUFFIX,
  DERIVE_GRANULARITIES,
  DERIVE_MAX_SHOTS,
  DERIVE_TITLE_CHARS,
  specRowOf,
  isScreenplayDocument,
  type DeriveGranularity,
  type DialogueCoverage,
  type ShotMeta,
} from './model.js';
import { checkEnum, checkShotMeta, isPlainObject, writeShotMeta } from './shot-meta.js';
import { ok, refuse, type StoryboardRefusal, type StoryboardResult } from './result.js';

/** The fields a proposed shot may carry. Closed, so a field the schema lacks is refused rather than dropped. */
export const PROPOSED_SHOT_FIELDS = [
  'shotSize',
  'cameraAngle',
  'cameraMovement',
  'lens',
  'action',
  'durationSec',
  'transition',
  'dialogueQuotes',
] as const;

/**
 * The shape the model proposes, as the loop stages it. `dialogueQuotes` is verbatim scene text
 * that the shot covers; this module turns each quote into an anchor.
 */
export interface DeriveProposal {
  readonly shots: ReadonlyArray<{
    readonly shotSize?: string;
    readonly cameraAngle?: string;
    readonly cameraMovement?: string;
    readonly lens?: string;
    readonly action?: string;
    readonly durationSec?: number;
    readonly transition?: string;
    readonly dialogueQuotes?: readonly string[];
  }>;
}

export interface DeriveRequest {
  /** The resolved id of a screenplay scene document. The harness resolves a title to it, as `doc.read` does. */
  readonly docId: string;
  readonly granularity?: DeriveGranularity;
  /** Passed to the model with the scene, and recorded on the plan. The engine does not read it. */
  readonly styleNote?: string;
}

/** A quote this shot could not be anchored to, and why. Reported on the plan; no coverage is kept for it. */
export interface UnanchoredQuote {
  readonly quote: string;
  readonly reason: 'not-found' | 'ambiguous';
  /** How many times the quote occurs, when it occurs more than once. */
  readonly count?: number;
}

export interface PlannedShot {
  /** 1-based position in the proposal, which is the position the card will take in the new folder. */
  readonly number: number;
  readonly title: string;
  /** The stored `shot` object the card carries, anchors included. Never mutated after planning. */
  readonly stored: Record<string, unknown>;
  readonly unanchored: readonly UnanchoredQuote[];
}

export interface DerivePlan {
  readonly docId: string;
  readonly sceneTitle: string;
  readonly sceneParentId: string;
  readonly folderTitle: string;
  readonly granularity: DeriveGranularity;
  readonly styleNote?: string;
  /** The scene's revision when the anchors were captured. The `storyboard.create` command refuses if it has moved. */
  readonly revision: number;
  readonly shots: readonly PlannedShot[];
  /** The id the folder command creates. */
  readonly folderId: string;
  /** The ids the shot commands create, in the plan's shot order. */
  readonly shotIds: readonly string[];
  /** The commands the bus applies, in order: the folder first, then one card per shot. */
  readonly commands: readonly ShotCommand[];
  /** The target tree, one line per node the apply will create, for the plan card. */
  readonly treeDiff: readonly string[];
  readonly notes: readonly string[];
}

/** Where the ids of a plan come from: the minting seam the tests fix, as the node helpers take it. */
export interface DeriveOptions {
  readonly randomBytes?: RandomBytes;
}

/** The title a shot card takes: its action's first line, cut to {@link DERIVE_TITLE_CHARS}. */
export function shotTitleOf(action: string | undefined): string {
  const line = (action ?? '')
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text !== '');
  if (line === undefined) return 'Shot';
  const chars = [...line];
  if (chars.length <= DERIVE_TITLE_CHARS) return line;
  return `${chars.slice(0, DERIVE_TITLE_CHARS - 1).join('')}…`;
}

/** Prefixes a refusal with the shot it is about, so the model knows which item to fix. */
function inShot(refusal: StoryboardRefusal, number: number): { readonly ok: false; readonly refusal: StoryboardRefusal } {
  return { ok: false, refusal: { ...refusal, message: `shot ${number}: ${refusal.message}` } };
}

interface ParsedShot {
  readonly meta: Record<string, unknown>;
  readonly quotes: readonly string[];
}

/** Checks the proposal's shape and each shot's values. Nothing here touches the scene. */
function parseProposal(raw: unknown): StoryboardResult<ParsedShot[]> {
  if (!isPlainObject(raw) || !Array.isArray(raw.shots)) {
    return refuse('proposal-malformed', 'the proposal must be an object with a list of shots');
  }
  const items: unknown[] = raw.shots;
  if (items.length === 0) {
    return refuse(
      'proposal-empty',
      'no shots were proposed. Give the scene more detail, or derive again with granularity full-coverage.',
      'needs_input',
    );
  }
  if (items.length > DERIVE_MAX_SHOTS) {
    return refuse(
      'too-many-shots',
      `${items.length} shots were proposed; the limit is ${DERIVE_MAX_SHOTS}. Split the scene into parts and derive each one.`,
    );
  }

  const parsed: ParsedShot[] = [];
  for (const [index, item] of items.entries()) {
    const number = index + 1;
    if (!isPlainObject(item)) return refuse('proposal-malformed', `shot ${number} is not an object`);
    for (const key of Object.keys(item)) {
      if (!(PROPOSED_SHOT_FIELDS as readonly string[]).includes(key)) {
        return refuse(
          'proposal-unknown-field',
          `shot ${number} has the field "${key}", which is not in the shot schema. The fields are ${PROPOSED_SHOT_FIELDS.join(', ')}.`,
        );
      }
    }

    const meta: Record<string, unknown> = {};
    for (const field of ['shotSize', 'cameraAngle', 'cameraMovement', 'transition'] as const) {
      const value = item[field];
      if (value === undefined) continue;
      const refusal = checkEnum(field, value);
      if (refusal !== undefined) return inShot(refusal, number);
      meta[field] = value;
    }
    for (const field of ['lens', 'action', 'durationSec'] as const) {
      if (item[field] !== undefined) meta[field] = item[field];
    }
    const shotRefusal = checkShotMeta(meta);
    if (shotRefusal !== undefined) return inShot(shotRefusal, number);

    const quotes: string[] = [];
    if (item.dialogueQuotes !== undefined) {
      if (!Array.isArray(item.dialogueQuotes)) return refuse('proposal-malformed', `shot ${number}: dialogueQuotes must be a list of text`);
      for (const quote of item.dialogueQuotes as unknown[]) {
        if (typeof quote !== 'string' || quote === '') {
          return refuse('proposal-malformed', `shot ${number}: each dialogue quote must be non-empty text`);
        }
        if (quote.length > ANCHOR_MAX_EXACT_CHARS) {
          return refuse(
            'quote-too-long',
            `shot ${number}: a dialogue quote is ${quote.length} characters; the limit is ${ANCHOR_MAX_EXACT_CHARS}. Quote the cue and its first line.`,
          );
        }
        quotes.push(quote);
      }
    }
    parsed.push({ meta, quotes });
  }
  return ok(parsed);
}

/**
 * The plan for one scene: the proposal checked, the anchors captured against the scene as it is
 * now, the ids minted, and the commands that create the storyboard written out. Pure: nothing in `state`
 * changes, and the commands are applied only by the bus.
 */
export function planDerive(state: ProjectState, request: DeriveRequest, proposal: unknown, options: DeriveOptions = {}): StoryboardResult<DerivePlan> {
  const scene = nodeById(state, request.docId);
  if (scene === undefined || scene.type !== 'document') {
    return refuse('doc-missing', `no document with id "${request.docId}". Read the binder with binder.read_tree and pass a document's id.`);
  }
  if (!isScreenplayDocument(scene)) {
    return refuse('not-screenplay', 'derive works on screenplay scenes — this doc is prose. Pick a scene document, or mark the scene as a screenplay first.');
  }
  if (scene.parentId === null) {
    return refuse('doc-orphan', `the scene "${scene.title}" has no parent folder to hold its shots, so nothing can be derived from it.`);
  }
  const body = getBody(state, scene.id);
  if (body.trim() === '') {
    return refuse('doc-empty', 'the scene is empty, so there is nothing to derive shots from. Write or paste the scene, then derive again.', 'needs_input');
  }

  const parsed = parseProposal(proposal);
  if (!parsed.ok) return parsed;

  const revision = getRevision(state, scene.id);
  const notes: string[] = [];
  const shots: PlannedShot[] = [];

  for (const [index, shot] of parsed.value.entries()) {
    const number = index + 1;
    const dialogue: DialogueCoverage[] = [];
    const unanchored: UnanchoredQuote[] = [];
    for (const quote of shot.quotes) {
      const location = locateQuote(body, quote);
      if (location.status === 'one') {
        const anchor = captureTextAnchor(body, location.from, location.to, revision);
        if (anchor !== undefined) {
          dialogue.push({ kind: 'fountain-element', docId: scene.id, anchor });
          continue;
        }
        unanchored.push({ quote, reason: 'not-found' });
      } else if (location.status === 'many') {
        unanchored.push({ quote, reason: 'ambiguous', count: location.count });
      } else {
        unanchored.push({ quote, reason: 'not-found' });
      }
    }

    const meta: Record<string, unknown> = { ...shot.meta };
    if (dialogue.length > 0) meta.dialogue = dialogue;
    const stored = writeShotMeta({ meta: meta as ShotMeta, unknownValues: {}, unknownFields: {}, notices: [] });
    for (const entry of unanchored) {
      notes.push(
        entry.reason === 'ambiguous'
          ? `shot ${number}: the quote "${snippetOf(entry.quote)}" appears ${entry.count ?? 2} times in the scene, so no coverage was kept for it`
          : `shot ${number}: the quote "${snippetOf(entry.quote)}" is not in the scene verbatim, so no coverage was kept for it`,
      );
    }
    const action = typeof shot.meta.action === 'string' ? shot.meta.action : undefined;
    shots.push({ number, title: shotTitleOf(action), stored, unanchored });
  }

  const parent = nodeById(state, scene.parentId);
  const folderTitle = `${scene.title}${DERIVE_FOLDER_SUFFIX}`;

  // Every id is minted against the ids already in the tree and the ones minted so far, so the folder and
  // the cards cannot collide with each other or with what is there. The folder is minted first.
  const taken = new Set(state.manifest.tree.map((node) => node.id));
  const mint = (): string => {
    const id = newId('n', { taken, ...(options.randomBytes !== undefined ? { randomBytes: options.randomBytes } : {}) });
    taken.add(id);
    return id;
  };
  const folderId = mint();
  const cards = shots.map((shot) => ({ shot, id: mint() }));
  const shotIds = cards.map((card) => card.id);

  const commands: ShotCommand[] = [
    {
      name: 'storyboard.create',
      params: {
        id: folderId,
        parentId: scene.parentId,
        title: folderTitle,
        scene: { id: scene.id, parentId: scene.parentId, revision },
      },
    },
    ...cards.map(
      ({ shot, id }): ShotCommand => ({
        name: 'shot.create',
        params: { id, parentId: folderId, title: shot.title, stored: shot.stored },
      }),
    ),
  ];

  const treeDiff = [
    `+ folder "${folderTitle}" (storyboard) under "${parent?.title ?? scene.parentId}"`,
    ...shots.map((shot) => {
      const row = specRowOf(shot.stored);
      return `  + shot ${shot.number} "${shot.title}"${row === '' ? '' : ` · ${row}`}`;
    }),
  ];

  const granularity = request.granularity ?? DERIVE_GRANULARITIES[0];
  return ok({
    docId: scene.id,
    sceneTitle: scene.title,
    sceneParentId: scene.parentId,
    folderTitle,
    granularity,
    ...(request.styleNote !== undefined ? { styleNote: request.styleNote } : {}),
    revision,
    shots,
    folderId,
    shotIds,
    commands,
    treeDiff,
    notes,
  });
}

function snippetOf(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 39)}…`;
}

