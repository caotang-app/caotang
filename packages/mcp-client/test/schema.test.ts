/**
 * The argument checker. Two kinds of claim: the verdicts agree with the SDK's own AJV (the
 * differential test, which is what makes this checker trustworthy rather than merely
 * self-consistent), and the failures name the exact JSON path of each violation (what the spec asks
 * `mcp.invoke` to list). The fail-closed cases are asserted separately: a schema this file cannot
 * check is refused, never passed.
 */

import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { describe, expect, it } from 'vitest';

import { describeFailure, validateArguments } from '../src/index.js';

interface Case {
  readonly name: string;
  readonly schema: unknown;
  readonly instances: readonly unknown[];
}

const corpus: readonly Case[] = [
  {
    name: 'required properties and scalar types',
    schema: { type: 'object', properties: { q: { type: 'string' }, n: { type: 'integer', minimum: 1 } }, required: ['q'] },
    instances: [{ q: 'a' }, { q: 'a', n: 1 }, { q: 'a', n: 0 }, { n: 1 }, { q: 3 }, { q: 'a', n: 1.5 }, [], 'x', null, { q: 'a', extra: 1 }],
  },
  {
    name: 'additionalProperties: false',
    schema: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
    instances: [{ a: 'x' }, { a: 'x', b: 1 }, {}],
  },
  {
    name: 'additionalProperties as a schema',
    schema: { type: 'object', additionalProperties: { type: 'number' } },
    instances: [{ a: 1 }, { a: 'x' }, {}],
  },
  {
    name: 'patternProperties with additionalProperties: false',
    schema: { type: 'object', patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false },
    instances: [{ 'x-a': 's' }, { 'x-a': 1 }, { y: 1 }, { 'x-a': 's', y: 1 }],
  },
  {
    name: 'items with length and uniqueness',
    schema: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, uniqueItems: true },
    instances: [['a'], [], ['a', 'b', 'c', 'd'], ['a', 'a'], [1], ['a', 'b']],
  },
  {
    name: 'prefixItems with items: false',
    schema: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false },
    instances: [['a', 1], ['a'], ['a', 1, 2], [1, 'a']],
  },
  {
    name: 'enum over mixed types',
    schema: { enum: ['a', 1, null] },
    instances: ['a', 1, null, 'b', [1], 1.0],
  },
  {
    name: 'const over an object',
    schema: { const: { x: 1 } },
    instances: [{ x: 1 }, { x: 2 }, { x: 1, y: 2 }],
  },
  {
    name: 'numeric bounds and multipleOf',
    schema: { type: 'number', minimum: 0, maximum: 10, exclusiveMinimum: 0, multipleOf: 0.5 },
    instances: [0, 0.5, 1, 10, 10.5, -1, 0.3, 'x', 9.5],
  },
  {
    name: 'numeric exclusiveMaximum',
    schema: { type: 'integer', exclusiveMaximum: 5 },
    instances: [4, 5, 6, 4.5],
  },
  {
    name: 'string length in code points and pattern',
    schema: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-zé]+$' },
    instances: ['ab', 'a', 'abcde', 'AB', 'abc', 'é', 'éé', 'abcé'],
  },
  {
    name: 'anyOf',
    schema: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 10 }] },
    instances: ['a', 10, 9, null],
  },
  {
    name: 'oneOf with an overlap',
    schema: { oneOf: [{ type: 'number' }, { type: 'integer' }] },
    instances: [1, 1.5, 'x'],
  },
  {
    name: 'allOf',
    schema: { allOf: [{ type: 'object' }, { required: ['a'] }] },
    instances: [{ a: 1 }, {}, []],
  },
  {
    name: 'not',
    schema: { not: { type: 'string' } },
    instances: [1, 'x'],
  },
  {
    name: '$ref into $defs',
    schema: {
      type: 'object',
      properties: { item: { $ref: '#/$defs/item' }, list: { type: 'array', items: { $ref: '#/$defs/item' } } },
      $defs: { item: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    },
    instances: [{ item: { id: 'a' } }, { item: {} }, { list: [{ id: 'x' }, { id: 2 }] }, { list: [{ id: 'x' }] }],
  },
  {
    name: 'if / then / else',
    schema: {
      type: 'object',
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['x'] },
      else: { required: ['y'] },
    },
    instances: [{ kind: 'a', x: 1 }, { kind: 'a' }, { kind: 'b', y: 1 }, { kind: 'b' }, {}],
  },
  {
    name: 'dependentRequired',
    schema: { type: 'object', dependentRequired: { a: ['b'] } },
    instances: [{ a: 1, b: 2 }, { a: 1 }, { c: 1 }],
  },
  {
    name: 'a nullable union',
    schema: { type: ['string', 'null'] },
    instances: ['a', null, 1],
  },
  {
    name: 'minProperties and maxProperties',
    schema: { type: 'object', minProperties: 1, maxProperties: 2 },
    instances: [{}, { a: 1 }, { a: 1, b: 2, c: 3 }],
  },
  {
    name: 'boolean subschemas',
    schema: { type: 'object', properties: { a: false, b: true } },
    instances: [{ a: 1 }, {}, { b: 'anything' }],
  },
  {
    name: 'contains with minContains',
    schema: { type: 'array', contains: { type: 'number' }, minContains: 2 },
    instances: [[1, 'a'], [1, 2], ['a']],
  },
  {
    name: 'a recursive schema that stays finite',
    schema: { type: 'object', properties: { child: { $ref: '#' } } },
    instances: [{ child: { child: {} } }, { child: 1 }, {}],
  },
  {
    name: 'the empty schema accepts anything',
    schema: {},
    instances: [1, 'x', null, [], {}],
  },
];

