/**
 * Project export: the project block's identity and language (epub-metadata.md), its backfill on open, and the
 * validator's tolerance for the new fields.
 *
 * The rule under test is the one the EPUB persistence depends on: an identifier is minted once, at create or on the
 * first open of a project that predates it, and is never regenerated after that. A test that reopened a project and got
 * a different identifier would be a retailer's record split in two.
 */

import { describe, expect, it } from 'vitest';
import {
  BACKFILLABLE_FIELDS,
  MemoryArtifactFs,
  backfillProjectIdentity,
  createEmptyManifest,
  defaultLanguage,
  identifierUrn,
  languageSubtag,
  mintIdentifier,
  readProject,
  serializeManifest,
  validateManifest,
  type Manifest,
} from '../src/index.js';

const NOW = new Date('2026-10-08T09:00:00.000Z');
const FIRST = '3f2a9c1e-8b4d-4a5e-9c7f-2d1e0a9b8c7d';
const LATER = 'ffffffff-0000-4000-8000-000000000000';

/** A manifest as a project written before the identifier and language existed: no identifier, no language, no recipes. */
function legacyManifest(): Manifest {
  const manifest = createEmptyManifest('Legacy', NOW, { uuid: () => FIRST, locale: 'de-DE' });
  delete (manifest.project as { identifier?: unknown }).identifier;
  delete (manifest.project as { language?: string }).language;
  delete manifest.recipes;
  return manifest;
}

describe('minting and the language default', () => {
  it('mints a urn:uuid identifier from the random part it is given', () => {
    expect(mintIdentifier(() => FIRST)).toBe(`urn:uuid:${FIRST}`);
  });

  it('mints a different identifier for each project, from the platform\'s random source', () => {
    expect(mintIdentifier()).not.toBe(mintIdentifier());
    expect(mintIdentifier()).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gives a stored bare uuid its URN form, and leaves a URN as it is', () => {
    expect(identifierUrn(FIRST)).toBe(`urn:uuid:${FIRST}`);
    expect(identifierUrn(`urn:uuid:${FIRST}`)).toBe(`urn:uuid:${FIRST}`);
  });

  it('takes the language subtag of the locale, so en-US is en and de-DE is de', () => {
    expect(languageSubtag('en-US')).toBe('en');
    expect(languageSubtag('de-DE')).toBe('de');
    expect(defaultLanguage('fr')).toBe('fr');
  });

  it('falls back to en for a tag the platform cannot parse, rather than writing a value that is not a language', () => {
    expect(languageSubtag('')).toBe('en');
    expect(languageSubtag('not a tag!!')).toBe('en');
  });
});

describe('a new project carries its identity from the moment it exists', () => {
  it('mints the identifier, sets the language from the locale, and seeds the Manuscript recipe', () => {
    const m = createEmptyManifest('The Lighthouse Keeper', NOW, { uuid: () => FIRST, locale: 'en-GB' });
    expect(m.project.identifier).toEqual({ uuid: `urn:uuid:${FIRST}` });
    expect(m.project.language).toBe('en');
    // exporter.md §4: docx, the manuscript root, the default template.
    expect(m.recipes).toEqual([{ name: 'Manuscript', includeRootIds: ['manuscript'], format: 'docx', templateId: 'default', options: {} }]);
  });

  it('gives two new projects two identifiers', () => {
    const a = createEmptyManifest('A', NOW);
    const b = createEmptyManifest('B', NOW);
    expect(a.project.identifier?.uuid).not.toBe(b.project.identifier?.uuid);
  });
});

describe('backfillProjectIdentity — once, on open, and only what is missing', () => {
  it('fills in an identifier and a language a project lacks, and names both fields', () => {
    const m = legacyManifest();
    const set = backfillProjectIdentity(m, { uuid: () => FIRST, locale: 'de-DE' });
    expect(set).toEqual(['project.identifier.uuid', 'project.language']);
    expect(m.project.identifier).toEqual({ uuid: `urn:uuid:${FIRST}` });
    expect(m.project.language).toBe('de');
    expect([...BACKFILLABLE_FIELDS]).toEqual(set);
  });

  it('sets nothing on a manifest that is already complete, so a second open is a no-op', () => {
    const m = createEmptyManifest('Done', NOW, { uuid: () => FIRST, locale: 'en' });
    expect(backfillProjectIdentity(m, { uuid: () => LATER, locale: 'de' })).toEqual([]);
    expect(m.project.identifier?.uuid).toBe(`urn:uuid:${FIRST}`);
    expect(m.project.language).toBe('en');
  });

  it('never replaces an identifier that is present, even when it is not a URN', () => {
    const m = createEmptyManifest('Kept', NOW, { uuid: () => FIRST, locale: 'en' });
    m.project.identifier = { uuid: FIRST };
    expect(backfillProjectIdentity(m, { uuid: () => LATER })).toEqual([]);
    expect(m.project.identifier.uuid).toBe(FIRST);
  });
});

