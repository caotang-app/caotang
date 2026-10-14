import type { CodexEntry } from '@caotang/store';
import { describe, expect, it } from 'vitest';

import { BLOCK_BRANCHES, COLON_GATHER, CUE_NAMES, DECLARED_UNDER_KNOT, DIVERT_VAR, TAVERN, TAVERN_TAGGED, TWO_WAY, WHOLE_STORY } from './fixtures.js';
import { buildRows, compileInk, csvField, ensureLineIds, exportCsv, planInkImport, toCsv } from '../src/index.js';

const entry = (id: string, name: string, type: string, aliases: string[] = []): CodexEntry => ({
  id,
  name,
  aliases,
  type,
  description: '',
  includePolicy: 'detected',
  caseSensitive: false,
  exclude: [],
  attachments: [],
  keywords: [],
  origin: 'manual',
  sources: [],
});

const CODEX = [
  entry('c_ALICE00001', 'Alice', 'character', ['Al']),
  entry('c_INNKEEP001', 'Innkeeper', 'character'),
  entry('c_LANTERN001', 'Lantern', 'object'),
];

describe('the dialogue table rows', () => {
  const rows = buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED, meta: { speaker: 'c_ALICE00001' } }], { entries: CODEX, charLimit: 42 });

  it('has one row per spoken line and choice label, with the id each carries', () => {
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.lineId)).toEqual([
      'l_0000000001',
      'l_0000000002',
      'l_0000000003_c',
      'l_0000000004_c',
      'l_0000000005_c',
      'l_0000000006',
      'l_0000000007',
      'l_0000000008',
      'l_0000000009',
      'l_0000000010',
    ]);
  });

  it('resolves a typed speaker to its codex id, with its display name in the context', () => {
    const cue = rows.find((r) => r.text === "Ah, a traveller. What'll it be?");
    expect(cue?.speaker).toBe('c_INNKEEP001');
    expect(cue?.context).toBe('tavern / Innkeeper');
  });

  it('gives a line with no typed speaker the container default, and a choice label too', () => {
    const plain = rows.find((r) => r.text === 'The innkeeper looks up.');
    expect(plain?.speaker).toBe('c_ALICE00001');
    expect(plain?.context).toBe('tavern / Alice');
    const choice = rows.find((r) => r.text === 'Order an ale');
    expect(choice?.speaker).toBe('c_ALICE00001');
    expect(choice?.kind).toBe('choice');
  });

  it('keeps an unresolved typed speaker as the typed name, and the context without a display name', () => {
    const body = '-> s\n=== s ===\nBob: Who is that?\n-> END\n';
    const [row] = buildRows([{ id: 'd2', title: 'Scene', body }], { entries: CODEX });
    expect(row?.speaker).toBe('Bob');
    expect(row?.context).toBe('s');
  });

  it('applies the character limit to every row, and leaves it null when none is set', () => {
    expect(rows.every((r) => r.charLimit === 42)).toBe(true);
    const unlimited = buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED }]);
    expect(unlimited.every((r) => r.charLimit === null)).toBe(true);
  });

  it('carries the condition on a choice row, and the empty string elsewhere', () => {
    expect(rows.find((r) => r.text === 'Pay off the tab')?.condition).toBe('gold > 5');
    expect(rows.find((r) => r.text === 'Order an ale')?.condition).toBe('');
  });
});

describe('the RFC 4180 CSV', () => {
  it('writes the §6 header and one CRLF-terminated record per row', () => {
    const rows = buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED, meta: { speaker: 'c_ALICE00001' } }], { entries: CODEX });
    const csv = toCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('lineId,speaker,text,context,charLimit');
    expect(lines).toHaveLength(12);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes a field that holds a comma, a quote or a line break, and doubles its quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('quotes the comma in a spoken line, and leaves charLimit blank when unset', () => {
    const rows = buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED, meta: { speaker: 'c_ALICE00001' } }], { entries: CODEX });
    const csv = toCsv(rows);
    expect(csv).toContain('"Ah, a traveller. What\'ll it be?"');
    expect(csv.split('\r\n')[1]?.endsWith(',')).toBe(true);
  });

  it('adds a condition column when a caller asks, and not otherwise', () => {
    const rows = buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED }], { entries: CODEX });
    expect(toCsv(rows).split('\r\n')[0]).toBe('lineId,speaker,text,context,charLimit');
    const withConditions = toCsv(rows, { includeConditions: true });
    expect(withConditions.split('\r\n')[0]).toBe('lineId,speaker,text,context,charLimit,condition');
    expect(withConditions).toContain(',gold > 5');
  });
});

describe('the export gate', () => {
  it('refuses a table with rows that have no id, and names them', () => {
    const result = exportCsv([{ id: 'd1', title: 'Tavern', body: TAVERN }], { entries: CODEX });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toHaveLength(10);
    expect(result.duplicates).toEqual([]);
  });

  it('refuses an id that names two lines, since an id names one line once', () => {
    const body = '-> s\n=== s ===\nFirst. # lineId: l_0000000001\nSecond. # lineId: l_0000000001\n-> END\n';
    const result = exportCsv([{ id: 'd1', title: 'Scene', body }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.duplicates).toEqual(['l_0000000001']);
  });

  it('exports once the ids are minted, with the same rows the table shows', () => {
    let counter = 0;
    const stream = (n: number): Uint8Array => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) {
        counter += 1;
        out[i] = (counter * 97 + 31) & 0xff;
      }
      return out;
    };
    const minted = ensureLineIds(TAVERN, { randomBytes: stream });
    const result = exportCsv([{ id: 'd1', title: 'Tavern', body: minted.body }], { entries: CODEX });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(10);
    expect(result.csv.split('\r\n')).toHaveLength(12);
  });
});

