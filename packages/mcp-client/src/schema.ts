/**
 * The argument check behind `mcp.invoke` — [extensibility.md §6](../../../docs/architecture/extensibility.md):
 * *"validate = model args against the pinned inputSchema (schema violations listed with
 * JSON paths)"*.
 *
 * A checker for the JSON Schema 2020-12 vocabulary that tool input schemas use. The SDK
 * ships validators too, but they return one string for every violation. The spec asks for
 * each violation at its own path, and a caller that has to read paths out of prose cannot
 * build the per-op failure list §2 requires. `test/schema.test.ts` checks this file's
 * verdicts against the SDK's own AJV over a corpus, so the two agree on what is valid.
 *
 * **It fails closed.** A keyword that restricts a value and that this file does not check
 * (`unevaluatedProperties`, a `$ref` into another document, a malformed keyword) returns an
 * `unsupported` verdict, and the call is refused. A keyword that only annotates (`title`,
 * `description`, `examples`, `default`, and `format`, which 2020-12 treats as an annotation
 * unless a dialect asserts it) is ignored, as JSON Schema says it must be. `format` is
 * therefore not enforced here: the server validates again, and this check is a pre-flight.
 *
 * **The server's schema drives the work, so the work is bounded.** A schema may share subschemas
 * (a DAG with no cycle, so the depth limit never fires), and then the walk is exponential in its
 * depth; one call makes at most {@link WORK_BUDGET} checks. A pattern is run only if it repeats no
 * group that already repeats or alternates (`(a+)+`, `(a|aa)+`), because the engine cannot be
 * stopped partway through such a match. Both refusals are `unsupported`, so the call is refused by name.
 */

import { canonicalJson } from './canonical.js';
import { hasOwn, isRecord } from './util.js';

/** One violation: where it is (a JSON pointer, `''` for the root) and what is wrong there. */
export interface SchemaFailure {
  readonly path: string;
  readonly message: string;
}

export type SchemaVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: readonly SchemaFailure[] }
  | { readonly ok: false; readonly unsupported: string };

/** Keywords that restrict a value and that this checker does not implement. Their presence refuses the call. */
const UNSUPPORTED_KEYWORDS: readonly string[] = [
  'unevaluatedProperties',
  'unevaluatedItems',
  '$dynamicRef',
  '$recursiveRef',
  '$dynamicAnchor',
  '$recursiveAnchor',
];

/** How deep `$ref` and nesting may go before the checker gives up rather than recurse forever. */
const MAX_DEPTH = 64;

/**
 * The most checks one call may make, counted per (subschema, value) visit. At about a microsecond a visit this is
 * roughly a tenth of a second on the UI thread, and it is far above what any real argument needs.
 */
export const WORK_BUDGET = 100_000;

/** Thrown inside the walk, caught at the top, and turned into an `unsupported` verdict. */
class Unsupported extends Error {
  readonly keyword: string;
  constructor(keyword: string) {
    super(keyword);
    this.name = 'Unsupported';
    this.keyword = keyword;
  }
}

interface Context {
  readonly root: unknown;
  readonly patterns: Map<string, RegExp>;
  /** Checks made so far in this call, against {@link WORK_BUDGET}. */
  visits: number;
}

/** Checks one value against one schema. Every violation is collected, not just the first. */
export function validateArguments(schema: unknown, value: unknown): SchemaVerdict {
  const failures: SchemaFailure[] = [];
  const context: Context = { root: schema, patterns: new Map(), visits: 0 };
  try {
    check(schema, value, '', context, 0, failures);
  } catch (error) {
    if (error instanceof Unsupported) return { ok: false, unsupported: error.keyword };
    throw error;
  }
  if (failures.length === 0) return { ok: true };
  // Ordered by path, so the same arguments always produce the same list in the same order.
  failures.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: false, failures };
}

/** The message as a sentence, for the model: `/entries/0/name must be string`. */
export function describeFailure(failure: SchemaFailure): string {
  return `${failure.path === '' ? 'the arguments' : failure.path} ${failure.message}`;
}