describe('validateArguments agrees with the SDK AJV on the corpus', () => {
  const sdk = new AjvJsonSchemaValidator();
  for (const item of corpus) {
    it(item.name, () => {
      const validate = sdk.getValidator(item.schema as Parameters<typeof sdk.getValidator>[0]);
      for (const instance of item.instances) {
        const ours = validateArguments(item.schema, instance);
        expect('unsupported' in ours, `the checker refused ${JSON.stringify(instance)}`).toBe(false);
        const theirs = validate(instance).valid;
        expect(ours.ok, `verdict for ${JSON.stringify(instance)}`).toBe(theirs);
      }
    });
  }
});

describe('the failures carry exact JSON paths', () => {
  const schema = {
    type: 'object',
    properties: {
      entries: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    },
    required: ['entries'],
  };

  it('lists every violation at the path it occurs', () => {
    const verdict = validateArguments(schema, { entries: [{ name: 3 }, {}] });
    expect(verdict.ok).toBe(false);
    if (verdict.ok || 'unsupported' in verdict) throw new Error('expected failures');
    expect(verdict.failures.map((failure) => [failure.path, failure.message])).toEqual([
      ['/entries/0/name', 'must be string'],
      ['/entries/1/name', 'is required'],
    ]);
    expect(verdict.failures.map(describeFailure)).toEqual(['/entries/0/name must be string', '/entries/1/name is required']);
  });

  it('names the root as "the arguments" when the root itself is wrong', () => {
    const verdict = validateArguments({ type: 'object' }, []);
    if (verdict.ok || 'unsupported' in verdict) throw new Error('expected a failure');
    expect(describeFailure(verdict.failures[0]!)).toBe('the arguments must be object');
  });

  it('escapes a property name that holds a slash, as a JSON pointer does', () => {
    const verdict = validateArguments({ type: 'object', properties: { 'a/b': { type: 'string' } } }, { 'a/b': 1 });
    if (verdict.ok || 'unsupported' in verdict) throw new Error('expected a failure');
    expect(verdict.failures[0]?.path).toBe('/a~1b');
  });
});

