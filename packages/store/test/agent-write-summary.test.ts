/**
 * The summary an agent's codex, notes, binder and synopsis write reports (agent-harness §8, L9). The Undo button and the activity log both
 * show the summary, so a write the agent made is named in the writer's words, and a write the writer made keeps the bus's own wording.
 * Each case sends the same command twice, once as the agent (inside an approved plan where the command needs one) and once as the writer,
 * and reads the summary the activity log holds for each. Without the agent's branch, both would read the bus's wording.
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
  type CommandName,
  type PermissionContext,
  type UndoStore,
} from '@caotang/bus';
import { newId } from '@caotang/ids';

import {
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectCommandRegistry,
  createProjectState,
  emptyCoherenceState,
  type ProjectState,
} from '../src/index.js';

const OPENED = new Date('2026-10-01T09:00:00.000Z');
const clock = { now: () => Date.parse('2026-10-08T10:00:00.000Z') };
const CHAPTER = 'n_CHAPTER001';
const STORM = 'n_TEMPEST001';
const FINDING = 'f_AAAAAAAAAA';
const APPROVED: PermissionContext = { approvedPlan: true };

/** A manuscript with one chapter and one document, and a coherence file with one open finding that quotes it, and one label, which the writes below name. */
function fixture(): ProjectState {
  const state = createProjectState(createEmptyManifest('The Lighthouse Keeper', OPENED));
  addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now: OPENED, id: CHAPTER });
  addDocument(state, { parentId: CHAPTER, title: 'The Storm', body: 'The gale arrived at dawn.', now: OPENED, id: STORM });
  state.manifest.vocabulary.labels.push({ id: 'act-one', name: 'Act One', color: '#4a90d9' });
  const coherence = emptyCoherenceState();
  coherence.findings.push({ id: FINDING, status: 'open', updatedAt: OPENED.toISOString(), evidence: [{ docId: STORM }] });
  state.coherence = coherence;
  return state;
}

/** One send, as `issuedBy`, on a fresh project: the activity log's summary for it. A refusal fails the test, since the summary is the point. */
function summaryOf(name: CommandName, params: Record<string, unknown>, issuedBy: 'user' | 'agent'): string {
  const state = fixture();
  const registry = createProjectCommandRegistry({ clock });
  const log = createActivityLog();
  const undo: UndoStore = createUndoStore({ dispatch: (command) => execute(command, bus, registry) });
  const bus: BusContext<ProjectState> = {
    state,
    view: createViewState(),
    read: () => state,
    undo,
    log,
    idempotency: createIdempotencyCache(),
    notify: () => {},
  };
  const command: Command = { id: newId('cmd'), name, params, issuedBy, createdAt: clock.now() };
  const dispatch: BusContext<ProjectState> = issuedBy === 'agent' ? { ...bus, permission: APPROVED } : bus;
  const result = execute(command, dispatch, registry);
  if (!result.ok) throw new Error(`refused: ${result.error.code}: ${result.error.message}`);
  return log.entries().at(-1)?.summary ?? '';
}

describe('an agent’s codex, notes, binder and synopsis writes say what the agent did (L9)', () => {
  it('a codex write by the agent names the change in the writer’s words, and the writer’s keeps the bus’s wording', () => {
    const params = { entries: [{ action: 'create', name: 'Tamsin' }] };
    expect(summaryOf('codex.upsert', params, 'agent')).toBe('the agent’s codex change: 1 created, 0 updated');
    expect(summaryOf('codex.upsert', params, 'user')).toBe('created 1 and updated 0 codex entry');
  });

  it('a codex write that attaches the entry names the attachment as the agent’s too', () => {
    const params = { entries: [{ action: 'create', name: 'Tamsin', attachTo: [STORM] }] };
    expect(summaryOf('codex.upsert', params, 'agent')).toBe('the agent’s codex change: 1 created, 0 updated, 1 node attached');
    expect(summaryOf('codex.upsert', params, 'user')).toBe('created 1 and updated 0 codex entry, attached to 1 node');
  });

  it('a notes write by the agent names the document’s notes as the agent’s, and the writer’s keeps the bus’s wording', () => {
    const params = { nodeId: STORM, notes: 'Drafted by the agent.' };
    expect(summaryOf('notes.set', params, 'agent')).toBe('the agent’s notes for “The Storm”');
    expect(summaryOf('notes.set', params, 'user')).toBe('set the notes of "The Storm"');
  });

  it('a binder rename by the agent names the rename in the writer’s words', () => {
    const params = { nodeId: STORM, title: 'The Gale' };
    expect(summaryOf('binder.rename', params, 'agent')).toBe('the agent’s rename of “The Storm” to “The Gale”');
    expect(summaryOf('binder.rename', params, 'user')).toBe('renamed "The Storm" to "The Gale"');
  });

  it('a binder move by the agent names the document it moved, as the agent’s', () => {
    const params = { nodeId: STORM, newParentId: CHAPTER, index: 0 };
    expect(summaryOf('binder.move', params, 'agent')).toBe('the agent’s move of “The Storm”');
    expect(summaryOf('binder.move', params, 'user')).toBe('moved "The Storm" to position 0 under "Chapter 1"');
  });

  it('a binder create by the agent names the new node in the writer’s words', () => {
    const params = { parentId: CHAPTER, type: 'document', title: 'The Tide' };
    expect(summaryOf('binder.create', params, 'agent')).toBe('the agent’s new document “The Tide”');
    expect(summaryOf('binder.create', params, 'user')).toBe('created the document "The Tide" under "Chapter 1"');
  });

  it('a synopsis write by the agent names the synopsis as the agent’s, and the writer’s keeps the bus’s wording', () => {
    const params = { nodeId: STORM, synopsis: 'A gale takes the lamp.' };
    expect(summaryOf('binder.setSynopsis', params, 'agent')).toBe('the agent’s synopsis for “The Storm”');
    expect(summaryOf('binder.setSynopsis', params, 'user')).toBe('set the synopsis of "The Storm"');
  });

  it('a status and label write by the agent names the fields in the writer’s words, and the writer’s keeps the bus’s wording', () => {
    const params = { nodeId: STORM, patch: { status: 'draft', label: 'act-one' } };
    expect(summaryOf('binder.setMeta', params, 'agent')).toBe('the agent’s status and label for “The Storm”');
    expect(summaryOf('binder.setMeta', params, 'user')).toBe('set status, label on "The Storm"');
  });

  it('a keyword write by the agent names the keywords as the agent’s', () => {
    const params = { nodeId: STORM, patch: { keywords_add: ['sea'] } };
    expect(summaryOf('binder.setMeta', params, 'agent')).toBe('the agent’s keywords for “The Storm”');
    expect(summaryOf('binder.setMeta', params, 'user')).toBe('set 1 keyword added on "The Storm"');
  });

  it('a finding the agent marks fixed is named by the scene it quotes, with no finding id', () => {
    const params = { findingId: FINDING, status: 'fixed' };
    const agent = summaryOf('coherence.setFindingStatus', params, 'agent');
    expect(agent).toBe('the agent marked a finding in “The Storm” fixed');
    expect(agent).not.toContain(FINDING);
    // The writer's wording names the finding by its message, or by the scene it quotes when it has none (the fixture has none).
    expect(summaryOf('coherence.setFindingStatus', params, 'user')).toBe('marked a finding in “The Storm” fixed');
  });
});