function check(schema: unknown, value: unknown, path: string, context: Context, depth: number, out: SchemaFailure[]): void {
  if (depth > MAX_DEPTH) throw new Unsupported('a schema nested deeper than the checker follows');
  context.visits += 1;
  if (context.visits > WORK_BUDGET) throw new Unsupported('a check that exceeds the work budget');
  if (schema === true) return;
  if (schema === false) {
    out.push({ path, message: 'is not allowed' });
    return;
  }
  if (!isRecord(schema)) throw new Unsupported('a schema that is not an object');

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (hasOwn(schema, keyword)) throw new Unsupported(keyword);
  }

  if (hasOwn(schema, '$ref')) {
    check(resolveReference(context.root, schema['$ref']), value, path, context, depth + 1, out);
  }

  checkType(schema, value, path, out);
  checkEnumAndConst(schema, value, path, out);

  if (typeof value === 'string') checkString(schema, value, path, context, out);
  if (typeof value === 'number') checkNumber(schema, value, path, out);
  if (Array.isArray(value)) checkArray(schema, value, path, context, depth, out);
  if (isRecord(value)) checkObject(schema, value, path, context, depth, out);

  checkCombinators(schema, value, path, context, depth, out);
}

function checkType(schema: Record<string, unknown>, value: unknown, path: string, out: SchemaFailure[]): void {
  if (!hasOwn(schema, 'type')) return;
  const declared = schema['type'];
  const wellFormed = typeof declared === 'string' || (Array.isArray(declared) && declared.every((item) => typeof item === 'string'));
  if (!wellFormed) throw new Unsupported('a "type" that is not a name or a list of names');
  const names = typeof declared === 'string' ? [declared] : (declared as string[]);
  if (!names.some((name) => matchesType(name, value))) {
    out.push({ path, message: `must be ${names.join(' or ')}` });
  }
}

function matchesType(name: string, value: unknown): boolean {
  switch (name) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      throw new Unsupported(`type "${name}"`);
  }
}

function checkEnumAndConst(schema: Record<string, unknown>, value: unknown, path: string, out: SchemaFailure[]): void {
  if (hasOwn(schema, 'const') && canonicalJson(value) !== canonicalJson(schema['const'])) {
    out.push({ path, message: `must be ${JSON.stringify(schema['const'])}` });
  }
  if (hasOwn(schema, 'enum')) {
    const allowed = arrayKeyword(schema, 'enum');
    if (!allowed.some((candidate) => canonicalJson(candidate) === canonicalJson(value))) {
      out.push({ path, message: `must be one of ${allowed.map((candidate) => JSON.stringify(candidate)).join(', ')}` });
    }
  }
}

function checkString(schema: Record<string, unknown>, value: string, path: string, context: Context, out: SchemaFailure[]): void {
  const length = [...value].length;
  const min = numberKeyword(schema, 'minLength');
  const max = numberKeyword(schema, 'maxLength');
  if (min !== undefined && length < min) out.push({ path, message: `must be at least ${min} characters` });
  if (max !== undefined && length > max) out.push({ path, message: `must be at most ${max} characters` });
  if (hasOwn(schema, 'pattern')) {
    const pattern = stringKeyword(schema, 'pattern');
    if (!compile(pattern, context).test(value)) out.push({ path, message: `must match the pattern ${pattern}` });
  }
}

