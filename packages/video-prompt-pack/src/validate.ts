/**
 * The pack-time checks — [video-prompt-pack.md §2, §5, §8](../../../docs/architecture/video-prompt-pack.md).
 *
 * Every rule here reads a template's `limits` and never a vendor's name, so a template
 * declares its rules and this file applies them. A row is an error when the vendor would
 * refuse the shot, and a warning when it would accept the shot and the writer should know
 * something. Nothing is clamped or truncated: an out-of-set value is reported and left as it
 * is, so the writer fixes it in the app (§2).
 */

import {
  NEGATIVE_PROMPT_PACK_CAP,
  REFERENCE_TYPES,
  SEED_MAX,
  SEED_MIN,
  type IssueSeverity,
  type ResolvedReference,
  type ValidationCode,
  type ValidationIssue,
  type VideoShotRef,
} from './model.js';
import { audioParts, clean, countWords, hasAudio } from './compose.js';
import type { AcceptContext, VendorLimits } from './template.js';

/** The fields `genericIssues` reads from a template. A `TemplateDefinition` has all of them. */
export interface RuleSubject {
  readonly id: string;
  readonly displayName: string;
  readonly limits: VendorLimits;
  readonly compose: (shot: VideoShotRef) => string;
}

function list(values: readonly (string | number)[]): string {
  return values.map(String).join(', ');
}

/**
 * The rows every vendor is checked against. The order is fixed, so a shot's rows come out
 * in the same order on every run.
 */
export function genericIssues(shot: VideoShotRef, subject: RuleSubject, context: AcceptContext): ValidationIssue[] {
  const rows: ValidationIssue[] = [];
  const { limits, displayName } = subject;
  const add = (code: ValidationCode, severity: IssueSeverity, field: string, message: string): void => {
    rows.push({ code, severity, field, message, shotId: context.shotId, vendor: subject.id });
  };

  if (!limits.modes.includes(shot.mode)) {
    add('mode-unsupported', 'error', 'mode', `${displayName} does not take ${shot.mode} shots; use ${list(limits.modes)}.`);
  }

  const prompt = subject.compose(shot);
  if (prompt === '') {
    add('empty-prompt', 'error', 'prompt', `The shot has no prompt text for ${displayName}. Draft the prompt, or write its camera, subject or action.`);
  }

  for (const field of limits.required) {
    if (field === 'durationSec' && shot.durationSec === undefined) {
      add('missing-field', 'error', 'durationSec', `${displayName} needs a duration: set one of ${list(limits.durations)} seconds for this shot.`);
    }
    if (field === 'aspectRatio' && shot.aspectRatio === undefined) {
      add('missing-field', 'error', 'aspectRatio', `${displayName} needs an aspect ratio: set one of ${list(limits.aspectRatios)} for this shot.`);
    }
    if (field === 'resolution' && shot.resolution === undefined && limits.resolutions !== undefined) {
      add('missing-field', 'error', 'resolution', `${displayName} needs a resolution: set one of ${list(limits.resolutions)} for this shot.`);
    }
  }

  if (shot.durationSec !== undefined && !limits.durations.includes(shot.durationSec)) {
    add('out-of-enum', 'error', 'durationSec', `${displayName} takes ${list(limits.durations)} seconds; this shot has ${shot.durationSec}. Choose one it takes.`);
  }

  if (shot.aspectRatio !== undefined && !limits.aspectRatios.includes(shot.aspectRatio)) {
    add('out-of-enum', 'error', 'aspectRatio', `${displayName} takes the aspect ratios ${list(limits.aspectRatios)}; this shot has ${shot.aspectRatio}.`);
  }

  if (shot.resolution !== undefined) {
    if (limits.resolutions === undefined) {
      add('unsupported-field', 'warning', 'resolution', `${displayName} takes no resolution field, so this shot's resolution is not sent.`);
    } else if (!limits.resolutions.includes(shot.resolution)) {
      add('out-of-enum', 'error', 'resolution', `${displayName} takes the resolutions ${list(limits.resolutions)}; this shot has ${shot.resolution}.`);
    }
  }

  if (shot.seed !== undefined) {
    if (!Number.isInteger(shot.seed) || shot.seed < SEED_MIN || shot.seed > SEED_MAX) {
      add('out-of-range', 'error', 'seed', `A seed is a whole number from ${SEED_MIN} to ${SEED_MAX}; this shot has ${shot.seed}.`);
    }
    if (!limits.seed) {
      add('unsupported-field', 'warning', 'seed', `${displayName} takes no seed, so this shot's seed is not sent. Record it in the best take so the take can be reproduced.`);
    }
  }

  // A take's seed is the value a re-run uses, and Runway's own guidance says a seed alone does not reproduce
  // a take. It is held to the same range as the shot's seed. The check runs whether or not this vendor takes
  // a seed, because the record is re-exported in full.
  const take = shot.bestTake;
  if (take !== undefined && (!Number.isInteger(take.seed) || take.seed < SEED_MIN || take.seed > SEED_MAX)) {
    add('out-of-range', 'error', 'bestTake.seed', `A best take's seed is a whole number from ${SEED_MIN} to ${SEED_MAX}; this take has ${take.seed}.`);
  }

  const negative = clean(shot.negativePrompt);
  if (negative !== '') {
    if (negative.length > NEGATIVE_PROMPT_PACK_CAP) {
      add('over-cap', 'error', 'negativePrompt', `The negative prompt is ${negative.length} characters; the pack allows ${NEGATIVE_PROMPT_PACK_CAP} for every vendor. Shorten it in the shot.`);
    }
    if (limits.negativeChars === undefined) {
      add('unsupported-field', 'warning', 'negativePrompt', `${displayName} takes no negative prompt, so this shot's exclusions are not sent. Put them in the prompt text if they matter.`);
    } else if (negative.length > limits.negativeChars) {
      add('over-cap', 'error', 'negativePrompt', `The negative prompt is ${negative.length} characters; ${displayName} takes at most ${limits.negativeChars}. Shorten it in the shot.`);
    }
  }

  if (limits.promptChars !== undefined && prompt.length > limits.promptChars) {
    add('over-cap', 'error', 'prompt', `The prompt is ${prompt.length} characters; ${displayName} takes at most ${limits.promptChars}. Shorten the prompt in the shot, then export again. Nothing is cut silently.`);
  }
  if (limits.promptWords !== undefined && countWords(prompt) > limits.promptWords) {
    add('over-cap', 'warning', 'prompt', `The prompt is ${countWords(prompt)} words; ${displayName}'s practical ceiling is ${limits.promptWords}. Shorter prompts hold better. Nothing is cut silently.`);
  }

  if (hasAudio(shot.audio) && !limits.audio) {
    const cues = Object.entries(audioParts(shot.audio))
      .filter(([, text]) => text !== '')
      .map(([cue]) => cue);
    add('unsupported-field', 'warning', 'audio', `${displayName} takes no audio cues, so ${cues.join(', ')} is not sent. Fold any sound the shot needs into the prompt text.`);
  }

  if (shot.promptExtend === true) {
    if (limits.promptExtend) {
      add('prompt-extend-on', 'warning', 'promptExtend', `${displayName}'s prompt_extend rewrites the prompt with a model. This shot turns it on, so the vendor will not send the prompt Caotang wrote.`);
    } else {
      add('unsupported-field', 'warning', 'promptExtend', `${displayName} has no prompt rewrite toggle, so this setting is not sent.`);
    }
  }

  for (const reference of context.references) {
    checkReference(reference, subject, add);
  }
  checkReferenceCounts(context.references, subject, add);

  if (shot.mode === 'i2v' && limits.modes.includes('i2v') && context.references.length === 0) {
    add('missing-reference', 'error', 'references', 'An i2v shot needs a first frame: attach a first-frame asset to the shot, or a visual reference to a codex entry the shot mentions.');
  }

  return rows;
}

