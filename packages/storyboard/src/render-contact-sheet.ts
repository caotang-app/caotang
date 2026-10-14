/**
 * The contact sheet — [storyboard.md](../../../docs/architecture/storyboard.md) §6, `ContactSheetPdfRenderer`.
 *
 * Two halves, and the split is the point of the module:
 *
 * - The **page plan** is pure. Cards, geometry and text go in; the position of every card, picture,
 *   chip and line of text comes out, in points with the origin at the top left. The plan has all the
 *   structure a contact sheet has (page count, capacity, reading order, what sits inside the page), and
 *   the tests check it directly.
 * - The **emitter** turns a plan into PDF bytes. It is an injected port. storyboard.md §6 gives this
 *   renderer the screenplay PDF's pattern, and screenplay.md §5.3 leaves that library's pick to the C28
 *   benchmark gate. So no library is pinned here. {@link ContactSheetPdfRenderer.render} refuses with
 *   that reason until an emitter is supplied; {@link ContactSheetPdfRenderer.build} works without one,
 *   and returns the plan and the image bytes an emitter would be given.
 *
 * Text width is estimated, not measured. Helvetica averages about half an em per character, and the
 * layout uses {@link SHEET_LAYOUT}`.charWidthEm` of 0.55 so a wrapped line stays inside its card. An
 * estimate that errs wide is the safe error here: it wraps early rather than overflow.
 */

import { nodeById, type ArtifactFs, type ProjectState } from '@caotang/store';

import { readImage, type LoadedImage } from './assets.js';
import { isStoryboardFolder, specRowOf } from './model.js';
import { shotFieldOf } from './nodes.js';
import { exportNumbers, shotsInBinderOrder } from './ordering.js';
import { readShotMeta, storedOf } from './shot-meta.js';
import { ok, refuse, type StoryboardResult } from './result.js';

/** Page sizes in points: A4 and US Letter. */
export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

/** The layout constants. Exported so a test, or a later layout, reads the numbers the plan was built from. */
export const SHEET_LAYOUT = {
  margin: 36,
  headerHeight: 36,
  gutter: 12,
  columns: 3,
  /** Image height over width: 16:9 landscape cards, the shape a storyboard frame has. */
  imageAspect: 9 / 16,
  /** Text lines of action each card shows. The spec's "action line" is one line; two lines keep a useful excerpt. */
  actionLines: 2,
  gap: 4,
  lineHeight: 10,
  chipFontSize: 8,
  specFontSize: 8,
  actionFontSize: 8,
  headerFontSize: 11,
  charWidthEm: 0.55,
  chipHeight: 12,
} as const;

export const ELLIPSIS = '…';

/** Estimated width of a run of text at a font size. See the header on why this is an estimate. */
export function measureText(text: string, fontSize: number): number {
  return [...text].length * fontSize * SHEET_LAYOUT.charWidthEm;
}

function charsPerLine(maxWidth: number, fontSize: number): number {
  return Math.max(1, Math.floor(maxWidth / (fontSize * SHEET_LAYOUT.charWidthEm)));
}

function cutTo(text: string, length: number): string {
  return [...text].slice(0, length).join('');
}

/**
 * Wraps text to a width in at most `maxLines` lines. Words wrap on spaces, a word longer than a line
 * is broken, and text past the last line is cut with an ellipsis on that line, so a reader sees that
 * more follows. Deterministic: the same text, width and size always give the same lines.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const capacity = charsPerLine(maxWidth, fontSize);
  const lines: string[] = [];
  let line = '';
  const flush = (): void => {
    if (line !== '') lines.push(line);
    line = '';
  };

  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    let rest = word;
    while ([...rest].length > capacity) {
      flush();
      lines.push(cutTo(rest, capacity));
      rest = [...rest].slice(capacity).join('');
    }
    const candidate = line === '' ? rest : `${line} ${rest}`;
    if ([...candidate].length <= capacity) {
      line = candidate;
    } else {
      flush();
      line = rest;
    }
  }
  flush();

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? '';
  kept[maxLines - 1] = `${cutTo(last, Math.max(0, capacity - 1))}${ELLIPSIS}`;
  return kept;
}

/** One card's content, before it has a position. */
export interface SheetCard {
  readonly shotId: string;
  readonly shotNumber: number;
  readonly specRow: string;
  readonly action: string;
  /** Whether the image loaded. When false the card draws a placeholder with {@link placeholder}. */
  readonly image: boolean;
  readonly placeholder: string;
}

