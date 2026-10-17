/**
 * The storyboard contact sheet as a PDF (`contact-sheet-pdf`, storyboard.md §6): the page plan from `@caotang/storyboard`,
 * drawn by this package's pdf-lib emitter. The plan's own geometry is tested in the storyboard package; these tests read the
 * file the compile produced back with pdf-lib and check what the spec says the file is: one page per planned page, on A4 or
 * Letter, the pictures embedded once, a caption, with a note, where a picture cannot be drawn, and text outside Latin script
 * set in the Noto Sans CJK fallback font, which is read only when a sheet needs it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { unzlibSync } from 'fflate/browser';
import {
  createActivityLog,
  createIdempotencyCache,
  createUndoStore,
  createViewState,
  execute,
  type BusContext,
  type Command,
} from '@caotang/bus';
import { createProjectCommandRegistry, MemoryArtifactFs, type ProjectState } from '@caotang/store';
import { addShotNode, planContactSheet } from '@caotang/storyboard';
import type { AssetRecord } from '@caotang/video-prompt-pack';
import { cjkFontCandidates, loadCjkFontInNode } from '../src/cjk-font-node.js';
import {
  CJK_FONT_FILE,
  CONTACT_SHEET_HEADER,
  containIn,
  createExporter,
  drawContactSheet,
  fitToWidth,
  renderMedia,
  sfntFromWoff,
  type FontLoader,
  type ByteArtifacts,
  type ExporterService,
} from '../src/index.js';
import { PNG_1X1 } from './epub-fixtures.js';
import { COMPILED_AT } from './fixture.js';
import { ASSET_FILE, ASSET_ID, ASSETS, MEDIA_IDS, OPENED, PROJECT_NAME, makeMediaProject } from './media-fixture.js';

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

function rig(
  options: {
    state?: ProjectState;
    assets?: ReadonlyMap<string, AssetRecord>;
    files?: Record<string, Uint8Array>;
    loadFallbackFont?: FontLoader;
  } = {},
): { exporter: ExporterService; reads: string[] } {
  const state = options.state ?? makeMediaProject();
  const files = options.files ?? { [`assets/${ASSET_FILE}`]: PNG_1X1 };
  const reads: string[] = [];
  const exporter = createExporter({
    readState: () => state,
    artifacts: new MemoryArtifactFs(),
    clock: { now: () => COMPILED_AT },
    metadata: () => ({ author: 'Ada Lovelace' }),
    assets: () => options.assets ?? ASSETS,
    readAsset: async (path) => {
      reads.push(path);
      return files[path] ?? null;
    },
    ...(options.loadFallbackFont === undefined ? {} : { loadFallbackFont: options.loadFallbackFont }),
  });
  return { exporter, reads };
}

async function compileSheet(exporter: ExporterService, selection: string[] = ['manuscript']) {
  const result = await exporter.compile({ includeRootIds: selection }, 'contact-sheet-pdf');
  const file = result.files[0];
  if (file === undefined || result.files.length !== 1) throw new Error(`expected one file, got ${result.files.length}`);
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  return { result, file, bytes, pdf: await PDFDocument.load(bytes, { updateMetadata: false }) };
}

/**
 * How many pictures the file embeds: each is one image XObject, however many cards draw it. A PNG with transparency also
 * carries its alpha as a second image (its soft mask), which is not a picture of its own, so masks are not counted.
 */
function imageCount(pdf: PDFDocument): number {
  const images = pdf.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  const masks = new Set(images.map(([, object]) => String((object as PDFRawStream).dict.get(PDFName.of('SMask')))));
  return images.filter(([ref]) => !masks.has(String(ref))).length;
}

/** The embedded font programs (FontFile2 streams) in the file, decompressed. Helvetica is built in, so it has none. */
function embeddedFontFiles(pdf: PDFDocument): Uint8Array[] {
  const files: Uint8Array[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue;
    const ref = object.get(PDFName.of('FontFile2'));
    const stream = ref === undefined ? undefined : pdf.context.lookup(ref);
    if (stream instanceof PDFRawStream) files.push(inflated(stream));
  }
  return files;
}

function inflated(stream: PDFRawStream): Uint8Array {
  return stream.dict.get(PDFName.of('Filter')) === PDFName.of('FlateDecode') ? unzlibSync(stream.contents) : stream.contents;
}

