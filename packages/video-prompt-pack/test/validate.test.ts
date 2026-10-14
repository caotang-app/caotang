/**
 * The pack-time checks. Each rule has a shot that breaks it and a test that names the row it raises,
 * by code, severity and field. The baseline shot at the top raises nothing, so an over-reporting rule
 * fails here too.
 */
import { describe, expect, it } from 'vitest';

import {
  VIDEO_DURATIONS,
  VIDEO_TEMPLATES,
  templateById,
  type ResolvedReference,
  type ValidationIssue,
  type VideoDurationSec,
  type VideoShotRef,
  type VideoVendorTemplate,
} from '../src/index.js';

import { refFor } from './fixtures.js';

const PROMPT = { camera: 'Slow dolly-in', subject: 'Elena', action: 'walks down the quay', context: 'Harbour at dusk', style: 'Film grain' };

function rows(vendor: string, ref: VideoShotRef, references: readonly ResolvedReference[] = []): ValidationIssue[] {
  const template = templateById(vendor);
  if (template === undefined) throw new Error(`no template ${vendor}`);
  return template.accepts(ref, { shotId: 's1', references });
}

function find(issues: readonly ValidationIssue[], code: ValidationIssue['code'], field?: string): ValidationIssue | undefined {
  return issues.find((issue) => issue.code === code && (field === undefined || issue.field === field));
}

function ref(file: string, type: ResolvedReference['type'] = 'character', source: ResolvedReference['source'] = 'codex'): ResolvedReference {
  return { type, source, fileName: file, assetId: file, label: 'Elena' };
}

/** The first value a template declares for a field. The table below reads each vendor's own sets, so the shot fits it. */
function first<T>(values: readonly T[]): T {
  const [value] = values;
  if (value === undefined) throw new Error('the template declares no value for this field');
  return value;
}

/** A shot every template takes: text-to-video, and the first duration, ratio and resolution the vendor declares. */
function shotThatFits(template: VideoVendorTemplate): VideoShotRef {
  const resolution = template.limits.resolutions?.[0];
  return refFor(template.id, {
    prompt: PROMPT,
    durationSec: first(template.limits.durations),
    aspectRatio: first(template.limits.aspectRatios),
    ...(resolution === undefined ? {} : { resolution }),
  });
}

describe('a shot inside every limit raises nothing', () => {
  it('a valid Runway shot has no rows at all', () => {
    expect(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, aspectRatio: '16:9' }))).toEqual([]);
  });
});

describe('durations, ratios and resolutions are enums, reported and never clamped', () => {
  it('a duration the vendor does not take is an out-of-enum error, and the value is kept', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 8 }));
    expect(find(issues, 'out-of-enum', 'durationSec')).toMatchObject({ severity: 'error', vendor: 'runway-gen4', shotId: 's1' });
  });

  it('a missing duration the vendor needs is a missing-field error', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT }));
    expect(find(issues, 'missing-field', 'durationSec')).toMatchObject({ severity: 'error' });
  });

  it('an aspect ratio outside the vendor set is an out-of-enum error', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, aspectRatio: '21:9' }));
    expect(find(issues, 'out-of-enum', 'aspectRatio')).toMatchObject({ severity: 'error' });
  });

  it('Sora needs both an aspect ratio and a resolution, since it derives its frame size from them', () => {
    const issues = rows('sora-2', refFor('sora-2', { prompt: PROMPT, durationSec: 8 }));
    expect(find(issues, 'missing-field', 'aspectRatio')).toMatchObject({ severity: 'error' });
    expect(find(issues, 'missing-field', 'resolution')).toMatchObject({ severity: 'error' });
  });

  it('a resolution on a vendor that takes none is a warning, because the field is not sent', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, resolution: '1080p' }));
    expect(find(issues, 'unsupported-field', 'resolution')).toMatchObject({ severity: 'warning' });
  });
});

describe('character caps and the word ceiling', () => {
  it('a prompt over the vendor cap is an over-cap error, and the message says nothing was cut', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: { subject: 'x'.repeat(600) }, durationSec: 5 }));
    const row = find(issues, 'over-cap', 'prompt');
    expect(row).toMatchObject({ severity: 'error' });
    expect(row?.message).toContain('Nothing is cut silently');
  });

  it("Veo's practical word ceiling is a warning, never an error", () => {
    const words = Array.from({ length: 180 }, (_, index) => `word${index}`).join(' ');
    const issues = rows('veo-3.1', refFor('veo-3.1', { prompt: { subject: words }, durationSec: 6, aspectRatio: '16:9' }));
    expect(find(issues, 'over-cap', 'prompt')).toMatchObject({ severity: 'warning' });
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('a negative prompt over 500 characters is an error for every vendor, Veo included', () => {
    const issues = rows('veo-3.1', refFor('veo-3.1', { prompt: PROMPT, durationSec: 6, negativePrompt: 'x'.repeat(501) }));
    expect(find(issues, 'over-cap', 'negativePrompt')).toMatchObject({ severity: 'error' });
  });

  it('a negative prompt on a vendor that takes none is a warning', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, negativePrompt: 'blurry' }));
    expect(find(issues, 'unsupported-field', 'negativePrompt')).toMatchObject({ severity: 'warning' });
  });
});

