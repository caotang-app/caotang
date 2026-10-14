/**
 * Seedance 2.5 — the `seedance-2.5` template ([video-prompt-pack.md §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence: Seedance 2.5 is text-to-video from reference images only, with no
 * first frame, up to 30 image references, and a duration of 4 to 30 seconds. Every duration in the
 * union that falls inside that range is accepted. The evidence does not give Seedance's aspect ratios,
 * so the template takes the two both the other five vendors document, 16:9 and 9:16, until C29 confirms
 * the rest. It documents no prompt cap, no seed and no audio, so none is enforced or sent.
 */

import { VIDEO_DURATIONS } from '../model.js';
import { defineTemplate } from '../template.js';
import { fieldIf, modelField, refNames, visualSentences } from './shared.js';

export const SEEDANCE_2_5 = defineTemplate({
  id: 'seedance-2.5',
  displayName: 'Seedance 2.5',
  provisional: 'The payload field names, the aspect ratios and the best-take fields are unverified until C29 checks them against ByteDance’s Seedance documentation.',
  limits: {
    modes: ['t2v'],
    durations: [...VIDEO_DURATIONS],
    aspectRatios: ['16:9', '9:16'],
    seed: false,
    audio: false,
    promptExtend: false,
    references: { max: { image: 30, character: 30 }, total: { types: ['image', 'character'], max: 30 } },
    required: ['durationSec'],
  },
  fileRefPolicy: 'attach',
  grammarHints: [
    'Seedance 2.5: text-to-video from reference images only, up to 30 images, with no first frame.',
    'Name the references in the prompt, because the images are the only way to hold a character.',
  ].join('\n'),
  compose: (shot) => visualSentences(shot.prompt),
  map: (shot, context) => {
    const referenceImages = refNames(context.references, ['image', 'character']);
    return {
      ...modelField(shot),
      prompt: visualSentences(shot.prompt),
      ...fieldIf('duration', shot.durationSec),
      ...fieldIf('ratio', shot.aspectRatio),
      ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
    };
  },
});
