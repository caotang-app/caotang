/**
 * The XML sanitizer and the two XML parts it protects — exporter.md §3 (a DOCX that
 * opens in Word) and §3a (0 epubcheck errors). A control character that XML 1.0 forbids
 * fails both, for a reason the author cannot see, so every part must parse whatever the
 * manuscript carries.
 *
 * The three characters are the ones the review named, U+000B, U+000C and U+0001, and
 * they go into the places a user's text lands in a part: a body, a title and an author.
 */

import { describe, expect, it } from 'vitest';
import { flatten } from '../src/flatten.js';
import { renderDocx } from '../src/render-docx.js';
import { escapeXml, renderEpub, type EpubInput } from '../src/render-epub.js';
import type { RenderInput } from '../src/render-input.js';
import { DEFAULT_TEMPLATE } from '../src/template.js';
import type { FlatBlock } from '../src/types.js';
import { stripXmlIllegal } from '../src/xml-text.js';
import { IDS, makeProject, PROJECT_NAME } from './fixture.js';
import { assertWellFormedXml, unzipText } from './xml.js';

const IDENTIFIER = 'urn:uuid:3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d';
const MTIME = new Date('2026-10-08T09:30:00.000Z');

/** Every code point XML 1.0 forbids: U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF. */
const FORBIDDEN_CODE_POINTS = [
  ...Array.from({ length: 9 }, (_, i) => i),
  0x0b,
  0x0c,
  ...Array.from({ length: 0x1f - 0x0e + 1 }, (_, i) => 0x0e + i),
  0xfffe,
  0xffff,
];

/** Forbidden characters in a body, a title, an author and a chapter title. */
const DIRTY = {
  body: 'Alpha\u000Bbeta\u000Cgamma\u0001delta.',
  title: 'The\u000C Lighthouse\u0001 Keeper',
  author: 'M.\u000B Ortega\u0001',
  chapter: 'Chapter\u000B One',
};

function dirtyInput(): RenderInput {
  const blocks: FlatBlock[] = [
    { kind: 'frontmatter', fmKind: 'titlepage' },
    { kind: 'chapter', title: DIRTY.chapter, level: 1, number: 1 },
    { kind: 'scene', docId: IDS.landing, title: 'The Landing', body: DIRTY.body, number: 1 },
  ];
  return { blocks, title: DIRTY.title, author: DIRTY.author, date: '2026-10-08', template: DEFAULT_TEMPLATE, toc: true };
}

function epubOf(input: RenderInput): EpubInput {
  return { ...input, language: 'en', identifier: IDENTIFIER, modified: '2026-10-08T09:30:00Z', mtime: MTIME };
}

/** The fixture project, clean: the parser must accept what the renderers write for ordinary text. */
function cleanInput(): RenderInput {
  const blocks = flatten(makeProject(), { includeRootIds: ['manuscript'] }, { titlePage: true }).blocks;
  return { blocks, title: PROJECT_NAME, author: 'M. Ortega', date: '2026-10-08', template: DEFAULT_TEMPLATE, toc: true };
}

describe('stripXmlIllegal — the code points XML 1.0 forbids', () => {
  it('removes every forbidden code point', () => {
    for (const code of FORBIDDEN_CODE_POINTS) {
      expect(stripXmlIllegal(`a${String.fromCodePoint(code)}b`), `U+${code.toString(16)}`).toBe('ab');
    }
  });

  it('keeps the characters XML allows: tab, line feed and carriage return, and astral characters', () => {
    const allowed = '\t\n\r  �\u{1F600}x';
    expect(stripXmlIllegal(allowed)).toBe(allowed);
  });

  it('leaves the markup characters to escapeXml, which is the one that escapes them', () => {
    expect(stripXmlIllegal('<a & "b">')).toBe('<a & "b">');
  });
});

describe('escapeXml — forbidden characters removed, markup characters escaped', () => {
  it('does both, in one pass', () => {
    expect(escapeXml('a\u000Bb <&>')).toBe('ab &lt;&amp;&gt;');
  });
});

describe('the well-formedness check itself', () => {
  it('rejects a forbidden character, which the parser alone would not see', () => {
    expect(() => assertWellFormedXml('part', '<a>x\u000By</a>')).toThrow(/U\+000B/);
  });

  it('rejects a part the parser cannot read', () => {
    expect(() => assertWellFormedXml('part', '<a><b></a>')).toThrow(/not well-formed/);
  });

  it('accepts a well-formed part', () => {
    expect(() => assertWellFormedXml('part', '<?xml version="1.0"?><a href="x">&lt;ok&gt;</a>')).not.toThrow();
  });
});

