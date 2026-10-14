/**
 * The result set of a saved filter over the binder — [binder-filters.md §3](docs/architecture/binder-filters.md).
 *
 * The result-set rule: a matching node is shown together with its ancestor chain, so a
 * matching scene renders inside its chapter; a non-matching sibling is hidden. The two
 * fixed roots always render. The project root never does, because the binder never
 * shows it (ui-modules §2.1).
 *
 * The spec states no ordering beyond the ancestor rule, so every list here is in
 * binder order: the order the binder already shows, siblings by `order`. That keeps a
 * filtered tree a subsequence of the unfiltered one, which is what a reader expects.
 */
import type { BinderIndex } from './binder-index.js';
import { isReservedRoot } from './binder-index.js';
import { matchPrepared, prepareCriteria, type FilterCriteria, type FilterProbe, type FilterRoot } from './criteria.js';

export interface FilterSpec {
  readonly criteria: FilterCriteria;
  /** binder-filters §2: a scope restriction. Absent means both roots are searched. */
  readonly root?: FilterRoot;
}

export interface FilterResult {
  /** Nodes that match on their own, in binder order. Reserved roots are never here. */
  readonly matched: readonly string[];
  /** Everything the view shows: matches, their ancestors, and the fixed roots — in binder order. */
  readonly visible: readonly string[];
  /** The badge count ("N scenes match"). */
  readonly matchCount: number;
}

const RENDERED_ROOT_IDS = ['manuscript', 'research'] as const;

/**
 * Evaluate a saved filter (or an ad-hoc criteria set, which is the same thing without a
 * name) over the binder. Pure: the index and the probe are the only inputs.
 */
export function evaluateFilter(spec: FilterSpec, index: BinderIndex, probe: Omit<FilterProbe, 'wordsOf'>): FilterResult {
  const fullProbe: FilterProbe = { ...probe, wordsOf: (id) => index.wordsOf(id) };
  // Folded once for the whole pass, so the cost is one fold per tag rather than one per node and tag.
  const prepared = prepareCriteria(spec.criteria);

  const matched: string[] = [];
  for (const id of index.order) {
    const node = index.node(id);
    if (node === undefined || isReservedRoot(node)) continue;
    if (spec.root !== undefined && !index.ancestorsOf(id).includes(spec.root)) continue;
    if (matchPrepared(node, prepared, fullProbe)) matched.push(id);
  }

  const shown = new Set<string>();
  for (const id of matched) {
    shown.add(id);
    for (const ancestor of index.ancestorsOf(id)) shown.add(ancestor);
  }
  for (const id of RENDERED_ROOT_IDS) {
    if (index.has(id)) shown.add(id);
  }

  const visible = index.order.filter((id) => shown.has(id) && index.node(id)?.type !== 'root');
  return { matched, visible, matchCount: matched.length };
}
