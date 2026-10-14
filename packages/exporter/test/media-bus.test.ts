/**
 * The media-track formats through the bus: the same `export.compile` a user's click dispatches, with the registry,
 * the activity log and the undo store in the path. What is checked is what an artifact set does that a single file
 * does not: one log row for all of its files, one undo that removes all of them, and a name set that stays paired
 * when a second compile collides with the first.
 *
 * A media refusal reaches the bus through the store's port, which reports a thrown port error as `internal`
 * (see `export-commands.test.ts` in the store, and the two `it.fails` in `exporter.test.ts`). These tests pin
 * that today's behaviour, and that a refusal writes nothing, logs nothing and groups nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type Command,
  type CommandError,
  type ExecutionOutcome,
  type Result,
  type UndoStore,
} from '@caotang/bus';
import { createProjectCommandRegistry, MemoryArtifactFs, type ProjectState } from '@caotang/store';
import type { ExportRecipe } from '@caotang/store';
import { createExporter, type ExporterService } from '../src/index.js';
import { COMPILED_AT, PROJECT_NAME } from './fixture.js';
import { ASSETS, UNKEYED_INK, BROKEN_INK, makeMediaProject } from './media-fixture.js';

type Dispatch = Result<ExecutionOutcome, CommandError>;

interface Rig {
  readonly state: ProjectState;
  readonly fs: MemoryArtifactFs;
  readonly exporter: ExporterService;
  readonly bus: BusContext<ProjectState>;
  readonly undo: UndoStore;
  readonly run: (name: Command['name'], params: Record<string, unknown>) => Dispatch;
}

let serial = 0;

function rig(state: ProjectState = makeMediaProject()): Rig {
  const fs = new MemoryArtifactFs();
  const clock = { now: () => COMPILED_AT };
  const exporter = createExporter({
    readState: () => state,
    artifacts: fs,
    clock,
    metadata: () => ({ author: 'Ada Lovelace' }),
    assets: () => ASSETS,
  });
  const registry = createProjectCommandRegistry({ clock, exporter: exporter.commandPort() });
  const undo: UndoStore = createUndoStore({ dispatch: (command) => execute(command, bus, registry) });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log: createActivityLog(),
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  const run = (name: Command['name'], params: Record<string, unknown>): Dispatch => {
    serial += 1;
    const command = {
      id: `cmd_MEDIA${String(serial).padStart(6, '0')}`,
      name,
      params,
      issuedBy: 'user',
      createdAt: COMPILED_AT,
    } as Command;
    return execute(command, bus, registry);
  };
  return { state, fs, exporter, bus, undo, run };
}

function okValue(outcome: Dispatch): ExecutionOutcome {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.value;
}

function logRows(fs: MemoryArtifactFs): Array<Record<string, unknown>> {
  return JSON.parse(fs.snapshot()['exports/compile-log.json'] ?? '[]') as Array<Record<string, unknown>>;
}


/** A recipe as the manifest holds it: the exporter reads recipes from the state, and `recipe.save` is what writes them. */
function holdRecipe(r: { readonly state: ProjectState }, recipe: ExportRecipe): void {
  const kept = (r.state.manifest.recipes ?? []).filter((held) => held.name !== recipe.name);
  r.state.manifest.recipes = [...kept, recipe];
}