export interface PlacedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A run of text at a baseline. `y` is the baseline, measured down from the top of the page. */
export interface PlacedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
}

export interface PlacedCard {
  readonly shotId: string;
  readonly shotNumber: number;
  /** The whole card: image, chip, spec row and action lines. */
  readonly frame: PlacedRect;
  /** The image box, or the placeholder box when there is no image. */
  readonly image: PlacedRect;
  readonly hasImage: boolean;
  readonly chip: PlacedRect;
  readonly chipText: PlacedText;
  readonly spec: PlacedText;
  readonly action: readonly PlacedText[];
  readonly placeholder?: PlacedText;
}

export interface SheetPage {
  /** 0-based. */
  readonly index: number;
  readonly title: PlacedText;
  readonly pageLabel: PlacedText;
  readonly cards: readonly PlacedCard[];
  /** Set on the single page of an empty sheet. */
  readonly emptyNote?: PlacedText;
}

export interface SheetGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly headerHeight: number;
  readonly gutter: number;
  readonly columns: number;
}

export interface SheetPlan {
  readonly pageSize: PageSize;
  readonly geometry: SheetGeometry;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardsPerPage: number;
  readonly pages: readonly SheetPage[];
}

export interface PaginateOptions {
  readonly pageSize?: PageSize;
  readonly columns?: number;
  /** The header text, already filled. Cut to one line, and to the room the page label leaves. */
  readonly headerText?: string;
  readonly emptyText?: string;
}

/**
 * The page plan for a list of cards. Cards fill each page row by row, left to right then down, in the
 * order given, which is binder order. A sheet with no cards is one page with a note, not zero pages, so
 * a printed sheet always has something on it.
 */
export function paginate(cards: readonly SheetCard[], options: PaginateOptions = {}): SheetPlan {
  const pageSize = options.pageSize ?? 'A4';
  const size = PAGE_SIZES[pageSize];
  const columns = options.columns ?? SHEET_LAYOUT.columns;
  if (!Number.isInteger(columns) || columns < 1 || columns > 6) {
    throw new Error('contact-sheet columns must be a whole number from 1 to 6');
  }

  const { margin, headerHeight, gutter, gap, lineHeight, actionLines, imageAspect } = SHEET_LAYOUT;
  const geometry: SheetGeometry = { width: size.width, height: size.height, margin, headerHeight, gutter, columns };
  const contentWidth = size.width - 2 * margin;
  const cardWidth = (contentWidth - gutter * (columns - 1)) / columns;
  const imageHeight = cardWidth * imageAspect;
  const cardHeight = imageHeight + gap + lineHeight + actionLines * lineHeight + gap;
  const contentHeight = size.height - 2 * margin - headerHeight;
  const rows = Math.floor((contentHeight + gutter) / (cardHeight + gutter));
  if (rows < 1) throw new Error('the page is too small for one contact-sheet card at this column count');
  const cardsPerPage = rows * columns;

  const pageCount = Math.max(1, Math.ceil(cards.length / cardsPerPage));
  const headerRoom = contentWidth - 12;
  const pages: SheetPage[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const label = `Page ${index + 1} of ${pageCount}`;
    const labelWidth = measureText(label, SHEET_LAYOUT.headerFontSize);
    const headerLine = wrapText(options.headerText ?? '', Math.max(0, headerRoom - labelWidth), SHEET_LAYOUT.headerFontSize, 1)[0] ?? '';
    const page = cards.slice(index * cardsPerPage, (index + 1) * cardsPerPage);
    const placed = page.map((card, slot) => placeCard(card, slot, columns, cardWidth, cardHeight, imageHeight));
    const emptyNote =
      index === 0 && cards.length === 0
        ? {
            text: options.emptyText ?? 'No shots yet.',
            x: margin,
            y: margin + headerHeight + 24,
            fontSize: SHEET_LAYOUT.headerFontSize,
          }
        : undefined;
    pages.push({
      index,
      title: { text: headerLine, x: margin, y: margin + SHEET_LAYOUT.headerFontSize, fontSize: SHEET_LAYOUT.headerFontSize },
      pageLabel: {
        text: label,
        x: size.width - margin - labelWidth,
        y: margin + SHEET_LAYOUT.headerFontSize,
        fontSize: SHEET_LAYOUT.headerFontSize,
      },
      cards: placed,
      ...(emptyNote !== undefined ? { emptyNote } : {}),
    });
  }
  return { pageSize, geometry, cardWidth, cardHeight, cardsPerPage, pages };
}

