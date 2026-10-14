/**
 * The dialogue module's entries, read by the harness that registers them (cutscenes and interactive narrative; dialogue-narrative.md §7).
 *
 * The dialogue package's own spec-parity test checks the entries against the spec's table. The checks here need the
 * harness's own validator and schema derivation, and the harness's `ToolPort` type, so they live where those live. The
 * dialogue package does not import the harness: the harness imports it, and an import back would close a cycle.
 */

import { DIALOGUE_TOOL_ENTRIES, dialogueDraftTool, dialogueTableTool, type DialogueToolEntry, type DialogueToolName } from '@caotang/dialogue';
import { describe, expect, it } from 'vitest';

import { checkParams, toJsonSchema, type ToolPort } from '../src/index.js';

describe('the harness can read the dialogue declarations', () => {
  it.each(DIALOGUE_TOOL_ENTRIES.map((entry) => [entry.meta.name, entry] as const))('carries the schema the harness derives from its params, for %s', (_name, entry: DialogueToolEntry) => {
    // The entry's schema is the harness's own derivation, not a copy: a key in one is a key in the other.
    expect(entry.schema).toEqual(toJsonSchema(entry.params));
    expect(entry.schema.type).toBe('object');
    expect(Object.keys(entry.schema.properties as object).length).toBeGreaterThan(0);
    expect(entry.schema.required).toEqual(entry.params.required);
  });

  it('accepts a valid draft call and refuses an undeclared key, since the schema is closed', () => {
    const draft = DIALOGUE_TOOL_ENTRIES[0];
    expect(draft).toBeDefined();
    if (draft === undefined) return;
    expect(checkParams('dialogue.draft', draft.params, { doc: 'Tavern', instruction: 'Write it.', fromBeats: ['tavern.ale'], target_lines: 6 }).ok).toBe(true);
    expect(checkParams('dialogue.draft', draft.params, { doc: 'Tavern', instruction: 'Write it.', mood: 'grim' }).ok).toBe(false);
  });

  it('refuses a blank doc, a bad format and a missing required key on the table', () => {
    const table = DIALOGUE_TOOL_ENTRIES[1];
    expect(table).toBeDefined();
    if (table === undefined) return;
    expect(checkParams('dialogue.table', table.params, { doc: 'Tavern', format: 'csv', includeConditions: true }).ok).toBe(true);
    expect(checkParams('dialogue.table', table.params, { doc: '   ' }).ok).toBe(false);
    expect(checkParams('dialogue.table', table.params, { doc: 'Tavern', format: 'xlsx' }).ok).toBe(false);
    expect(checkParams('dialogue.table', table.params, {}).ok).toBe(false);
  });

  it('has the harness port shape: each handler is assignable to ToolPort, so a registry can call it as one', () => {
    // A type-level check: a handler whose return or context drifts from the harness's port type fails the typecheck here.
    const ports: Record<DialogueToolName, ToolPort> = { 'dialogue.draft': dialogueDraftTool, 'dialogue.table': dialogueTableTool };
    expect(Object.keys(ports)).toEqual(['dialogue.draft', 'dialogue.table']);
  });
});