/**
 * The text the file's ToUnicode maps hold: what a PDF reader extracts when it copies or searches the text set in the
 * fallback font. pdf-lib writes one `bfrange`/`bfchar` entry per glyph with its UTF-16 code units in hex.
 */
function toUnicodeText(pdf: PDFDocument): string {
  let text = '';
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Subtype')) !== PDFName.of('Type0')) continue;
    const ref = object.get(PDFName.of('ToUnicode'));
    const stream = ref === undefined ? undefined : pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const cmap = new TextDecoder().decode(inflated(stream));
    for (const match of cmap.matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
      const hex = match[1] ?? '';
      const units: number[] = [];
      for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
      // pdf-lib maps .notdef to U+FFFF, which is no character of the text.
      if (hex.toUpperCase() !== 'FFFF') text += String.fromCharCode(...units);
    }
  }
  return text;
}

/** One page's content stream, decompressed, as text. */
function pageContent(pdf: PDFDocument, index: number): string {
  const contents = pdf.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
  return streams.map((stream) => (stream instanceof PDFRawStream ? new TextDecoder('latin1').decode(inflated(stream)) : '')).join('\n');
}

function hexOf(text: string): string {
  return [...text].map((char) => (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(2, '0')).join('');
}

/** A loader over the package's font file that counts its calls. */
function countingLoader(): { load: FontLoader; calls: () => number } {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return loadCjkFontInNode();
    },
    calls: () => calls,
  };
}

function withAction(action: string, imageAlt?: string): ProjectState {
  const state = makeMediaProject();
  addShotNode(state, {
    parentId: MEDIA_IDS.shots,
    title: 'World',
    id: 'n_WORLD00001',
    now: OPENED,
    stored: { action, ...(imageAlt === undefined ? {} : { imageAlt }) },
  });
  return state;
}

/** A project whose one storyboard holds `count` shots, with no pictures. */
function manyShots(count: number): ProjectState {
  const state = makeMediaProject();
  for (let i = 0; i < count; i += 1) {
    addShotNode(state, {
      parentId: MEDIA_IDS.shots,
      title: `Extra ${i + 1}`,
      id: `n_EXTRA${String(i).padStart(5, '0')}`,
      now: OPENED,
      stored: { shotSize: 'CU', action: `Extra shot ${i + 1}.`, durationSec: 1 },
    });
  }
  return state;
}

