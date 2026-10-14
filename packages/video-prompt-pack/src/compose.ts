/**
 * The text helpers every vendor template composes its prompt from. Nothing here
 * truncates: a helper that drops text would hide an over-cap prompt from the validator,
 * and silent truncation is the posture the spec rejects everywhere (§2).
 */

import type { VideoAudio, VideoPrompt } from './model.js';

/** Trims a field and collapses its whitespace into single spaces, so a vendor prompt is one paragraph. */
export function clean(text: string | undefined): string {
  return text === undefined ? '' : text.trim().replace(/\s+/g, ' ');
}

/** One sentence: the text with a full stop when it has no closing punctuation of its own. */
export function sentence(text: string): string {
  if (text === '') return '';
  return /[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`;
}

/** The non-empty parts as sentences, joined with a space. */
export function joinSentences(parts: readonly (string | undefined)[]): string {
  return parts
    .map(clean)
    .filter((part) => part !== '')
    .map(sentence)
    .join(' ');
}

/** The non-empty parts joined with a space and no punctuation. */
export function joinWords(parts: readonly (string | undefined)[]): string {
  return parts
    .map(clean)
    .filter((part) => part !== '')
    .join(' ');
}

/** The prompt's five cleaned parts, in the normalized schema's order. */
export function promptParts(prompt: VideoPrompt): Readonly<Record<keyof VideoPrompt, string>> {
  return {
    camera: clean(prompt.camera),
    subject: clean(prompt.subject),
    action: clean(prompt.action),
    context: clean(prompt.context),
    style: clean(prompt.style),
  };
}

/** The four audio cues, cleaned. An absent cue is the empty string. */
export function audioParts(audio: VideoAudio | undefined): Readonly<Record<keyof VideoAudio, string>> {
  return {
    dialogue: clean(audio?.dialogue),
    sfx: clean(audio?.sfx),
    ambient: clean(audio?.ambient),
    music: clean(audio?.music),
  };
}

/** True when at least one audio cue has text. */
export function hasAudio(audio: VideoAudio | undefined): boolean {
  const parts = audioParts(audio);
  return parts.dialogue !== '' || parts.sfx !== '' || parts.ambient !== '' || parts.music !== '';
}

/** True when no prompt part has text. The validator reports this as `empty-prompt`. */
export function isPromptEmpty(prompt: VideoPrompt): boolean {
  const parts = promptParts(prompt);
  return parts.camera === '' && parts.subject === '' && parts.action === '' && parts.context === '' && parts.style === '';
}

/** Whitespace-separated words, the unit the Veo practical ceiling is written in. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The distinct speaker labels in a dialogue cue, read as `NAME: line` at the start of a
 * line. This is a heuristic: a cue that names speakers some other way is not counted.
 */
export function speakersOf(dialogue: string): Set<string> {
  const speakers = new Set<string>();
  for (const match of dialogue.matchAll(/(?:^|\n)\s*([A-Z][A-Za-z.' -]{0,30}):/g)) {
    const label = match[1];
    if (label !== undefined) speakers.add(label.trim());
  }
  return speakers;
}
