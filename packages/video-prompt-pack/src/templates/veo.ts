/**
 * Veo 3 / 3.1 — the `veo-3.1` template ([video-prompt-pack.md §4–§5](../../../../docs/architecture/video-prompt-pack.md)).
 *
 * The limits are the D3 evidence: durations 4, 6 and 8; 16:9 and 9:16; a negative prompt up to 1000
 * characters (pack-wide 500 still applies); native audio. Resolution is 720p and 1080p, which the
 * evidence does not state for Veo, so it is provisional until they are checked against the vendor's documentation. Veo's practical prompt ceiling is
 * about 175 words, and it is a warning and never a rejection.
 *
 * Two rules sit with the template and not in the limits. Audio cues go first, because the vendor reads
 * them best there. Dialogue is quoted. And lip-sync is reliable for one speaker per shot, so two or more
 * speakers draw a warning.
 */

import type { ValidationIssue, VideoShotRef } from '../model.js';
import { audioParts, clean, joinSentences, promptParts, speakersOf } from '../compose.js';
import { defineTemplate, type AcceptContext } from '../template.js';
import { fieldIf, modelField, refName, refNames } from './shared.js';

/** Audio first, then `[Cinematography] + [Subject] + [Action] + [Dialogue] + [Context] + [Style]`. */
function veoText(shot: VideoShotRef): string {
  const cues = audioParts(shot.audio);
  const parts = promptParts(shot.prompt);
  return joinSentences([
    cues.ambient !== '' ? `Ambient sound: ${cues.ambient}` : undefined,
    cues.sfx !== '' ? `Sound effects: ${cues.sfx}` : undefined,
    cues.music !== '' ? `Music: ${cues.music}` : undefined,
    parts.camera,
    [parts.subject, parts.action].filter((part) => part !== '').join(' '),
    cues.dialogue !== '' ? `Dialogue: ${cues.dialogue}` : undefined,
    parts.context,
    parts.style,
  ]);
}

/** The two rules the limits cannot say: the dialogue convention and the speaker count. */
function veoRules(shot: VideoShotRef, context: AcceptContext): ValidationIssue[] {
  const rows: ValidationIssue[] = [];
  const dialogue = shot.audio?.dialogue ?? '';
  if (dialogue.trim() === '') return rows;
  const row = (code: ValidationIssue['code'], severity: ValidationIssue['severity'], message: string): ValidationIssue => ({
    code,
    severity,
    field: 'audio.dialogue',
    message,
    shotId: context.shotId,
    vendor: 'veo-3.1',
  });
  if (!/["“”]/.test(dialogue)) {
    rows.push(row('dialogue-unquoted', 'warning', 'Veo reads dialogue in quotes. Put the spoken line between quotation marks.'));
  }
  if (speakersOf(dialogue).size > 1) {
    rows.push(row('multi-speaker', 'warning', "Veo's lip-sync is under 40% with several speakers in one shot. Split the exchange into single-speaker shots."));
  }
  return rows;
}

export const VEO_3_1 = defineTemplate({
  id: 'veo-3.1',
  displayName: 'Veo 3.1',
  provisional: 'The payload field names, the 1080p resolution and the best-take fields are unverified until they are checked against Google’s Veo documentation.',
  limits: {
    modes: ['t2v', 'i2v'],
    durations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    promptWords: 175,
    negativeChars: 1000,
    seed: false,
    audio: true,
    promptExtend: false,
    references: { max: { image: 3, character: 3, firstFrame: 1, lastFrame: 1 }, total: { types: ['image', 'character'], max: 3 } },
    required: ['durationSec'],
  },
  fileRefPolicy: 'attach',
  grammarHints: [
    'Veo 3 / 3.1: one sentence per shot, in the order [cinematography] + [subject] + [action] + [context] + [style] + [audio].',
    'Audio cues go first and dialogue is quoted.',
    'The practical ceiling is about 175 words; a longer prompt is a warning.',
    'Lip-sync is reliable for one speaker per shot and falls under 40% with several, so give each shot one speaker.',
  ].join('\n'),
  compose: veoText,
  extra: veoRules,
  map: (shot, context) => {
    const negative = clean(shot.negativePrompt);
    const referenceImages = refNames(context.references, ['image', 'character']);
    return {
      ...modelField(shot),
      prompt: veoText(shot),
      ...fieldIf('negativePrompt', negative === '' ? undefined : negative),
      ...fieldIf('durationSeconds', shot.durationSec),
      ...fieldIf('aspectRatio', shot.aspectRatio),
      ...fieldIf('resolution', shot.resolution),
      ...(referenceImages.length > 0 ? { referenceImages } : {}),
      ...fieldIf('firstFrame', refName(context.references, 'firstFrame')),
      ...fieldIf('lastFrame', refName(context.references, 'lastFrame')),
    };
  },
});
