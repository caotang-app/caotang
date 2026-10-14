/**
 * Reference resolution — [video-prompt-pack.md §3](../../../docs/architecture/video-prompt-pack.md).
 *
 * The order is fixed, deterministic and previewable:
 *
 *  1. the shot's own override, when its prompt record names references;
 *  2. else the visual references of the codex entries the shot's action or covered script
 *     mentions, through the codex candidate rules (codex.md §5–§6);
 *  3. else none.
 *
 * Both steps apply the codex rules to the entry they name. A `never` entry supplies nothing, and
 * neither does an entry with an empty description (codex.md §2, §5). Mention detection is the codex
 * engine's own (`detect`), and the candidate rules are `selectCandidates`, so each rule is decided in
 * one place and a name that matches in the manuscript matches here the same way.
 *
 * The provenance records which entries supplied which references, and which were withheld and why,
 * because the preview shows the writer the consistency payload before anything is exported. The draft's
 * codex layer (L2) is built from the same supplied entries, so the two cannot disagree.
 *
 * An override that names an entry with no visual reference, or an id that names no entry, keeps a
 * reference with no file name, so the validator reports it. A mention with no visual reference supplies
 * nothing, and the provenance says so.
 */

import { detect, selectCandidates, sortCodex, type DetectionResult } from '@caotang/codex';

import type { CodexEntryWithRefs, ResolvedReference, ShotNode, StoryboardSnapshot, VideoReference } from './model.js';

/** The text a shot exposes to mention detection: its action and the script it covers, each as a named surface. */
export function shotSurfaces(shot: ShotNode): { id: string; text: string }[] {
  return [
    { id: 'action', text: shot.action ?? '' },
    { id: 'covered', text: shot.covered.map((covered) => covered.text).join('\n\n') },
  ];
}

/** Codex mentions in one shot's action and covered script. Entries the shot does not mention are absent. */
export function detectShotMentions(shot: ShotNode, codex: readonly CodexEntryWithRefs[]): DetectionResult {
  return detect(shotSurfaces(shot), codex);
}

export interface SuppliedEntry {
  readonly entryId: string;
  readonly name: string;
  /** `mentioned` for a codex entry the shot names; `override` for an entry the shot's record names. */
  readonly reason: 'mentioned' | 'override';
  /** The surfaces that held the mention: `action`, `covered`. Empty for an override. */
  readonly where: readonly string[];
  readonly assetIds: readonly string[];
}

export interface WithheldEntry {
  readonly entryId: string;
  readonly name: string;
  /**
   * `never`, `manual-unattached` and `empty-description` are the codex rules (codex.md §2, §5, §6).
   * `no-visual-reference` is the entry's own gap: it has nothing to send.
   */
  readonly reason: 'never' | 'manual-unattached' | 'empty-description' | 'no-visual-reference';
}

export interface ReferenceProvenance {
  readonly shotId: string;
  readonly source: 'shot' | 'codex' | 'none';
  /** The entries that supplied references, in codex order. */
  readonly supplied: readonly SuppliedEntry[];
  /** The entries the shot names, by mention or override, that supplied no reference, and the reason. */
  readonly withheld: readonly WithheldEntry[];
}

export interface ReferenceResolution {
  readonly references: readonly ResolvedReference[];
  readonly provenance: ReferenceProvenance;
}

export interface ResolveInput {
  readonly shot: ShotNode;
  /** The shot's prompt record references for the vendor. Non-empty means an override. */
  readonly override?: readonly VideoReference[];
  readonly storyboard: StoryboardSnapshot;
}

/** What one override reference supplies, and the entry it was withheld from when the codex rules refuse it. */
interface OverrideResolution {
  readonly resolved: ResolvedReference[];
  readonly supplied?: SuppliedEntry;
  readonly withheld?: WithheldEntry;
}

