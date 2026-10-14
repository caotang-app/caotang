/**
 * Final Draft's XML — [screenplay.md §5.2](../../../docs/architecture/screenplay.md).
 *
 * Import is the v0.1-of-track half. Every paragraph is typed, so the import is mechanical:
 * FDX paragraphs become the element model, the element model becomes Fountain text, and
 * the Fountain importer maps that onto sections and scenes. Emit is the v0.2-of-track half,
 * and it is written to D11's answer: typed paragraphs, the title
 * page, `SceneProperties` Length and Page where pagination computed them, scene numbers kept
 * verbatim from the heading, and the page-number header layer from the paginator's pages.
 * Revision marks, locked pages and their colours are never emitted, since the model stores none.
 *
 * The scene-number attribute and the header element are the two encodings D11 calls
 * implementation-time residue. Their source read (Screenplain's FDX writer, rsdoiel/fdx) is not
 * complete, so both are unverified against a Final Draft file (a known gap).
 *
 * FDX is a flat, machine-written format with no entities beyond the five predefined ones
 * and numeric references, so it is read here with a small reader rather than a parser
 * dependency (the vendor-if-dormant posture).
 */

import { printedText, sceneNumberOf, stripSceneNumber } from './classify.js';
import { importFountainScript, type ImportedScript } from './import.js';
import { paginate, sceneLengths } from './paginate.js';
import { parseFountain } from './parse.js';
import { serialiseFountain } from './serialise.js';
import type { FlatBlock } from './flat-block.js';
import type { ScreenplayElement } from './types.js';
import { renderFountain, type FountainRenderOptions } from './render-fountain.js';

export const FDX_MIME = 'application/xml';

/** One `<Paragraph>` as read from the file. */
export interface FdxParagraph {
  readonly type: string;
  readonly text: string;
  readonly alignment: string | null;
  /** From `SceneProperties Length`, in eighths of a page. Null when absent. */
  readonly lengthEighths: number | null;
  /** The index of the `DualDialogue` container this paragraph sits in, or null. */
  readonly container: number | null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#')) {
      const code = body.startsWith('#x') ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/([A-Za-z:]+)="([^"]*)"/g)) {
    out[m[1] ?? ''] = decodeEntities(m[2] ?? '');
  }
  return out;
}

