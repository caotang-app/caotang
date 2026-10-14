/**
 * The preflight's measuring instrument.
 *
 * A preflight that only asserts "it worked" measures nothing (C19: the
 * library's own suite is 5 shapes). What the sixth acceptance criterion asks
 * for is a **per-construct result table**, so this module records, for one
 * corpus entry: the mdast types the parse actually saw, the PM node/mark
 * types it produced, the round-trip bytes, and whether the outcome was stable.
 *
 * The important property: this reports what happened, it does not assert what
 * should have happened. The assertions live in the test, where a deviation is
 * a finding to be written into §2 — not an exception to be caught here.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { fromProseMirror, remarkProseMirror } from '@handlewithcare/remark-prosemirror';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Root as MdastRoot } from 'mdast';
import { caotangSchema } from './schema.js';
import {
  CANONICAL_STRINGIFY_OPTIONS,
  createParseHandlers,
  createSerializeHandlers,
} from './handlers.js';

/** §3.3's loss classes, in the order the spec states them. */
export type Class = 'exact' | 'degrade' | 'lost';

export interface ConstructResult {
  name: string;
  group: string;
  /** The mdast types remark-parse actually produced for this input. */
  mdastTypes: string[];
  /** The PM node type names the parse produced. */
  pmNodes: string[];
  /** The PM mark type names present anywhere in the resulting doc. */
  pmMarks: string[];
  /** `serialize(parse(input))`. */
  output: string;
  /** §3.3's bar, measured against the newline-terminated body projection. */
  byteIdentical: boolean;
  /** The same comparison without the trailing-newline allowance. */
  byteIdenticalRaw: boolean;
  /** §3.3's real bar: same input → same bytes, always. */
  deterministic: boolean;
  /** The construct's fate, derived from the round-trip — not declared. */
  outcome: Class;
  /** A human-readable note for §2's table. Empty when nothing is notable. */
  note: string;
  /** The error the library threw, if it threw instead of degrading. */
  threw: string | null;
}

/**
 * A minimal mdast walker. Written here rather than taken from `unist-util-visit`
 * because that package is not in §2's pin table, and the install criterion is
 * "the §2 pin table exact" — the preflight must not widen the dependency
 * surface it is auditing. The corpus trees are small and this is the only walk.
 */
const collectTypes = (node: unknown, into: Set<string>): void => {
  if (!node || typeof node !== 'object') return;
  const typed = node as { type?: unknown; children?: unknown };
  if (typeof typed.type === 'string') into.add(typed.type);
  if (Array.isArray(typed.children)) {
    for (const child of typed.children) collectTypes(child, into);
  }
};

const mdastTypesOf = (tree: MdastRoot): string[] => {
  const types = new Set<string>();
  collectTypes(tree, types);
  return [...types].sort();
};

const pmShapeOf = (pm: PmNode): { nodes: string[]; marks: string[] } => {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  pm.descendants((node) => {
    nodes.add(node.type.name);
    for (const mark of node.marks) marks.add(mark.type.name);
  });
  return { nodes: [...nodes].sort(), marks: [...marks].sort() };
};

/**
 * §5 **Save**: PM → mdast (`fromProseMirror`, sync) → body projection through
 * remark-stringify with §5's dialect options.
 *
 * `remarkGfm` is on the **serialize** chain as well as the parse chain, and
 * that is a finding rather than a detail: §5 step 2 names only `remarkStringify`.
 * Measured without it, `fromPmMark('delete')` produces a well-formed
 * `delete` mdast node and remark-stringify then throws
 * `Cannot handle unknown node `delete`` — so §3.2's `strike` mark cannot be
 * written without it. `remark-gfm` registers the `delete` *serializer*; the
 * parse side alone is not enough. See §2 finding F2.
 */
