/**
 * Storyboard: the descriptor of `shot.importImage`. Its validator checks the closed key set and the two strings, and
 * nothing else: whether the node is a shot is the store's apply to say, before any byte is written.
 */

import { describe, expect, it } from 'vitest';

import { COMMAND_NAMES, COMMAND_REGISTRY, shotImageCommands, type ValidationSnapshot } from '../src/index.js';
import { makeSnapshot } from './fixtures.js';

function validate(params: unknown): { ok: boolean; value?: unknown; code?: string; target?: string } {
  const snapshot: ValidationSnapshot = makeSnapshot();
  const result = shotImageCommands.shotImportImage.validate(params, snapshot) as {
    ok: boolean;
    value?: unknown;
    error?: { code: string; target?: string };
  };
  return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.error?.code, target: result.error?.target };
}

describe('shot.importImage: the descriptor', () => {
  it('accepts a node id and a staging id, and returns them as the apply reads them', () => {
    expect(validate({ nodeId: 'n_SHOTONE001', stagingId: 'stg_ABCDEF0123' })).toEqual({
      ok: true,
      value: { nodeId: 'n_SHOTONE001', stagingId: 'stg_ABCDEF0123' },
    });
  });

  it('refuses a key the command does not declare, so a path or bytes cannot ride in as a param', () => {
    expect(validate({ nodeId: 'n_SHOTONE001', stagingId: 'stg_ABCDEF0123', path: 'assets/x.png' })).toMatchObject({ ok: false });
    expect(validate({ nodeId: 'n_SHOTONE001', stagingId: 'stg_ABCDEF0123', bytes: [137, 80] })).toMatchObject({ ok: false });
  });

  it('refuses a blank or missing node id, and a missing staging id', () => {
    expect(validate({ nodeId: '   ', stagingId: 'stg_ABCDEF0123' })).toMatchObject({ ok: false, target: 'nodeId' });
    expect(validate({ stagingId: 'stg_ABCDEF0123' })).toMatchObject({ ok: false });
    expect(validate({ nodeId: 'n_SHOTONE001' })).toMatchObject({ ok: false, target: 'stagingId' });
  });

  it('is a write the gate asks about for an agent, is undone by its inverse, and is asynchronous', () => {
    const descriptor = shotImageCommands.shotImportImage;
    expect(descriptor.agentRisk).toBe('write-confirm');
    expect(descriptor.undo).toBe('inverse');
    expect(descriptor.asyncApply).toBe(true);
    expect(descriptor.mutates).toBe('project');
  });

  it('is named in the closed set and registered, once', () => {
    expect(COMMAND_NAMES.filter((name) => name === 'shot.importImage')).toHaveLength(1);
    expect(COMMAND_REGISTRY['shot.importImage'].descriptor).toBe(shotImageCommands.shotImportImage);
  });
});
