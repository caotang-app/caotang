// @vitest-environment jsdom
/**
 * What the editor is willing to show and to take in: the images it loads (§2.1, A2, and the
 * fully-offline posture), and what a paste keeps (§10's "paste as plain text + basic inline
 * marks", a v0.1 scope item).
 *
 * ## What is measured, and against what
 *
 * Both are measured on the live view: the DOM the browser would fetch from, and the document
 * ProseMirror built from the pasted HTML. The expected bodies are written out in the test,
 * and each is checked against the headless `serialize`, so the test cannot pass by agreeing
 * with the adapter's own projection.
 */
import { describe, expect, it } from 'vitest';
import type { Node as PmNode } from '@tiptap/pm/model';
import { serialize } from '../src/index.js';
import { isAppLocalSource, isSafeLinkTarget, plainPasteHtml } from '../src/tiptap/index.js';
import { focusDom, mountInto, tiptapOf } from './tiptap-harness.js';

/** The `src` values the focus DOM holds, for the `img` elements that carry one. */
const loadedSources = (host: HTMLElement): string[] =>
  Array.from(focusDom(host).querySelectorAll('img'))
    .map((img) => img.getAttribute('src'))
    .filter((src): src is string => src !== null);

/** The `src` of every image node in the document, whether or not the view renders it as an `img`. */
const imageSources = (doc: PmNode): string[] => {
  const sources: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'image') sources.push(String(node.attrs['src']));
  });
  return sources;
};

/** A paste, dispatched as the view's own clipboard path receives it. */
const paste = (host: HTMLElement, html: string): void => {
  tiptapOf(focusDom(host)).view.pasteHTML(html, new Event('paste') as ClipboardEvent);
};

