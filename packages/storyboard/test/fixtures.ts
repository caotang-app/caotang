/**
 * Fixtures for the storyboard tests. Projects are built with the store's own primitives, so a fixture
 * cannot drift from the shape the store produces, and the storyboard fields are set through the same
 * functions the engine uses.
 */

import type { RandomBytes } from '@caotang/ids';
import { MemoryArtifactFs, addDocument, addFolder, createEmptyManifest, createProjectState, type ProjectState } from '@caotang/store';

import { setNodeKind } from '../src/nodes.js';

export const NOW = new Date('2026-10-08T09:00:00.000Z');

/**
 * A deterministic randomness source. Every call returns different bytes, so minted ids are distinct
 * across a test, and two runs of a test mint the same ids.
 */
export function seqRandom(seed = 7): RandomBytes {
  let state = seed >>> 0;
  return (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      out[i] = (state >>> 16) & 0xff;
    }
    return out;
  };
}

/** A screenplay scene. Its quotes are chosen so each lookup case is exercised: one unique, one repeated, one absent. */
export const SCENE_BODY = [
  'EXT. HARBOUR - DAWN',
  '',
  'Elena crosses the empty quay. Gulls circle.',
  '',
  'ELENA',
  'I was gone nine years.',
  '',
  'The lighthouse keeper does not look up.',
  '',
  'ELENA',
  'I was gone nine years.',
].join('\n');

export const PROSE_BODY = 'Elena walked to the harbour and did not look back.';

export interface Fixture {
  readonly state: ProjectState;
  readonly random: RandomBytes;
}

/**
 * The fixture tree:
 *
 * ```
 * root
 * └─ manuscript
 *    ├─ act1 (folder)
 *    │  ├─ scene1  (document, kind screenplay, SCENE_BODY)
 *    │  ├─ prose1  (document, prose, PROSE_BODY)
 *    │  └─ empty1  (document, kind screenplay, '')
 *    └─ board1 (folder, kind storyboard) — empty
 * ```
 */
export function buildFixture(): Fixture {
  const manifest = createEmptyManifest('Fixture', NOW);
  const state = createProjectState(manifest, { now: NOW });
  addFolder(state, { id: 'act1', parentId: 'manuscript', title: 'Act 1', now: NOW });
  setNodeKind(
    addDocument(state, { id: 'scene1', parentId: 'act1', title: 'Harbour', body: SCENE_BODY, now: NOW }),
    'screenplay',
  );
  addDocument(state, { id: 'prose1', parentId: 'act1', title: 'Prose', body: PROSE_BODY, now: NOW });
  setNodeKind(addDocument(state, { id: 'empty1', parentId: 'act1', title: 'Blank', body: '', now: NOW }), 'screenplay');
  const board = addFolder(state, { id: 'board1', parentId: 'manuscript', title: 'Board', now: NOW });
  setNodeKind(board, 'storyboard');
  return { state, random: seqRandom() };
}

/** The tree as JSON, for asserting that a refused call changed nothing. */
export function treeSnapshot(state: ProjectState): string {
  return JSON.stringify(state.manifest.tree);
}

/** Bytes that carry a real PNG signature and a body, so a read back is checkable byte for byte. */
export function pngBytes(extra = 16): Uint8Array {
  const out = new Uint8Array(8 + extra);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 0; i < extra; i += 1) out[8 + i] = (i * 37) & 0xff;
  return out;
}

export function jpegBytes(extra = 12): Uint8Array {
  const out = new Uint8Array(3 + extra);
  out.set([0xff, 0xd8, 0xff], 0);
  for (let i = 0; i < extra; i += 1) out[3 + i] = (i * 91) & 0xff;
  return out;
}

export function webpBytes(extra = 12): Uint8Array {
  const out = new Uint8Array(12 + extra);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  out.set([0x00, 0x00, 0x00, 0x00], 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  for (let i = 0; i < extra; i += 1) out[12 + i] = (i * 53) & 0xff;
  return out;
}

/** A memory artifact store that counts the byte-port calls, so a test can show which path bytes took. */
export class CountingFs extends MemoryArtifactFs {
  readonly calls: string[] = [];

  override async readBytes(path: string): Promise<Uint8Array> {
    this.calls.push(`readBytes ${path}`);
    return super.readBytes(path);
  }

  override async writeBytesAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.calls.push(`writeBytesAtomic ${path}`);
    return super.writeBytesAtomic(path, bytes);
  }
}
