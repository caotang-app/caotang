/**
 * The BYOK boundary (video-prompt-pack.md §1, §6): Caotang authors and exports the pack and never calls a
 * vendor, so no tool is a vendor tool, the source makes no network call, and a full run touches no network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PROMPT_PACK_TOOL_ENTRIES,
  PROMPT_PACK_TOOL_NAMES,
  preparePack,
  renderPromptPack,
  stagePromptDraft,
  commitPromptDraft,
} from '../src/index.js';

import { storyboard, fakeModel } from './fixtures.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}/${name}`;
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('no vendor tool and no network call', () => {
  it('declares no tool named for a vendor, a host or a fetch', () => {
    const vendor = /runway|veo|kling|sora|wan|seedance|http|fetch|upload/i;
    expect(PROMPT_PACK_TOOL_NAMES.some((name) => vendor.test(name))).toBe(false);
    expect(PROMPT_PACK_TOOL_ENTRIES.every((entry) => !vendor.test(entry.meta.name))).toBe(true);
  });

  it('contains no network call anywhere in its source', () => {
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\//;
    const offenders = sourceFiles(SRC).filter((file) => forbidden.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('runs a full stage, commit and render without touching the network', async () => {
    const network = vi.fn(() => {
      throw new Error('network call attempted');
    });
    vi.stubGlobal('fetch', network);
    const board = storyboard();
    const model = fakeModel(() => JSON.stringify({ subject: 'Elena', action: 'walks down the quay' }));
    const proposal = await stagePromptDraft({ shotIds: ['s1'], vendor: 'runway-gen4' }, board, model);
    const outcome = commitPromptDraft(proposal, board);
    expect(outcome.ok).toBe(true);
    const run = preparePack(board, 'runway-gen4', []);
    expect(renderPromptPack(run, 'json').ok).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });
});
