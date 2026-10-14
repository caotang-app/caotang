/**
 * The sample manuscript the first-run card opens, and the three demo intents it offers (context-assembly §6).
 *
 * The demo provider's scripts (`@caotang/gateway/mock`) answer for these exact titles and wording, so the sample has the
 * same shape the harness's demo tests run against: an empty "The Friend" the draft goes into, "Chapter 1" with "The
 * Landing" and "The Storm" for the synopses and the continuity check, and the codex entry "Elena" the brief mentions.
 */

import {
  addDocument,
  addFolder,
  createEmptyManifest,
  createProjectState,
  type CodexEntry,
  type ProjectState,
} from '@caotang/store';
import { newId } from '@caotang/ids';
import { DEMO_INTENTS } from '@caotang/gateway/mock';

/** The sample's title, as the binder and the Home list show it. */
export const SAMPLE_TITLE = 'Sample manuscript';

/** The three zero-key demo intents, with the labels the card shows for them. */
export const DEMO_CHOICES: readonly { readonly intent: string; readonly label: string }[] = [
  { intent: DEMO_INTENTS.draftScene, label: 'Draft the opening scene' },
  { intent: DEMO_INTENTS.fillSynopses, label: 'Fill in the synopses' },
  { intent: DEMO_INTENTS.continuity, label: 'Check for continuity problems' },
];

/** The sample's first body, which the drafting demo writes into "The Friend" (its body starts empty). */
export const LANDING_BODY = 'The ferry was late, as always.';
export const STORM_BODY = 'Rain.\n\n***\n\nThe lamp failed.';

/** A fresh sample project: the manuscript, a codex entry, and nothing else. The ids are generated, not fixed. */
export function sampleProjectState(now: Date = new Date()): ProjectState {
  const state = createProjectState(createEmptyManifest(SAMPLE_TITLE, now));
  const chapterOne = addFolder(state, { parentId: 'manuscript', title: 'Chapter 1', now });
  addDocument(state, {
    parentId: chapterOne.id,
    title: 'The Landing',
    body: LANDING_BODY,
    now,
    synopsis: 'Elena returns to the island.',
  });
  addDocument(state, { parentId: chapterOne.id, title: 'The Storm', body: STORM_BODY, now });
  const chapterTwo = addFolder(state, { parentId: 'manuscript', title: 'Chapter 2', now });
  addDocument(state, { parentId: chapterTwo.id, title: 'The Friend', now });
  const elena: CodexEntry = {
    id: newId('c'),
    name: 'Elena',
    aliases: [],
    type: 'character',
    description: 'The keeper of the light, who left the island years ago.',
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
  };
  state.manifest.codex = [...(state.manifest.codex ?? []), elena];
  return state;
}