/** Resolves one override reference: an asset, or the visual references of an entry the codex rules allow. */
function resolveOverride(reference: VideoReference, storyboard: StoryboardSnapshot): OverrideResolution {
  const { assets, codex } = storyboard;
  if (reference.assetId !== undefined) {
    const asset = assets.get(reference.assetId);
    return {
      resolved: [{ type: reference.type, source: 'shot', assetId: reference.assetId, fileName: asset?.fileName, label: asset?.label }],
    };
  }
  if (reference.entryId === undefined) return { resolved: [{ type: reference.type, source: 'shot' }] };

  const entry = codex.find((candidate) => candidate.id === reference.entryId);
  // An id that names no entry keeps no file, so the validator reports it.
  if (entry === undefined) return { resolved: [{ type: reference.type, source: 'shot', entryId: reference.entryId }] };

  // An override replaces the mention or the attachment that would bring an entry in (codex.md §5–§6), so it
  // may name an entry the shot does not mention, or a `manual` entry the shot is not attached to. It does not
  // lift the rules that forbid sending an entry (`never`, codex.md §5), and it cannot send an entry with
  // nothing to send (an empty description, codex.md §2).
  const refuse = (reason: WithheldEntry['reason']): OverrideResolution => ({
    resolved: [],
    withheld: { entryId: entry.id, name: entry.name, reason },
  });
  if (entry.includePolicy === 'never') return refuse('never');
  if (entry.description.trim() === '') return refuse('empty-description');

  const visual = entry.visualRefs ?? [];
  if (visual.length === 0) {
    return {
      resolved: [{ type: reference.type, source: 'shot', entryId: entry.id, label: entry.name }],
      withheld: { entryId: entry.id, name: entry.name, reason: 'no-visual-reference' },
    };
  }
  const resolved = visual.map((assetId): ResolvedReference => {
    const asset = assets.get(assetId);
    return { type: reference.type, source: 'shot', entryId: entry.id, assetId, fileName: asset?.fileName, label: entry.name };
  });
  return {
    resolved,
    supplied: { entryId: entry.id, name: entry.name, reason: 'override', where: [], assetIds: visual },
  };
}

/** Resolves a shot's references for one vendor, and says where each came from. Pure. */
export function resolveReferences(input: ResolveInput): ReferenceResolution {
  const { shot, storyboard } = input;
  const override = input.override ?? [];

  if (override.length > 0) {
    const references: ResolvedReference[] = [];
    const supplied: SuppliedEntry[] = [];
    const withheld: WithheldEntry[] = [];
    for (const reference of override) {
      const result = resolveOverride(reference, storyboard);
      references.push(...result.resolved);
      if (result.supplied !== undefined) supplied.push(result.supplied);
      if (result.withheld !== undefined) withheld.push(result.withheld);
    }
    return { references, provenance: { shotId: shot.id, source: 'shot', supplied, withheld } };
  }

  // The candidate rules run once, here. `never`, `manual` (attached to the focus scope) and an empty
  // description are decided by `selectCandidates`, and the references below follow its answer.
  const detected = detectShotMentions(shot, storyboard.codex);
  const selection = selectCandidates({ entries: storyboard.codex, tree: storyboard.tree, focusDocId: shot.id, detected });
  const candidates = new Set(selection.candidates.map((candidate) => candidate.entry.id));
  const suppressed = new Map(selection.suppressed.map((item) => [item.entry.id, item.reason]));
  const references: ResolvedReference[] = [];
  const supplied: SuppliedEntry[] = [];
  const withheld: WithheldEntry[] = [];

  for (const entry of sortCodex(storyboard.codex)) {
    // Only a mention supplies a reference (§3). An `always` entry or an attached one that the shot does not name does not.
    const hit = detected.get(entry.id);
    if (hit === undefined) continue;
    const reason = suppressed.get(entry.id);
    if (reason !== undefined) {
      withheld.push({ entryId: entry.id, name: entry.name, reason });
      continue;
    }
    // A mention that the selection neither keeps nor suppresses supplies nothing.
    if (!candidates.has(entry.id)) continue;
    const visual = entry.visualRefs ?? [];
    if (visual.length === 0) {
      withheld.push({ entryId: entry.id, name: entry.name, reason: 'no-visual-reference' });
      continue;
    }
    const type = entry.type === 'character' ? 'character' : 'image';
    for (const assetId of visual) {
      const asset = storyboard.assets.get(assetId);
      references.push({ type, source: 'codex', entryId: entry.id, assetId, fileName: asset?.fileName, label: entry.name });
    }
    supplied.push({ entryId: entry.id, name: entry.name, reason: 'mentioned', where: hit.where, assetIds: visual });
  }

  return {
    references,
    provenance: { shotId: shot.id, source: references.length > 0 ? 'codex' : 'none', supplied, withheld },
  };
}
