/**
 * The screenplay element model — [screenplay.md §2.3](../../../docs/architecture/screenplay.md),
 * the parse layer's output.
 *
 * `text` is the writer's text with the forcing character stripped (`.`, `!`, `@`,
 * `>`). `forced` records that the character was there, so the serialiser can write
 * it back. Multi-line elements (action, dialogue, notes, boneyard) join their source
 * lines with `\n`. A `title_page` is only ever the first element of a parse.
 *
 * The `forced` flag on `action` and `character`, and the `dual` flag on `character`,
 * are additive to the spec's union. Each is present only when true.
 */

/** A half-open span `[from, to)` into the source text the parser was given. */
export interface TextRange {
  readonly from: number;
  readonly to: number;
}

export type ScreenplayElement =
  | { readonly type: 'scene_heading'; readonly text: string; readonly forced: boolean }
  | { readonly type: 'action'; readonly text: string; readonly forced?: boolean }
  | { readonly type: 'character'; readonly text: string; readonly dual?: boolean; readonly forced?: boolean }
  | { readonly type: 'parenthetical'; readonly text: string }
  | { readonly type: 'dialogue'; readonly text: string }
  | { readonly type: 'transition'; readonly text: string; readonly forced: boolean }
  | { readonly type: 'centered'; readonly text: string }
  | { readonly type: 'page_break' }
  | { readonly type: 'section'; readonly depth: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'synopsis'; readonly text: string }
  | { readonly type: 'note'; readonly text: string }
  | { readonly type: 'boneyard'; readonly text: string }
  | { readonly type: 'title_page'; readonly entries: Readonly<Record<string, string>> };

export type ScreenplayElementType = ScreenplayElement['type'];

/** An element with the span it was read from. The parser attaches one to every element. */
export type LocatedElement = ScreenplayElement & { readonly range: TextRange };
