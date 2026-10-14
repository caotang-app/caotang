/**
 * The §3.3 mdast handler table, built for the Tiptap preflight.
 *
 * ## Why this table is smaller than §3.3
 *
 * §3.3 classifies *every* mdast type, degrade rows included. This table
 * registers handlers for the **exact class only**, and lets the library's own
 * defaults handle everything else — on purpose. A preflight's job is to
 * *measure* what remark-prosemirror 0.1.5 does; a degrade handler written here
 * would replace the behaviour under test with Caotang's intent, which measures
 * nothing. The degrade rows are recorded as declared expectations
 * (`DEGRADE_CLASS`) and the corpus reports what the library actually did.
 *
 * ## The one shape the exported factories cannot express — in BOTH directions
 *
 * `toPmNode` / `toPmMark` build from `state.all(node)` (i.e. `children`), and
 * `fromPmNode` / `fromPmMark` emit `children`. The two mdast types that carry
 * **`value`** instead of `children` — `inlineCode` and `code` — therefore
 * cannot be expressed with any of the four factories. Measured consequence on
 * the serialize side: a table built with `fromPmMark('inlineCode')` produces
 * `` `` `` for the input `` `code` `` — the content is silently lost, because
 * remark-stringify reads `node.value`, finds it absent, and emits an empty
 * span. Both leaves are hand-written below. This is a property of the
 * library's API surface, not a Caotang workaround; `corpus.test.ts` pins it.
 */
import type { NodeType, Schema } from '@tiptap/pm/model';
import type {
  Code,
  Delete,
  Emphasis,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  Strong,
} from 'mdast';
import { fromPmMark, fromPmNode, toPmMark, toPmNode } from '@handlewithcare/remark-prosemirror';

/** §3.3's `LossWarning`, verbatim. */
export interface LossWarning {
  code: 'unsupported-node' | 'lossy-attribute' | 'lossy-structure';
  mdastType: string;
  position?: { line: number; column: number };
  detail: string;
}

/**
 * §5 step 2's stringify options — **as §5 writes them**.
 *
 * Kept verbatim, and asserted to throw, because two of the five values are not
 * legal inputs. `mdast-util-to-markdown` takes a single *character* for
 * `rule` (`*`, `-`, `_`) and for `fence` (`` ` ``, `~`) and expands it to the
 * three-character form itself: `rule: '*'` already serializes to `***`, and
 * `fence: '`'` already serializes to ` ``` `. Passing the *output* spelling
 * `'***'` / `'```'` throws. See `CANONICAL_STRINGIFY_OPTIONS` below for the
 * values the pipeline actually runs, and §2's findings F1.
 */
export const SPEC_STRINGIFY_OPTIONS = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  rule: '***',
  fence: '```',
  listItemIndent: 'one',
} as const;

/**
 * The options the pipeline runs: §5's *intent* — output spellings `-`, ` ``` `,
 * `***` — expressed as the single characters the library accepts.
 *
 * Every value is §5's own, with the three-character rule/fence spellings
 * reduced to the one character remark expands them from. `bullet`,
 * `emphasis`, `strong` and `listItemIndent` are already single tokens and are
 * byte-for-byte §5's..
 */
export const CANONICAL_STRINGIFY_OPTIONS = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  rule: '*',
  fence: '`',
  listItemIndent: 'one',
} as const;

/** Alias kept for the pipeline import sites. */
export const STRINGIFY_OPTIONS = CANONICAL_STRINGIFY_OPTIONS;

/**
 * The exact-class mdast types §3.3 maps, as data. The corpus asserts every one
 * of them is registered, so a type added to §3.3 and forgotten here is a red
 * test rather than a silent degrade.
 */
export const EXACT_CLASS_MDAST_TYPES = [
  'paragraph',
  'text',
  'blockquote',
  'heading',
  'list',
  'listItem',
  'emphasis',
  'strong',
  'inlineCode',
  'delete',
  'link',
  'image',
  'break',
  'thematicBreak',
  'code',
] as const;

/**
 * §3.3's degrade rows, as declared expectations rather than as handlers — the
 * diff between these and what 0.1.5 does is §2's result table.
 */