/** Reads the paragraphs of an FDX document in order, with their container and scene length. */
export function parseFdxParagraphs(xml: string): FdxParagraph[] {
  // Self-closing paragraphs carry no text and would otherwise swallow the next paragraph's body.
  const source = xml.replace(/<Paragraph\b[^>]*\/>/g, '');
  const containers: [number, number][] = [];
  for (const m of source.matchAll(/<DualDialogue\b[^>]*>[\s\S]*?<\/DualDialogue>/g)) {
    const start = m.index ?? 0;
    containers.push([start, start + m[0].length]);
  }
  const paragraphs: FdxParagraph[] = [];
  for (const m of source.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const start = m.index ?? 0;
    const attrs = attributes(m[1] ?? '');
    const body = (m[2] ?? '').replace(/<Text\b[^>]*\/>/g, '');
    const text = [...body.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((t) => decodeEntities(t[1] ?? '')).join('');
    const scene = /<SceneProperties\b([^>]*)>/.exec(body);
    const length = scene !== null ? Number.parseInt(attributes(scene[1] ?? '').Length ?? '', 10) : Number.NaN;
    const containerAt = containers.findIndex(([from, to]) => start >= from && start < to);
    paragraphs.push({
      type: attrs.Type ?? 'Action',
      text,
      alignment: attrs.Alignment ?? null,
      lengthEighths: Number.isFinite(length) ? length : null,
      container: containerAt === -1 ? null : containerAt,
    });
  }
  return paragraphs;
}

/** FDX paragraph types to elements. The second cue of a dual-dialogue pair takes the dual marker. */
function fdxElements(paragraphs: readonly FdxParagraph[], notices: string[]): ScreenplayElement[] {
  const elements: ScreenplayElement[] = [];
  const cuesSeen = new Map<number, number>();
  for (const p of paragraphs) {
    const text = p.text.trim();
    if (text === '') continue;
    switch (p.type) {
      case 'Scene Heading':
        elements.push({ type: 'scene_heading', text, forced: false });
        break;
      case 'Action':
      case 'Shot':
        elements.push({ type: 'action', text });
        break;
      case 'General':
        elements.push(p.alignment === 'Center' ? { type: 'centered', text } : { type: 'action', text });
        break;
      case 'Character': {
        let dual = false;
        if (p.container !== null) {
          const seen = (cuesSeen.get(p.container) ?? 0) + 1;
          cuesSeen.set(p.container, seen);
          dual = seen > 1;
        }
        elements.push(dual ? { type: 'character', text, dual: true } : { type: 'character', text });
        break;
      }
      case 'Parenthetical':
        elements.push({ type: 'parenthetical', text: text.startsWith('(') ? text : `(${text})` });
        break;
      case 'Dialogue':
        elements.push({ type: 'dialogue', text });
        break;
      case 'Transition':
        elements.push({ type: 'transition', text, forced: false });
        break;
      default:
        notices.push(`Paragraph type "${p.type}" imported as action.`);
        elements.push({ type: 'action', text });
    }
  }
  return elements;
}

/**
 * Imports an FDX script. The paragraphs become Fountain, then the Fountain importer maps
 * them onto scenes. Each scene takes the `SceneProperties Length` of its own heading.
 */
export function importFdx(xml: string): ImportedScript {
  const notices: string[] = [];
  const paragraphs = parseFdxParagraphs(xml);
  const elements = fdxElements(paragraphs, notices);
  const script = importFountainScript(serialiseFountain(elements));
  const lengths = paragraphs.filter((p) => p.type === 'Scene Heading' && p.text.trim() !== '').map((p) => p.lengthEighths);
  let next = 0;
  const nodes = script.nodes.map((node) => {
    if (node.kind !== 'scene' || node.heading === null) return node;
    const lengthEighths = lengths[next] ?? null;
    next += 1;
    return { ...node, lengthEighths };
  });
  return { titlePage: script.titlePage, nodes, notices: [...notices, ...script.notices] };
}

export interface FdxRenderResult {
  readonly xml: string;
  /** What was left out, in order: never silent (screenplay.md §5.2, D11). */
  readonly notes: readonly string[];
}

/** One `<Paragraph>` line. `attrs` is a string of attributes, each with its leading space. */
function paragraphXml(type: string, text: string, properties: string, attrs: string): string {
  return `<Paragraph Type="${type}"${attrs}>${properties}<Text>${escapeXml(text)}</Text></Paragraph>`;
}

/**
 * Renders the flattened blocks as an FDX document, to D11's emit set.
 * Annotations do not print, so each paragraph carries its printed text (`printedText`).
 */
export function renderFdx(blocks: readonly FlatBlock[], opts: FountainRenderOptions): FdxRenderResult {
  const fountain = renderFountain(blocks, opts);
  const parsed = parseFountain(fountain.text);
  // Pagination supplies the SceneProperties Length and Page, and the header's page numbers: D11 emits
  // only what has been computed.
  const pages = paginate(parsed.elements, { titlePage: false });
  const lengths = new Map(sceneLengths(pages).map((s) => [s.scene, s] as const));
  const notes = [...fountain.notes];

  const titleEntries = parsed.elements.find((el) => el.type === 'title_page');
  const titleXml: string[] = [];
  if (titleEntries !== undefined && titleEntries.type === 'title_page') {
    const paragraphs = Object.entries(titleEntries.entries).map(
      ([key, value]) => `      ${paragraphXml('Action', `${key}: ${value}`, '', ' Alignment="Center"')}`,
    );
    titleXml.push('  <TitlePage>', '    <Content>', ...paragraphs, '    </Content>', '  </TitlePage>');
  }

  const body: string[] = [];
  let scene = 0;
  let sequentialDual = false;
  for (const el of parsed.elements) {
    const text = 'text' in el ? printedText(el.text) : '';
    switch (el.type) {
      case 'scene_heading': {
        const length = lengths.get(scene);
        const printed = printedText(el.text);
        const number = sceneNumberOf(printed);
        const properties = length !== undefined ? `<SceneProperties Length="${length.lengthEighths}" Page="${length.page}"/>` : '';
        // The number is kept verbatim from the heading. Its attribute name is unverified (a known gap).
        const attrs = number !== null ? ` Number="${escapeXml(number)}"` : '';
        body.push(paragraphXml('Scene Heading', stripSceneNumber(printed), properties, attrs));
        scene += 1;
        break;
      }
      case 'action':
        if (text !== '') body.push(paragraphXml('Action', text.replace(/\n/g, ' '), '', ''));
        break;
      case 'character':
        if (el.dual === true) sequentialDual = true;
        if (text !== '') body.push(paragraphXml('Character', text, '', ''));
        break;
      case 'parenthetical':
        if (text !== '') body.push(paragraphXml('Parenthetical', text, '', ''));
        break;
      case 'dialogue':
        if (text !== '') body.push(paragraphXml('Dialogue', text.replace(/\n/g, ' '), '', ''));
        break;
      case 'transition':
        if (text !== '') body.push(paragraphXml('Transition', text, '', ''));
        break;
      case 'centered':
        if (text !== '') body.push(paragraphXml('General', text, '', ' Alignment="Center"'));
        break;
      // Sections, synopses, notes, boneyards and page breaks are never emitted (screenplay.md §2.2, §5.2).
      default:
        break;
    }
  }
  if (sequentialDual) {
    notes.push('Dual dialogue written as sequential paragraphs: the DualDialogue container is not emitted.');
  }

  // The page-number layer (D11). Page 1 carries no number (screenplay.md §5.3), so the first numbered page is 2.
  const firstNumbered = pages.find((page) => page.number >= 2)?.number ?? 2;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="3">',
    ...titleXml,
    '  <Content>',
    ...body.map((line) => `    ${line}`),
    '  </Content>',
    `  <HeaderAndFooter FirstPage="${firstNumbered}">`,
    '    <Header>',
    '      <Paragraph Alignment="Right"><DynamicLabel Type="Page"/></Paragraph>',
    '    </Header>',
    '  </HeaderAndFooter>',
    '</FinalDraft>',
  ].join('\n');
  return { xml: `${xml}\n`, notes };
}

export interface FdxRenderer {
  emit(blocks: readonly FlatBlock[], opts: FountainRenderOptions): Promise<Blob>;
}

export function createFdxRenderer(): FdxRenderer {
  return {
    async emit(blocks, opts) {
      const { xml } = renderFdx(blocks, opts);
      return new Blob([xml], { type: FDX_MIME });
    },
  };
}