describe('contact-sheet-pdf — the storyboard as a PDF of shot cards', () => {
  it('writes one PDF named for the project, on A4, with its metadata set from the compile', async () => {
    const { file, bytes, pdf, result } = await compileSheet(rig().exporter);
    expect(file.fileName).toBe(`${PROJECT_NAME} (contact sheet).pdf`);
    expect(file.mimeType).toBe('application/pdf');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.getPageCount()).toBe(1);
    const size = pdf.getPage(0).getSize();
    expect(size.width).toBeCloseTo(A4.width, 2);
    expect(size.height).toBeCloseTo(A4.height, 2);
    expect(pdf.getTitle()).toMatch(/^The Lighthouse Keeper — Shots — \d{4}-\d{2}-\d{2}$/);
    expect(pdf.getAuthor()).toBe('Ada Lovelace');
    expect(pdf.getCreationDate()?.getTime()).toBe(Math.floor(COMPILED_AT / 1000) * 1000);
    expect(result.log.format).toBe('contact-sheet-pdf');
    expect(result.log.blockCount).toBe(2);
    expect(result.log.notes).toContain('contact sheet: 1 page of 15 shots each, A4');
  });

  it('embeds the stored picture, read from assets/ by its file name', async () => {
    const { exporter, reads } = rig();
    const { pdf, result } = await compileSheet(exporter);
    expect(reads).toEqual([`assets/${ASSET_FILE}`]);
    expect(imageCount(pdf)).toBe(1);
    expect(result.log.notes.some((note) => note.includes('caption'))).toBe(false);
  });

  it('embeds a picture once when several cards show it', async () => {
    const state = makeMediaProject();
    addShotNode(state, { parentId: MEDIA_IDS.shots, title: 'Again', id: 'n_AGAIN00001', now: OPENED, stored: { image: ASSET_ID } });
    const { exporter, reads } = rig({ state });
    const { pdf } = await compileSheet(exporter);
    expect(reads).toEqual([`assets/${ASSET_FILE}`]);
    expect(imageCount(pdf)).toBe(1);
  });

  it('has as many pages as the plan, and the plan fills A4 fifteen cards at a time', async () => {
    const state = manyShots(29); // 2 + 29 = 31 shots: 15 + 15 + 1
    const { pdf, result } = await compileSheet(rig({ state }).exporter);
    expect(pdf.getPageCount()).toBe(3);
    expect(result.log.blockCount).toBe(31);
    expect(result.log.notes).toContain('contact sheet: 3 pages of 15 shots each, A4');
  });

  it('shows the caption, and says why, when the picture’s bytes cannot be read', async () => {
    const { pdf, result } = await compileSheet(rig({ files: {} }).exporter);
    expect(pdf.getPageCount()).toBe(1);
    expect(imageCount(pdf)).toBe(0);
    expect(result.log.notes).toContain(`contact sheet: image ${ASSET_ID} could not be read, so its cards show the caption`);
  });

  it('shows the caption when the picture is not in assets/, and says so before anything is drawn', async () => {
    const { exporter, reads } = rig({ assets: new Map() });
    const { result } = await compileSheet(exporter);
    expect(reads).toEqual([]);
    expect(result.log.notes).toContain(`image ${ASSET_ID} is not in assets/, so its cards show the caption`);
  });

  it('shows the caption for a WebP picture, which the PDF cannot embed', async () => {
    const webp = new Map([[ASSET_ID, { id: ASSET_ID, fileName: `${ASSET_ID}.webp` }]]);
    const { exporter, reads } = rig({ assets: webp });
    const { pdf, result } = await compileSheet(exporter);
    expect(reads).toEqual([]);
    expect(imageCount(pdf)).toBe(0);
    expect(result.log.notes).toContain(`image ${ASSET_ID} is a WebP file, which the PDF cannot embed, so its cards show the caption`);
  });

  it('shows the caption when the stored bytes are not an image the engine can read', async () => {
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { pdf, result } = await compileSheet(rig({ files: { [`assets/${ASSET_FILE}`]: broken } }).exporter);
    expect(imageCount(pdf)).toBe(0);
    expect(result.log.notes.some((note) => note.startsWith(`contact sheet: image ${ASSET_ID} could not be embedded`))).toBe(true);
  });

  it('draws text outside Latin script as "?", and names it in the log, when the compile has no fallback font', async () => {
    const state = makeMediaProject();
    addShotNode(state, { parentId: MEDIA_IDS.shots, title: 'Tea', id: 'n_TEAHOUSE01', now: OPENED, stored: { action: '草堂 at dawn' } });
    const { result, pdf } = await compileSheet(rig({ state }).exporter);
    expect(result.log.notes).toContain(
      'contact sheet: 2 characters the PDF\'s built-in font cannot show, and this compile has no fallback font, were drawn as "?": 草 (U+8349), 堂 (U+5802)',
    );
    expect(embeddedFontFiles(pdf)).toHaveLength(0);
  });

  it('keeps accented Latin text, which the built-in font shows', async () => {
    const state = makeMediaProject();
    addShotNode(state, { parentId: MEDIA_IDS.shots, title: 'Café', id: 'n_CAFE000001', now: OPENED, stored: { action: 'Abeßer crosses the café — slowly…' } });
    const { result } = await compileSheet(rig({ state }).exporter);
    expect(result.log.notes.some((note) => note.includes('built-in font'))).toBe(false);
  });

  it('notes a shot with no metadata on record, whose card shows only its number', async () => {
    const state = makeMediaProject();
    addShotNode(state, { parentId: MEDIA_IDS.shots, title: 'Bare', id: 'n_BARE000001', now: OPENED, stored: {} });
    const shot = state.manifest.tree.find((node) => node.id === 'n_BARE000001') as { shot?: unknown } | undefined;
    if (shot !== undefined) delete shot.shot;
    const { result } = await compileSheet(rig({ state }).exporter);
    expect(result.log.notes).toContain('shot 3: no shot metadata is on record, so its card shows only its number');
  });

  it('refuses a selection with no shot, and writes nothing', async () => {
    await expect(rig().exporter.compile({ includeRootIds: ['research'] }, 'contact-sheet-pdf')).rejects.toThrow(
      'this compile as the contact sheet is refused: the selection holds no shot, so there is no contact sheet to draw',
    );
  });

  it('refuses through the images port when the assets folder cannot be listed', async () => {
    const exporter = createExporter({
      readState: () => makeMediaProject(),
      artifacts: new MemoryArtifactFs(),
      clock: { now: () => COMPILED_AT },
      assets: () => {
        throw new Error('EACCES: permission denied, scandir assets');
      },
    });
    await expect(exporter.compile({ includeRootIds: ['manuscript'] }, 'contact-sheet-pdf')).rejects.toThrow('EACCES');
  });
});