export const DEGRADE_CLASS: ReadonlyArray<{
  mdastType: string;
  specBehavior: string;
  warningCode: LossWarning['code'];
  /** What 0.1.5 actually does, measured 2026-10-01. See §2 finding F5. */
  measured: string;
}> = [
  {
    mdastType: 'html',
    specBehavior: 'literal text paragraph; warning unsupported-node',
    warningCode: 'unsupported-node',
    measured:
      'block-level HTML throws `Invalid content for node doc` — the default handler emits an inline text node where the doc requires block+',
  },
  {
    mdastType: 'table',
    specBehavior: 'each row serialized as one paragraph line; warning lossy-structure',
    warningCode: 'lossy-structure',
    measured: 'throws `unknown markdown node: table` — the library has no degrade path',
  },
  {
    mdastType: 'footnoteDefinition',
    specBehavior: 'definition appended as paragraph; warning unsupported-node',
    warningCode: 'unsupported-node',
    measured: 'silently dropped (`ignore`) — content lost with no warning',
  },
  {
    mdastType: 'footnoteReference',
    specBehavior: 'inline [^n] text kept; warning unsupported-node',
    warningCode: 'unsupported-node',
    measured: 'throws `unknown markdown node: footnoteReference`',
  },
  {
    mdastType: 'definition',
    specBehavior: 'expanded to direct link/image; warning lossy-attribute',
    warningCode: 'lossy-attribute',
    measured: 'silently dropped (`ignore`) — the definition itself; the reference resolves through the library default',
  },
  {
    mdastType: 'linkReference',
    specBehavior: 'expanded to direct link; warning lossy-attribute',
    warningCode: 'lossy-attribute',
    measured:
      'resolves to a real link via the library default, but emits no warning — the loss taxonomy is entirely Caotang-side',
  },
  {
    mdastType: 'imageReference',
    specBehavior: 'expanded to direct image; warning lossy-attribute',
    warningCode: 'lossy-attribute',
    measured: 'throws `unknown markdown node: imageReference`',
  },
];

/** A `list` is one mdast type and two PM nodes, so it needs a real handler. */
const listHandler =
  (schema: Schema) =>
  (node: List, _parent: never, state: PmState) => {
    const type: NodeType = node.ordered ? schema.nodes.ordered_list! : schema.nodes.bullet_list!;
    const attrs = node.ordered ? { start: node.start ?? 1 } : null;
    return type.createAndFill(attrs, state.all(node) as never);
  };

/**
 * Parse handlers — the exact class only.
 *
 * Node names are §3.1's, not Tiptap's: §3.1 names them `bullet_list` /
 * `ordered_list` / `horizontal_rule` / `hard_break` / `code_block`, and
 * `schema.ts` uses those names. The mdast side keeps its own vocabulary
 * (`list` with an `ordered` flag, `thematicBreak`, `break`, `code`). The two
 * namespaces differ; §3.1 is the contract and the schema follows it.
 *
 * The return type is spelled out rather than left as `ReturnType<…>`: the
 * library's handler signature mentions a `State` type it does not export, so an
 * inferred return type would make this module's own declarations unnamed
 * (TS4023). Declaring the shape here is also the honest statement of the
 * contract — every key is an mdast type, and `state` is only used by the two
 * hand-written handlers.
 */
export interface ParseHandlers {
  paragraph: (node: never, parent: never, state: never) => unknown;
  heading: (node: Heading, parent: never, state: never) => unknown;
  blockquote: (node: never, parent: never, state: never) => unknown;
  list: (node: List, parent: never, state: PmState) => unknown;
  listItem: (node: never, parent: never, state: never) => unknown;
  image: (node: Image, parent: never, state: never) => unknown;
  break: (node: never, parent: never, state: never) => unknown;
  thematicBreak: (node: never, parent: never, state: never) => unknown;
  emphasis: (node: Emphasis, parent: never, state: never) => unknown;
  strong: (node: Strong, parent: never, state: never) => unknown;
  delete: (node: Delete, parent: never, state: never) => unknown;
  link: (node: Link, parent: never, state: never) => unknown;
  inlineCode: (node: InlineCode) => unknown;
  code: (node: Code) => unknown;
}

/**
 * The slice of the library's `State` this file actually uses. The real type is
 * not exported by 0.1.5, so it is described rather than imported: `all` is the
 * only member any handler here calls, and the `list` handler is the only one
 * that needs it.
 */