describe('the whole-story import plan', () => {
  const plan = planInkImport(WHOLE_STORY);

  it('makes one container per knot-cluster: the intro cluster with its function, and the market alone', () => {
    expect(plan.containers.map((c) => c.title)).toEqual(['intro', 'market']);
    expect(plan.containers[0]?.knots).toEqual(['intro', 'cell', 'call_out', 'bump']);
    expect(plan.containers[1]?.knots).toEqual(['market']);
  });

  it('gives every container a body that compiles on its own', () => {
    for (const container of plan.containers) {
      expect(compileInk(container.body).ok, container.title).toBe(true);
    }
  });

  it('copies in only the global declarations a container uses, and keeps the others in the preamble', () => {
    expect(plan.containers[0]?.body.startsWith('VAR coins = 0')).toBe(true);
    expect(plan.containers[0]?.body).not.toContain('unused_flag');
    expect(plan.containers[1]?.body).not.toContain('VAR');
    expect(plan.preamble).toContain('VAR unused_flag = false');
    expect(plan.globals).toEqual(['VAR coins = 0', 'VAR unused_flag = false']);
  });

  it('reports where the root sends the story, since the entry is not a container', () => {
    expect(plan.entryDiverts).toEqual(['intro']);
    expect(plan.notes.some((n) => n.includes('sends the reader to intro'))).toBe(true);
  });

  it('keeps two knots that divert to each other in one container', () => {
    const two = planInkImport(TWO_WAY);
    expect(two.containers).toHaveLength(1);
    expect(two.containers[0]?.knots).toEqual(['ping', 'pong']);
    expect(compileInk(two.containers[0]?.body ?? '').ok).toBe(true);
  });

  it('treats a body with no knots as one flow in one container', () => {
    const flat = planInkImport('Hello.\n-> END\n');
    expect(flat.containers.map((c) => c.title)).toEqual(['Imported story']);
    expect(flat.notes[0]).toMatch(/no knots/);
  });
});

describe('the whole-story import, with declarations written under knots', () => {
  const plan = planInkImport(DECLARED_UNDER_KNOT);
  const container = (title: string): string => plan.containers.find((c) => c.title === title)?.body ?? '';

  it('gives every container a body that compiles on its own', () => {
    expect(plan.containers.map((c) => c.title)).toEqual(['a', 'b', 'c', 'lounge', 'street']);
    for (const c of plan.containers) expect(compileInk(c.body).ok, c.title).toBe(true);
  });

  it('copies a declaration written under one knot into the container of a separate cluster that uses it', () => {
    expect(container('c').startsWith('VAR coins = 0')).toBe(true);
    expect(container('street').startsWith('LIST mood = calm, angry')).toBe(true);
  });

  it('keeps a declaration in the container it is written in, once, and does not copy it into a container that never uses it', () => {
    expect(container('b').split('VAR coins').length - 1).toBe(1);
    expect(container('lounge').split('LIST mood').length - 1).toBe(1);
    expect(container('a')).toContain('VAR spare = 1');
    expect(container('c')).not.toContain('VAR spare');
  });

  it('keeps a declaration no container uses where it is written, so nothing in the file is lost', () => {
    expect(container('a')).toContain('VAR spare = 1');
    expect(plan.preamble).not.toContain('VAR spare');
    expect(plan.globals).toEqual(['VAR spare = 1', 'VAR coins = 0', 'LIST mood = calm, angry']);
  });

  it('keeps a knot that a divert-valued declaration names in the container that uses the declaration', () => {
    const divert = planInkImport(DIVERT_VAR);
    expect(divert.containers.map((c) => c.knots)).toEqual([['hub', 'vault']]);
    expect(compileInk(divert.containers[0]?.body ?? '').ok).toBe(true);
    expect(divert.preamble).toBe('-> hub');
  });
});

describe('the dialogue table, for branch, cue and gather shapes', () => {
  it('speaks the text of a conditional block branch, and not its value', () => {
    expect(compileInk(BLOCK_BRANCHES).ok).toBe(true);
    const rows = buildRows([{ id: 'd1', title: 'Block', body: BLOCK_BRANCHES }]);
    expect(rows.map((r) => [r.speaker, r.text])).toEqual([
      ['', 'Glad to see you.'],
      ['', 'Oh no.'],
      ['', 'Hmm.'],
    ]);
  });

  it('keeps a cue with a Unicode capital out of the spoken text, and names its speaker', () => {
    expect(compileInk(CUE_NAMES).ok).toBe(true);
    const rows = buildRows([{ id: 'd1', title: 'Cues', body: CUE_NAMES }]);
    expect(rows.map((r) => [r.speaker, r.text])).toEqual([
      ['Zoë', 'Bonjour.'],
      ['Émile', 'Salut.'],
      ['', 'Plain line.'],
    ]);
  });

  it('keeps a gather line that ends in a colon as a row', () => {
    expect(compileInk(COLON_GATHER).ok).toBe(true);
    const rows = buildRows([{ id: 'd1', title: 'Gather', body: COLON_GATHER }]);
    expect(rows.map((r) => r.text)).toEqual(['Hi.', 'Here they are:', 'Nice.']);
  });

  it('writes the character limit into the charLimit column when a template sets one', () => {
    const csv = toCsv(buildRows([{ id: 'd1', title: 'Tavern', body: TAVERN_TAGGED }], { charLimit: 42 }));
    const records = csv.split('\r\n');
    expect(records[1]?.endsWith(',42')).toBe(true);
    expect(records.slice(1, -1).every((record) => record.endsWith(',42'))).toBe(true);
  });
});