/** Places one card in its slot on a page, and everything inside it. */
function placeCard(
  card: SheetCard,
  slot: number,
  columns: number,
  cardWidth: number,
  cardHeight: number,
  imageHeight: number,
): PlacedCard {
  const { margin, headerHeight, gutter, gap, lineHeight, actionLines, chipFontSize, chipHeight, specFontSize, actionFontSize } = SHEET_LAYOUT;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const x = margin + column * (cardWidth + gutter);
  const y = margin + headerHeight + row * (cardHeight + gutter);

  const chipText = String(card.shotNumber);
  const chipWidth = Math.max(14, measureText(chipText, chipFontSize) + 6);
  const specY = y + imageHeight + gap + specFontSize;
  const specText = wrapText(card.specRow, cardWidth, specFontSize, 1)[0] ?? '';
  const actionText = wrapText(card.action, cardWidth, actionFontSize, actionLines);
  const placeholder = card.image
    ? undefined
    : {
        text: wrapText(card.placeholder, cardWidth - 2 * gap, actionFontSize, 1)[0] ?? '',
        x: x + gap,
        y: y + imageHeight / 2 + actionFontSize / 2,
        fontSize: actionFontSize,
      };

  return {
    shotId: card.shotId,
    shotNumber: card.shotNumber,
    frame: { x, y, width: cardWidth, height: cardHeight },
    image: { x, y, width: cardWidth, height: imageHeight },
    hasImage: card.image,
    chip: { x: x + gap, y: y + gap, width: chipWidth, height: chipHeight },
    chipText: { text: chipText, x: x + gap + 3, y: y + gap + chipFontSize + 1, fontSize: chipFontSize },
    spec: { text: specText, x, y: specY, fontSize: specFontSize },
    action: actionText.map((text, index) => ({
      text,
      x,
      y: specY + lineHeight + index * lineHeight,
      fontSize: actionFontSize,
    })),
    ...(placeholder !== undefined ? { placeholder } : {}),
  };
}

/** The filled template. `{name}` is replaced; a name with no value is left as written, so a typo shows (the exporter's rule). */
export function fillTemplate(pattern: string, values: Readonly<Record<string, string>>): string {
  return pattern.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? (values[name] ?? '') : whole,
  );
}

export interface ContactSheetOptions {
  readonly pageSize?: PageSize;
  readonly columns?: number;
  /** A header template. `{project}`, `{storyboard}` and `{date}` are filled. Defaults to `{storyboard}`. */
  readonly headerTemplate?: string;
  readonly project?: string;
  readonly storyboard?: string;
  /** The date `{date}` shows, as YYYY-MM-DD. Defaults to today. Pass it in tests. */
  readonly now?: Date;
}

