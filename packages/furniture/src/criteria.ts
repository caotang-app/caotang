/**
 * Saved-filter criteria and their pure evaluation — [binder-filters.md §2, §2.1, §3](docs/architecture/binder-filters.md).
 *
 * `matchNode` is the whole matching rule for one node: a conjunction of the criteria
 * present on a {@link FilterCriteria}. It reads no clock, no randomness and no store.
 * The two date windows read `probe.now`, which the caller injects, so the same project
 * state, criteria and `now` always give the same answer.
 */
import { canonical, caseFold } from '@caotang/codex';
import type { TreeNode } from '@caotang/store';

import { isReservedRoot } from './binder-index.js';
import { MILLISECONDS_PER_DAY } from './day.js';

export type SearchSurface = 'title' | 'synopsis' | 'body';

export const SEARCH_SURFACES: readonly SearchSurface[] = ['title', 'synopsis', 'body'];

export type FilterRoot = 'manuscript' | 'research';

export const FILTER_ROOTS: readonly FilterRoot[] = ['manuscript', 'research'];

/**
 * The criteria a saved filter may carry. Every field is optional and a present field
 * is one conjunct. A `null` in a saved manifest means "absent" and is normalised away
 * on load, so the in-memory type has no `null`.
 */
export interface FilterCriteria {
  /** Case-insensitive substring; no word boundaries. */
  text?: string;
  /** Which surfaces `text` searches; absent or empty means all three. */
  textIn?: SearchSurface[];
  /** Vocabulary status id, exact match. */
  statusId?: string;
  /** Vocabulary label id, exact match. */
  labelId?: string;
  /** The node must carry every one of these tags. */
  keywordsAll?: string[];
  /** The node must carry at least one of these tags. */
  keywordsAny?: string[];
  /** Word-count lower bound, inclusive. */
  minWords?: number;
  /** Word-count upper bound, inclusive. */
  maxWords?: number;
  /** v0.2 (binder-filters §2.1): `node.createdAt` within the last N × 24 h of `now`. */
  createdWithinDays?: number;
  /** v0.2 (binder-filters §2.1): `node.updatedAt` within the last N × 24 h of `now`. */
  modifiedWithinDays?: number;
}

/** The criteria keys this build knows. A key outside this list is dropped on load (§4). */
export const CRITERIA_KEYS = [
  'text',
  'textIn',
  'statusId',
  'labelId',
  'keywordsAll',
  'keywordsAny',
  'minWords',
  'maxWords',
  'createdWithinDays',
  'modifiedWithinDays',
] as const;

export type CriteriaKey = (typeof CRITERIA_KEYS)[number];

/** The vocabulary ids a criterion may name. A criterion naming an id outside it matches nothing (§2). */
export interface VocabularyIds {
  readonly statusIds: ReadonlySet<string>;
  readonly labelIds: ReadonlySet<string>;
}

/** The manifest's vocabulary, reduced to its ids. */
export function vocabularyIds(vocabulary: {
  readonly statuses: readonly { readonly id: string }[];
  readonly labels: readonly { readonly id: string }[];
}): VocabularyIds {
  return {
    statusIds: new Set(vocabulary.statuses.map((term) => term.id)),
    labelIds: new Set(vocabulary.labels.map((term) => term.id)),
  };
}

/**
 * What matching may read. The spec's `probe` is `bodyOf` and `wordsOf`; `now` and the
 * vocabulary are added because the v0.2 date criteria (§2.1) need an injected clock and
 * because a criterion on a since-deleted vocabulary id must match nothing (§2).
 */
export interface FilterProbe {
  /** The body projection of a document (project-format §3). Read only when `text` searches the body. */
  bodyOf(docId: string): string;
  /** Own count for a document, subtree sum for a folder (binder-filters §2). */
  wordsOf(nodeId: string): number;
  /** The injected instant for the rolling date windows. */
  readonly now: Date;
  readonly vocabulary: VocabularyIds;
}

/**
 * The matching fold: codex.md §4's canonical form, then simple case folding. Shared
 * with mention detection, so a "case-insensitive" match means the same thing here and
 * in the codex.
 */
export function foldText(text: string): string {
  return caseFold(canonical(text));
}

/**
 * The criteria with their folded forms computed once. A pass over the binder folds each
 * tag and the text needle once, here, instead of once per node.
 */
export interface PreparedCriteria {
  readonly criteria: FilterCriteria;
  /** Folded `keywordsAll` tags. A node must carry every one. */
  readonly keywordsAll: ReadonlySet<string>;
  /** Folded `keywordsAny` tags. A node must carry at least one. */
  readonly keywordsAny: ReadonlySet<string>;
  /** Folded `text`, or undefined when the criterion is absent. */
  readonly needle: string | undefined;
}

