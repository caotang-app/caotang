/**
 * Kling 2.6 — the `kling-2.6` template ([video-prompt-pack.md §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence: a prompt up to 2500 characters, a negative prompt up to 500, durations
 * 5 and 10, and the 16:9, 9:16 and 1:1 ratios. Kling takes first and last frames, and up to four
 * multi-image references (v1.6+). It documents no seed in the evidence, so none is sent. The payload
 * field names are provisional until C29.
 *
 * The `cfg_scale` adherence control is noted in the grammar hints but not set here. It is the vendor's
 * own parameter, and a writer who wants it records it in the best take.
 */

import { visualSentences, modelField, refName, refNames, fieldIf } from './shared.js';
import { clean } from '../compose.js';
import { defineTemplate } from '../template.js';

export const KLING_2_6 = defineTemplate({
  id: 'kling-2.6',
  displayName: 'Kling 2.6',
  provisional: 'The payload field names, the reference-frame fields and the best-take fields are unverified until C29 checks them against Kling’s documentation.',
  limits: {
    modes: ['t2v', 'i2v'],
    durations: [5, 10],
    aspectRatios: ['16:9', '9:16', '1:1'],
    promptChars: 2500,
    negativeChars: 500,
    seed: false,
    audio: false,
    promptExtend: false,
    references: { max: { image: 4, character: 4, firstFrame: 1, lastFrame: 1 }, total: { types: ['image', 'character'], max: 4 } },
    required: ['durationSec'],
  },
  fileRefPolicy: 'attach',
  grammarHints: [
    'Kling 2.6: free prose up to 2,500 characters, camera first.',
    'cfg_scale sets how closely the vendor follows the prompt (0 to 1, default 0.5). Set it in the vendor tool and record it in the best take.',
    'First and last frames are uploaded to Kling by hand, so the pack lists the files to attach.',
    'Up to six shots can run as one multi-prompt take; this template exports one shot at a time.',
  ].join('\n'),
  compose: (shot) => visualSentences(shot.prompt),
  map: (shot, context) => {
    const negative = clean(shot.negativePrompt);
    const imageList = refNames(context.references, ['image', 'character']);
    return {
      ...modelField(shot),
      prompt: visualSentences(shot.prompt),
      ...fieldIf('negative_prompt', negative === '' ? undefined : negative),
      ...fieldIf('duration', shot.durationSec),
      ...fieldIf('aspect_ratio', shot.aspectRatio),
      ...fieldIf('image', refName(context.references, 'firstFrame')),
      ...fieldIf('image_tail', refName(context.references, 'lastFrame')),
      ...(imageList.length > 0 ? { image_list: imageList } : {}),
    };
  },
});