describe('the page size: A4 or Letter (storyboard.md §6)', () => {
  it('draws Letter pages, twelve cards each, when the request asks for Letter', async () => {
    const state = manyShots(11); // 13 shots: 12 + 1 on Letter
    const output = renderMedia({
      state,
      format: 'contact-sheet-pdf',
      includeRootIds: ['manuscript'],
      title: PROJECT_NAME,
      author: '',
      date: '2026-10-17',
      titlePage: false,
      base: PROJECT_NAME,
      assets: ASSETS,
      readAsset: async () => PNG_1X1,
      pageSize: 'Letter',
      at: COMPILED_AT,
    });
    expect(output.notes).toContain('contact sheet: 2 pages of 12 shots each, Letter');
    const render = output.files[0]?.render;
    if (render === undefined) throw new Error('the contact sheet has no render');
    const rendered = await render();
    const bytes = typeof rendered === 'object' && !(rendered instanceof Uint8Array) ? rendered.contents : rendered;
    const pdf = await PDFDocument.load(bytes as Uint8Array);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(1).getSize()).toEqual(LETTER);
  });

  it('takes the page size from a saved recipe through the bus, writes the PDF to exports/, and undo removes it', async () => {
    const state = makeMediaProject();
    const fs = new MemoryArtifactFs();
    const written = new Map<string, Uint8Array>();
    const bytes: ByteArtifacts = {
      writeBytes: async (path, data) => void written.set(path, data),
      removeBytes: async (path) => void written.delete(path),
    };
    const clock = { now: () => COMPILED_AT };
    const exporter = createExporter({
      readState: () => state,
      artifacts: fs,
      bytes,
      clock,
      assets: () => ASSETS,
      readAsset: async () => PNG_1X1,
    });
    await exporter.ready();
    const registry = createProjectCommandRegistry({ clock, exporter: exporter.commandPort() });
    const undo = createUndoStore({ dispatch: (command) => execute(command, bus, registry) });
    const bus: BusContext<ProjectState> = {
      state,
      view: createViewState(),
      read: () => state,
      undo,
      log: createActivityLog(),
      idempotency: createIdempotencyCache(),
      notify: () => {},
    };
    let serial = 0;
    const run = (name: Command['name'], params: Record<string, unknown>) => {
      serial += 1;
      return execute({ id: `cmd_SHEET${String(serial).padStart(6, '0')}`, name, params, issuedBy: 'user', createdAt: COMPILED_AT } as Command, bus, registry);
    };

    const saved = run('recipe.save', {
      name: 'Letter sheets',
      includeRootIds: [MEDIA_IDS.shots],
      format: 'contact-sheet-pdf',
      options: { pageSize: 'Letter' },
    });
    expect(saved.ok).toBe(true);
    expect(state.manifest.recipes?.find((recipe) => recipe.name === 'Letter sheets')?.options).toEqual({ pageSize: 'Letter' });

    const compiled = run('export.compile', { format: 'contact-sheet-pdf', recipeName: 'Letter sheets' });
    expect(compiled.ok).toBe(true);
    await exporter.idle();
    expect(exporter.failures()).toEqual([]);
    const path = 'exports/Letter sheets (contact sheet).pdf';
    const file = written.get(path);
    if (file === undefined) throw new Error(`nothing at ${path}: ${[...written.keys()].join(', ')}`);
    const pdf = await PDFDocument.load(file);
    expect(pdf.getPage(0).getSize()).toEqual(LETTER);

    // Undo removes the PDF from the byte store, where it was written, as it removes a DOCX or an EPUB.
    if (!compiled.ok) throw new Error('the compile was refused');
    expect(undo.undo(compiled.value.undoGroupId ?? '').ok).toBe(true);
    await exporter.idle();
    expect(written.has(path)).toBe(false);
    expect(exporter.failures()).toEqual([]);
  });

  it('refuses a page size that is not A4 or Letter at validate', () => {
    const state = makeMediaProject();
    const clock = { now: () => COMPILED_AT };
    const registry = createProjectCommandRegistry({ clock });
    const bus: BusContext<ProjectState> = {
      state,
      view: createViewState(),
      read: () => state,
      undo: createUndoStore({ dispatch: (command) => execute(command, bus, registry) }),
      log: createActivityLog(),
      idempotency: createIdempotencyCache(),
      notify: () => {},
    };
    const outcome = execute(
      {
        id: 'cmd_SHEETBAD001',
        name: 'recipe.save',
        params: { name: 'Odd', includeRootIds: ['manuscript'], format: 'contact-sheet-pdf', options: { pageSize: 'A3' } },
        issuedBy: 'user',
        createdAt: COMPILED_AT,
      } as Command,
      bus,
      registry,
    );
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.message).toContain('params.options.pageSize must be one of A4, Letter');
  });
});

