/**
 * The graph view's layout — [dialogue-narrative.md §3](../../../docs/architecture/dialogue-narrative.md).
 *
 * The graph view is a corkboard variant over the parse (§3): nodes are cards, choice labels
 * are edges, and the layout is a pure projection with no randomness. Layers run top-down by
 * graph distance from the entry; within a layer, body order breaks every tie, so the same
 * body always lays out the same way (eval-stable, §8). Nodes no path reaches sit in a final row.
 */

import { ROOT_NODE_ID, type DialogueGraph, END_TARGET, FALLTHROUGH_TARGET, DYNAMIC_TARGET } from './ink-parse.js';

export const LAYOUT_COLUMN_WIDTH = 240;
export const LAYOUT_ROW_HEIGHT = 140;

export interface NodePlacement {
  readonly id: string;
  /** Graph distance from the entry. The unreached row is one past the deepest layer. */
  readonly layer: number;
  /** The index within its layer, in body order. */
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly reached: boolean;
}

export interface GraphLayout {
  readonly entry: string;
  readonly placements: readonly NodePlacement[];
  /** Node ids per layer, top to bottom. The last row holds the unreached nodes when there are any. */
  readonly layers: readonly (readonly string[])[];
  readonly width: number;
  readonly height: number;
}

/** The edges a node has, as node ids: its diverts and its choices, minus the terminal and dynamic targets. */
function successorsOf(graph: DialogueGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    if (to === END_TARGET || to === DYNAMIC_TARGET || to === FALLTHROUGH_TARGET) return;
    const list = out.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    out.set(from, list);
  };
  for (const node of graph.nodes) {
    for (const divert of node.diverts) add(node.id, divert.target);
    for (const choice of node.choices) add(node.id, choice.target);
  }
  return out;
}

/** Lays the graph out: breadth-first distance from the entry, one row per distance, body order within a row. */
export function layoutGraph(graph: DialogueGraph): GraphLayout {
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const successors = successorsOf(graph);
  const distance = new Map<string, number>([[ROOT_NODE_ID, 0]]);
  const queue: string[] = [ROOT_NODE_ID];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] ?? '';
    const next = distance.get(current) ?? 0;
    for (const target of successors.get(current) ?? []) {
      if (!distance.has(target) && order.has(target)) {
        distance.set(target, next + 1);
        queue.push(target);
      }
    }
  }

  const deepest = Math.max(0, ...distance.values());
  const unreachedRow = deepest + 1;
  const byLayer = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const reached = distance.has(node.id);
    const layer = reached ? distance.get(node.id) ?? 0 : unreachedRow;
    const row = byLayer.get(layer) ?? [];
    row.push(node.id);
    byLayer.set(layer, row);
  }

  const placements: NodePlacement[] = [];
  const layers: string[][] = [];
  let widest = 0;
  for (const layer of [...byLayer.keys()].sort((a, b) => a - b)) {
    const ids = (byLayer.get(layer) ?? []).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    layers[layer] = ids;
    widest = Math.max(widest, ids.length);
    ids.forEach((id, column) => {
      placements.push({
        id,
        layer,
        column,
        x: column * LAYOUT_COLUMN_WIDTH,
        y: layer * LAYOUT_ROW_HEIGHT,
        reached: distance.has(id),
      });
    });
  }

  return {
    entry: graph.entry,
    placements,
    layers,
    width: Math.max(1, widest) * LAYOUT_COLUMN_WIDTH,
    height: Math.max(1, layers.length) * LAYOUT_ROW_HEIGHT,
  };
}