describe('seeds, audio and the rewrite toggle', () => {
  it('a seed outside 1…4294967294 is an out-of-range error', () => {
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, seed: 0 })), 'out-of-range', 'seed')).toBeDefined();
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, seed: 4294967295 })), 'out-of-range', 'seed')).toBeDefined();
  });

  it('a seed on a vendor that takes none is a warning that says to record it in the best take', () => {
    const row = find(rows('veo-3.1', refFor('veo-3.1', { prompt: PROMPT, durationSec: 6, seed: 9 })), 'unsupported-field', 'seed');
    expect(row).toMatchObject({ severity: 'warning' });
    expect(row?.message).toContain('best take');
  });

  it('audio cues on a vendor that takes none are a warning', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, audio: { sfx: 'door creak' } }));
    expect(find(issues, 'unsupported-field', 'audio')).toMatchObject({ severity: 'warning' });
  });

  it('turning on the rewrite toggle warns on Wan, and is reported as unsupported on a vendor without one', () => {
    expect(find(rows('wan-2.6', refFor('wan-2.6', { prompt: PROMPT, durationSec: 5, promptExtend: true })), 'prompt-extend-on')).toMatchObject({ severity: 'warning' });
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, promptExtend: true })), 'unsupported-field', 'promptExtend')).toBeDefined();
  });
});

describe('Veo dialogue convention and speakers', () => {
  it('dialogue without quotation marks is a warning', () => {
    const issues = rows('veo-3.1', refFor('veo-3.1', { prompt: PROMPT, durationSec: 6, audio: { dialogue: 'We leave at dawn.' } }));
    expect(find(issues, 'dialogue-unquoted')).toMatchObject({ severity: 'warning' });
  });

  it('two speakers in one shot is a warning, since lip-sync falls under 40%', () => {
    const dialogue = 'ELENA: "We leave at dawn."\nFERRYMAN: "Not in this fog."';
    const issues = rows('veo-3.1', refFor('veo-3.1', { prompt: PROMPT, durationSec: 6, audio: { dialogue } }));
    expect(find(issues, 'multi-speaker')).toMatchObject({ severity: 'warning' });
  });
});

describe('references: the vendor takes certain types and certain counts', () => {
  it('an i2v shot with nothing to start from is a missing-reference error', () => {
    const issues = rows('runway-gen4', refFor('runway-gen4', { mode: 'i2v', prompt: PROMPT, durationSec: 5 }));
    expect(find(issues, 'missing-reference', 'references')).toMatchObject({ severity: 'error' });
  });

  it('an i2v shot on a vendor that is text-to-video only is a mode-unsupported error', () => {
    const issues = rows('seedance-2.5', refFor('seedance-2.5', { mode: 'i2v', prompt: PROMPT, durationSec: 5 }), [ref('a_first.png', 'firstFrame', 'shot')]);
    expect(find(issues, 'mode-unsupported', 'mode')).toMatchObject({ severity: 'error' });
  });

  it('more references than the vendor takes is a reference-limit error', () => {
    const many = Array.from({ length: 31 }, (_, index) => ref(`a_${index}.png`, 'image', 'shot'));
    const issues = rows('seedance-2.5', refFor('seedance-2.5', { prompt: PROMPT, durationSec: 5 }), many);
    expect(find(issues, 'reference-limit', 'references')).toMatchObject({ severity: 'error' });
  });

  it('a combined cap across the vendor’s shared slots is a reference-limit error', () => {
    const four = [ref('a_1.png', 'image', 'shot'), ref('a_2.png', 'image', 'shot'), ref('a_3.png', 'character', 'shot'), ref('a_4.png', 'character', 'shot')];
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5 }), four), 'reference-limit')).toBeDefined();
  });

  it('Sora takes at most two characters per generation', () => {
    const three = [ref('a_1.png', 'character', 'shot'), ref('a_2.png', 'character', 'shot'), ref('a_3.png', 'character', 'shot')];
    const issues = rows('sora-2', refFor('sora-2', { prompt: PROMPT, durationSec: 8, aspectRatio: '16:9', resolution: '720p' }), three);
    expect(find(issues, 'reference-limit')).toMatchObject({ severity: 'error' });
  });

  it('a codex visual reference the vendor cannot take is a warning, and a shot override of one is an error', () => {
    const fromCodex = rows('wan-2.6', refFor('wan-2.6', { prompt: PROMPT, durationSec: 5 }), [ref('a_elena.png', 'character', 'codex')]);
    expect(find(fromCodex, 'reference-unsupported')).toMatchObject({ severity: 'warning' });
    const fromShot = rows('wan-2.6', refFor('wan-2.6', { prompt: PROMPT, durationSec: 5 }), [ref('a_elena.png', 'character', 'shot')]);
    expect(find(fromShot, 'reference-unsupported')).toMatchObject({ severity: 'error' });
  });

  it('a reference that names no file is an error from a shot and a warning from the codex', () => {
    const named = (source: ResolvedReference['source']): ResolvedReference => ({ type: 'character', source, label: 'Elena' });
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5 }), [named('shot')]), 'missing-reference')).toMatchObject({ severity: 'error' });
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5 }), [named('codex')]), 'missing-reference')).toMatchObject({ severity: 'warning' });
  });
});