describe('an image is loaded only from an app-local source (§2.1, A2)', () => {
  it.each([
    ['https', 'https://example.test/a.png'],
    ['http', 'http://example.test/a.png'],
    ['protocol-relative', '//example.test/a.png'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
  ])('a %s source reaches the DOM as its alt text, and no request is made for it', async (_name, src) => {
    const { host, instance } = await mountInto(`![a fine picture](${src})\n`);
    expect(loadedSources(host)).toEqual([]);
    expect(focusDom(host).textContent).toContain('a fine picture');
    // The image is still in the document: the placeholder is a rendering, not a deletion.
    expect(instance.getContent()).toContain('a fine picture');
  });

  it('a network source is still in the body, so saving the document does not lose the reference', async () => {
    const { instance } = await mountInto('![a fine picture](https://example.test/a.png)\n');
    expect(instance.getContent()).toBe('![a fine picture](https://example.test/a.png)\n');
  });

  it('a relative source is an image, and it keeps its source for the browser to resolve', async () => {
    const { host } = await mountInto('![a pic](images/a.png)\n');
    expect(loadedSources(host)).toEqual(['images/a.png']);
  });

  it('an image without alt text still shows a placeholder, not nothing', async () => {
    const { host } = await mountInto('![](https://example.test/a.png)\n');
    expect(loadedSources(host)).toEqual([]);
    expect(focusDom(host).querySelector('.caotang-image-placeholder')?.textContent).toBe('Image');
  });

  it('the source test reads the URL the way the browser does, and no other way', () => {
    expect(isAppLocalSource('images/a.png')).toBe(true);
    expect(isAppLocalSource('/assets/a.png')).toBe(true);
    expect(isAppLocalSource('https://example.test/a.png')).toBe(false);
    expect(isAppLocalSource('//example.test/a.png')).toBe(false);
    expect(isAppLocalSource('')).toBe(false);
    // A tab or a newline inside a scheme is removed by the browser before it reads the scheme.
    expect(isAppLocalSource('ht\ntps://example.test/a.png')).toBe(false);
    // Two backslashes read as the network-path prefix `//`, which a browser resolves to a host.
    expect(isAppLocalSource('\\\\example.test\\share\\a.png')).toBe(false);
  });
});

/** The C0 controls the URL standard strips from the ends of a reference, as a code point and as a name. */
const CONTROLS = ['\u0000', '\u0001', '\u001f'];
const code = (control: string): string => `U+${control.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`;
/**
 * The controls that reach the document. CommonMark replaces a NUL in a destination with U+FFFD, so
 * a NUL cannot arrive through a body; the NUL cases are asserted on the function, where they are
 * still a real input.
 */
const IN_DOCUMENT_CONTROLS = ['\u0001', '\u001f'];
const REMOTE = [
  ['https', 'https://example.test/a.png'],
  ['http', 'http://example.test/a.png'],
  ['protocol-relative', '//example.test/a.png'],
  ['mixed-case scheme', 'HtTpS://example.test/a.png'],
] as const;

describe('a control character in front of a remote source does not make it local (§2.1, A2)', () => {
  it.each(
    REMOTE.flatMap(([name, src]) => IN_DOCUMENT_CONTROLS.map((control) => [`${name} behind ${code(control)}`, control, src] as const)),
  )('a %s source is not loaded, and the image is still in the document', async (_label, control, src) => {
    const { host, instance } = await mountInto(`![a fine picture](<${control}${src}>)\n`);
    // The control: the source parses as an image, so what is measured is the URL and not the parser.
    expect(imageSources(tiptapOf(focusDom(host)).state.doc)).toEqual([`${control}${src}`]);
    expect(loadedSources(host)).toEqual([]);
    expect(focusDom(host).textContent).toContain('a fine picture');
    expect(instance.getContent()).toContain('a fine picture');
  });

  it.each(IN_DOCUMENT_CONTROLS.map((control) => [code(control), control] as const))(
    'an agent apply of a remote source behind %s is not loaded either',
    async (_label, control) => {
      const { host, instance } = await mountInto('');
      const src = `${control}https://example.test/a.png`;
      instance.replaceRange({ from: 0, to: 0 }, `![a fine picture](<${src}>)`, { historyExcluded: true });
      expect(imageSources(tiptapOf(focusDom(host)).state.doc)).toEqual([src]);
      expect(loadedSources(host)).toEqual([]);
    },
  );

  it.each(REMOTE.flatMap(([name, src]) => CONTROLS.map((control) => [`${name} behind ${code(control)}`, control, src] as const)))(
    'the source test refuses a %s source, NUL included',
    (_label, control, src) => {
      expect(isAppLocalSource(`${control}${src}`)).toBe(false);
      expect(isAppLocalSource(`${control} ${src}`)).toBe(false);
    },
  );

  it('strips the controls the URL standard strips from both ends, and reads the scheme after that', () => {
    expect(isAppLocalSource('\u0001https://example.test/a.png')).toBe(false);
    expect(isAppLocalSource('\u0000//example.test/a.png')).toBe(false);
    expect(isAppLocalSource(' \u001fHTTPS://example.test/a.png')).toBe(false);
    expect(isAppLocalSource('https://example.test/a.png\u0001')).toBe(false);
    expect(isAppLocalSource('\u0001images/a.png\u0002')).toBe(true);
    // Nothing is left once the controls are gone, so there is no reference to load.
    expect(isAppLocalSource('\u0001')).toBe(false);
  });
});

describe('a paste keeps plain paragraphs and the §3.2 marks (§10)', () => {
  it('a pasted heading, list, blockquote and image arrive as paragraphs of text, and the image is dropped', async () => {
    const { host, instance } = await mountInto('');
    paste(
      host,
      '<h1>Title</h1><ul><li>item one</li><li>item two</li></ul><blockquote>quoted</blockquote>' +
        '<img src="https://example.test/x.png" alt="x">',
    );
    const doc = tiptapOf(focusDom(host)).state.doc;
    const kinds = new Set<string>();
    doc.forEach((node) => kinds.add(node.type.name));
    expect([...kinds]).toEqual(['paragraph']);
    expect(loadedSources(host)).toEqual([]);
    const expected = 'Title\n\nitem one\n\nitem two\n\nquoted\n';
    expect(instance.getContent()).toBe(expected);
    expect(serialize(doc as never)).toBe(expected);
  });

  it('bold, italic and code keep their marks, and a space between two marked pieces is kept', async () => {
    const { host, instance } = await mountInto('');
    paste(host, '<p>Plain <strong>bold</strong> and <em>it</em> <code>c</code></p>');
    expect(instance.getContent()).toBe('Plain **bold** and _it_ `c`\n');
  });

  it('a link keeps its target when the target is web or mail, and loses the link when it is anything else', async () => {
    const { host, instance } = await mountInto('');
    paste(host, '<p><a href="https://example.test/">site</a> and <a href="javascript:alert(1)">bad</a></p>');
    expect(instance.getContent()).toBe('[site](https://example.test/) and bad\n');
  });

  it.each([
    ['a normal-weight style on the wrapper', '<b style="font-weight:normal;">Plain text here</b>', 'Plain text here\n'],
    ['a 400 weight on a strong wrapper', '<strong style="font-weight: 400">Plain text here</strong>', 'Plain text here\n'],
    ['a Google Docs guid id alone', '<b id="docs-internal-guid-6d1c"><span>Plain text here</span></b>', 'Plain text here\n'],
    [
      'a Google Docs clipboard wrapper',
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-6d1c">' +
        '<p dir="ltr"><span style="font-weight:400;">Plain text here</span></p>' +
        '<p dir="ltr"><span>Second paragraph</span></p></b>',
      'Plain text here\n\nSecond paragraph\n',
    ],
  ])('a wrapper that declares plain weight pastes as plain text, with %s (§10)', async (_label, html, expected) => {
    const { host, instance } = await mountInto('');
    paste(host, html);
    expect(instance.getContent()).toBe(expected);
  });

  it('bold the source declares pastes as bold, and italic the source declares normal does not', async () => {
    const { host, instance } = await mountInto('');
    paste(host, '<p><b style="font-weight:bold">Loud</b> and <em style="font-style:normal">quiet</em></p>');
    expect(instance.getContent()).toBe('**Loud** and quiet\n');
  });

  it('a script in pasted HTML is neither run nor kept', async () => {
    const { host, instance } = await mountInto('');
    (window as unknown as { __caotangPwned?: boolean }).__caotangPwned = false;
    paste(host, '<script>window.__caotangPwned = true</script><p>ok</p>');
    expect((window as unknown as { __caotangPwned?: boolean }).__caotangPwned).toBe(false);
    expect(instance.getContent()).toBe('ok\n');
  });

  it('a paste with no text in it changes nothing', async () => {
    const { host, instance } = await mountInto('Hello.\n');
    paste(host, '<img src="https://example.test/x.png" alt="">');
    expect(instance.getContent()).toBe('Hello.\n');
  });
});

describe('the paste transform, read directly (§10)', () => {
  it('reduces block structure to paragraphs and keeps no attribute but a safe href', () => {
    const out = plainPasteHtml('<div class="x" onclick="z()"><h2 id="h">A <em>b</em></h2><p style="color:red">c</p></div>');
    expect(out).toBe('<p>A <em>b</em></p><p>c</p>');
  });

  it('keeps a safe link target and drops an unsafe one, by the same rule as the scheme test', () => {
    expect(isSafeLinkTarget('https://example.test/')).toBe(true);
    expect(isSafeLinkTarget('mailto:someone@example.test')).toBe(true);
    expect(isSafeLinkTarget('chapter-2.html')).toBe(true);
    expect(isSafeLinkTarget('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkTarget('data:text/html,hi')).toBe(false);
    expect(isSafeLinkTarget('java\tscript:alert(1)')).toBe(false);
  });

  it('reads a wrapper that declares plain weight as transparent, and keeps the bold a source declares', () => {
    expect(plainPasteHtml('<b style="font-weight:normal" id="docs-internal-guid-1"><span>x</span></b>')).toBe('<p>x</p>');
    expect(plainPasteHtml('<b style="font-weight:700">x</b>')).toBe('<p><strong>x</strong></p>');
  });

  it('returns nothing for HTML with no text, so ProseMirror falls back to the clipboard’s plain text', () => {
    expect(plainPasteHtml('<img src="https://example.test/x.png">')).toBe('');
  });
});