describe('contact-sheet-pdf — text outside Latin script, in the Noto Sans CJK fallback font', () => {
  const CHINESE = '草堂的早晨，繁體字也行';
  const JAPANESE = 'ひらがなとカタカナ';
  const KOREAN = '한국어 문장';

  it('sets Chinese, Japanese and Korean text in the fallback font, and the text extracts back', async () => {
    const loader = countingLoader();
    const state = withAction(`${CHINESE} ${JAPANESE}`, KOREAN);
    const { pdf, result } = await compileSheet(rig({ state, files: {}, loadFallbackFont: loader.load }).exporter);
    expect(loader.calls()).toBe(1);
    const extracted = toUnicodeText(pdf);
    for (const char of `${CHINESE}${JAPANESE}${KOREAN}`.replace(/\s/g, '')) expect(extracted).toContain(char);
    expect(result.log.notes).toContain('contact sheet: text outside Latin script is set in Noto Sans CJK SC, embedded with only the glyphs it uses');
    expect(result.log.notes.some((note) => note.includes('drawn as "?"'))).toBe(false);
  });

  it('embeds only the glyphs the sheet uses, each with an outline', async () => {
    const state = withAction(`${CHINESE} ${JAPANESE} ${KOREAN}`);
    const { pdf, bytes } = await compileSheet(rig({ state, loadFallbackFont: loadCjkFontInNode }).exporter);
    const files = embeddedFontFiles(pdf);
    expect(files).toHaveLength(1);
    const subset = fontkit.create(files[0] as Uint8Array) as unknown as { numGlyphs: number; getGlyph(id: number): { path: { commands: unknown[] } } };
    const distinct = new Set(`${CHINESE}${JAPANESE}${KOREAN}`.replace(/\s/g, '')).size;
    // .notdef, plus one glyph per distinct character (a space is set in Helvetica).
    expect(subset.numGlyphs).toBe(distinct + 1);
    for (let id = 1; id < subset.numGlyphs; id += 1) expect(subset.getGlyph(id).path.commands.length).toBeGreaterThan(0);
    // The whole font is megabytes; the file carries a few kilobytes of it.
    expect(bytes.byteLength).toBeLessThan(40_000);
  });

  it('switches font inside a line of mixed text', async () => {
    const state = withAction('Mei 走进茶馆, orders 龙井, and waits.');
    const { pdf } = await compileSheet(rig({ state, loadFallbackFont: loadCjkFontInNode }).exporter);
    for (const char of '走进茶馆龙井') expect(toUnicodeText(pdf)).toContain(char);
    // Latin letters stay in Helvetica: the fallback subset maps none of them.
    expect(toUnicodeText(pdf)).not.toMatch(/[A-Za-z]/);
    // pdf-lib writes Helvetica text as WinAnsi hex: "Mei " and ", orders " are shown in Helvetica, between the CJK runs.
    const page = pageContent(pdf, 0);
    expect(page).toContain(`<${hexOf('Mei ')}> Tj`);
    expect(page).toContain(`<${hexOf(', orders ')}> Tj`);
  });

  it('never reads the font for a Latin-only sheet, whose bytes are those of a compile with no fallback font', async () => {
    const loader = countingLoader();
    const state = withAction('Abeßer crosses the café — slowly…');
    const withFont = await compileSheet(rig({ state, loadFallbackFont: loader.load }).exporter);
    const without = await compileSheet(rig({ state }).exporter);
    expect(loader.calls()).toBe(0);
    expect(embeddedFontFiles(withFont.pdf)).toHaveLength(0);
    expect([...withFont.bytes]).toEqual([...without.bytes]);
    expect(withFont.result.log.notes.some((note) => note.includes('Noto'))).toBe(false);
  });

  it('draws a character neither font has as "?", and names it in the log', async () => {
    const state = withAction('雨 🎬 and ⲁ');
    const { result, pdf } = await compileSheet(rig({ state, loadFallbackFont: loadCjkFontInNode }).exporter);
    expect(result.log.notes).toContain(
      'contact sheet: 2 characters neither the PDF\'s built-in font nor Noto Sans CJK SC can show were drawn as "?": 🎬 (U+1F3AC), ⲁ (U+2C81)',
    );
    expect(toUnicodeText(pdf)).toContain('雨');
  });

  it('draws text outside Latin script as "?", and says why, when the font cannot be read', async () => {
    const state = withAction('雨');
    const failing: FontLoader = async () => {
      throw new Error('offline');
    };
    const { result, pdf } = await compileSheet(rig({ state, loadFallbackFont: failing }).exporter);
    expect(result.log.notes).toContain(
      'contact sheet: 1 character the PDF\'s built-in font cannot show, and the fallback font could not be read (offline), was drawn as "?": 雨 (U+96E8)',
    );
    expect(embeddedFontFiles(pdf)).toHaveLength(0);
  });

  it('writes the same bytes for the same sheet and the same moment, with the fallback font', async () => {
    const state = withAction(`${CHINESE} ${KOREAN}`);
    const first = await compileSheet(rig({ state, loadFallbackFont: loadCjkFontInNode }).exporter);
    const second = await compileSheet(rig({ state, loadFallbackFont: loadCjkFontInNode }).exporter);
    expect([...first.bytes]).toEqual([...second.bytes]);
  });

  it('cuts a CJK line with an ellipsis inside the card, measured in the fallback font', async () => {
    const long = '山'.repeat(400);
    const planned = planContactSheet(withAction(long), ['manuscript'], () => ({ drawn: false, note: 'none' }));
    const drawn = await drawContactSheet({
      plan: planned.plan,
      pictures: new Map(),
      readPicture: async () => null,
      title: 'T',
      at: new Date(COMPILED_AT),
      loadFallbackFont: loadCjkFontInNode,
    });
    const card = planned.plan.pages[0]?.cards.find((placed) => placed.shotId === 'n_WORLD00001');
    const width = card?.frame.width ?? 0;
    // The plan breaks between the 山 with no space to break at, one em each at the 8 pt action size, and ends with an ellipsis.
    expect(card?.action.map((line) => line.text.replace('…', '')).join('')).toMatch(/^山+$/);
    expect(card?.action[1]?.text.endsWith('…')).toBe(true);
    // The emitter measures with the real fonts: Helvetica's ellipsis is one em too, so the last line gives up one more 山.
    const pdf = await PDFDocument.load(drawn.contents);
    const runs = [...pageContent(pdf, 0).matchAll(/<((?:0001)+)> Tj/g)].map((match) => (match[1] ?? '').length / 4);
    const perLine = Math.floor(width / 8);
    expect(runs).toEqual([perLine, perLine - 1]);
    expect(toUnicodeText(pdf)).toBe('山');
  });
});