type Add = (code: ValidationCode, severity: IssueSeverity, field: string, message: string) => void;

function checkReference(reference: ResolvedReference, subject: RuleSubject, add: Add): void {
  const severity: IssueSeverity = reference.source === 'shot' ? 'error' : 'warning';
  const who = reference.label ?? reference.assetId ?? 'A reference';
  if (reference.fileName === undefined) {
    add('missing-reference', severity, 'references', `${who} names no file in the project's assets. Re-attach its image.`);
    return;
  }
  if (subject.limits.references.max[reference.type] === undefined) {
    const remedy = reference.source === 'codex' ? 'so this entry carries the character by its prompt text' : 'remove it from this shot';
    add('reference-unsupported', severity, 'references', `${subject.displayName} takes no ${reference.type} reference for ${who}; ${remedy}.`);
  }
}

/** Counts only the references the vendor takes and the store can name. Missing and unsupported ones have their own rows. */
function checkReferenceCounts(references: readonly ResolvedReference[], subject: RuleSubject, add: Add): void {
  const rules = subject.limits.references;
  const usable = references.filter((reference) => reference.fileName !== undefined && rules.max[reference.type] !== undefined);
  for (const type of REFERENCE_TYPES) {
    const max = rules.max[type];
    if (max === undefined) continue;
    const count = usable.filter((reference) => reference.type === type).length;
    if (count > max) {
      add('reference-limit', 'error', 'references', `${subject.displayName} takes at most ${max} ${type} reference${max === 1 ? '' : 's'}; this shot has ${count}. Remove the extra ones.`);
    }
  }
  if (rules.total !== undefined) {
    const { types, max } = rules.total;
    const count = usable.filter((reference) => types.includes(reference.type)).length;
    if (count > max) {
      add('reference-limit', 'error', 'references', `${subject.displayName} takes at most ${max} references across ${types.join(' and ')}; this shot has ${count}. Remove the extra ones.`);
    }
  }
}