describe('the checker fails closed on what it cannot check', () => {
  it('refuses unevaluatedProperties rather than passing it', () => {
    expect(validateArguments({ type: 'object', unevaluatedProperties: false }, {})).toEqual({
      ok: false,
      unsupported: 'unevaluatedProperties',
    });
  });

  it('refuses a $ref into another document', () => {
    expect(validateArguments({ $ref: 'https://example.test/other.json' }, {})).toEqual({
      ok: false,
      unsupported: 'a $ref to another document',
    });
  });

  it('refuses a $ref that does not resolve', () => {
    expect(validateArguments({ $ref: '#/$defs/missing' }, {})).toEqual({ ok: false, unsupported: 'a $ref that does not resolve' });
  });

  it('refuses a type it does not know', () => {
    expect(validateArguments({ type: 'date' }, '2026')).toEqual({ ok: false, unsupported: 'type "date"' });
  });

  it('refuses a malformed type keyword', () => {
    expect(validateArguments({ type: 5 }, 1)).toEqual({ ok: false, unsupported: 'a "type" that is not a name or a list of names' });
  });

  it('refuses a pattern that is not a regular expression', () => {
    expect(validateArguments({ type: 'string', pattern: '(' }, 'x')).toEqual({
      ok: false,
      unsupported: 'a pattern that is not a valid regular expression',
    });
  });

  it('refuses a self-reference that never consumes the value', () => {
    const verdict = validateArguments({ $ref: '#' }, 1);
    expect(verdict.ok).toBe(false);
    expect('unsupported' in verdict).toBe(true);
  });

  it('ignores the annotations JSON Schema says are annotations', () => {
    expect(validateArguments({ title: 'Query', description: 'a phrase', examples: ['x'], format: 'uri', default: 'x' }, 'anything')).toEqual({
      ok: true,
    });
  });
});

describe('the checker stays within its work budget, and runs no pattern that can take exponential time', () => {
  // The probes stay short on purpose. Without the refusal, 26 characters take the engine a fraction of a second and
  // 40 would not finish, so a regression here must fail fast rather than hang the run.
  it('refuses a pattern that repeats a group which already repeats, before running it', () => {
    const started = performance.now();
    const verdict = validateArguments({ type: 'string', pattern: '^(a+)+$' }, `${'a'.repeat(26)}!`);
    expect(verdict).toEqual({ ok: false, unsupported: 'a pattern with nested repetition' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('refuses a pattern that repeats a group which alternates', () => {
    expect(validateArguments({ type: 'string', pattern: '^(a|aa)+$' }, `${'a'.repeat(26)}!`)).toEqual({
      ok: false,
      unsupported: 'a pattern with nested repetition',
    });
  });

  it('refuses a repetition nested inside a repeated group even when the inner one is bounded', () => {
    expect(validateArguments({ type: 'string', pattern: '^((ab){2,3}c)+$' }, 'abababc')).toEqual({
      ok: false,
      unsupported: 'a pattern with nested repetition',
    });
  });

  it('still checks a repeated group that does not nest, and a flat pattern, as before', () => {
    expect(validateArguments({ type: 'string', pattern: '^(ab)+$' }, 'abab')).toEqual({ ok: true });
    expect(validateArguments({ type: 'string', pattern: '^(ab)+$' }, 'aba')).toEqual({
      ok: false,
      failures: [{ path: '', message: 'must match the pattern ^(ab)+$' }],
    });
    expect(validateArguments({ type: 'string', pattern: '^[(a+)]+$' }, '(a+)')).toEqual({ ok: true });
  });

  it('refuses a schema whose shared subschemas would take exponential time, and names the budget', () => {
    // Each level refers to the level below twice: about 2^20 paths and no cycle, so the depth limit never fires.
    let schema: unknown = { type: 'string' };
    for (let level = 0; level < 20; level += 1) schema = { allOf: [schema, schema] };
    const started = performance.now();
    const verdict = validateArguments(schema, 'x');
    expect(verdict).toEqual({ ok: false, unsupported: 'a check that exceeds the work budget' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('checks a shared subschema that stays within the budget', () => {
    let schema: unknown = { type: 'string' };
    for (let level = 0; level < 8; level += 1) schema = { allOf: [schema, schema] };
    expect(validateArguments(schema, 'x')).toEqual({ ok: true });
  });
});