describe('the fallback font file', () => {
  it('is found by the Node loader in @caotang/font-noto-cjk, and unpacks from WOFF to a TrueType font', async () => {
    expect(cjkFontCandidates().some((path) => path.endsWith(`font-noto-cjk/${CJK_FONT_FILE}`) || path.endsWith(`noto-sans-cjk/${CJK_FONT_FILE}`))).toBe(true);
    const woff = await loadCjkFontInNode();
    expect(new TextDecoder().decode(woff.slice(0, 4))).toBe('wOFF');
    const sfnt = await sfntFromWoff(woff);
    expect([...sfnt.slice(0, 4)]).toEqual([0, 1, 0, 0]);
    const font = fontkit.create(sfnt) as unknown as { familyName: string; hasGlyphForCodePoint(code: number): boolean };
    expect(font.familyName).toBe('Noto Sans CJK SC');
    for (const char of '中體かカ한Яα') expect(font.hasGlyphForCodePoint(char.codePointAt(0) ?? 0)).toBe(true);
  });

  it('leaves bytes that are not WOFF as they are', async () => {
    const bytes = new Uint8Array([0, 1, 0, 0, 9, 9]);
    expect(await sfntFromWoff(bytes)).toBe(bytes);
  });
});

describe('the emitter draws the plan it is given', () => {
  it('draws exactly the pages the plan lists, from a plan with no project around it', async () => {
    const state = manyShots(14); // 16 shots
    const planned = planContactSheet(state, ['manuscript'], () => ({ drawn: false, note: 'none' }), { headerTemplate: CONTACT_SHEET_HEADER });
    const drawn = await drawContactSheet({ plan: planned.plan, pictures: new Map(), readPicture: async () => null, title: 'T', at: new Date(COMPILED_AT) });
    const pdf = await PDFDocument.load(drawn.contents);
    expect(pdf.getPageCount()).toBe(planned.plan.pages.length);
    expect(drawn.notes).toEqual([]);
  });

  it('writes the same bytes for the same plan and the same moment', async () => {
    const planned = planContactSheet(makeMediaProject(), ['manuscript'], () => ({ drawn: true }));
    const input = { plan: planned.plan, pictures: planned.pictures, readPicture: async () => PNG_1X1, title: 'T', at: new Date(COMPILED_AT) };
    const first = await drawContactSheet(input);
    const second = await drawContactSheet(input);
    expect([...first.contents]).toEqual([...second.contents]);
  });
});

