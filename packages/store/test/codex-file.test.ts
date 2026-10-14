/**
 * Codex redundancy-file codec — [codex.md §3](docs/architecture/codex.md).
 *
 * codex.md §3 is explicit: "`codex/<id>.md` — YAML front matter `{id, name,
 * type, includePolicy, caseSensitive, aliases, exclude, attachments, keywords}`
 * + body = `description` Markdown." The file exists so that "each entry is
 * individually meaningful and survives manifest corruption", so the tests below
 * are written as a survival property — write it, parse nothing, read it back from
 * the file alone — rather than as a serializer snapshot.
 */

import { describe, expect, it } from 'vitest';
import {
  formatCodexFrontMatter,
  parseCodexFile,
  serializeCodexFile,
  type CodexFrontMatter,
} from '../src/index.js';

const entry: CodexFrontMatter = {
  id: 'c_5H8QK2M9RT',
  name: 'Elena Voss',
  type: 'character',
  includePolicy: 'detected',
  caseSensitive: false,
  aliases: ['Lena', 'the keeper'],
  exclude: ['Lena said'],
  attachments: ['n_3W8RN2TQ6C'],
  keywords: ['protagonist'],
};

const description = [
  "The lighthouse keeper's daughter; returns after nine years abroad.",
  '',
  'She is the only one who remembers the storm.',
].join('\n');

