/**
 * Shared plumbing for the live-editor tests (`tiptap-*.test.ts`). Not a test file: it
 * is imported by them, and the root vitest include pattern does not collect it.
 *
 * The harness mounts through the **public** `createTiptapEditorApi().mount`, and it
 * reaches the view only through the DOM the view owns. The one exception is
 * `tiptapOf`, which reads the Tiptap editor `@tiptap/core` attaches to the view's
 * root element (`dom.editor`); a test that has to see a transaction's own flags
 * (`scrolledIntoView`, `addToHistory`) needs that, and nothing else in the suite does.
 */
import type { Editor } from '@tiptap/core';
import { afterEach } from 'vitest';
import {
  createTiptapEditorApi,
  type TiptapEditorInstance,
  type TiptapMountOptions,
} from '../src/tiptap/index.js';

const mounted: Array<{ host: HTMLElement; instance: TiptapEditorInstance }> = [];

/** Every instance a test mounts is destroyed and its host removed afterwards. */
afterEach(() => {
  for (const { host, instance } of mounted.splice(0)) {
    instance.destroy();
    host.remove();
  }
});

/** Mount `body` into a fresh host attached to the document. */
export const mountInto = async (
  body: string,
  opts: Partial<TiptapMountOptions> = {},
): Promise<{ host: HTMLElement; instance: TiptapEditorInstance }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const instance = await createTiptapEditorApi().mount(host, {
    docId: 'doc-under-test',
    initialBody: body,
    ...opts,
  });
  mounted.push({ host, instance });
  return { host, instance };
};

/** The focus document's ProseMirror root. */
export const focusDom = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>('.caotang-editor-focus .ProseMirror');
  if (!el) throw new Error('harness: no focus view under the host');
  return el;
};

/** The ghost region's container, which the adapter hides until something is streamed into it. */
export const ghostRegion = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>('.caotang-editor-ghost');
  if (!el) throw new Error('harness: no ghost region under the host');
  return el;
};

/** The ghost region's ProseMirror root. */
export const ghostDom = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>('.caotang-editor-ghost .ProseMirror');
  if (!el) throw new Error('harness: no ghost view under the host');
  return el;
};

/** The Tiptap editor behind a view root, for the transaction flags the DOM does not show. */
export const tiptapOf = (root: HTMLElement): Editor => {
  const editor = (root as HTMLElement & { editor?: Editor }).editor;
  if (!editor) throw new Error('harness: the view root carries no Tiptap editor');
  return editor;
};

/** The first text node under `root` whose content includes `needle`. */
export const textNodeWith = (root: Node, needle: string): Text => {
  const walker = root.ownerDocument!.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(needle)) return node as Text;
  }
  throw new Error(`harness: no text node contains "${needle}"`);
};

/**
 * Put the document selection on `[start, end)` of a text node, focus the view first
 * (ProseMirror only reads the DOM selection while the view has focus), and fire the
 * `selectionchange` a browser would fire. jsdom does not raise that event itself.
 */
export const selectDom = (host: HTMLElement, node: Text, start: number, end: number): void => {
  focusDom(host).focus();
  const selection = document.getSelection()!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

/** A Ctrl+Z (or Ctrl+Shift+Z) keystroke, dispatched where the browser would send it. */
export const pressUndo = (host: HTMLElement, redo = false): void => {
  focusDom(host).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true }),
  );
};