describe('an open that finds the fields missing', () => {
  it('backfills the identifier and the language once, notices both, and keeps the identifier on the next open', async () => {
    const text = serializeManifest(legacyManifest());
    const first = await readProject(new MemoryArtifactFs(), { manifestText: text, uuid: () => FIRST, locale: 'de-DE' });
    expect(first.state.manifest.project.identifier).toEqual({ uuid: `urn:uuid:${FIRST}` });
    expect(first.state.manifest.project.language).toBe('de');
    const paths = first.notices.map((notice) => notice.path);
    expect(paths).toEqual(expect.arrayContaining(['project.identifier.uuid', 'project.language']));

    // The save that follows writes what the open filled in. Reopening that file must not mint again.
    const again = await readProject(new MemoryArtifactFs(), {
      manifestText: serializeManifest(first.state.manifest),
      uuid: () => LATER,
      locale: 'fr-FR',
    });
    expect(again.state.manifest.project.identifier?.uuid).toBe(`urn:uuid:${FIRST}`);
    expect(again.state.manifest.project.language).toBe('de');
    expect(again.notices.filter((notice) => notice.path.startsWith('project.'))).toEqual([]);
  });

  it('opens a legacy project without a recipe, and leaves the recipes absent rather than inventing one', async () => {
    const loaded = await readProject(new MemoryArtifactFs(), {
      manifestText: serializeManifest(legacyManifest()),
      uuid: () => FIRST,
      locale: 'de-DE',
    });
    expect(loaded.state.manifest.recipes).toBeUndefined();
  });
});

describe('the validator tolerates the new fields, and drops only what it cannot read', () => {
  it('drops a non-string author with a warning, and keeps the project', () => {
    const m = createEmptyManifest('Odd', NOW, { uuid: () => FIRST, locale: 'en' });
    (m.project as unknown as Record<string, unknown>)['author'] = 42;
    const report = validateManifest(m, { docFiles: [] });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.path)).toContain('project.author');
    expect(report.manifest?.project).not.toHaveProperty('author');
  });

  it('keeps a recipe whose options are malformed, drops only the options, and says so', () => {
    const m = createEmptyManifest('Odd', NOW, { uuid: () => FIRST, locale: 'en' });
    m.recipes = [{ name: 'Beta', includeRootIds: ['manuscript'], format: 'md', options: { toc: 'yes' } as unknown as object }];
    const report = validateManifest(m, { docFiles: [] });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.path)).toContain('recipes[0].options');
    const kept = report.manifest?.recipes?.[0];
    expect(kept?.name).toBe('Beta');
    expect(kept).not.toHaveProperty('options');
  });

  it('keeps a well-formed recipe\'s options exactly as written', () => {
    const m = createEmptyManifest('Good', NOW, { uuid: () => FIRST, locale: 'en' });
    m.recipes = [{ name: 'Beta', includeRootIds: ['manuscript'], format: 'md', options: { titlePage: false, author: 'A' } }];
    const report = validateManifest(m, { docFiles: [] });
    expect(report.warnings.filter((w) => w.path.startsWith('recipes'))).toEqual([]);
    expect(report.manifest?.recipes?.[0]?.options).toEqual({ titlePage: false, author: 'A' });
  });

  it('drops a malformed ISBN and keeps the uuid, so a bad ISBN never changes the book\'s identity', async () => {
    const parsed = JSON.parse(serializeManifest(createEmptyManifest('Kept', NOW, { uuid: () => FIRST, locale: 'en' }))) as {
      project: { identifier?: unknown };
    };
    parsed.project.identifier = { uuid: `urn:uuid:${FIRST}`, isbn: 123 };
    const opened = await readProject(new MemoryArtifactFs(), {
      manifestText: JSON.stringify(parsed),
      uuid: () => LATER,
      locale: 'en',
    });
    expect(opened.state.manifest.project.identifier).toEqual({ uuid: `urn:uuid:${FIRST}` });
    const paths = opened.notices.map((notice) => notice.path);
    expect(paths).toContain('project.identifier.isbn');
    expect(paths).not.toContain('project.identifier.uuid');
  });

  it('makes a new identifier only when the block holds no uuid string at all', async () => {
    const parsed = JSON.parse(serializeManifest(createEmptyManifest('Kept', NOW, { uuid: () => FIRST, locale: 'en' }))) as {
      project: { identifier?: unknown };
    };
    parsed.project.identifier = { uuid: 42 };
    const opened = await readProject(new MemoryArtifactFs(), {
      manifestText: JSON.stringify(parsed),
      uuid: () => LATER,
      locale: 'en',
    });
    expect(opened.state.manifest.project.identifier).toEqual({ uuid: `urn:uuid:${LATER}` });
    expect(opened.notices.map((notice) => notice.path)).toContain('project.identifier.uuid');
  });
});