describe('codex redundancy file', () => {
  it('emits exactly the nine keys codex.md §3 lists, in its order', () => {
    const block = formatCodexFrontMatter(entry);
    const keys = block
      .split('\n')
      .filter((l) => l !== '' && l !== '---')
      .map((l) => l.slice(0, l.indexOf(':')));
    expect(keys).toEqual([
      'id',
      'name',
      'type',
      'includePolicy',
      'caseSensitive',
      'aliases',
      'exclude',
      'attachments',
      'keywords',
    ]);
  });

  it('round-trips every field and the description body verbatim', () => {
    const parsed = parseCodexFile(serializeCodexFile(entry, description));
    // The fixture carries no provenance, so the file has no `sources` key and a
    // read of it gets the K4 defaults: origin 'manual' (the stated default) and no
    // citations.
    expect(parsed.frontMatter).toEqual({ ...entry, origin: 'manual', sources: [] });
    expect(parsed.description).toBe(description);
  });

  // codex.md §10 K4. A recovered agent entry keeps its provenance: the origin and the
  // citations come back as written, quote and all, because the redundancy file is
  // what a recovery restores from (codex.md §3).
  it('round-trips provenance: origin and every citation field survive the file', () => {
    const citations = [
      { docId: 'n_3W8RN2TQ6C', quote: 'The ferry was late,', from: 0, to: 19, extractedAt: '2026-10-01T00:00:00.000Z' },
      // Quote characters the front matter must escape: quotes, a colon, a backslash, a newline.
      { docId: 'n_3W8RN2TQ6C', quote: 'said: "no" \\ then\nleft', from: 20, to: 42, extractedAt: '2026-10-01T00:00:00.000Z' },
    ];
    const agent: CodexFrontMatter = { ...entry, origin: 'agent', sources: citations };
    const text = serializeCodexFile(agent, description);
    const parsed = parseCodexFile(text);
    expect(parsed.frontMatter).toEqual({ ...entry, origin: 'agent', sources: citations });
    expect(parsed.coercions).toEqual([]);
    expect(parsed.description).toBe(description);
  });

  it('reads a file with no origin key (written before K4) as manual, without a note', () => {
    const parsed = parseCodexFile(serializeCodexFile(entry, description));
    expect(parsed.frontMatter.origin).toBe('manual');
    expect(parsed.coercions).toEqual([]);
  });

  it('coerces an unknown origin to agent, notes it, and drops a malformed citation, keeping the rest', () => {
    const text = serializeCodexFile({ ...entry, origin: 'agent' }, description).replace('origin: agent', 'origin: wizard');
    const withBadCitations = text.replace(
      '\n---\n',
      '\nsources: "[{\\"docId\\":\\"n_3W8RN2TQ6C\\",\\"quote\\":\\"q\\",\\"from\\":\\"zero\\",\\"to\\":3},{\\"docId\\":\\"n_3W8RN2TQ6C\\",\\"quote\\":\\"ok\\",\\"from\\":0,\\"to\\":2}]"\n---\n',
    );
    const parsed = parseCodexFile(withBadCitations);
    expect(parsed.frontMatter.origin).toBe('agent');
    expect(parsed.frontMatter.sources).toEqual([{ docId: 'n_3W8RN2TQ6C', quote: 'ok', from: 0, to: 2 }]);
    expect(parsed.coercions.some((note) => note.includes('origin "wizard"'))).toBe(true);
    expect(parsed.coercions.some((note) => note.includes('from must be a whole offset'))).toBe(true);
  });

  it('preserves a multi-line description byte-for-byte', () => {
    // A description with trailing spaces and CRLF: the irreplaceable half of
    // the file, exactly as document bodies are treated (§3).
    const awkward = 'line one  \r\nline two\t\r\n\r\n  indented';
    const parsed = parseCodexFile(serializeCodexFile(entry, awkward));
    expect(parsed.description).toBe(awkward);
  });

  // Same contract as a document body (see document-file.test.ts): a description
  // that ends in a newline comes back with that newline, not one fewer.
  it.each([
    ['one trailing newline', 'The lighthouse keeper.\n'],
    ['two trailing newlines', 'The lighthouse keeper.\n\n'],
    ['only a newline', '\n'],
    ['a trailing CRLF', 'The lighthouse keeper.\r\n'],
    ['a bare trailing CR', 'The lighthouse keeper.\r'],
  ])('round-trips a description ending in %s byte-for-byte', (_label, text) => {
    expect(parseCodexFile(serializeCodexFile(entry, text)).description).toBe(text);
    const crlf = serializeCodexFile(entry, text, { newline: '\r\n' });
    expect(parseCodexFile(crlf).description).toBe(text);
  });

  it('defaults the closed enums rather than inventing values', () => {
    const raw = [
      '---',
      'id: c_5H8QK2M9RT',
      'name: Elena',
      'includePolicy: whenever-she-shows-up',
      'aliases: []',
      '---',
      '',
      'A body.',
      '',
    ].join('\n');
    const parsed = parseCodexFile(raw);
    // codex.md §2: unknown includePolicy coerces to 'detected'.
    expect(parsed.frontMatter.includePolicy).toBe('detected');
    // An absent type is not a closed-enum violation to invent around.
    expect(parsed.frontMatter.type).toBe('other');
    expect(parsed.frontMatter.caseSensitive).toBe(false);
    expect(parsed.description).toBe('A body.');
  });

  it('keeps a case-sensitive entry case-sensitive through the file', () => {
    const parsed = parseCodexFile(serializeCodexFile({ ...entry, caseSensitive: true }, 'Will.'));
    expect(parsed.frontMatter.caseSensitive).toBe(true);
  });

  it('tolerates the block-scalar and quoted forms a real YAML writer emits', () => {
    const raw = [
      '---',
      'id: c_5H8QK2M9RT',
      "name: 'Elena: the keeper'",
      'type: character',
      'includePolicy: always',
      'caseSensitive: false',
      'aliases: [Lena, "the keeper"]',
      'exclude: []',
      'attachments: [n_3W8RN2TQ6C]',
      'keywords: []',
      '---',
      '',
      'A body.',
      '',
    ].join('\r\n');
    const parsed = parseCodexFile(raw);
    expect(parsed.frontMatter.name).toBe('Elena: the keeper');
    expect(parsed.frontMatter.aliases).toEqual(['Lena', 'the keeper']);
    expect(parsed.description).toBe('A body.');
  });

  it('refuses a file with no id or name rather than importing a nameless entry', () => {
    expect(() => parseCodexFile('---\nname: Elena\n---\n\nbody\n')).toThrow(/no `id`/);
    expect(() => parseCodexFile('---\nid: c_5H8QK2M9RT\n---\n\nbody\n')).toThrow(/no `name`/);
    expect(() => parseCodexFile('no front matter at all\n')).toThrow(/front matter fence/);
  });

  it('writes an entry with an empty description as front matter alone', () => {
    const raw = serializeCodexFile(entry, '');
    expect(raw.endsWith('---\n')).toBe(true);
    expect(parseCodexFile(raw).description).toBe('');
  });
});
