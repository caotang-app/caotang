/**
 * `CodexEntry.visualRefs` (video-prompt-pack.md §3): the asset ids a prompt pack sends with a shot that mentions the entry.
 * The field is additive, so an entry without it reads as none and is written exactly as before, and a list of anything
 * other than text is refused by the manifest's shape check, as `attachments` is.
 */

import { describe, expect, it } from 'vitest';

import {
  createEmptyManifest,
  formatCodexFrontMatter,
  parseCodexFile,
  serializeManifest,
  validateManifest,
  type CodexEntry,
  type CodexFrontMatter,
  type Manifest,
} from '../src/index.js';

const HARBOUR = 'c_HARBOUR001';
const PORTRAIT = 'a_PORTRAIT01';

function frontMatter(overrides: Partial<CodexFrontMatter> = {}): CodexFrontMatter {
  return {
    id: HARBOUR,
    name: 'Harbour',
    type: 'location',
    includePolicy: 'detected',
    caseSensitive: false,
    aliases: [],
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    ...overrides,
  };
}

function entry(overrides: Partial<CodexEntry> = {}): CodexEntry {
  return {
    id: HARBOUR,
    name: 'Harbour',
    aliases: [],
    type: 'location',
    description: 'A grey harbour under a low sky.',
    includePolicy: 'detected',
    caseSensitive: false,
    exclude: [],
    attachments: [],
    keywords: [],
    origin: 'manual',
    sources: [],
    ...overrides,
  };
}

function manifestWith(codex: CodexEntry): Manifest {
  const manifest = createEmptyManifest('The Lighthouse Keeper', new Date('2026-10-01T09:00:00.000Z'));
  manifest.codex = [codex];
  return manifest;
}

describe('codex visual references in the redundancy file', () => {
  it('keeps the asset ids through a format and parse round trip', () => {
    const text = formatCodexFrontMatter(frontMatter({ visualRefs: [PORTRAIT, 'a_HARBOUR002'] }));
    const parsed = parseCodexFile(`${text}A grey harbour.\n`);
    expect(parsed.frontMatter.visualRefs).toEqual([PORTRAIT, 'a_HARBOUR002']);
  });

  it('writes no key for an entry without visual references, so an older file is unchanged', () => {
    const text = formatCodexFrontMatter(frontMatter());
    expect(text).not.toContain('visualRefs');
    expect(parseCodexFile(`${text}A grey harbour.\n`).frontMatter.visualRefs).toBeUndefined();
  });

  it('writes no key for an empty list either', () => {
    expect(formatCodexFrontMatter(frontMatter({ visualRefs: [] }))).not.toContain('visualRefs');
  });

  it('places the key after keywords, in the fixed key order', () => {
    const text = formatCodexFrontMatter(frontMatter({ visualRefs: [PORTRAIT] }));
    expect(text.indexOf('keywords:')).toBeLessThan(text.indexOf('visualRefs:'));
    expect(text.indexOf('visualRefs:')).toBeLessThan(text.indexOf('origin:'));
  });
});

describe('codex visual references in the manifest', () => {
  it('refuses a list that is not text, and accepts a list of asset ids', () => {
    // A hand-edited file, read as JSON: the writer never holds a non-list, so the check is on the text the loader reads.
    const raw = JSON.parse(serializeManifest(manifestWith(entry()))) as { codex: { visualRefs?: unknown }[] };
    raw.codex[0] = { ...raw.codex[0], visualRefs: PORTRAIT };
    const refused = validateManifest(raw);
    expect(refused.errors.map((error) => error.path)).toContain(`codex[0].visualRefs`);

    const accepted = validateManifest(JSON.parse(serializeManifest(manifestWith(entry({ visualRefs: [PORTRAIT] })))));
    expect(accepted.errors.filter((error) => error.path.includes('visualRefs'))).toEqual([]);
  });

  it('writes the key after keywords when there are references, and not at all when there are none', () => {
    const withRefs = serializeManifest(manifestWith(entry({ visualRefs: [PORTRAIT] })));
    expect(withRefs).toContain(`"visualRefs": ["${PORTRAIT}"]`);
    expect(withRefs.indexOf('"keywords"')).toBeLessThan(withRefs.indexOf('"visualRefs"'));
    expect(withRefs.indexOf('"visualRefs"')).toBeLessThan(withRefs.indexOf('"origin"'));

    expect(serializeManifest(manifestWith(entry()))).not.toContain('visualRefs');
  });

  it('reads its references back from the manifest text', () => {
    const back = JSON.parse(serializeManifest(manifestWith(entry({ visualRefs: [PORTRAIT] })))) as Manifest;
    expect(back.codex?.[0]?.visualRefs).toEqual([PORTRAIT]);
  });
});
