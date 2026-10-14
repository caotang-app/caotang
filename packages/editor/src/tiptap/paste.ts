/**
 * [editor-engine.md] §10 — "paste as plain text + basic inline marks", a v0.1 scope item.
 *
 * ## Why this is a transform and not a schema
 *
 * ProseMirror's default paste keeps whatever the clipboard's HTML maps onto the schema.
 * The schema has headings, lists, blockquotes, code blocks and images, so a paste from a
 * web page put all of them into a manuscript, and the image's `src` was an arbitrary
 * network reference. §10 says what a paste is in v0.1, and this module is that sentence.
 *
 * The transform runs on the HTML **before** ProseMirror parses it (`transformPastedHTML`),
 * and it emits only `<p>` elements holding text and the §3.2 marks (`strong`, `em`,
 * `s`, `code`, and `a` with a safe `href`). Every other element is either a paragraph
 * boundary, a line break, or dropped. Images are dropped: §3.1 gives `image` no insert
 * path in v0.1, so a pasted image has nowhere to go that a writer could see.
 *
 * ## Safety of the parse
 *
 * `DOMParser` builds an inert document, so a pasted `<script>` or `onerror` attribute is
 * never run or loaded. The output is serialized from elements this module creates, so no
 * attribute from the source survives except the one `href` checked below.
 */

/** Element name → the §3.2 mark it becomes. `B` and `I` are presentational, so they are checked below. */
const MARK_TAGS: Readonly<Record<string, string>> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  CODE: 'code',
};

/**
 * The value of one property in an element's inline `style`, lower-cased and without `!important`,
 * or `null` when the element does not set it. Read from the attribute, because the element is in
 * an inert document and its computed style is not the source's own declaration.
 */
const cssValue = (element: Element, property: string): string | null => {
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== property) continue;
    return declaration.slice(colon + 1).replace(/!important/i, '').trim().toLowerCase();
  }
  return null;
};

/**
 * The §3.2 mark an element's own tag and style ask for, or `null` when the element carries none.
 *
 * A `b` or `strong` that declares normal or 400 weight is not bold, and an `em` or `i` that
 * declares normal style is not italic: Google Docs wraps a whole copied selection in a `b` with
 * `font-weight:normal`, and mapping it made every pasted paragraph bold. A `b`
 * whose id starts with `docs-internal-guid` is that wrapper, so it carries no mark either.
 */
const markFor = (element: Element): string | null => {
  const tag = element.tagName.toUpperCase();
  const mark = MARK_TAGS[tag];
  if (mark === undefined) return null;
  if (mark === 'strong') {
    const weight = cssValue(element, 'font-weight');
    if (weight === 'normal' || weight === '400') return null;
    if (tag === 'B' && element.id.startsWith('docs-internal-guid')) return null;
  }
  if (mark === 'em' && cssValue(element, 'font-style') === 'normal') return null;
  return mark;
};

/** Elements whose content is never text a writer meant to paste. */
const DROPPED = new Set([
  'SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'IMG', 'PICTURE',
  'SOURCE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'INPUT', 'TEXTAREA',
  'SELECT', 'BUTTON',
]);

/** Elements that end a paragraph. A heading, list item, quote or cell becomes plain paragraph text. */
const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'UL',
]);

/**
 * A link target a paste may keep: `http`, `https` or `mailto`, or a reference with no
 * scheme. Anything else (`javascript:`, `data:`, a `file:` path) keeps its text and loses
 * the link, because the link is the only part of the paste that could run or fetch.
 */
export const isSafeLinkTarget = (href: string): boolean => {
  const target = href.replace(/[\t\n\r]/g, '').trim();
  if (/^(https?:|mailto:)/i.test(target)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(target);
};

/** `Node.TEXT_NODE` and `Node.ELEMENT_NODE`, spelled out: this file runs where `Node` is a DOM global. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Whitespace in pasted text collapses the way HTML renders it, so a line break in the source is a space. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ');

/**
 * The plain-paragraphs-with-marks form of pasted HTML. Returned as an HTML string for
 * ProseMirror's own parser, which is what `transformPastedHTML` expects.
 *
 * Returns `''` when nothing textual was pasted. ProseMirror then falls back to the
 * clipboard's plain text, which is the correct behaviour for a paste with no text in its
 * HTML.
 */
export const plainPasteHtml = (html: string): string => {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const out = source.createElement('div');
  let paragraph: Element | null = null;

  /** The current paragraph, created when the first text or break needs one. */
  const current = (): Element => {
    if (paragraph === null) {
      paragraph = source.createElement('p');
      out.append(paragraph);
    }
    return paragraph;
  };
  const endParagraph = (): void => {
    paragraph = null;
  };

  /** Text inside the marks, outermost first: `em` inside `strong` is `<strong><em>…</em></strong>`. */
  const appendText = (text: string, marks: readonly string[]): void => {
    let node: Node = source.createTextNode(text);
    for (const mark of [...marks].reverse()) {
      const wrapper = source.createElement(mark.startsWith('a:') ? 'a' : mark);
      if (mark.startsWith('a:')) wrapper.setAttribute('href', mark.slice(2));
      wrapper.append(node);
      node = wrapper;
    }
    current().append(node);
  };

  const walk = (parent: Node, marks: readonly string[]): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        // A space is kept between two inline pieces, because it is what separates them.
        // At the start of a paragraph it is the source's indentation, and is dropped.
        let text = collapse(child.textContent ?? '');
        if (paragraph === null) text = text.replace(/^ /, '');
        if (text.length > 0) appendText(text, marks);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const element = child as Element;
      const tag = element.tagName.toUpperCase();
      if (DROPPED.has(tag)) continue;
      if (tag === 'BR') {
        current().append(source.createElement('br'));
        continue;
      }
      if (BLOCKS.has(tag)) {
        endParagraph();
        walk(element, marks);
        endParagraph();
        continue;
      }
      const mark = markFor(element);
      if (mark !== null) {
        walk(element, [...marks, mark]);
        continue;
      }
      if (tag === 'A') {
        const href = element.getAttribute('href') ?? '';
        walk(element, isSafeLinkTarget(href) && href.length > 0 ? [...marks, `a:${href}`] : marks);
        continue;
      }
      walk(element, marks);
    }
  };

  walk(source.body, []);
  return out.innerHTML;
};
