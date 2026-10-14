/**
 * The binder's entries for making a media node (screenplay, dialogue and storyboard; media-track.md): a screenplay scene, a storyboard, a shot card and a
 * dialogue container. The rules for which kind goes where live here, with the media kinds, and the binder only asks for
 * the entries a node earns. Every create is a `binder.create`, so the bus checks it (storyboard.md §2.1: a shot lives in
 * a storyboard folder; dialogue-narrative.md §2.1: a container is `branching`), and a refusal reaches the binder's error line.
 */

import type { TreeNode } from '@caotang/store';

import { isStoryboardFolder } from './engines.js';

/** What the binder asks the bus to create: the params `binder.create` takes, less the parent. */
export interface MediaCreateSpec {
  readonly type: 'folder' | 'document' | 'shot' | 'dialogue';
  readonly kind?: 'screenplay' | 'storyboard' | 'branching';
  readonly title: string;
}

/**
 * One entry of the binder's context menu: the fields `components/shared.tsx`'s `MenuItem` takes, which the binder adds
 * to its own list. Declared here so this module imports no component file.
 */
export interface MediaMenuItem {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly separatorBefore?: boolean;
}

/**
 * The menu entries for a node. A chapter (a folder directly under the manuscript) offers a screenplay scene, a storyboard and a
 * dialogue container; a storyboard folder offers a shot card, and nothing else, because a storyboard holds only shots. Any other
 * node offers nothing: the manuscript and research sections are not chapters, and a document goes inside a chapter (docs/decisions.md
 * 2026-10-14, "Chapterless documents"), and a document is not a container, so the binder's own entries cover it.
 */
export function mediaCreateItems(node: TreeNode, create: (parentId: string, spec: MediaCreateSpec) => void): MediaMenuItem[] {
  if (isStoryboardFolder(node)) {
    return [{ key: 'new-shot', label: 'New shot here', separatorBefore: true, onSelect: () => create(node.id, { type: 'shot', title: 'New shot' }) }];
  }
  if (node.type !== 'folder' || node.parentId !== 'manuscript') return [];
  return [
    {
      key: 'new-screenplay',
      label: 'New screenplay scene here',
      separatorBefore: true,
      onSelect: () => create(node.id, { type: 'document', kind: 'screenplay', title: 'Untitled scene' }),
    },
    {
      key: 'new-storyboard',
      label: 'New storyboard here',
      onSelect: () => create(node.id, { type: 'folder', kind: 'storyboard', title: 'Storyboard' }),
    },
    {
      key: 'new-dialogue',
      label: 'New dialogue here',
      onSelect: () => create(node.id, { type: 'dialogue', kind: 'branching', title: 'Untitled dialogue' }),
    },
  ];
}