function checkNumber(schema: Record<string, unknown>, value: number, path: string, out: SchemaFailure[]): void {
  const minimum = numberKeyword(schema, 'minimum');
  const maximum = numberKeyword(schema, 'maximum');
  // Draft-4 wrote the exclusive bounds as booleans beside `minimum` and `maximum`; 2020-12 writes them as numbers.
  const exclusiveMinimum = hasOwn(schema, 'exclusiveMinimum') ? schema['exclusiveMinimum'] : undefined;
  const exclusiveMaximum = hasOwn(schema, 'exclusiveMaximum') ? schema['exclusiveMaximum'] : undefined;
  for (const bound of [exclusiveMinimum, exclusiveMaximum]) {
    if (bound !== undefined && typeof bound !== 'number' && typeof bound !== 'boolean') {
      throw new Unsupported('an exclusive bound that is neither a number nor a boolean');
    }
  }
  if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) {
    out.push({ path, message: `must be > ${exclusiveMinimum}` });
  } else if (exclusiveMinimum === true && minimum !== undefined && value <= minimum) {
    out.push({ path, message: `must be > ${minimum}` });
  } else if (minimum !== undefined && value < minimum) {
    out.push({ path, message: `must be >= ${minimum}` });
  }
  if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) {
    out.push({ path, message: `must be < ${exclusiveMaximum}` });
  } else if (exclusiveMaximum === true && maximum !== undefined && value >= maximum) {
    out.push({ path, message: `must be < ${maximum}` });
  } else if (maximum !== undefined && value > maximum) {
    out.push({ path, message: `must be <= ${maximum}` });
  }
  const multiple = numberKeyword(schema, 'multipleOf');
  if (multiple !== undefined) {
    if (multiple <= 0) throw new Unsupported('multipleOf that is not positive');
    const quotient = value / multiple;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9 * Math.max(1, Math.abs(quotient))) {
      out.push({ path, message: `must be a multiple of ${multiple}` });
    }
  }
}

function checkArray(schema: Record<string, unknown>, value: unknown[], path: string, context: Context, depth: number, out: SchemaFailure[]): void {
  // Positional schemas: 2020-12's `prefixItems` (with `items` for the rest), Draft-7's array-form `items`
  // (with `additionalItems` for the rest), or one `items` schema for every element.
  let positional: readonly unknown[] = [];
  let rest: { readonly schema: unknown } | undefined;
  if (hasOwn(schema, 'prefixItems')) {
    positional = arrayKeyword(schema, 'prefixItems');
    if (hasOwn(schema, 'items')) rest = { schema: schema['items'] };
  } else if (Array.isArray(schema['items'])) {
    positional = schema['items'];
    if (hasOwn(schema, 'additionalItems')) rest = { schema: schema['additionalItems'] };
  } else if (hasOwn(schema, 'items')) {
    rest = { schema: schema['items'] };
  }
  value.forEach((item, index) => {
    const child = childPath(path, index);
    if (index < positional.length) {
      check(positional[index], item, child, context, depth + 1, out);
    } else if (rest !== undefined) {
      check(rest.schema, item, child, context, depth + 1, out);
    }
  });

  const min = numberKeyword(schema, 'minItems');
  const max = numberKeyword(schema, 'maxItems');
  if (min !== undefined && value.length < min) out.push({ path, message: `must have at least ${min} items` });
  if (max !== undefined && value.length > max) out.push({ path, message: `must have at most ${max} items` });
  if (schema['uniqueItems'] === true) {
    const seen = new Set(value.map((item) => canonicalJson(item)));
    if (seen.size !== value.length) out.push({ path, message: 'must not contain duplicate items' });
  }
  if (hasOwn(schema, 'contains')) {
    const matching = value.filter((item) => collect(schema['contains'], item, path, context, depth).length === 0).length;
    const atLeast = numberKeyword(schema, 'minContains') ?? 1;
    const atMost = numberKeyword(schema, 'maxContains');
    if (matching < atLeast) out.push({ path, message: `must contain at least ${atLeast} matching item${atLeast === 1 ? '' : 's'}` });
    if (atMost !== undefined && matching > atMost) out.push({ path, message: `must contain at most ${atMost} matching items` });
  }
}