export interface PmState {
  all: (parent: List) => unknown[];
}

export const createParseHandlers = (schema: Schema): ParseHandlers => ({
  // --- container nodes: the exported factories do the work ----------------
  paragraph: toPmNode(schema.nodes.paragraph!),
  heading: toPmNode(schema.nodes.heading!, (node: Heading) => ({ level: node.depth })),
  blockquote: toPmNode(schema.nodes.blockquote!),
  list: listHandler(schema),
  listItem: toPmNode(schema.nodes.list_item!),
  image: toPmNode(schema.nodes.image!, (node: Image) => ({
    src: node.url,
    alt: node.alt ?? null,
    title: node.title ?? null,
  })),
  break: toPmNode(schema.nodes.hard_break!),
  thematicBreak: toPmNode(schema.nodes.horizontal_rule!),

  // --- marks ---------------------------------------------------------------
  emphasis: toPmMark(schema.marks.em!),
  strong: toPmMark(schema.marks.strong!),
  delete: toPmMark(schema.marks.strike!),
  link: toPmMark(schema.marks.link!, (node: Link) => ({
    href: node.url,
    title: node.title ?? null,
  })),

  // --- the two `value`-carrying leaves, hand-written ------------------------
  // `inlineCode` is a text node carrying the `code` MARK (§3.2 makes inline
  // code a mark, not a node).
  inlineCode: (node: InlineCode) => [schema.text(node.value, [schema.marks.code!.create()])],
  code: (node: Code) =>
    schema.nodes.code_block!.create(
      { language: node.lang ?? null },
      node.value ? schema.text(node.value) : undefined,
    ),
});

/**
 * Serialize handlers, keyed on the same §3.1/§3.2 PM names.
 *
 * Takes no schema, unlike `createParseHandlers` — the serialize side never
 * constructs a node, it only reads one, so a `schema` parameter here would be
 * an unused argument pretending to be a dependency.
 */
export const createSerializeHandlers = () => ({
  paragraph: fromPmNode('paragraph'),
  heading: fromPmNode('heading', (node) => ({
    // mdast types `depth` as the literal union 1–6; §3.1's `level` attr is a
    // plain number. The cast is at the boundary between the two, not a blanket
    // `any`, and remark-parse only ever produces 1–6 from a `#`×N run.
    depth: node.attrs.level as Heading['depth'],
  })),
  blockquote: fromPmNode('blockquote'),
  bullet_list: fromPmNode('list', () => ({ ordered: false, spread: false })),
  ordered_list: fromPmNode('list', (node) => ({
    ordered: true,
    start: (node.attrs.start as number | null) ?? 1,
    spread: false,
  })),
  list_item: fromPmNode('listItem'),
  horizontal_rule: fromPmNode('thematicBreak'),
  hard_break: fromPmNode('break'),
  image: fromPmNode('image', (node) => ({
    url: node.attrs.src as string,
    alt: (node.attrs.alt as string | null) ?? undefined,
    title: (node.attrs.title as string | null) ?? undefined,
  })),

  // The two `value`-carrying leaves again, on the way out. `fromPmMark` and
  // `fromPmNode` both emit `children`, which remark-stringify does not read for
  // these two types — it reads `value`.
  code_block: (node: { textContent: string; attrs: Record<string, unknown> }) => ({
    type: 'code' as const,
    value: node.textContent,
    lang: (node.attrs.language as string | null) ?? undefined,
  }),
  code: (_mark: unknown, _parent: unknown, children: Array<{ value?: string }>) => ({
    type: 'inlineCode' as const,
    value: children.map((child) => child.value ?? '').join(''),
  }),

  // --- marks ---------------------------------------------------------------
  em: fromPmMark('emphasis'),
  strong: fromPmMark('strong'),
  strike: fromPmMark('delete'),
  link: fromPmMark('link', (mark) => ({
    url: mark.attrs.href as string,
    title: (mark.attrs.title as string | null) ?? undefined,
  })),
});

export type SerializeHandlers = ReturnType<typeof createSerializeHandlers>;
export { fromPmMark, fromPmNode, toPmMark, toPmNode };
export type { Delete, Emphasis, Strong };
