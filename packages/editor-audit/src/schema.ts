/**
 * The §3 Caotang ProseMirror schema, built for the C16 preflight.
 *
 * This is NOT the M5 editor. It is the minimum surface the §5 fixture corpus
 * needs in order to run through remark-prosemirror at all: a schema is a
 * required argument to both `remarkProseMirror` and `fromProseMirror`, so a
 * corpus run without one measures nothing (C19: the library's own suite is 5
 * shapes — the corpus is the real instrument).
 *
 * Node and mark sets are transcribed from [editor-engine.md] §3.1/§3.2, names
 * included, because §3.3's handler table is keyed on those names. If §3 ever
 * changes, this file is wrong until it is changed with it.
 */
import { Schema } from '@tiptap/pm/model';

export const caotangSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      defining: true,
    },
    blockquote: { group: 'block', content: 'block+', defining: true },
    // §3.1 names the two list nodes `bullet_list` / `ordered_list`, NOT
    // Tiptap's `bulletList` / `orderedList`. §3.1 is the contract; the
    // handler table in handlers.ts is keyed on these names. Tiptap's own
    // StarterKit is not what builds this schema (see bundle-entry.ts, which
    // mounts the §10 extension set for the *bundle audit* only).
    bullet_list: { group: 'block', content: 'list_item+', defining: true },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { start: { default: 1 } },
      defining: true,
    },
    list_item: { content: 'block+' },
    horizontal_rule: { group: 'block' },
    code_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: null } },
    },
    hard_break: { group: 'inline', inline: true, selectable: false },
    image: {
      group: 'inline',
      inline: true,
      draggable: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    em: {},
    strong: {},
    strike: {},
    code: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
  },
});
