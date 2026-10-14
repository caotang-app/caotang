/**
 * The two tool entries, in the harness's entry shape, and their handlers. The metadata is checked against
 * storyboard.md §4 by spec-parity.test.ts; `harness-contract.test.ts` checks the shape against the harness's
 * own types. This file checks the entries' behaviour and the handlers' results.
 */

import { describe, expect, it } from 'vitest';

import {
  STORYBOARD_TOOL_ENTRIES,
  STORYBOARD_TOOL_NAMES,
  addShotNode,
  annotateShotsTool,
  applyStoryboardCommands,
  commandErrorOf,
  deriveShotsTool,
  importImage,
  isStoryboardToolName,
  presentAssetIds,
  type ShotCommand,
  type StoryboardToolContext,
} from '../src/index.js';

import { CountingFs, NOW, buildFixture, pngBytes, seqRandom, treeSnapshot } from './fixtures.js';

const PROPOSAL = {
  shots: [{ shotSize: 'WS', action: 'Elena crosses the empty quay.', dialogueQuotes: ['Gulls circle.'] }],
};

/** The bus command names a storyboard plan may contain. Anything else would be a command the bus does not have. */
const PLAN_COMMAND_NAMES: readonly ShotCommand['name'][] = ['storyboard.create', 'shot.create', 'shot.setMeta', 'binder.move'];

function entry(name: string) {
  const found = STORYBOARD_TOOL_ENTRIES.find((candidate) => candidate.meta.name === name);
  if (found === undefined) throw new Error(`no entry ${name}`);
  return found;
}

function context(state: StoryboardToolContext['state'], extra: Partial<StoryboardToolContext> = {}): StoryboardToolContext {
  return { state, presentAssets: new Set(), now: NOW, randomBytes: seqRandom(11), ...extra };
}

describe('the entries have the harness’s shape', () => {
  it('names the two tools in the order the spec gives them, as port entries with extension surface', () => {
    expect(STORYBOARD_TOOL_ENTRIES.map((candidate) => candidate.meta.name)).toEqual(['shots.derive', 'shots.annotate']);
    expect([...STORYBOARD_TOOL_NAMES]).toEqual(['shots.derive', 'shots.annotate']);
    for (const candidate of STORYBOARD_TOOL_ENTRIES) {
      expect(candidate.kind).toBe('port');
      expect(candidate.port).toBe(candidate.meta.name);
      expect(candidate.meta.surface).toBe('extension');
      expect(candidate.meta.descriptionVersion).toBe(1);
      expect(candidate.meta.description.length).toBeGreaterThan(40);
      expect(candidate.meta.undoable).toBe(true);
    }
  });

  it('gives derive a write-confirm risk and annotate a write-auto one, as the spec’s table does', () => {
    expect(entry('shots.derive').meta.risk).toBe('write-confirm');
    expect(entry('shots.annotate').meta.risk).toBe('write-auto');
  });

  it('requires a document for derive, and a list of shots for annotate, with the batch bound in the schema', () => {
    expect(entry('shots.derive').params).toMatchObject({ kind: 'object', required: ['doc'] });
    const shots = entry('shots.annotate').params.properties['shots'];
    expect(shots).toMatchObject({ kind: 'array', minItems: 1, maxItems: 50, unique: true });
  });

  it('closes the granularity to the two values the spec names, defaulting to key-shots', () => {
    expect(entry('shots.derive').params.properties['granularity']).toMatchObject({
      kind: 'enum',
      values: ['key-shots', 'full-coverage'],
      default: 'key-shots',
    });
  });

  it('closes the spec’s camera fields to their lists, and refuses an annotate that sets nothing with a CommandError', () => {
    const spec = entry('shots.annotate').params.properties['spec'];
    expect(spec).toMatchObject({ kind: 'object', required: [] });
    const refine = entry('shots.annotate').refine;
    // The harness reports a refine's value as the refusal, so it must be a CommandError: a bare string would reach the model unwrapped.
    expect(refine?.({ shots: ['n_X'] })).toMatchObject({
      code: 'invalid-params',
      message: 'nothing to set: pass an image, a spec or an action',
      correctiveHint: 'add an image, a spec or an action',
    });
    expect(refine?.({ shots: ['n_X'], action: 'x' })).toBeUndefined();
  });

  it('recognises its own names, and no others', () => {
    expect(isStoryboardToolName('shots.derive')).toBe(true);
    expect(isStoryboardToolName('shots.annotate')).toBe(true);
    expect(isStoryboardToolName('shots.delete')).toBe(false);
    expect(isStoryboardToolName(undefined)).toBe(false);
  });
});

