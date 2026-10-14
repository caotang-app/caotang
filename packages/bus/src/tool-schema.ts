/**
 * One declaration per tool's params, read two ways: as the JSON Schema an MCP
 * client sees, and as the closed-set validator the harness runs.
 *
 * **Why one declaration.** extensibility.md §2 makes the registry the single
 * tool-declaration seam, and a separate hand-written schema beside a separate
 * validator is how a tool gains a parameter the validator refuses or loses one
 * the schema advertises. Both outputs are derived from `ParamSpec` here, so a
 * key exists in the schema if and only if the validator accepts it.
 *
 * **Closed by default.** An object spec refuses any key it does not declare
 * (`additionalProperties: false` on the schema side, the bus's
 * `requireDeclaredParams` rule on the validator side).
 *
 * **Deliberately small.** The subset here is what the fourteen tools need:
 * strings, integers, booleans, enums, arrays, objects, a two-way union and a
 * tagged union on one key. It is not a general JSON Schema implementation, and
 * `validate.ts` (the harness) says exactly which keywords it enforces.
 *
 * **Why this file is in the bus.** A media module declares its
 * tools in the registry's entry shape, and that shape needs `param` and
 * `toJsonSchema`. The harness imports those modules, so a module that imported
 * them from the harness would close a cycle. This file has no imports, so the
 * bus, which every tool package already depends on, is the one place for it.
 * `@caotang/harness` re-exports every name here from `schema.ts`.
 */

export type ParamSpec =
  | StringSpec
  | IntegerSpec
  | BooleanSpec
  | EnumSpec
  | ArraySpec
  | ObjectSpec
  | FreeObjectSpec
  | UnionSpec
  | TaggedSpec;

/**
 * An object whose keys are checked by something else. A plan step's params are the
 * params of whichever tool the step names, so the plan's own schema can say only
 * "an object"; the step's tool checks its keys when the step is preflighted.
 */
export interface FreeObjectSpec {
  readonly kind: 'free-object';
  readonly description: string;
}

export interface StringSpec {
  readonly kind: 'string';
  readonly description: string;
  /** Refuses a value that is empty or whitespace after trim (the bus's `requireNonBlankString`). */
  readonly nonBlank?: boolean;
  /** Code points, the unit the specs write their limits in. Exceeding it is a limit, not a shape error. */
  readonly maxLength?: number;
  /** The corrective hint for an overflow, when the generic "shorten it" would send the caller the wrong way. */
  readonly overflowHint?: string;
  readonly default?: string;
}

export interface IntegerSpec {
  readonly kind: 'integer';
  readonly description: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: number;
}

export interface BooleanSpec {
  readonly kind: 'boolean';
  readonly description: string;
  readonly default?: boolean;
}

export interface EnumSpec {
  readonly kind: 'enum';
  readonly description: string;
  readonly values: readonly string[];
  readonly default?: string;
}

export interface ArraySpec {
  readonly kind: 'array';
  readonly description: string;
  readonly items: ParamSpec;
  /** A minimum is a shape refusal; a maximum is a limit, and says how to split. */
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly unique?: boolean;
}

export interface ObjectSpec {
  readonly kind: 'object';
  readonly description: string;
  readonly properties: Readonly<Record<string, ParamSpec>>;
  readonly required: readonly string[];
}

/** `A | B` where the two options are told apart by JSON type, as `fields: [...] | "all"` is. */
export interface UnionSpec {
  readonly kind: 'union';
  readonly description: string;
  readonly options: readonly ParamSpec[];
}

/** An object whose `tag` key selects which variant's closed key set applies, as `ops[].action` does. */
export interface TaggedSpec {
  readonly kind: 'tagged';
  readonly description: string;
  readonly tag: string;
  readonly variants: Readonly<Record<string, ObjectSpec>>;
}

export type JsonSchema = { readonly [key: string]: unknown };

