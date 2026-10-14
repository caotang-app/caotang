/**
 * The shared fixture: one small storyboard with two storyboard folders, six codex entries that cover
 * every include policy, a few assets, and a fake model that records each request. Nothing here reaches
 * the network. The fake model is the only model the tests run against.
 */

import type { TreeNode } from '@caotang/store';

import type {
  AssetRecord,
  CodexEntryWithRefs,
  PromptModel,
  PromptModelReply,
  PromptModelRequest,
  ShotNode,
  StoryboardSnapshot,
  VideoShotRef,
} from '../src/index.js';

export function codexEntry(name: string, overrides: Partial<CodexEntryWithRefs> = {}): CodexEntryWithRefs {
  return {
    id: `c_${name.toLowerCase().replace(/\W+/g, '_')}`,
    name,
    aliases: [],
    type: 'character',
    description: `About ${name}.`,
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    ...overrides,
  };
}

export function treeNode(id: string, parentId: string | null, type: string, title: string, order: number, synopsis = ''): TreeNode {
  return { id, parentId, type, title, order, status: null, label: null, keywords: [], synopsis, notes: '' };
}

export const ELENA = codexEntry('Elena', {
  id: 'c_elena',
  aliases: ['Ellie'],
  description: 'A cartographer who maps the harbour. Dark red coat.',
  visualRefs: ['a_elena'],
});
export const HARBOUR = codexEntry('Harbour', {
  id: 'c_harbour',
  type: 'location',
  description: 'A fog-bound port.',
  visualRefs: ['a_harbor'],
});
export const WOLF = codexEntry('Wolf', {
  id: 'c_wolf',
  type: 'object',
  includePolicy: 'never',
  description: "Spoiler: the wolf is the ferryman's daughter.",
  visualRefs: ['a_wolf'],
});
export const STYLE = codexEntry('Style guide', {
  id: 'c_style',
  type: 'lore',
  includePolicy: 'always',
  description: 'Muted palette; film grain.',
});
export const LANTERN = codexEntry('Lantern', {
  id: 'c_lantern',
  type: 'object',
  includePolicy: 'always',
  description: '',
});
export const FERRY = codexEntry('Ferry', {
  id: 'c_ferry',
  type: 'object',
  includePolicy: 'manual',
  attachments: ['board1'],
  description: 'The ferry Maren.',
  visualRefs: ['a_ferry'],
});

export const ASSETS: ReadonlyMap<string, AssetRecord> = new Map<string, AssetRecord>([
  ['a_elena', { id: 'a_elena', fileName: 'a_elena.png', label: 'Elena front' }],
  ['a_harbor', { id: 'a_harbor', fileName: 'a_harbor.jpg' }],
  ['a_wolf', { id: 'a_wolf', fileName: 'a_wolf.png' }],
  ['a_ferry', { id: 'a_ferry', fileName: 'a_ferry.png' }],
  ['a_first', { id: 'a_first', fileName: 'a_first.png' }],
]);

/** Two storyboard folders under two acts: `board1` holds s1–s3, and `board2` holds s4. */
export const TREE: readonly TreeNode[] = [
  treeNode('root', null, 'root', 'Novel', 0),
  treeNode('act1', 'root', 'folder', 'Act 1', 10, 'The harbour town wakes to fog.'),
  treeNode('scene1', 'act1', 'document', 'Scene 1', 10, 'Elena meets the ferryman.'),
  treeNode('board1', 'act1', 'folder', 'Scene 1 — Shots', 20, 'Shots for the quay.'),
  treeNode('s1', 'board1', 'shot', 'Shot A', 10),
  treeNode('s2', 'board1', 'shot', 'Shot B', 20),
  treeNode('s3', 'board1', 'shot', 'Shot C', 30),
  treeNode('act2', 'root', 'folder', 'Act 2', 20),
  treeNode('board2', 'act2', 'folder', 'Shots — Act 2', 10),
  treeNode('s4', 'board2', 'shot', 'Shot D', 10),
];

export const SHOTS: readonly ShotNode[] = [
  {
    id: 's1',
    action: 'Elena walks down the quay toward the ferry.',
    imageAlt: 'Elena on the quay, fog behind her.',
    shotSize: 'MCU',
    cameraAngle: 'eye',
    cameraMovement: 'dolly-in',
    lens: '35mm',
    durationSec: 5,
    covered: [{ label: 'Scene 1, cue ELENA', text: 'ELENA: "We leave at dawn."' }],
  },
  { id: 's2', action: 'The ferryman points at the harbour.', durationSec: 8, covered: [] },
  { id: 's3', action: 'Fog over the water.', durationSec: 5, covered: [] },
  { id: 's4', action: 'The wolf watches from the harbour at night.', durationSec: 5, covered: [] },
];

export const CODEX: readonly CodexEntryWithRefs[] = [ELENA, HARBOUR, WOLF, STYLE, LANTERN, FERRY];

/** The shared storyboard. A test that needs another shape builds its own from the parts above. */
export function storyboard(overrides: Partial<StoryboardSnapshot> = {}): StoryboardSnapshot {
  return { tree: TREE, shots: SHOTS, codex: CODEX, assets: ASSETS, ...overrides };
}

/** A shot's record for one vendor, for tests that start from a drafted or hand-set prompt. */
export function refFor(vendor: string, overrides: Partial<VideoShotRef> = {}): VideoShotRef {
  return {
    vendor,
    mode: 't2v',
    prompt: { camera: 'Slow dolly-in', subject: 'Elena', action: 'walks down the quay', context: 'Harbour at dusk', style: 'Film grain' },
    references: [],
    ...overrides,
  };
}

/** A shot with its record for one vendor set. */
export function withRef(shot: ShotNode, ref: VideoShotRef): ShotNode {
  return { ...shot, vendorRefs: [ref] };
}

export interface FakeModel extends PromptModel {
  readonly calls: PromptModelRequest[];
}

/**
 * A deterministic model. The responder sees each request and its index, and returns text, a reply
 * with usage, or an error to throw. Every request is recorded, so a test can count the calls.
 */
export function fakeModel(respond: (request: PromptModelRequest, index: number) => string | Error | PromptModelReply): FakeModel {
  const calls: PromptModelRequest[] = [];
  return {
    model: 'fake-1',
    calls,
    async complete(request: PromptModelRequest): Promise<PromptModelReply> {
      calls.push(request);
      const reply = respond(request, calls.length - 1);
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'string') return { content: reply, usage: { promptTokens: 100, completionTokens: 20 } };
      return reply;
    },
  };
}

/** The shot number a draft request is for, read from its user message. */
export function shotNumberOfRequest(request: PromptModelRequest): number {
  return Number(/Shot (\d+) of the storyboard/.exec(request.user)?.[1] ?? '0');
}

/** A draft responder that answers each shot number from a table, as JSON. Unlisted shots get an empty object. */
export function draftReply(byNumber: Readonly<Record<number, Record<string, unknown>>>): (request: PromptModelRequest) => string {
  return (request) => JSON.stringify(byNumber[shotNumberOfRequest(request)] ?? {});
}