describe('the refusals a handler returns are the bus’s CommandError, with the storyboard code and askBack kept', () => {
  it('maps a refusal that names a missing thing to not-found, and a conflict to revision-conflict', () => {
    expect(commandErrorOf({ code: 'shot-unknown', message: 'no shot' })).toEqual({
      code: 'not-found',
      message: 'no shot',
      details: { storyboardCode: 'shot-unknown' },
    });
    expect(commandErrorOf({ code: 'scene-moved', message: 'moved', askBack: 'conflict' })).toEqual({
      code: 'revision-conflict',
      message: 'moved',
      details: { storyboardCode: 'scene-moved', askBack: 'conflict' },
    });
  });

  it('maps a batch over its bound to limit-exceeded, and anything else to invalid-params', () => {
    expect(commandErrorOf({ code: 'batch-too-large', message: 'split it' }).code).toBe('limit-exceeded');
    expect(commandErrorOf({ code: 'enum-invalid', message: 'list the values' }).code).toBe('invalid-params');
  });

  it('gives a handler refusal the same shape: an error object with a code and a message, never a bare string', () => {
    const fixture = buildFixture();
    const result = deriveShotsTool({ doc: 'nope' }, context(fixture.state, { proposal: PROPOSAL }));
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found', message: expect.any(String) } });
    expect(typeof (result.ok ? undefined : result.error)).toBe('object');
  });
});

describe('shots.derive: the handler plans and returns the commands, and applies nothing', () => {
  it('returns the plan as the card, and leaves the project as it was', () => {
    const fixture = buildFixture();
    const before = treeSnapshot(fixture.state);
    const result = deriveShotsTool({ doc: 'scene1' }, context(fixture.state, { proposal: PROPOSAL }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.shots).toHaveLength(1);
      expect(result.value.summary).toContain('"Harbour — Shots" with 1 shot, awaiting approval');
    }
    expect(treeSnapshot(fixture.state)).toBe(before);
  });

  it('returns commands the bus can run: a storyboard, then one card per shot, and nothing outside the plan’s names', () => {
    const fixture = buildFixture();
    const result = deriveShotsTool({ doc: 'scene1' }, context(fixture.state, { proposal: PROPOSAL }));
    if (!result.ok) throw new Error('plan refused');
    expect(result.value.commands.map((command) => command.name)).toEqual(['storyboard.create', 'shot.create']);
    for (const command of result.value.commands) expect(PLAN_COMMAND_NAMES).toContain(command.name);
  });

  it('carries the granularity default and the style note into the plan', () => {
    const fixture = buildFixture();
    const result = deriveShotsTool({ doc: 'scene1', styleNote: 'tight' }, context(fixture.state, { proposal: PROPOSAL }));
    expect(result.ok && result.value.plan).toMatchObject({ granularity: 'key-shots', styleNote: 'tight' });
  });

  it('refuses a missing or blank document, and an unknown granularity, without reading the proposal', () => {
    const fixture = buildFixture();
    expect(deriveShotsTool({}, context(fixture.state, { proposal: PROPOSAL }))).toMatchObject({
      ok: false,
      error: { code: 'not-found', details: { storyboardCode: 'doc-missing' } },
    });
    expect(deriveShotsTool({ doc: '  ' }, context(fixture.state, { proposal: PROPOSAL }))).toMatchObject({ ok: false });
    expect(deriveShotsTool({ doc: 'scene1', granularity: 'some' }, context(fixture.state, { proposal: PROPOSAL }))).toMatchObject({
      ok: false,
      error: { details: { storyboardCode: 'granularity-invalid' } },
    });
  });

  it('refuses a prose scene with the spec’s words, through the handler too', () => {
    const fixture = buildFixture();
    const result = deriveShotsTool({ doc: 'prose1' }, context(fixture.state, { proposal: PROPOSAL }));
    expect(result.ok === false && result.error.message).toContain('derive works on screenplay scenes — this doc is prose');
  });

  it('its commands, applied later as the bus would, create what the card showed', () => {
    const fixture = buildFixture();
    const result = deriveShotsTool({ doc: 'scene1' }, context(fixture.state, { proposal: PROPOSAL }));
    if (!result.ok) throw new Error('plan refused');
    const applied = applyStoryboardCommands(fixture.state, result.value.commands, { now: NOW });
    expect(applied.ok).toBe(true);
    expect(fixture.state.manifest.tree.some((node) => node.id === result.value.plan.folderId)).toBe(true);
    expect(fixture.state.manifest.tree.some((node) => node.id === result.value.plan.shotIds[0])).toBe(true);
  });
});

