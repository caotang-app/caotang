/**
 * The dialogue container kinds and their metadata — [dialogue-narrative.md §2.1](../../../docs/architecture/dialogue-narrative.md).
 *
 * A dialogue container is one document-like node whose body file is raw Ink. The branch
 * structure lives in that text (knots are beats, diverts are links), so the binder holds the
 * container and never per-beat nodes (§2.1's decision). `beat` is the beat-class sibling that
 * project-format.md §2 names; it takes the same Ink body and the same metadata, and the spec
 * gives no beat-only field, so none is invented here.
 *
 * Metadata reads tolerantly, as project-format.md's unknown-tolerance rule asks: an unknown engine
 * target or a non-boolean flag is dropped with a note, never an error, and the rest still applies.
 */

/** The tree-node types that hold an Ink body. `dialogue` is the named container; `beat` is its beat-class form. */
export const DIALOGUE_NODE_TYPES = ['dialogue', 'beat'] as const;
export type DialogueNodeType = (typeof DIALOGUE_NODE_TYPES)[number];

/** §2.1's `kind` marker on a dialogue container: the graph-view trigger. */
export const DIALOGUE_KIND = 'branching';

/** §2.1's default compile target hints. The recipes carry the truth; these are hints only. */
export const ENGINE_TARGETS = ['ink-json', 'yarn-csv', 'generic-csv'] as const;
export type EngineTarget = (typeof ENGINE_TARGETS)[number];

/** A dialogue container's body file extension (§2.1; project-format.md's media-track note allows it). */
export const INK_BODY_EXTENSION = '.ink';

/** §2.1 and §2.2: the per-container metadata. Every field is optional. */
export interface DialogueContainerMeta {
  /** A codex entry id: the default speaker for a line with no `Name:` prefix. */
  readonly speaker?: string;
  /** The locale code of the authored language. */
  readonly locBaseline?: string;
  /** The default compile target hint. */
  readonly engineTarget?: EngineTarget;
  /** Opt-in (A3): the save path mints `lineId` tags for lines that lack one. */
  readonly autoLineIds?: boolean;
}

export function isDialogueNodeType(type: string): type is DialogueNodeType {
  return (DIALOGUE_NODE_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a binder node carries §2.1's branching marker, the graph view's trigger. The store's
 * tree node has no `kind` field yet, so this reads whatever object the caller holds.
 */
export function isBranchingContainer(node: unknown): boolean {
  return typeof node === 'object' && node !== null && (node as { readonly kind?: unknown }).kind === DIALOGUE_KIND;
}

/** A copy of a node with §2.1's branching marker set. The copy is the caller's to write: nothing here mutates the node. */
export function markBranching<T extends object>(node: T): T & { readonly kind: typeof DIALOGUE_KIND } {
  return { ...node, kind: DIALOGUE_KIND };
}

export function isEngineTarget(value: unknown): value is EngineTarget {
  return typeof value === 'string' && (ENGINE_TARGETS as readonly string[]).includes(value);
}

/**
 * Reads a container's metadata object. Anything it cannot use is dropped and named in
 * `notes`, so a hand-edited value shows up in the report and never fails a load.
 */
export function readDialogueMeta(raw: unknown): { readonly meta: DialogueContainerMeta; readonly notes: readonly string[] } {
  if (raw === undefined || raw === null) return { meta: {}, notes: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { meta: {}, notes: ['dialogue metadata is not an object and was ignored'] };
  const source = raw as Record<string, unknown>;
  const notes: string[] = [];
  const meta: { speaker?: string; locBaseline?: string; engineTarget?: EngineTarget; autoLineIds?: boolean } = {};
  if (typeof source.speaker === 'string' && source.speaker.trim() !== '') meta.speaker = source.speaker.trim();
  else if (source.speaker !== undefined) notes.push('speaker must be a codex entry id; it was ignored');
  if (typeof source.locBaseline === 'string' && source.locBaseline.trim() !== '') meta.locBaseline = source.locBaseline.trim();
  if (source.engineTarget !== undefined) {
    if (isEngineTarget(source.engineTarget)) meta.engineTarget = source.engineTarget;
    else notes.push(`engineTarget "${String(source.engineTarget)}" is not a known target and was ignored`);
  }
  if (source.autoLineIds !== undefined) {
    if (typeof source.autoLineIds === 'boolean') meta.autoLineIds = source.autoLineIds;
    else notes.push('autoLineIds must be true or false; it was ignored and defaults to false');
  }
  return { meta, notes };
}
