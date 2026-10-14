/**
 * Wan 2.6 — the `wan-2.6` template ([video-prompt-pack.md §2, §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence: a prompt up to 1500 characters (the 2.2 model took 800, and this template
 * is for 2.5 and 2.6), a negative prompt up to 500, durations 5, 10 and 15, the five ratios the evidence
 * lists, 720p and 1080p, and a seed. Wan takes one first frame for image-to-video and no reference images,
 * so a codex visual reference cannot reach it and the validator says so.
 *
 * Wan's `prompt_extend` is an LLM rewrite of the prompt. Caotang's authored prompt is canonical (§2), so the
 * template always sends `prompt_extend: false` unless the writer turns it on, and then it warns.
 */

import { clean } from '../compose.js';
import { defineTemplate } from '../template.js';
import { fieldIf, modelField, refName, visualSentences } from './shared.js';

export const WAN_2_6 = defineTemplate({
  id: 'wan-2.6',
  displayName: 'Wan 2.6',
  provisional: 'The payload field names, the prompt_extend default and the best-take fields are unverified until C29 checks them against Alibaba’s Wan documentation.',
  limits: {
    modes: ['t2v', 'i2v'],
    durations: [5, 10, 15],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    promptChars: 1500,
    negativeChars: 500,
    seed: true,
    audio: false,
    promptExtend: true,
    references: { max: { firstFrame: 1 } },
    required: ['durationSec'],
  },
  fileRefPolicy: 'name',
  grammarHints: [
    'Wan 2.6: prompt up to 1,500 characters and negative prompt up to 500.',
    'prompt_extend is off, because the vendor would rewrite the prompt Caotang wrote. Turning it on is a warning.',
    'Wan takes a first frame and no reference images, so a character is carried by the prompt text.',
  ].join('\n'),
  compose: (shot) => visualSentences(shot.prompt),
  map: (shot, context) => {
    const negative = clean(shot.negativePrompt);
    return {
      ...modelField(shot),
      prompt: visualSentences(shot.prompt),
      ...fieldIf('negative_prompt', negative === '' ? undefined : negative),
      ...fieldIf('duration', shot.durationSec),
      ...fieldIf('aspect_ratio', shot.aspectRatio),
      ...fieldIf('resolution', shot.resolution),
      ...fieldIf('seed', shot.seed),
      prompt_extend: shot.promptExtend ?? false,
      ...fieldIf('img_url', refName(context.references, 'firstFrame')),
    };
  },
});
