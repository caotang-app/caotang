/**
 * The EPUB metadata floor, held as structure — epub-metadata.md, exporter.md §3a.
 *
 * What this file pins, and why each is a property a reader depends on:
 *
 * - the **persistent identifier** is the same string on every pack, and is the package's unique identifier, so a
 *   retailer dedupes the book across re-exports (EPUB 3.3 §5.5.2);
 * - the **ISBN** is a second identifier, refined with its ONIX scheme, and is omitted when there is none;
 * - the **cover** is a `cover-image` manifest item, the legacy `cover` meta, and a stored image in the archive, and it is
 *   absent, with no property at all, when the project has none;
 * - the **language** reaches `dc:language` and every chapter's `xml:lang`.
 *
 * The epubcheck gate, which validates these same packs, is `epub-epubcheck.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { renderEpub } from '../src/render-epub.js';
import { COVER_PNG, EPUB_IDENTIFIER, PNG_1X1, epubInput, pack } from './epub-fixtures.js';

describe('the package identifier — the persistence rule', () => {
  it('writes the stored identifier as the unique identifier, byte-for-byte', async () => {
    const { text } = await pack(epubInput());
    const opf = text['OEBPS/content.opf'] ?? '';
    expect(opf).toContain('unique-identifier="pub-id"');
    expect(opf).toContain(`<dc:identifier id="pub-id">${EPUB_IDENTIFIER}</dc:identifier>`);
  });

  it('is byte-identical across two packs of the same manifest, while the modified time moves (epub-metadata.md fixture 5)', async () => {
    const first = await pack(epubInput({ modified: '2026-10-08T09:30:00Z' }));
    const second = await pack(epubInput({ modified: '2026-10-09T18:00:00Z' }));
    const idOf = (opf: string): string | undefined => /<dc:identifier id="pub-id">[^<]*<\/dc:identifier>/.exec(opf)?.[0];
    expect(idOf(first.text['OEBPS/content.opf'] ?? '')).toBe(idOf(second.text['OEBPS/content.opf'] ?? ''));
    expect(first.text['OEBPS/content.opf']).toContain('2026-10-08T09:30:00Z');
    expect(second.text['OEBPS/content.opf']).toContain('2026-10-09T18:00:00Z');
  });

  it('escapes an identifier it is handed, so no value can break the package document', async () => {
    const { text } = await pack(epubInput({ identifier: 'urn:uuid:a&b<c>' }));
    expect(text['OEBPS/content.opf']).toContain('urn:uuid:a&amp;b&lt;c&gt;');
  });
});

describe('the ISBN — the optional second identifier (epub-metadata.md fixture 2)', () => {
  it('adds a second dc:identifier refined with its ONIX scheme, and leaves the unique identifier on the uuid', async () => {
    const { text } = await pack(epubInput({ isbn: 'urn:isbn:9780306406157' }));
    const opf = text['OEBPS/content.opf'] ?? '';
    expect(opf).toContain('<dc:identifier id="isbn-id">urn:isbn:9780306406157</dc:identifier>');
    expect(opf).toContain('<meta refines="#isbn-id" property="identifier-type" scheme="onix:codelist5">15</meta>');
    expect(opf).toContain('unique-identifier="pub-id"');
  });

  it('omits the ISBN entirely when there is none, with no placeholder value', async () => {
    const { text } = await pack(epubInput());
    const opf = text['OEBPS/content.opf'] ?? '';
    expect(opf).not.toContain('isbn-id');
    expect(opf).not.toContain('onix:codelist5');
  });
});

describe('the cover — the cover-image item (epub-metadata.md fixtures 3 and 4)', () => {
  it('declares the cover-image manifest item, the legacy cover meta, and stores the image in the archive', async () => {
    const { files, text } = await pack(epubInput({ cover: COVER_PNG }));
    const opf = text['OEBPS/content.opf'] ?? '';
    expect(opf).toContain('<item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>');
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    const stored = files['OEBPS/cover.png'];
    expect(stored).toBeDefined();
    // The image is carried byte-for-byte: the cover is the file the writer chose, not a re-encoding of it.
    expect(Array.from(stored ?? new Uint8Array())).toEqual(Array.from(PNG_1X1));
  });

  it('stores the cover without compression, since an image gains nothing from it', async () => {
    const bytes = await renderEpub(epubInput({ cover: COVER_PNG }));
    // The entry is found by its name in the local header, whose compression method is 8 bytes past the header start.
    const at = indexOfBytes(bytes, new TextEncoder().encode('OEBPS/cover.png'));
    expect(at).toBeGreaterThan(0);
    const method = (bytes[at - 30 + 8] ?? 0) | ((bytes[at - 30 + 9] ?? 0) << 8);
    expect(method).toBe(0);
  });

  it('emits no cover property and no cover entry when the project has no cover', async () => {
    const { files, text } = await pack(epubInput());
    const opf = text['OEBPS/content.opf'] ?? '';
    expect(opf).not.toContain('cover-image');
    expect(opf).not.toContain('name="cover"');
    expect(Object.keys(files).some((name) => name.startsWith('OEBPS/cover.'))).toBe(false);
  });
});

describe('the language — dc:language and xml:lang (epub-metadata.md fixture 6)', () => {
  it('carries the project language to the package, the nav and every chapter', async () => {
    const { text } = await pack(epubInput({ language: 'de' }));
    expect(text['OEBPS/content.opf']).toContain('<dc:language>de</dc:language>');
    expect(text['OEBPS/content.opf']).toContain('xml:lang="de"');
    const documents = Object.keys(text).filter((name) => /OEBPS\/(chapter-\d+|nav)\.xhtml$/.test(name));
    expect(documents.length).toBeGreaterThan(1);
    for (const name of documents) {
      expect(text[name], name).toContain('xml:lang="de"');
    }
  });
});

/** The first index of `needle` in `haystack`, or -1. A small helper for reading a ZIP entry's header in place. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