function checkObject(schema: Record<string, unknown>, value: Record<string, unknown>, path: string, context: Context, depth: number, out: SchemaFailure[]): void {
  const properties = recordKeyword(schema, 'properties');
  const patterns = recordKeyword(schema, 'patternProperties');
  const requiredNames = hasOwn(schema, 'required') ? stringList(schema['required'], 'required') : [];
  for (const name of requiredNames) {
    if (!hasOwn(value, name)) out.push({ path: childPath(path, name), message: 'is required' });
  }

  for (const [key, child] of Object.entries(value)) {
    let matched = false;
    if (properties !== undefined && hasOwn(properties, key)) {
      matched = true;
      check(properties[key], child, childPath(path, key), context, depth + 1, out);
    }
    if (patterns !== undefined) {
      for (const [source, subschema] of Object.entries(patterns)) {
        if (compile(source, context).test(key)) {
          matched = true;
          check(subschema, child, childPath(path, key), context, depth + 1, out);
        }
      }
    }
    if (!matched && hasOwn(schema, 'additionalProperties')) {
      const additional = schema['additionalProperties'];
      if (additional === false) out.push({ path: childPath(path, key), message: 'is not allowed' });
      else if (additional !== true) check(additional, child, childPath(path, key), context, depth + 1, out);
    }
  }

  if (hasOwn(schema, 'propertyNames')) {
    for (const key of Object.keys(value)) {
      check(schema['propertyNames'], key, childPath(path, key), context, depth + 1, out);
    }
  }

  const count = Object.keys(value).length;
  const min = numberKeyword(schema, 'minProperties');
  const max = numberKeyword(schema, 'maxProperties');
  if (min !== undefined && count < min) out.push({ path, message: `must have at least ${min} properties` });
  if (max !== undefined && count > max) out.push({ path, message: `must have at most ${max} properties` });

  const dependentRequired = recordKeyword(schema, 'dependentRequired');
  const dependencies = recordKeyword(schema, 'dependencies');
  const dependentSchemas = recordKeyword(schema, 'dependentSchemas');
  if (dependentRequired !== undefined) {
    for (const [key, names] of Object.entries(dependentRequired)) {
      if (!hasOwn(value, key)) continue;
      for (const name of stringList(names, 'dependentRequired')) {
        if (!hasOwn(value, name)) out.push({ path: childPath(path, name), message: 'is required' });
      }
    }
  }
  if (dependencies !== undefined) {
    for (const [key, dependency] of Object.entries(dependencies)) {
      if (!hasOwn(value, key)) continue;
      if (Array.isArray(dependency)) {
        for (const name of stringList(dependency, 'dependencies')) {
          if (!hasOwn(value, name)) out.push({ path: childPath(path, name), message: 'is required' });
        }
      } else {
        check(dependency, value, path, context, depth + 1, out);
      }
    }
  }
  if (dependentSchemas !== undefined) {
    for (const [key, subschema] of Object.entries(dependentSchemas)) {
      if (hasOwn(value, key)) check(subschema, value, path, context, depth + 1, out);
    }
  }
}

function checkCombinators(schema: Record<string, unknown>, value: unknown, path: string, context: Context, depth: number, out: SchemaFailure[]): void {
  if (hasOwn(schema, 'allOf')) {
    for (const subschema of arrayKeyword(schema, 'allOf')) check(subschema, value, path, context, depth + 1, out);
  }
  if (hasOwn(schema, 'anyOf')) {
    const branches = arrayKeyword(schema, 'anyOf');
    if (!branches.some((branch) => collect(branch, value, path, context, depth).length === 0)) {
      out.push({ path, message: 'must match at least one of the permitted shapes' });
    }
  }
  if (hasOwn(schema, 'oneOf')) {
    const branches = arrayKeyword(schema, 'oneOf');
    const matching = branches.filter((branch) => collect(branch, value, path, context, depth).length === 0).length;
    if (matching === 0) out.push({ path, message: 'must match one of the permitted shapes' });
    if (matching > 1) out.push({ path, message: 'must match exactly one of the permitted shapes' });
  }
  if (hasOwn(schema, 'not') && collect(schema['not'], value, path, context, depth).length === 0) {
    out.push({ path, message: 'must not match the excluded shape' });
  }
  if (hasOwn(schema, 'if')) {
    const condition = collect(schema['if'], value, path, context, depth).length === 0;
    if (condition && hasOwn(schema, 'then')) check(schema['then'], value, path, context, depth + 1, out);
    if (!condition && hasOwn(schema, 'else')) check(schema['else'], value, path, context, depth + 1, out);
  }
}

/** The failures one subschema produces for one value, kept apart from the caller's list. */
function collect(subschema: unknown, value: unknown, path: string, context: Context, depth: number): SchemaFailure[] {
  const failures: SchemaFailure[] = [];
  check(subschema, value, path, context, depth + 1, failures);
  return failures;
}