describe('a prompt pack through the bus — three artifacts, one compile', () => {
  it('writes the three artifacts, logs one row that names all three, and reports them as outputs', async () => {
    const r = rig();
    await r.exporter.ready();
    const outcome = okValue(r.run('export.compile', { format: 'promptpack', templateId: 'runway-gen4' }));
    await r.exporter.idle();

    const digest = outcome.result as { output: string; outputs?: string[] };
    const expected = [
      'exports/runway-gen4-prompt-pack.json',
      'exports/runway-gen4-prompt-pack.md',
      'exports/runway-gen4-shot-list.csv',
    ];
    expect(digest.output).toBe(expected[0]);
    expect(digest.outputs).toEqual(expected);
    for (const path of expected) expect(r.fs.snapshot()[path]).toBeDefined();

    const rows = logRows(r.fs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ format: 'promptpack', output: expected[0], outputs: expected });
  });

  it('undoes the whole set with one undo, and keeps the log row, as an undone compile should', async () => {
    const r = rig();
    await r.exporter.ready();
    const outcome = okValue(r.run('export.compile', { format: 'promptpack', templateId: 'runway-gen4' }));
    await r.exporter.idle();

    expect(r.undo.undo(outcome.undoGroupId ?? '').ok).toBe(true);
    await r.exporter.idle();
    expect(Object.keys(r.fs.snapshot()).filter((path) => path.startsWith('exports/runway-gen4'))).toEqual([]);
    expect(logRows(r.fs)).toHaveLength(1);
  });

  it('keeps a second compile of the same pack paired: the set takes one suffix, on every file', async () => {
    const r = rig();
    await r.exporter.ready();
    okValue(r.run('export.compile', { format: 'promptpack', templateId: 'runway-gen4' }));
    const second = okValue(r.run('export.compile', { format: 'promptpack', templateId: 'runway-gen4' }));
    await r.exporter.idle();

    expect((second.result as { outputs?: string[] }).outputs).toEqual([
      'exports/runway-gen4-prompt-pack-2.json',
      'exports/runway-gen4-prompt-pack-2.md',
      'exports/runway-gen4-shot-list-2.csv',
    ]);
  });
});

describe('the other media formats through the bus', () => {
  it('compiles a fountain screenplay to one file, logged as a fountain row', async () => {
    const r = rig();
    await r.exporter.ready();
    const outcome = okValue(r.run('export.compile', { format: 'fountain' }));
    await r.exporter.idle();

    const output = `exports/${PROJECT_NAME}.fountain`;
    expect((outcome.result as { output: string }).output).toBe(output);
    expect(r.fs.snapshot()[output]).toContain('INT. KITCHEN - DAY');
    expect(logRows(r.fs)[0]).toMatchObject({ format: 'fountain', output });
    expect(logRows(r.fs)[0]).not.toHaveProperty('outputs');
  });

  it('names a shot list compiled from a recipe after the recipe', async () => {
    const r = rig();
    await r.exporter.ready();
    holdRecipe(r, {
      name: 'Beta',
      includeRootIds: ['manuscript'],
      format: 'shot-list-csv',
      templateId: 'default',
      options: {},
    });
    const outcome = okValue(r.run('export.compile', { format: 'shot-list-csv', recipeName: 'Beta' }));
    await r.exporter.idle();

    expect((outcome.result as { output: string }).output).toBe('exports/Beta (shot list).csv');
  });
});

describe('a media refusal through the bus — nothing written, logged or grouped', () => {
  it('refuses a dialogue table with an unkeyed row, and writes, logs and groups nothing', async () => {
    const r = rig(makeMediaProject({ innkeeper: UNKEYED_INK }));
    await r.exporter.ready();
    const outcome = r.run('export.compile', { format: 'dialogue-csv' });
    await r.exporter.idle();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain('has no line id');
    expect(outcome.error.message).toContain('Nothing was compiled or written');
    expect(r.bus.log.length).toBe(0);
    expect(r.undo.groups()).toHaveLength(0);
    expect(r.fs.snapshot()).toEqual({});
  });

  it('refuses an Ink story that does not compile, and writes, logs and groups nothing', async () => {
    const r = rig(makeMediaProject({ innkeeper: BROKEN_INK }));
    await r.exporter.ready();
    const outcome = r.run('export.compile', { format: 'ink-json' });
    await r.exporter.idle();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain('"The innkeeper" does not compile');
    expect(r.bus.log.length).toBe(0);
    expect(r.undo.groups()).toHaveLength(0);
    expect(r.fs.snapshot()).toEqual({});
  });

  it('refuses a prompt pack for a vendor that is not installed, before anything is reserved', async () => {
    const r = rig();
    await r.exporter.ready();
    const outcome = r.run('export.compile', { format: 'promptpack', templateId: 'no-such-vendor' });
    expect(outcome.ok).toBe(false);
    expect(r.fs.snapshot()).toEqual({});
    expect(r.bus.log.length).toBe(0);
  });
});
