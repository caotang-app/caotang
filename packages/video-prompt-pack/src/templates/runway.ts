/**
 * Runway Gen-4 — the `runway-gen4` template ([video-prompt-pack.md §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence:
 * the prompt at 512 characters, which is the floor of Runway's documented 512–1000 range, so a pack
 * is valid on every model the template names; durations 5 and 10; the 16:9 and 9:16 ratios the
 * evidence documents for the platform; one seed; and reference images as the consistency mechanism.
 * The payload field names and the Gen-4 ratio set are provisional until they are checked against the vendor's documentation.
 */

import type { VideoShotRef } from '../model.js';
import { joinSentences, promptParts, sentence } from '../compose.js';
import { defineTemplate } from '../template.js';
import { fieldIf, modelField, refName, refNames } from './shared.js';

/** `[camera movement]: [establishing scene]. [additional details].` — the Gen-4 guide's shape. */
function runwayText(shot: VideoShotRef): string {
  const parts = promptParts(shot.prompt);
  const scene = [parts.subject, parts.action].filter((part) => part !== '').join(' ');
  let lead = sentence(scene);
  if (parts.camera !== '') lead = scene !== '' ? `${parts.camera}: ${lead}` : sentence(parts.camera);
  const details = joinSentences([parts.context, parts.style]);
  return [lead, details].filter((part) => part !== '').join(' ');
}

export const RUNWAY_GEN4 = defineTemplate({
  id: 'runway-gen4',
  displayName: 'Runway Gen-4',
  provisional: 'The payload field names, the Gen-4 ratio set and the best-take fields are unverified until they are checked against Runway’s documentation.',
  limits: {
    modes: ['t2v', 'i2v'],
    durations: [5, 10],
    aspectRatios: ['16:9', '9:16'],
    promptChars: 512,
    seed: true,
    audio: false,
    promptExtend: false,
    references: { max: { image: 3, character: 3, firstFrame: 1 }, total: { types: ['image', 'character'], max: 3 } },
    required: ['durationSec'],
  },
  fileRefPolicy: 'attach',
  grammarHints: [
    'Runway Gen-4: [camera movement]: [establishing scene]. [additional details].',
    'Write concrete physical actions, never abstract ideas.',
    'The reference image and the prompt together make the prompt, so do not describe the reference image again.',
    'This template sends no audio cues and no negative prompt.',
  ].join('\n'),
  compose: runwayText,
  map: (shot, context) => {
    const referenceImages = refNames(context.references, ['image', 'character']);
    return {
      ...modelField(shot),
      promptText: runwayText(shot),
      ...fieldIf('duration', shot.durationSec),
      ...fieldIf('ratio', shot.aspectRatio),
      ...fieldIf('seed', shot.seed),
      ...fieldIf('promptImage', refName(context.references, 'firstFrame')),
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
    };
  },
});