describe('the empty shot and the audio of a shot with a prompt', () => {
  it('a record with no prompt text is an empty-prompt error', () => {
    expect(find(rows('runway-gen4', refFor('runway-gen4', { prompt: {}, durationSec: 5 })), 'empty-prompt')).toMatchObject({ severity: 'error' });
  });
});

describe('a best take’s seed is held to the seed range (video-prompt-pack.md §2, §3)', () => {
  it('a seed of 0 or 4294967295 on a best take is an out-of-range error on bestTake.seed', () => {
    for (const seed of [0, 4294967295]) {
      const take = { seed, model: 'gen4', vendorParams: {} };
      const issues = rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, bestTake: take }));
      expect(find(issues, 'out-of-range', 'bestTake.seed')).toMatchObject({ severity: 'error', shotId: 's1', vendor: 'runway-gen4' });
    }
  });

  it('the range holds on a vendor that takes no seed, because the take is re-exported in full', () => {
    const take = { seed: 0, model: 'veo', vendorParams: {} };
    expect(find(rows('veo-3.1', refFor('veo-3.1', { prompt: PROMPT, durationSec: 6, bestTake: take })), 'out-of-range', 'bestTake.seed')).toBeDefined();
  });

  it('the first and the last seed of the range raise nothing', () => {
    for (const seed of [1, 4294967294]) {
      const take = { seed, model: 'gen4', vendorParams: {} };
      expect(rows('runway-gen4', refFor('runway-gen4', { prompt: PROMPT, durationSec: 5, bestTake: take }))).toEqual([]);
    }
  });
});

// Every template runs the same three checks over its own limits: a shot that fits raises nothing, a prompt over its
// cap is refused and named, and a duration outside its set is refused and kept. The table is the spec's §8 fixtures.
for (const template of VIDEO_TEMPLATES) {
  describe(`${template.displayName}: the same rules as every other template (§8)`, () => {
    it('a shot that fits the vendor raises no rows', () => {
      expect(rows(template.id, shotThatFits(template))).toEqual([]);
    });

    it('a duration outside the vendor’s set is an out-of-enum error on durationSec, and the value is kept', () => {
      // Seedance takes every union value, so its out-of-set value is one the union does not hold. Stored data can carry
      // one, and the validator refuses it all the same.
      const outside = VIDEO_DURATIONS.find((duration) => !template.limits.durations.includes(duration)) ?? (25 as VideoDurationSec);
      const row = find(rows(template.id, { ...shotThatFits(template), durationSec: outside }), 'out-of-enum', 'durationSec');
      expect(row).toMatchObject({ severity: 'error', shotId: 's1', vendor: template.id });
      expect(row?.message).toContain(String(outside));
    });

    const cap = template.limits.promptChars;
    const ceiling = template.limits.promptWords;
    if (cap !== undefined) {
      it(`a prompt over ${cap} characters is an over-cap error that names the prompt, and nothing is cut silently`, () => {
        const shot = { ...shotThatFits(template), prompt: { subject: 'x'.repeat(cap) } };
        expect(template.compose(shot).length).toBeGreaterThan(cap);
        const row = find(rows(template.id, shot), 'over-cap', 'prompt');
        expect(row).toMatchObject({ severity: 'error', shotId: 's1', vendor: template.id });
        expect(row?.message).toContain('Nothing is cut silently');
      });
    } else if (ceiling !== undefined) {
      it(`a prompt over the ${ceiling}-word ceiling is an over-cap warning, never an error, and nothing is cut silently`, () => {
        const subject = Array.from({ length: ceiling + 5 }, (_, index) => `word${index}`).join(' ');
        const issues = rows(template.id, { ...shotThatFits(template), prompt: { subject } });
        expect(find(issues, 'over-cap', 'prompt')).toMatchObject({ severity: 'warning' });
        expect(find(issues, 'over-cap', 'prompt')?.message).toContain('Nothing is cut silently');
        expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      });
    } else {
      it('no numeric prompt cap is documented for it, so a long prompt raises no over-cap row', () => {
        expect(find(rows(template.id, { ...shotThatFits(template), prompt: { subject: 'x'.repeat(3000) } }), 'over-cap')).toBeUndefined();
      });
    }
  });
}
