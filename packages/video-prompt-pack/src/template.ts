/**
 * The vendor-template layer — [video-prompt-pack.md §5](../../../docs/architecture/video-prompt-pack.md).
 *
 * A template is data plus three functions. The data is its `limits`: the modes, durations,
 * aspect ratios and resolutions it accepts, its character caps, its seed and audio support,
 * and its reference rules. Every rule the validator applies comes from that data, so a vendor's
 * enums and caps are stated once and cannot drift between the check and the document. The
 * functions compose the prompt text, map the normalized shot to the vendor's field names, and
 * add any rule the data cannot say (Veo's dialogue quoting, Wan's rewrite toggle).
 *
 * Templates are a closed set compiled into this package (§5): a new vendor is a spec change
 * with fixtures, never a runtime plugin.
 */

import type { ReferenceType, ResolvedReference, ValidationIssue, VideoAspectRatio, VideoDurationSec, VideoMode, VideoResolution, VideoShotRef } from './model.js';
import { genericIssues } from './validate.js';

/** The fields a vendor needs that the normalized shot may leave unset. */
export type RequiredField = 'durationSec' | 'aspectRatio' | 'resolution';

export interface ReferenceRules {
  /** The most of each type the vendor takes. A type absent here is not taken at all. */
  readonly max: Partial<Record<ReferenceType, number>>;
  /** A combined cap on some types, for a vendor whose slots are shared (Runway's three image slots). */
  readonly total?: { readonly types: readonly ReferenceType[]; readonly max: number };
}

/** What a vendor accepts. Out-of-set values are reported as errors and never clamped. */
export interface VendorLimits {
  readonly modes: readonly VideoMode[];
  readonly durations: readonly VideoDurationSec[];
  readonly aspectRatios: readonly VideoAspectRatio[];
  /** Undefined: the vendor takes no resolution field, so a shot's resolution is not sent. */
  readonly resolutions?: readonly VideoResolution[];
  /** The vendor's cap on the composed prompt, in characters. Undefined: no numeric cap is documented. */
  readonly promptChars?: number;
  /** A practical word ceiling. Exceeding it is a warning, since it is a quality limit and not a rejection. */
  readonly promptWords?: number;
  /** The vendor's cap on the negative prompt. Undefined: the vendor takes none. */
  readonly negativeChars?: number;
  readonly seed: boolean;
  readonly audio: boolean;
  /** The vendor has a rewrite toggle that changes the authored prompt. Caotang's default is off (§2). */
  readonly promptExtend: boolean;
  readonly references: ReferenceRules;
  readonly required: readonly RequiredField[];
}

/** What a rule check needs beyond the shot itself. */
export interface AcceptContext {
  readonly shotId: string;
  readonly references: readonly ResolvedReference[];
}

export interface MapContext {
  readonly references: readonly ResolvedReference[];
}

/** A vendor's request body, in JSON. Its field names are the vendor's, not Caotang's. */
export type VendorPayload = Record<string, unknown>;

export interface VideoVendorTemplate {
  /** The template id a `VideoShotRef.vendor` and a recipe's `templateId` name, for example `runway-gen4`. */
  readonly id: string;
  readonly displayName: string;
  readonly limits: VendorLimits;
  /**
   * How references ship (§3). `attach` means the pack also lists the files to upload by hand,
   * because the vendor takes binaries. `name` means the pack names the files and nothing is uploaded.
   */
  readonly fileRefPolicy: 'name' | 'attach';
  /** §4's grammar guidance, rendered as comments in the Markdown pack and shown to the drafter. */
  readonly grammarHints: string;
  /**
   * Set while the template's payload field names, limits or best-take fields are not yet verified
   * against the vendor's own documentation (§9, A3; C29). The text says what is unverified. Every
   * export of the template then carries a warning row, and the JSON and Markdown packs state the
   * note. Removing the field is the act of verifying the template.
   */
  readonly provisional?: string;
  /** The vendor's prompt text, before any cap is measured. Never truncated. */
  readonly compose: (shot: VideoShotRef) => string;
  /** The rules for this vendor: its data-driven checks, plus the rules that only it has. */
  readonly accepts: (shot: VideoShotRef, context: AcceptContext) => ValidationIssue[];
  /** The normalized shot in the vendor's own field names. Its keys are the vendor's, its values are the shot's. */
  readonly map: (shot: VideoShotRef, context: MapContext) => VendorPayload;
}

/** The authoring form of a template: everything except the `accepts` that `defineTemplate` builds. */
export interface TemplateDefinition extends Omit<VideoVendorTemplate, 'accepts'> {
  /** Rules that the limits cannot express, checked after the generic ones. */
  readonly extra?: (shot: VideoShotRef, context: AcceptContext) => ValidationIssue[];
}

/** Builds a template: `accepts` is the generic check over its limits, followed by its own rules. */
export function defineTemplate(definition: TemplateDefinition): VideoVendorTemplate {
  const { extra, ...rest } = definition;
  return {
    ...rest,
    accepts: (shot, context) => [...genericIssues(shot, definition, context), ...(extra?.(shot, context) ?? [])],
  };
}