/** What an emitter is given: the plan, and the image bytes its cards point at. */
export interface ContactSheetDocument {
  readonly plan: SheetPlan;
  readonly images: ReadonlyMap<string, LoadedImage>;
  readonly notes: readonly string[];
}

/** The PDF port. A later package supplies the library; nothing in this module names one. */
export interface ContactSheetEmitter {
  emit(document: ContactSheetDocument): Promise<Uint8Array>;
}

/** The contact sheet renderer, as the exporter's recipe names it. The emitter is optional by design (see the header). */
export class ContactSheetPdfRenderer {
  readonly id = 'contact-sheet-pdf';
  readonly mime = 'application/pdf';

  constructor(private readonly emitter?: ContactSheetEmitter) {}

  /**
   * The plan and the images, with no PDF. Works without an emitter, so the layout can be seen and
   * tested before the library is chosen.
   */
  async build(
    fs: ArtifactFs,
    state: ProjectState,
    selection?: readonly string[],
    options: ContactSheetOptions = {},
  ): Promise<ContactSheetDocument> {
    const notes: string[] = [];
    for (const id of selection ?? []) {
      if (nodeById(state, id) === undefined) notes.push(`no node "${id}" in the project, so nothing was drawn for it`);
    }

    const shots = shotsInBinderOrder(state, selection);
    const numbers = exportNumbers(shots);
    const images = new Map<string, LoadedImage>();
    const missing = new Set<string>();
    const cards: SheetCard[] = [];

    for (const node of shots) {
      const number = numbers.get(node.id) ?? 0;
      const read = readShotMeta(shotFieldOf(node));
      let hasImage = false;
      const assetId = read.meta.image;
      if (assetId !== undefined) {
        const loaded = images.get(assetId) ?? (await readImage(fs, assetId));
        if (loaded !== undefined) {
          images.set(assetId, loaded);
          hasImage = true;
        } else if (!missing.has(assetId)) {
          missing.add(assetId);
          notes.push(`image ${assetId} could not be read from assets/, so its cards draw a placeholder`);
        }
      }
      cards.push({
        shotId: node.id,
        shotNumber: number,
        specRow: specRowOf(storedOf(shotFieldOf(node)) ?? {}),
        action: read.meta.action ?? '',
        image: hasImage,
        placeholder: read.meta.imageAlt ?? 'No image',
      });
    }

    const single = selection?.length === 1 && selection[0] !== undefined ? nodeById(state, selection[0]) : undefined;
    const storyboardName = options.storyboard ?? (single !== undefined && isStoryboardFolder(single) ? single.title : 'All shots');
    const now = options.now ?? new Date();
    const headerText = fillTemplate(options.headerTemplate ?? '{storyboard}', {
      project: options.project ?? '',
      storyboard: storyboardName,
      date: now.toISOString().slice(0, 10),
    });

    const plan = paginate(cards, {
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.columns !== undefined ? { columns: options.columns } : {}),
      headerText,
    });
    return { plan, images, notes };
  }

  /** The PDF bytes, when an emitter is wired. Refused with the reason otherwise, never a silent empty file. */
  async render(
    fs: ArtifactFs,
    state: ProjectState,
    selection?: readonly string[],
    options: ContactSheetOptions = {},
  ): Promise<StoryboardResult<{ readonly bytes: Uint8Array; readonly pages: number; readonly notes: readonly string[] }>> {
    if (this.emitter === undefined) {
      return refuse(
        'pdf-engine-not-wired',
        'the contact sheet is laid out, but no PDF engine is wired yet: the library is chosen by the C28 benchmark. Use the shot list CSV for now.',
      );
    }
    const document = await this.build(fs, state, selection, options);
    const bytes = await this.emitter.emit(document);
    return ok({ bytes, pages: document.plan.pages.length, notes: document.notes });
  }
}