export function prepareCriteria(criteria: FilterCriteria): PreparedCriteria {
  return {
    criteria,
    keywordsAll: new Set((criteria.keywordsAll ?? []).map(foldText)),
    keywordsAny: new Set((criteria.keywordsAny ?? []).map(foldText)),
    needle: criteria.text !== undefined && criteria.text !== '' ? foldText(criteria.text) : undefined,
  };
}

/**
 * Does this node satisfy every present criterion? Reserved roots never do (§3).
 *
 * Criteria are checked cheapest first and the body last, so `bodyOf` runs only when
 * nothing else has already failed. An empty criteria object matches every node that is
 * not a reserved root, which is the reset state of a filter.
 */
export function matchNode(node: TreeNode, criteria: FilterCriteria, probe: FilterProbe): boolean {
  return matchPrepared(node, prepareCriteria(criteria), probe);
}

/** {@link matchNode} over criteria that {@link prepareCriteria} has already folded. */
export function matchPrepared(node: TreeNode, prepared: PreparedCriteria, probe: FilterProbe): boolean {
  if (isReservedRoot(node)) return false;

  const { criteria } = prepared;
  if (criteria.statusId !== undefined) {
    if (!probe.vocabulary.statusIds.has(criteria.statusId) || node.status !== criteria.statusId) return false;
  }
  if (criteria.labelId !== undefined) {
    if (!probe.vocabulary.labelIds.has(criteria.labelId) || node.label !== criteria.labelId) return false;
  }
  if (prepared.keywordsAll.size > 0 || prepared.keywordsAny.size > 0) {
    // The checks walk the node's own tags (at most 32, project-format §2) against the folded
    // criteria, so no criteria tag is folded again for each node.
    const carried = new Set(node.keywords.map(foldText));
    if (prepared.keywordsAll.size > carried.size) return false;
    for (const tag of prepared.keywordsAll) {
      if (!carried.has(tag)) return false;
    }
    if (prepared.keywordsAny.size > 0) {
      let anyCarried = false;
      for (const tag of carried) {
        if (prepared.keywordsAny.has(tag)) {
          anyCarried = true;
          break;
        }
      }
      if (!anyCarried) return false;
    }
  }
  if (criteria.minWords !== undefined || criteria.maxWords !== undefined) {
    const words = probe.wordsOf(node.id);
    if (criteria.minWords !== undefined && words < criteria.minWords) return false;
    if (criteria.maxWords !== undefined && words > criteria.maxWords) return false;
  }
  if (criteria.createdWithinDays !== undefined && !withinWindow(node.createdAt, criteria.createdWithinDays, probe.now)) {
    return false;
  }
  if (criteria.modifiedWithinDays !== undefined && !withinWindow(node.updatedAt, criteria.modifiedWithinDays, probe.now)) {
    return false;
  }
  if (prepared.needle !== undefined) {
    return textMatches(node, prepared.needle, criteria.textIn, probe);
  }
  return true;
}

/**
 * §2.1: a rolling window, not a calendar bucket. The lower edge is inclusive, so a node
 * stamped exactly N × 24 h ago still matches. There is no upper edge: a stamp later than
 * `now` (clock skew, or a `now` captured a moment before the write) counts as recent.
 * A missing or unparseable stamp never matches (§2.1: absent timestamps match nothing).
 */
function withinWindow(stamp: string | undefined, days: number, now: Date): boolean {
  if (stamp === undefined) return false;
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return false;
  return at >= now.getTime() - days * MILLISECONDS_PER_DAY;
}

/** `needle` is already folded by {@link prepareCriteria}. */
function textMatches(node: TreeNode, needle: string, textIn: readonly SearchSurface[] | undefined, probe: FilterProbe): boolean {
  const requested = textIn !== undefined && textIn.length > 0 ? textIn : SEARCH_SURFACES;
  // SEARCH_SURFACES is already in title, synopsis, body order, so the body comes last.
  for (const surface of SEARCH_SURFACES) {
    if (!requested.includes(surface)) continue;
    const haystack = surfaceText(surface, node, probe);
    if (haystack !== undefined && foldText(haystack).includes(needle)) return true;
  }
  return false;
}

function surfaceText(surface: SearchSurface, node: TreeNode, probe: FilterProbe): string | undefined {
  if (surface === 'title') return node.title;
  if (surface === 'synopsis') return node.synopsis;
  // Folders and other non-document nodes have no body, so the body is never read for them.
  return node.type === 'document' ? probe.bodyOf(node.id) : undefined;
}

/**
 * The vocabulary ids a saved filter names that the project no longer has. The row shows
 * an "unknown status" chip for these (binder-filters §2); matching already ignores them.
 */
export function danglingVocabulary(criteria: FilterCriteria, vocabulary: VocabularyIds): string[] {
  const dangling: string[] = [];
  if (criteria.statusId !== undefined && !vocabulary.statusIds.has(criteria.statusId)) {
    dangling.push(criteria.statusId);
  }
  if (criteria.labelId !== undefined && !vocabulary.labelIds.has(criteria.labelId)) {
    dangling.push(criteria.labelId);
  }
  return dangling;
}
