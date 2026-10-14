/**
 * Sora 2 / 2 Pro — the `sora-2` template ([video-prompt-pack.md §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence: durations 4, 8, 12, 16 and 20; a prompt in short prose, with no numeric
 * cap in the evidence, so none is enforced here; the frame size as `{w}x{h}`, which this template derives
 * from the aspect ratio and the resolution. Identity is the Characters API: a 2–4 second clip becomes a
 * persistent character id, at most two per generation, and Sora enforces likeness consent. Caotang never
 * uploads that clip. The pack names the character and the file to attach.
 *
 * Sora's seed and audio are not in the evidence, so neither is sent. The size table covers the two ratios
 * the evidence documents in both resolutions. The payload names are provisional until C29.
 */

import type { VideoAspectRatio, VideoResolution } from '../model.js';
import { defineTemplate } from '../template.js';
import { fieldIf, modelField, refName, visualSentences } from './shared.js';

/** The frame size for an aspect ratio and a resolution. Undefined outside the two ratios the template takes. */
function soraSize(aspect: VideoAspectRatio | undefined, resolution: VideoResolution | undefined): string | undefined {
  if (aspect === '16:9') return resolution === '1080p' ? '1920x1080' : resolution === '720p' ? '1280x720' : undefined;
  if (aspect === '9:16') return resolution === '1080p' ? '1080x1920' : resolution === '720p' ? '720x1280' : undefined;
  return undefined;
}

export const SORA_2 = defineTemplate({
  id: 'sora-2',
  displayName: 'Sora 2',
  provisional: 'The payload field names, the frame-size table and the best-take fields are unverified until C29 checks them against OpenAI’s Sora documentation.',
  limits: {
    modes: ['t2v', 'i2v'],
    durations: [4, 8, 12, 16, 20],
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    seed: false,
    audio: false,
    promptExtend: false,
    references: { max: { character: 2, firstFrame: 1 } },
    required: ['durationSec', 'aspectRatio', 'resolution'],
  },
  fileRefPolicy: 'attach',
  grammarHints: [
    'Sora 2: short prose, one action per shot.',
    'Identity comes from the Characters API. Create each character in Sora from a 2 to 4 second clip, and keep to two characters per generation.',
    'The pack names each character and the file to attach. Likeness consent is enforced by Sora, so the clip is never uploaded by Caotang.',
  ].join('\n'),
  compose: (shot) => visualSentences(shot.prompt),
  map: (shot, context) => {
    const characters = context.references
      .filter((reference) => reference.type === 'character' && reference.fileName !== undefined)
      .map((reference) => ({ name: reference.label ?? reference.assetId ?? 'character', file: reference.fileName }));
    return {
      ...modelField(shot),
      prompt: visualSentences(shot.prompt),
      ...fieldIf('seconds', shot.durationSec),
      ...fieldIf('size', soraSize(shot.aspectRatio, shot.resolution)),
      ...fieldIf('input_reference', refName(context.references, 'firstFrame')),
      ...(characters.length > 0 ? { characters } : {}),
    };
  },
});