/* ------------------------------------------------------------------ *
 * Constructors. Each returns one spec and nothing else, so a tool's
 * params read as a list of declarations.
 * ------------------------------------------------------------------ */

export const param = {
  string(
    description: string,
    options: { nonBlank?: boolean; maxLength?: number; overflowHint?: string; default?: string } = {},
  ): StringSpec {
    return { kind: 'string', description, ...options };
  },
  integer(description: string, options: { minimum?: number; maximum?: number; default?: number } = {}): IntegerSpec {
    return { kind: 'integer', description, ...options };
  },
  boolean(description: string, options: { default?: boolean } = {}): BooleanSpec {
    return { kind: 'boolean', description, ...options };
  },
  choice(description: string, values: readonly string[], options: { default?: string } = {}): EnumSpec {
    return { kind: 'enum', description, values, ...options };
  },
  list(
    description: string,
    items: ParamSpec,
    options: { minItems?: number; maxItems?: number; unique?: boolean } = {},
  ): ArraySpec {
    return { kind: 'array', description, items, ...options };
  },
  object(
    description: string,
    properties: Readonly<Record<string, ParamSpec>>,
    required: readonly string[] = [],
  ): ObjectSpec {
    return { kind: 'object', description, properties, required };
  },
  either(description: string, options: readonly ParamSpec[]): UnionSpec {
    return { kind: 'union', description, options };
  },
  freeObject(description: string): FreeObjectSpec {
    return { kind: 'free-object', description };
  },
  /**
   * A tagged union. The tag key is added to every variant here, as a required
   * one-value enum, so a variant cannot forget to declare the key that selects it.
   */
  tagged(description: string, tag: string, variants: Readonly<Record<string, ObjectSpec>>): TaggedSpec {
    const withTag: Record<string, ObjectSpec> = {};
    for (const [value, variant] of Object.entries(variants)) {
      withTag[value] = {
        ...variant,
        properties: { [tag]: { kind: 'enum', description: `the operation, always "${value}"`, values: [value] }, ...variant.properties },
        required: [tag, ...variant.required],
      };
    }
    return { kind: 'tagged', description, tag, variants: withTag };
  },
};

/** The JSON Schema an MCP client receives for one spec. Derived, never written by hand. */
export function toJsonSchema(spec: ParamSpec): JsonSchema {
  switch (spec.kind) {
    case 'string':
      return {
        type: 'string',
        description: spec.description,
        ...(spec.nonBlank === true ? { minLength: 1 } : {}),
        ...(spec.maxLength === undefined ? {} : { maxLength: spec.maxLength }),
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case 'integer':
      return {
        type: 'integer',
        description: spec.description,
        ...(spec.minimum === undefined ? {} : { minimum: spec.minimum }),
        ...(spec.maximum === undefined ? {} : { maximum: spec.maximum }),
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case 'boolean':
      return {
        type: 'boolean',
        description: spec.description,
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case 'enum':
      return {
        type: 'string',
        enum: [...spec.values],
        description: spec.description,
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case 'array':
      return {
        type: 'array',
        description: spec.description,
        items: toJsonSchema(spec.items),
        ...(spec.minItems === undefined ? {} : { minItems: spec.minItems }),
        ...(spec.maxItems === undefined ? {} : { maxItems: spec.maxItems }),
        ...(spec.unique === true ? { uniqueItems: true } : {}),
      };
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      for (const [key, child] of Object.entries(spec.properties)) properties[key] = toJsonSchema(child);
      return {
        type: 'object',
        description: spec.description,
        properties,
        required: [...spec.required],
        additionalProperties: false,
      };
    }
    case 'free-object':
      return { type: 'object', description: spec.description };
    case 'union':
      return { description: spec.description, anyOf: spec.options.map((option) => toJsonSchema(option)) };
    case 'tagged':
      return {
        description: spec.description,
        oneOf: Object.values(spec.variants).map((variant) => toJsonSchema(variant)),
      };
  }
}
