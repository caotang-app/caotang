/**
 * The data model of the AI-video prompt pack — [video-prompt-pack.md §2–§3](../../../docs/architecture/video-prompt-pack.md).
 *
 * Only the normalized shot schema lives here. The field names, caps and enums of each
 * vendor live in the templates (`templates/`), because that is where they differ. A
 * vendor's own parameters ride in `BestTake.vendorParams`, which Caotang records and
 * re-exports and never reads.
 *
 * The storyboard types (`ShotNode`, `StoryboardSnapshot`) are the shapes the app hands
 * this package. The storyboard module is not built yet, so they follow storyboard.md
 * §2.2 and carry no more than this package needs.
 */

import type { CodexEntry, TreeNode } from '@caotang/store';

export const VIDEO_MODES = ['t2v', 'i2v'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

/** §2's union of the surveyed duration enums. Each template accepts a subset and says which. */
export const VIDEO_DURATIONS = [4, 5, 6, 8, 10, 12, 15, 16, 20] as const;
export type VideoDurationSec = (typeof VIDEO_DURATIONS)[number];

export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_RESOLUTIONS = ['720p', '1080p'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const REFERENCE_TYPES = ['image', 'character', 'firstFrame', 'lastFrame'] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

/** §2: a seed is 1…4294967294 where the vendor takes one. */
export const SEED_MIN = 1;
export const SEED_MAX = 4294967294;

/** §2: `negativePrompt` is capped at 500 characters pack-wide, whatever the vendor takes. */
export const NEGATIVE_PROMPT_PACK_CAP = 500;

/** One reference for a shot. `entryId` names a codex entry, `assetId` a project asset (§2). */
export interface VideoReference {
  readonly type: ReferenceType;
  readonly entryId?: string;
  readonly assetId?: string;
}

/** The structured prose of one shot, camera first (§2). Every part is optional. */
export interface VideoPrompt {
  readonly camera?: string;
  readonly subject?: string;
  readonly action?: string;
  readonly context?: string;
  readonly style?: string;
}

/** The audio cues of one shot. Dialogue is quoted (§2); the template decides where each cue goes. */
export interface VideoAudio {
  readonly dialogue?: string;
  readonly sfx?: string;
  readonly ambient?: string;
  readonly music?: string;
}

/**
 * The take the writer kept from their own generation (§3). Caotang records it and re-exports
 * it, and never round-trips a generation itself. `vendorParams` is vendor-specific, so it is
 * not normalized.
 */
export interface BestTake {
  readonly seed: number;
  readonly model: string;
  readonly vendorParams: Readonly<Record<string, string | number>>;
  readonly note?: string;
}

/**
 * One shot's prompt for one vendor — §2's `VideoShotRef`, held in `ShotMeta.vendorRefs`.
 * `references` empty means "resolve from the codex" (§3); a non-empty list is an override.
 */
export interface VideoShotRef {
  readonly vendor: string;
  readonly model?: string;
  readonly mode: VideoMode;
  readonly prompt: VideoPrompt;
  readonly audio?: VideoAudio;
  readonly negativePrompt?: string;
  readonly durationSec?: VideoDurationSec;
  readonly aspectRatio?: VideoAspectRatio;
  readonly resolution?: VideoResolution;
  readonly seed?: number;
  readonly promptExtend?: boolean;
  readonly references: readonly VideoReference[];
  readonly notes?: string;
  readonly bestTake?: BestTake;
}

/**
 * §3: a codex entry may carry visual references, which are asset ids. The store's `CodexEntry` declares the
 * field (`visualRefs`, optional), and this interface names it again so the pack's readers need no store import.
 */
export interface CodexEntryWithRefs extends CodexEntry {
  readonly visualRefs?: string[];
}

/** A file in the project's `assets/` directory (storyboard.md §2.1). `fileName` is what the pack names and the writer attaches. */
export interface AssetRecord {
  readonly id: string;
  readonly fileName: string;
  readonly label?: string;
}

/** Script text one shot covers. The app resolves the shot's `dialogue[]` anchors first (edit-anchors.md §3). */
export interface CoveredScript {
  readonly label: string;
  readonly text: string;
}

/**
 * A `shot` node and the storyboard fields the prompt pack reads (storyboard.md §2.2).
 * Enum fields arrive as the strings storyboard stores, and an unknown value is kept as
 * written, so a label can still be shown for it.
 */
export interface ShotNode {
  readonly id: string;
  readonly action?: string;
  readonly imageAlt?: string;
  readonly shotSize?: string;
  readonly cameraAngle?: string;
  readonly cameraMovement?: string;
  readonly lens?: string;
  readonly durationSec?: number;
  readonly covered: readonly CoveredScript[];
  readonly vendorRefs?: readonly VideoShotRef[];
}

/** Everything the pack reads from one open project: the binder tree, the shots, the codex and the asset store. */
export interface StoryboardSnapshot {
  readonly tree: readonly TreeNode[];
  readonly shots: readonly ShotNode[];
  readonly codex: readonly CodexEntryWithRefs[];
  readonly assets: ReadonlyMap<string, AssetRecord>;
}

export type IssueSeverity = 'error' | 'warning';

/**
 * The validation rows the pack and the compile log carry (§4, §5). `over-cap`,
 * `out-of-enum` and `missing-reference` are the acceptance list the spec names; the rest
 * are the template rules that the same rows report. `provisional-template` is the one row
 * an export raises for the template itself, not for a shot (§9, A3).
 */
export type ValidationCode =
  | 'over-cap'
  | 'out-of-enum'
  | 'out-of-range'
  | 'missing-field'
  | 'missing-reference'
  | 'reference-limit'
  | 'reference-unsupported'
  | 'mode-unsupported'
  | 'unsupported-field'
  | 'prompt-extend-on'
  | 'multi-speaker'
  | 'dialogue-unquoted'
  | 'empty-prompt'
  | 'best-take-collision'
  | 'provisional-template';

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly severity: IssueSeverity;
  /** The field the row is about, in the normalized schema's names (`prompt.camera`, `durationSec`). */
  readonly field: string;
  /** Says what is wrong and names the fix. Never a bare code. */
  readonly message: string;
  readonly shotId?: string;
  readonly vendor?: string;
}

/**
 * A reference after resolution: the file a template names, and where it came from. `source`
 * is `shot` for an override on the shot's record and `codex` for an entry the shot mentions (§3).
 */
export interface ResolvedReference {
  readonly type: ReferenceType;
  readonly source: 'shot' | 'codex';
  readonly entryId?: string;
  readonly assetId?: string;
  /** The asset's file name when the store holds the asset. Undefined means the reference names no file. */
  readonly fileName?: string;
  /** The codex entry's name, when a codex entry supplied the reference. */
  readonly label?: string;
}

/** Looks up a shot's codex-facing folder chain: its ancestors, nearest first, without the project root. */
export interface FolderLink {
  readonly id: string;
  readonly title: string;
  readonly synopsis: string;
}
