/**
 * Helpers the six vendor templates share. They keep each template's map short, and they
 * leave the vendor-specific parts in the template file, where a reader looks for them.
 */

import type { ReferenceType, ResolvedReference, VideoPrompt, VideoShotRef } from '../model.js';
import { joinSentences, promptParts } from '../compose.js';

/** `{ [key]: value }` when the value is set, and nothing when it is not, so an unset field is absent rather than null. */
export function fieldIf<V>(key: string, value: V | undefined): Record<string, V> {
  return value === undefined ? {} : { [key]: value };
}

/** The shot's model override, when it has one. */
export function modelField(shot: VideoShotRef): Record<string, string> {
  return fieldIf('model', shot.model);
}

/** The file names of the resolved references of the given types, in resolution order. Unnamed ones are left out. */
export function refNames(references: readonly ResolvedReference[], types: readonly ReferenceType[]): string[] {
  return references.flatMap((reference) =>
    types.includes(reference.type) && reference.fileName !== undefined ? [reference.fileName] : [],
  );
}

/** The file name of the first resolved reference of one type, when there is one. */
export function refName(references: readonly ResolvedReference[], type: ReferenceType): string | undefined {
  return references.find((reference) => reference.type === type && reference.fileName !== undefined)?.fileName;
}

/**
 * The camera-first visual sentence most vendors take: camera, subject and action, context,
 * style, each as a sentence. The shared default, which a template overrides only when its
 * vendor documents a different order.
 */
export function visualSentences(prompt: VideoPrompt): string {
  const parts = promptParts(prompt);
  return joinSentences([parts.camera, [parts.subject, parts.action].filter((part) => part !== '').join(' '), parts.context, parts.style]);
}