export const serialize = (pm: PmNode): string => {
  const handlers = createSerializeHandlers();
  const tree = fromProseMirror(pm, {
    schema: caotangSchema,
    nodeHandlers: handlers as never,
    markHandlers: handlers as never,
  });
  return String(
    unified()
      .use(remarkGfm)
      .use(remarkStringify, { ...CANONICAL_STRINGIFY_OPTIONS })
      .stringify(tree),
  );
};

/** §5 **Load**: remark-parse + remark-gfm + the §3.3 handler table → PM doc. */
export const parse = async (body: string): Promise<PmNode> => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkProseMirror, {
      schema: caotangSchema,
      handlers: createParseHandlers(caotangSchema) as never,
    });
  // `remarkProseMirror` installs a **compiler** (`this.compiler = …`), not a
  // transformer. `run()` applies transformers only, so `run(parse(body))`
  // returns the mdast tree unchanged and any code written that way silently
  // gets mdast back where a PM doc was expected. The compiler is reached
  // through `stringify()`; `run()` first is what makes this correct if a
  // future transformer is ever added to the chain.
  // `run()` is typed as returning unist's base `Node`; with no transformers
  // installed it hands back the very `Root` that `parse` produced, which is
  // what `stringify` takes. The cast is at that one boundary.
  const tree = (await processor.run(processor.parse(body))) as MdastRoot;
  return processor.stringify(tree) as unknown as PmNode;
};

/** Strip every character the dialect is allowed to re-spell, for comparison. */
const semantic = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The body projection is newline-terminated — every real `doc.<id>.md` body is,
 * and remark-stringify always emits a trailing `\n`. Comparing a fixture that
 * has no trailing newline against output that does would make **every** corpus
 * entry "not byte-identical" and the flag would carry no information, so the
 * comparison is made against the newline-terminated form. The *un*normalized
 * comparison is still reported, as `byteIdenticalRaw`.
 */
const newlineTerminated = (s: string): string => (s.endsWith('\n') ? s : `${s}\n`);

/**
 * Round-trip one corpus entry and report what happened.
 *
 * `outcome` is DERIVED from the bytes, never declared by the fixture — so a
 * handler-table bug surfaces as a downgrade in the result table instead of
 * being papered over by a fixture that claims a class it did not achieve.
 */
export const measure = async (entry: {
  name: string;
  group: string;
  input: string;
}): Promise<ConstructResult> => {
  // A separate processor for the mdast tree: the one above has
  // `remarkProseMirror` installed, whose compiler returns a PM doc, so asking
  // it for the raw tree would be asking the wrong question.
  const tree = unified().use(remarkParse).use(remarkGfm).parse(entry.input) as MdastRoot;

  let pm: PmNode | null = null;
  let threw: string | null = null;
  let output = '';
  try {
    pm = await parse(entry.input);
    output = serialize(pm);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }

  const shape = pm ? pmShapeOf(pm) : { nodes: [], marks: [] };
  const byteIdenticalRaw = threw === null && output === entry.input;
  const byteIdentical = threw === null && output === newlineTerminated(entry.input);
  const deterministic = threw === null && output === serialize(await parse(entry.input));

  let outcome: Class;
  let note = '';
  if (threw !== null) {
    outcome = 'lost';
    note = 'library threw instead of degrading';
  } else if (byteIdentical) {
    outcome = 'exact';
  } else if (semantic(output) === semantic(entry.input)) {
    outcome = 'exact';
    note = 'byte-normalized to the canonical dialect spelling';
  } else if (semantic(output).length === 0) {
    outcome = 'lost';
    note = 'round-trip produced no content';
  } else {
    outcome = 'degrade';
    note = 'content changed across the round-trip';
  }

  return {
    name: entry.name,
    group: entry.group,
    mdastTypes: mdastTypesOf(tree),
    pmNodes: shape.nodes,
    pmMarks: shape.marks,
    output,
    byteIdentical,
    byteIdenticalRaw,
    deterministic,
    outcome,
    note,
    threw,
  };
};