/** A local `$ref`: `#` or a JSON pointer into the same document. Anything else is refused. */
function resolveReference(root: unknown, ref: unknown): unknown {
  if (typeof ref !== 'string' || !ref.startsWith('#')) throw new Unsupported('a $ref to another document');
  const fragment = ref.slice(1);
  if (fragment === '') return root;
  if (!fragment.startsWith('/')) throw new Unsupported('a $ref that is not a JSON pointer');
  let current: unknown = root;
  for (const raw of fragment.slice(1).split('/')) {
    const segment = decodePointerSegment(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (isRecord(current) && hasOwn(current, segment)) {
      current = current[segment];
    } else {
      throw new Unsupported('a $ref that does not resolve');
    }
  }
  return current;
}

function decodePointerSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Unsupported('a $ref with a malformed escape');
  }
}

function compile(source: string, context: Context): RegExp {
  const cached = context.patterns.get(source);
  if (cached !== undefined) return cached;
  if (hasNestedRepetition(source)) throw new Unsupported('a pattern with nested repetition');
  let compiled: RegExp;
  try {
    compiled = new RegExp(source, 'u');
  } catch {
    try {
      compiled = new RegExp(source);
    } catch {
      throw new Unsupported('a pattern that is not a valid regular expression');
    }
  }
  context.patterns.set(source, compiled);
  return compiled;
}

/**
 * Whether a pattern repeats a group that already repeats, or alternates, somewhere inside it: `(a+)+`, `(a|aa)+`.
 * Such a match can take time exponential in the length of the value, and the engine has no budget to stop it, so
 * the pattern is refused rather than run. The scan is deliberately plain. It refuses some safe patterns (a repeated
 * group of digits and dots, for one), and it does not bound a pattern whose cost is polynomial (`.*.*`).
 */
function hasNestedRepetition(source: string): boolean {
  const open: { repeats: boolean; alternates: boolean }[] = [];
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      open.push({ repeats: false, alternates: false });
    } else if (char === '|') {
      const group = open[open.length - 1];
      if (group !== undefined) group.alternates = true;
    } else if (char === ')') {
      const group = open.pop();
      if (group === undefined) continue;
      const after = repetitionAt(source, index + 1);
      if (after === 'repeat' && (group.repeats || group.alternates)) return true;
      const parent = open[open.length - 1];
      if (parent !== undefined) {
        parent.repeats = parent.repeats || group.repeats || after === 'repeat';
        parent.alternates = parent.alternates || group.alternates;
      }
    } else if (repetitionAt(source, index) === 'repeat') {
      const group = open[open.length - 1];
      if (group !== undefined) group.repeats = true;
    }
  }
  return false;
}

/** The quantifier that starts at `index`: `repeat` for one that can match many times, `optional` for `?` and `{0,1}`. */
function repetitionAt(source: string, index: number): 'none' | 'optional' | 'repeat' {
  const char = source.charAt(index);
  if (char === '*' || char === '+') return 'repeat';
  if (char === '?') return 'optional';
  if (char !== '{') return 'none';
  const range = /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(index, index + 32));
  if (range === null) return 'none';
  const max = range[2] === undefined ? Number(range[1]) : range[3] === '' || range[3] === undefined ? Infinity : Number(range[3]);
  return max > 1 ? 'repeat' : 'optional';
}

function childPath(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function numberKeyword(schema: Record<string, unknown>, key: string): number | undefined {
  if (!hasOwn(schema, key)) return undefined;
  const value = schema[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Unsupported(`${key} that is not a number`);
  return value;
}

function stringKeyword(schema: Record<string, unknown>, key: string): string {
  const value = schema[key];
  if (typeof value !== 'string') throw new Unsupported(`${key} that is not a string`);
  return value;
}

function arrayKeyword(schema: Record<string, unknown>, key: string): readonly unknown[] {
  const value = schema[key];
  if (!Array.isArray(value)) throw new Unsupported(`${key} that is not a list`);
  return value;
}

function recordKeyword(schema: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  if (!hasOwn(schema, key)) return undefined;
  const value = schema[key];
  if (!isRecord(value)) throw new Unsupported(`${key} that is not an object`);
  return value;
}

function stringList(value: unknown, keyword: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Unsupported(`${keyword} that is not a list of names`);
  }
  return value as string[];
}
