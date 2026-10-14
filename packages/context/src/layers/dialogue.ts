/**
 * A dialogue container as the focus of `dialogue.draft` — [dialogue-narrative.md §7](../../../../docs/architecture/dialogue-narrative.md)
 * and [context-assembly.md §2](../../../../docs/architecture/context-assembly.md).
 *
 * A container has no synopses, so its story so far is its beats. L4 is one line per beat of the container's Ink, the opening lines
 * and each knot, nearest first for the budget and in body order for display. L2 is the codex entries of the characters who speak in the
 * container: a `Name:` prefix resolves against the characters by name or alias (`resolveSpeakerName`), and a speaker counts once per
 * line it speaks. Both are read by the dialogue module's own parser, so a beat and a speaker mean there what they mean to the compile
 * and the table.
 */

import { parseInk, resolveSpeakerName, type GraphNode } from '@caotang/dialogue';
import type { DetectionHit } from '@caotang/codex';
import type { CodexEntry } from '@caotang/store';

import { newBlock, type BlockItem } from '../block.js';
import { LAYER_NAMES } from '../types.js';
import type { StoryPlan } from './story.js';

/** A beat's one-liner is its first speakable line, cut to this many characters. */
const ONE_LINER_CHARS = 160;

/** The beats a container's Ink holds, in body order: its opening lines when it has any, and each knot. Stitches belong to their knot. */
function beatsOf(body: string): GraphNode[] {
  return parseInk(body).graph.nodes.filter((node) => node.kind === 'knot' || (node.kind === 'root' && node.lines.length > 0));
}

/** The beat's first line, with its speaker as typed, cut to a line. A beat with no lines says so. */
function oneLinerOf(node: GraphNode): string {
  const first = node.lines[0];
  if (first === undefined) return '(no lines yet)';
  const text = first.speaker === null ? first.text.trim() : `${first.speaker}: ${first.text.trim()}`;
  const chars = [...text];
  return chars.length > ONE_LINER_CHARS ? `${chars.slice(0, ONE_LINER_CHARS).join('')}…` : text;
}

function beatTitle(node: GraphNode): string {
  return node.kind === 'root' ? 'Opening' : node.name;
}

/**
 * L4 for a container: its prior beats as one line each. A new beat is written at the end of the container, so every beat the
 * container holds precedes it. The budget drops the far end (the opening), as it drops the far end of a scene's story so far.
 */
export function beatStoryBlock(body: string): StoryPlan {
  const beats = beatsOf(body);
  const items: BlockItem[] = [...beats].reverse().map((node) => ({
    label: beatTitle(node),
    reason: 'earlier beat',
    body: `## ${beatTitle(node)} (beat)\n${oneLinerOf(node)}`,
    protected: false,
    group: 'prior',
  }));
  // Rank runs nearest first, so the body-order display reads the rank backwards, as the scene story's does.
  const display = beats.map((_, index) => beats.length - 1 - index);
  return {
    block: newBlock({
      id: 'L4',
      header: `# ${LAYER_NAMES.L4}`,
      empty: '(no earlier beats)',
      cut: '(story so far not sent)',
      items,
      display,
    }),
    notes: [],
    drops: [],
  };
}

/**
 * The codex entries of the characters who speak in a container, as detection hits (codex.md §4): each speaker that resolves to one
 * character counts once per line it speaks, under the surface `speakers`. The hits join the detected lane, so the codex's own policies
 * still decide what reaches the prompt: `never` stays out, `always` stays in, and a `manual` speaker needs its attachment.
 */
export function speakerHitsOf(entries: readonly CodexEntry[], body: string): Map<string, DetectionHit> {
  const hits = new Map<string, DetectionHit>();
  for (const line of parseInk(body).lines) {
    if (line.speaker === null) continue;
    const resolved = resolveSpeakerName(entries, line.speaker);
    if (resolved.kind !== 'resolved') continue;
    const count = (hits.get(resolved.entry.id)?.count ?? 0) + 1;
    hits.set(resolved.entry.id, { count, where: ['speakers'] });
  }
  return hits;
}