describe('the parser accepts what the renderers write for clean text', () => {
  it('reads every DOCX part of the fixture', async () => {
    const parts = unzipText(await renderDocx(cleanInput()));
    expect(Object.keys(parts)).toEqual(expect.arrayContaining(['word/document.xml', 'docProps/core.xml']));
    for (const [name, xml] of Object.entries(parts)) assertWellFormedXml(name, xml);
  });

  it('reads every EPUB part of the fixture, mimetype aside', async () => {
    const parts = unzipText(await renderEpub(epubOf(cleanInput())), ['mimetype']);
    expect(Object.keys(parts)).toEqual(expect.arrayContaining(['OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter-002.xhtml']));
    for (const [name, xml] of Object.entries(parts)) assertWellFormedXml(name, xml);
  });
});

describe('DOCX — no forbidden character reaches a part', () => {
  it('writes word/document.xml, docProps/core.xml and every other part as well-formed XML', async () => {
    const parts = unzipText(await renderDocx(dirtyInput()));
    expect(Object.keys(parts)).toEqual(expect.arrayContaining(['word/document.xml', 'docProps/core.xml']));
    for (const [name, xml] of Object.entries(parts)) assertWellFormedXml(name, xml);
  });

  it('keeps the words that were there, with the forbidden characters taken out', async () => {
    const parts = unzipText(await renderDocx(dirtyInput()));
    const body = parts['word/document.xml'] ?? '';
    expect(body).toContain('Alphabetagammadelta.');
    expect(body).toContain('<w:t xml:space="preserve">1. Chapter One</w:t>');
    expect(body).toContain('The Lighthouse Keeper');
    const core = parts['docProps/core.xml'] ?? '';
    expect(core).toContain('The Lighthouse Keeper');
    expect(core).toContain('M. Ortega');
  });
});

describe('every forbidden code point, in every field, still leaves each part well-formed', () => {
  const ALL = FORBIDDEN_CODE_POINTS.map((code) => String.fromCodePoint(code)).join('');
  const everywhere: RenderInput = {
    blocks: [
      { kind: 'frontmatter', fmKind: 'titlepage' },
      { kind: 'chapter', title: `Part${ALL}`, level: 1, number: 1 },
      { kind: 'scene', docId: IDS.landing, title: 'The Landing', body: `x${ALL}y`, number: 1 },
    ],
    title: `T${ALL}`,
    author: `A${ALL}`,
    date: '2026-10-08',
    template: DEFAULT_TEMPLATE,
    toc: true,
  };

  it('holds in the DOCX parts', async () => {
    for (const [name, xml] of Object.entries(unzipText(await renderDocx(everywhere)))) assertWellFormedXml(name, xml);
  });

  it('holds in the EPUB parts', async () => {
    for (const [name, xml] of Object.entries(unzipText(await renderEpub(epubOf(everywhere)), ['mimetype']))) {
      assertWellFormedXml(name, xml);
    }
  });
});

describe('EPUB — no forbidden character reaches a part', () => {
  it('writes every XML part, the package document and the navigation included, as well-formed XML', async () => {
    const parts = unzipText(await renderEpub(epubOf(dirtyInput())), ['mimetype']);
    expect(Object.keys(parts)).toEqual(
      expect.arrayContaining(['OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/chapter-001.xhtml']),
    );
    for (const [name, xml] of Object.entries(parts)) assertWellFormedXml(name, xml);
  });

  it('keeps the title, the author and the scene text, with the forbidden characters taken out', async () => {
    const parts = unzipText(await renderEpub(epubOf(dirtyInput())), ['mimetype']);
    const opf = parts['OEBPS/content.opf'] ?? '';
    expect(opf).toContain('<dc:title>The Lighthouse Keeper</dc:title>');
    expect(opf).toContain('<dc:creator id="creator">M. Ortega</dc:creator>');
    expect(parts['OEBPS/chapter-001.xhtml']).toContain('<p>Alphabetagammadelta.</p>');
    expect(parts['OEBPS/nav.xhtml']).toContain('1. Chapter One');
  });
});
