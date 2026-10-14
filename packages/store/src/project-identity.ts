/**
 * The project's EPUB identity and language — [epub-metadata.md](docs/architecture/epub-metadata.md), the floor.
 *
 * Two values are needed by every EPUB and are not the writer's to type: the persistent identifier and the
 * language. The identifier is `urn:uuid:` followed by a random UUID, minted **once** and never regenerated, because
 * a retailer dedupes a book by its identifier and a fresh one per export would split its record (EPUB 3.3 §5.5.2).
 * The language defaults to the app locale's language subtag (`en`, not `en-US`).
 *
 * Both are created with a new project ({@link createEmptyManifest}). A project that predates them is filled in
 * **once**, on open, by {@link backfillProjectIdentity}: that function only ever sets what is missing, so calling it
 * on an already-filled manifest changes nothing, and that idempotence is what lets both loaders call it.
 */

import type { Manifest } from './manifest.js';

/** The URN form every stored identifier takes (epub-metadata.md, `project.identifier.uuid`). */
export const IDENTIFIER_PREFIX = 'urn:uuid:';

/** A UUID string. The default is `crypto.randomUUID`, and a test passes its own to pin the value. */
export type UuidSource = () => string;

const defaultUuid: UuidSource = () => globalThis.crypto.randomUUID();

/** A fresh `urn:uuid:` identifier. Minted here and nowhere else, so the one generator is the one place to read. */
export function mintIdentifier(uuid: UuidSource = defaultUuid): string {
  return `${IDENTIFIER_PREFIX}${uuid()}`;
}

/**
 * The stored identifier in its URN form. A value written as a bare UUID is given the prefix rather than refused:
 * the writer already chose that identity, and the export must carry it byte-for-byte as the same URN on every pack.
 */
export function identifierUrn(stored: string): string {
  return stored.startsWith(IDENTIFIER_PREFIX) ? stored : `${IDENTIFIER_PREFIX}${stored}`;
}

/**
 * The language subtag of a BCP-47 tag: `en-US` → `en`. Falls back to `en` for a tag the platform cannot parse,
 * because an EPUB with no `dc:language` is refused by epubcheck and a wrong guess is a visible, editable value.
 */
export function languageSubtag(tag: string): string {
  try {
    const subtag = new Intl.Locale(tag).language;
    return subtag === '' ? 'en' : subtag;
  } catch {
    return 'en';
  }
}

/** The app's locale as a tag: the browser's language when there is one, the runtime's otherwise. */
export function appLocale(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator.language;
  if (typeof nav === 'string' && nav !== '') return nav;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

/** The default `project.language` for a new or unset project: the language subtag of the app locale. */
export function defaultLanguage(locale: string = appLocale()): string {
  return languageSubtag(locale);
}

export interface BackfillOptions {
  /** The identifier's random part, when a test pins it. */
  readonly uuid?: UuidSource;
  /** The locale the language default is read from, when a test pins it. */
  readonly locale?: string;
}

/**
 * Fills the identifier and the language a manifest is missing, and reports which fields it set.
 *
 * **Only missing values are set.** An identifier whose uuid is present is never replaced: the validator drops a
 * malformed ISBN and keeps the uuid, so only a manifest with no uuid string at all is missing one, and only then is
 * a new one made. An empty return means the manifest was already complete, which is the common case after the first
 * open.
 */
export function backfillProjectIdentity(manifest: Manifest, options: BackfillOptions = {}): string[] {
  const project = manifest.project;
  const set: string[] = [];
  if (project.identifier === undefined) {
    project.identifier = { uuid: mintIdentifier(options.uuid) };
    set.push('project.identifier.uuid');
  }
  if (project.language === undefined) {
    project.language = defaultLanguage(options.locale);
    set.push('project.language');
  }
  return set;
}

/**
 * Field paths a backfill may set, in the order {@link backfillProjectIdentity} reports them. Named once so the load
 * notice and the test that pins the rule read the same words.
 */
export const BACKFILLABLE_FIELDS = ['project.identifier.uuid', 'project.language'] as const;
