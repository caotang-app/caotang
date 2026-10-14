/**
 * `codex.upsert`'s visual references (video-prompt-pack.md §3, A5): the field is in the op's closed key set, it is shape-checked
 * as an asset id, and a list longer than the command's limit is refused. The bus cannot see the project's files, so a well-formed
 * id that names no picture is accepted here; the pack reports it as missing.
 */
import { describe, expect, it } from 'vitest';

import { COMMAND_REGISTRY, type CommandError, type Result } from '../src/index.js';
import { CODEX_ENTRY, makeSnapshot } from './fixtures.js';

const PORTRAIT = 'a_7K2QX9M4A1';
const HARBOUR = 'a_8K3QZ2M7RD';

function validate(params: unknown): Result<never, CommandError> {
  return COMMAND_REGISTRY['codex.upsert'].descriptor.validate(params, makeSnapshot()) as Result<never, CommandError>;
}

function accepted(result: Result<never, CommandError>): Record<string, unknown>[] {
  if (!result.ok) throw new Error(`expected an acceptance, got ${JSON.stringify(result.error)}`);
  return (result.value as unknown as { entries: Record<string, unknown>[] }).entries;
}

function failuresOf(result: Result<never, CommandError>): { target: string; message: string }[] {
  if (result.ok) throw new Error('expected a refusal, got an acceptance');
  return (result.error.details?.['failures'] ?? []) as { target: string; message: string }[];
}

describe('codex.upsert visualRefs', () => {
  it('accepts an update that sets the list, and keeps it in the narrowed op', () => {
    const [op] = accepted(validate({ entries: [{ action: 'update', id: CODEX_ENTRY, visualRefs: [PORTRAIT, HARBOUR] }] }));
    expect(op?.['visualRefs']).toEqual([PORTRAIT, HARBOUR]);
  });

  it('accepts a create that carries references, and an empty list that clears them', () => {
    const [created] = accepted(validate({ entries: [{ action: 'create', name: 'Harbour', visualRefs: [HARBOUR] }] }));
    expect(created?.['visualRefs']).toEqual([HARBOUR]);
    const [cleared] = accepted(validate({ entries: [{ action: 'update', id: CODEX_ENTRY, visualRefs: [] }] }));
    expect(cleared?.['visualRefs']).toEqual([]);
  });

  it('refuses a reference that is not an asset id, and names the entry and the position', () => {
    const failures = failuresOf(validate({ entries: [{ action: 'update', id: CODEX_ENTRY, visualRefs: [PORTRAIT, 'cover.png'] }] }));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.target).toBe('entries[0]');
    expect(failures[0]?.message).toContain('visualRefs[1] "cover.png" is not an asset id');
  });

  it('refuses a path where an id belongs, as the asset-id shape does for a cover', () => {
    const failures = failuresOf(validate({ entries: [{ action: 'create', name: 'Harbour', visualRefs: ['../assets/a_7K2QX9M4A1.png'] }] }));
    expect(failures[0]?.message).toContain('is not an asset id');
  });

  it('refuses a list longer than the command limit of ten', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `a_${String(index).padStart(10, '0')}`);
    const refused = validate({ entries: [{ action: 'update', id: CODEX_ENTRY, visualRefs: eleven }] });
    expect(refused.ok).toBe(false);
    expect(failuresOf(refused)[0]?.message).toContain('visualRefs');
  });

  it('accepts exactly ten references, the limit itself', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `a_${String(index).padStart(10, '0')}`);
    accepted(validate({ entries: [{ action: 'update', id: CODEX_ENTRY, visualRefs: ten }] }));
  });
});