describe('fitToWidth and containIn', () => {
  const measure = (text: string): number => [...text].length * 5;

  it('leaves text that fits, and cuts text that does not with an ellipsis inside the width', () => {
    expect(fitToWidth('short', 100, measure)).toBe('short');
    const cut = fitToWidth('a much longer line of text', 60, measure);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(60);
    expect(fitToWidth('anything', 2, measure)).toBe('');
  });

  it('scales a picture to fit its box, centred and never stretched', () => {
    const box = { x: 10, y: 20, width: 160, height: 90 };
    expect(containIn(box, 1600, 900)).toEqual(box);
    const square = containIn(box, 100, 100);
    expect(square).toEqual({ x: 10 + (160 - 90) / 2, y: 20, width: 90, height: 90 });
    const tall = containIn(box, 90, 180);
    expect(tall.height).toBe(90);
    expect(tall.width).toBe(45);
    expect(containIn(box, 0, 0)).toEqual(box);
  });
});

describe('pdf-lib is loaded lazily', () => {
  it('is imported in the emitter with a dynamic import() and as types only, so the editor bundle never pays for it', () => {
    const source = readFileSync(resolve(__dirname, '../src/render-contact-sheet.ts'), 'utf8');
    expect(source).toMatch(/await import\('pdf-lib'\)/);
    expect(source).not.toMatch(/^import (?!type )[^\n]*from 'pdf-lib'/m);
    for (const file of ['exporter.ts', 'media.ts', 'index.ts']) {
      expect(readFileSync(resolve(__dirname, `../src/${file}`), 'utf8')).not.toMatch(/from 'pdf-lib'/);
    }
  });

  it('loads fontkit with a dynamic import() too, and keeps the Node font loader out of the package index', () => {
    const source = readFileSync(resolve(__dirname, '../src/render-contact-sheet.ts'), 'utf8');
    expect(source).toMatch(/import\('@pdf-lib\/fontkit'\)/);
    expect(source).not.toMatch(/^import [^\n]*from '@pdf-lib\/fontkit'/m);
    const woff = readFileSync(resolve(__dirname, '../src/cjk-font.ts'), 'utf8');
    expect(woff).toMatch(/await import\('fflate\/browser'\)/);
    expect(woff).not.toMatch(/^import (?!type )[^;]*from 'fflate[^']*';/m);
    for (const file of ['exporter.ts', 'media.ts', 'index.ts', 'render-contact-sheet.ts', 'cjk-font.ts']) {
      const text = readFileSync(resolve(__dirname, `../src/${file}`), 'utf8');
      expect(text).not.toMatch(/from '\.\/cjk-font-node\.js'/);
      expect(text).not.toMatch(/from 'node:/);
    }
  });
});