describe('shots.annotate: the handler plans and returns the commands; the bus applies them as one group', () => {
  it('returns commands that, applied, change the shot; the handler itself changes nothing', async () => {
    const fixture = buildFixture();
    addShotNode(fixture.state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    const fs = new CountingFs();
    const imported = await importImage(fs, pngBytes(), {});
    if (!imported.ok) throw new Error('import failed');
    const before = treeSnapshot(fixture.state);

    const result = annotateShotsTool(
      { shots: ['n_SHOTONE001'], image: { assetId: imported.value.assetId }, spec: { shotSize: 'MS' } },
      context(fixture.state, { presentAssets: await presentAssetIds(fs) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('1 shot changed.');
    expect(result.value.commands.map((command) => command.name)).toEqual(['shot.setMeta']);
    expect(treeSnapshot(fixture.state)).toBe(before);

    expect(applyStoryboardCommands(fixture.state, result.value.commands).ok).toBe(true);
    expect(treeSnapshot(fixture.state)).not.toBe(before);
  });

  it('reports a batch that changed nothing as unchanged, not as an error, and returns no commands', () => {
    const fixture = buildFixture();
    addShotNode(fixture.state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    const result = annotateShotsTool({ shots: ['n_SHOTONE001'], action: 'a' }, context(fixture.state));
    expect(result.ok && result.value.summary).toBe('0 shots changed, 1 already had these values.');
    expect(result.ok && result.value.commands).toEqual([]);
  });

  it('refuses a malformed call field by field, with a CommandError for each', () => {
    const fixture = buildFixture();
    const ctx = context(fixture.state);
    expect(annotateShotsTool({ shots: 'n_X' }, ctx)).toMatchObject({ ok: false, error: { details: { storyboardCode: 'shots-invalid' } } });
    expect(annotateShotsTool({ shots: ['n_X'], image: 'a_X' }, ctx)).toMatchObject({ ok: false, error: { details: { storyboardCode: 'image-invalid' } } });
    expect(annotateShotsTool({ shots: ['n_X'], spec: 'WS' }, ctx)).toMatchObject({ ok: false, error: { details: { storyboardCode: 'spec-invalid' } } });
    expect(annotateShotsTool({ shots: ['n_X'], action: 3 }, ctx)).toMatchObject({ ok: false, error: { details: { storyboardCode: 'action-invalid' } } });
  });

  it('returns no commands when one shot in the batch is refused, and changes nothing', () => {
    const fixture = buildFixture();
    addShotNode(fixture.state, { parentId: 'board1', title: 'one', stored: { action: 'a' }, id: 'n_SHOTONE001', now: NOW });
    const before = treeSnapshot(fixture.state);
    const result = annotateShotsTool({ shots: ['n_SHOTONE001', 'n_NOPE00001'], action: 'changed' }, context(fixture.state));
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(result).not.toHaveProperty('value');
    expect(treeSnapshot(fixture.state)).toBe(before);
  });
});
