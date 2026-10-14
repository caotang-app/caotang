/**
 * Include-policy candidate selection — [codex.md §5](../../../docs/architecture/codex.md)
 * and §6 steps 1–3, plus the expansion of folder attachments over the binder tree.
 *
 * This decides which entries are *candidates* for a generation call. It does not
 * decide what fits: the codex layer's budget and prune order live in
 * context-assembly.md §2–§4 and consume this output.
 */

import type { CodexEntry, TreeNode } from '@caotang/store';
import type { DetectionResult } from './detect.js';
import { compareCodex, sortCodex } from './order.js';

/** Why an entry is a candidate. Carried through so the prompt preview can say it. */
export type CandidateReason =
  | { readonly kind: 'always' }
  | { readonly kind: 'detected'; readonly count: number; readonly where: readonly string[] }
  /** `via` is the attachment node that brought it in: the focus document or an ancestor folder. */
  | { readonly kind: 'attached'; readonly via: string };

export interface Candidate {
  readonly entry: CodexEntry;
  readonly reason: CandidateReason;
}

/**
 * Why an entry that would otherwise have qualified was removed. A `never` entry that
 * is mentioned is recorded here, so the preview can show the policy working.
 */
export type SuppressionReason = 'never' | 'empty-description' | 'manual-unattached';

export interface Suppressed {
  readonly entry: CodexEntry;
  readonly reason: SuppressionReason;
}

export interface CandidateInput {
  /** The codex, in any order. The output order does not depend on it. */
  readonly entries: readonly CodexEntry[];
  /** The binder tree, flat, as `Manifest.tree` stores it. */
  readonly tree: readonly TreeNode[];
  /**
   * The focus document. Its ancestors are the rest of the focus scope. Without a
   * focus, a `manual` entry can only be a suppressed candidate, never an attached one.
   */
  readonly focusDocId?: string;
  /** Mention hits from `detect()` or `MentionIndex.detectionFor()`, keyed by entry id. */
  readonly detected: DetectionResult;
}

export interface CandidateSet {
  /** In codex order: `always` first, then type, then name. */
  readonly candidates: readonly Candidate[];
  /** In codex order. Entries that would have qualified and were removed, for the preview. */
  readonly suppressed: readonly Suppressed[];
}

/**
 * The focus document, then its ancestors, nearest first. This is the focus scope of
 * codex.md §5: a folder attachment applies to every document beneath it, and the
 * ancestor walk finds that from the document's side. An id that is not in the tree
 * yields just itself, so a direct attachment still applies.
 */
export function focusScope(tree: readonly TreeNode[], docId: string): string[] {
  const parentOf = new Map<string, string | null>();
  for (const node of tree) parentOf.set(node.id, node.parentId);
  const scope: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = docId;
  while (cursor !== null && cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    scope.push(cursor);
    cursor = parentOf.get(cursor);
  }
  return scope;
}

/** The nearest scope node the entry is attached to, or undefined when none is. */
function attachedVia(entry: CodexEntry, scope: readonly string[]): string | undefined {
  const attached = new Set(entry.attachments);
  return scope.find((node) => attached.has(node));
}

/**
 * Every node each entry's attachments reach, as a map from node id to the entries
 * reaching it, each list in codex order. An attached folder reaches itself and every
 * descendant. An attached document reaches only itself.
 *
 * This is the same relation `selectCandidates` computes from the focus side, read
 * from the attachment side. The inspector's "attached here" chips use it. The two
 * are kept consistent by a test. Attachments of every policy are expanded here, and
 * the `manual` policy is applied only in selection.
 */
export function expandAttachments(
  entries: readonly CodexEntry[],
  tree: readonly TreeNode[],
): Map<string, CodexEntry[]> {
  const children = new Map<string, string[]>();
  for (const node of tree) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }

  const reached = new Map<string, CodexEntry[]>();
  for (const entry of sortCodex(entries)) {
    const seen = new Set<string>();
    const pending = [...(entry.attachments ?? [])];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined || seen.has(node)) continue;
      seen.add(node);
      const list = reached.get(node) ?? [];
      list.push(entry);
      reached.set(node, list);
      pending.push(...(children.get(node) ?? []));
    }
  }
  return reached;
}

/**
 * Candidate selection, codex.md §6 steps 1–3:
 *
 * - `never` is never a candidate. A mentioned one is recorded as suppressed.
 * - `always` is always a candidate.
 * - `manual` is a candidate only when attached to the focus scope, even if it is
 *   mentioned. A mentioned, unattached one is recorded as suppressed.
 * - `detected` (the default, and the coerced value for an unknown policy) is a
 *   candidate when mentioned. Its attachments do not matter.
 * - An empty description drops any candidate, and the drop is recorded.
 */
export function selectCandidates(input: CandidateInput): CandidateSet {
  const scope = input.focusDocId === undefined ? [] : focusScope(input.tree, input.focusDocId);
  const candidates: Candidate[] = [];
  const suppressed: Suppressed[] = [];

  for (const entry of input.entries) {
    const hit = input.detected.get(entry.id);

    if (entry.includePolicy === 'never') {
      if (hit !== undefined) suppressed.push({ entry, reason: 'never' });
      continue;
    }

    let reason: CandidateReason | undefined;
    if (entry.includePolicy === 'always') {
      reason = { kind: 'always' };
    } else if (entry.includePolicy === 'manual') {
      const via = attachedVia(entry, scope);
      if (via !== undefined) reason = { kind: 'attached', via };
      else if (hit !== undefined) suppressed.push({ entry, reason: 'manual-unattached' });
    } else if (hit !== undefined) {
      reason = { kind: 'detected', count: hit.count, where: hit.where };
    }
    if (reason === undefined) continue;

    // codex.md §2: an empty description drops the entry even when it matched.
    if ((entry.description ?? '').trim() === '') {
      suppressed.push({ entry, reason: 'empty-description' });
      continue;
    }
    candidates.push({ entry, reason });
  }

  candidates.sort((a, b) => compareCodex(a.entry, b.entry));
  suppressed.sort((a, b) => compareCodex(a.entry, b.entry));
  return { candidates, suppressed };
}
