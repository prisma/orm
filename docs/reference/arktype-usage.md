# Arktype Usage Guidelines

This document covers common patterns and pitfalls when using Arktype for schema validation in this codebase.

## Type-Safe Schema Declaration (Recommended Pattern)

**Always use `type.declare<TypeScriptType>().type({ ... })` instead of plain `type({ ... })`.**

This pattern ensures compile-time validation that your Arktype schema precisely matches an existing TypeScript type. If the inferred type is too wide or too narrow, TypeScript will error during compilation.

**✅ CORRECT (Type-Safe):**
```typescript
import { type } from 'arktype';

// Define your TypeScript type first (or import from a types module)
type User = {
  id: string;
  name: string;
  email?: string;
};

// Use type.declare<>() to ensure schema matches the type exactly
const UserSchema = type.declare<User>().type({
  id: 'string',
  name: 'string',
  'email?': 'string',
});
```

**❌ WRONG (No Compile-Time Safety):**
```typescript
// Without declare, schema mismatches won't be caught at compile time
const UserSchema = type({
  id: 'string',
  name: 'string',
  'email?': 'number',  // Typo: should be 'string', but no error!
});
```

### Benefits of `type.declare<>()`

1. **Autocomplete**: Get IDE autocomplete for object keys based on the TypeScript type
2. **Compile-time errors**: Mismatches between schema and type are caught immediately
3. **Documentation**: The schema explicitly shows which type it validates against
4. **Refactoring safety**: Changing the TypeScript type surfaces all schema mismatches

### Handling Morphs and Default Values

If your schema contains morphs (transformations) like `string.numeric.parse`, the input and output types differ. Use the `side` config to specify which side to validate:

```typescript
type Expected = { count: number; label?: string };

// Validate the output type (after parsing)
const Schema = type.declare<Expected, { side: 'out' }>().type({
  count: 'string.numeric.parse',  // Input: string, Output: number
  'label?': 'string',
});
```

Reference: [Arktype Declare API](https://arktype.io/docs/declare)

## Read the Docs Before Building Machinery

Read the arktype docs (https://arktype.io/docs) before you write code that walks a schema, copies values around validation, or repairs arktype's output afterwards. The Configuration, Morphs and Scopes pages cover most of the problems that look like they need bespoke code. Do not read arktype's compiled node tree (`schema.internal`, `.structure`, `.branches`, `.in`): it is not a public API, and code built on it breaks on shapes you did not anticipate (unions, tuples, a root `.narrow()` combined with defaults).

An example of what goes wrong otherwise: the CLI engine's config schemas once copied the input along the schema's declared shape before validation and put the config file's objects back afterwards, by walking the compiled node tree twice. arktype's documented `clone` option, with the objects to keep declared in the schema, does the same job without reading arktype's internals.

## What a Transformation Does to Its Input

### arktype clones the input before any morph applies

A morph is any transformation: `.pipe()`, `=>`, or a default value (`'string = "x"'`, `['path', '=', () => './x']`). When at least one morph applies anywhere in a value, arktype clones the whole root input before it applies the morphs, then writes each result into the clone at the morph's path. Without morphs nothing is cloned and validation returns the input itself.

The clone comes from the `clone` config option. Its default, `deepClone` from `@ark/util`:

- keeps each object's prototype, but builds a new object with copies of its own properties;
- rebuilds plain objects, arrays and class instances all the way down;
- keeps functions, `Map`, `Set` and other built-ins as they are, and re-creates `Date`s.

So after validation:

- `===` against a shared object fails. Codec descriptors used to mark "takes no params" with a shared `voidParamsSchema` object and compare against it; a cloned descriptor carried a copy, and every codec looked parameterized.
- Private `#fields` are missing on the copy, so methods that read them throw.
- Anything keyed by object identity (`WeakMap`, `Set` of objects) no longer finds the value.

### Configuring the clone

The option can be set globally, per scope, or per type:

```typescript
const configScope = scope(
  { path: type('string').pipe((value, ctx) => resolveAgainstConfigFile(value, ctx.path)) },
  { clone: (original) => copyExceptDeclaredReferences(original) },
);
```

- A custom function replaces the clone. The CLI engine's config scope copies every value except the ones a section schema declares with `reference(schema)`: the config file's own objects, such as descriptors and clients. A `reference` check runs during validation, before arktype clones, and records the value it accepted; the clone keeps recorded values as they are. The schema says which values are references, rather than the clone guessing from a value's type.
- `clone: false` writes results into the caller's input. That mutates the caller's objects and throws on frozen input.
- `structuredClone` is not a safe substitute: it throws on functions and drops prototypes.

Reference: [Configuration](https://arktype.io/docs/configuration), "clone".

### Other behaviour worth knowing

- **Literal defaults run their morph when the schema is defined; thunk defaults run it when the default is applied.** `['path', '=', './x']` resolves `./x` once, with no validation context. `['path', '=', () => './x']` resolves it during each validation. Use a thunk when the morph needs validation-time context.
- **A morph receives its location.** In `.pipe((value, ctx) => ...)`, `ctx.path` is the key path of the value within the root. The engine's `path` keyword uses it to find which config file declared the value.
- **A path given inside a `.narrow()` is taken from the root.** `ctx.error({ path: ['id'], ... })` inside a narrow on `family` reports at `id`, not `family.id`. Prepend the narrowed value's location to report under it: `path: [...ctx.path, 'id']`. Better, declare the fields structurally, so arktype reports each bad field at its full path itself.
- **Undeclared keys are kept by default.** Declaring only the keys you check lets the rest of an object pass through unchanged.
- **Errors for missing keys come out in alphabetical key order**, not declaration order.

## Optional Keys

**❌ WRONG:**
```typescript
const Schema = type({
  name: 'string | undefined',
  value: 'number | undefined',
});
```

**✅ CORRECT:**
```typescript
const Schema = type({
  'name?': 'string',
  'value?': 'number',
});
```

Use the `'key?'` syntax with the `?` suffix for optional keys. Arktype handles missing optional fields automatically - you don't need to normalize them to `undefined` before validation.

## Schema References in Object Properties

**✅ CORRECT:**
```typescript
const ReferencesSchema = type({
  table: 'string',
  columns: 'string[]',
});

const ForeignKeySchema = type({
  columns: 'string[]',
  references: ReferencesSchema,  // Direct schema reference works
  'name?': 'string',
});
```

You can reference schemas directly as object property values. This works seamlessly.

## Schema References in Record Types

**❌ WRONG:**
```typescript
const Schema = type({
  columns: 'Record<string, StorageColumnSchema>',  // Won't work - string can't resolve schema
});
```

**✅ CORRECT:**
```typescript
const StorageColumnSchema = type({
  type: 'string',
  'nullable?': 'boolean',
});

const Schema = type({
  columns: type({ '[string]': StorageColumnSchema }),  // Use '[string]' key pattern
});
```

Use `type({ '[string]': Schema })` to create a `Record<string, Schema>` type. The `'[string]'` key pattern tells Arktype this is a Record type with string keys and the referenced schema as values.

## Schema References in Arrays

**❌ WRONG:**
```typescript
const Schema = type({
  items: type([ItemSchema]),  // Creates a tuple requiring exactly 1 element, not an array
  'items?': 'unknown[]',      // Requires manual validation
});
```

**✅ CORRECT:**
```typescript
const ItemSchema = type({
  id: 'string',
  'name?': 'string',
});

const Schema = type({
  'items?': ItemSchema.array(),  // Use .array() method
});
```

Use the `.array()` method on a schema to create an array type. Arktype will automatically validate each element of the array against the schema. No manual validation needed.

## Type Inference vs Type Declaration

There are two patterns for keeping TypeScript types and Arktype schemas in sync:

### Pattern 1: `type.declare<>()` — Type-First (Preferred)

Use when you have an existing TypeScript type that the schema must match:

```typescript
import { type } from 'arktype';

// Type exists first (from types module, API contract, etc.)
type User = {
  name: string;
  platform: 'android' | 'ios';
  versions?: (number | string)[];
};

// Schema validates against the existing type
const UserSchema = type.declare<User>().type({
  name: 'string',
  platform: "'android' | 'ios'",
  'versions?': '(number | string)[]',
});
```

### Pattern 2: `.infer` — Schema-First

Use when the schema is your source of truth and you need to derive the type:

```typescript
import { type } from 'arktype';

// Schema is the source of truth
const UserSchema = type({
  name: 'string',
  platform: "'android' | 'ios'",
  'versions?': '(number | string)[]',
});

// Type is derived from the schema
type User = typeof UserSchema.infer;
```

### When to Use Which

| Pattern | Use Case |
|---------|----------|
| `type.declare<T>()` | Validating against existing types (e.g., contract types, imported interfaces) |
| `.infer` | Schema is the source of truth, type is derived |

**In this codebase, prefer `type.declare<>()` because we typically have existing TypeScript types from contract definitions that schemas must match exactly.**

## Readonly Arrays

When your TypeScript type uses readonly arrays, your schema must match with `.array().readonly()`:

**✅ CORRECT:**
```typescript
import { type } from 'arktype';

type PrimaryKey = {
  readonly columns: readonly string[];
  readonly name?: string;
};

const PrimaryKeySchema = type.declare<PrimaryKey>().type({
  columns: type.string.array().readonly(),  // Use .readonly() for readonly arrays
  'name?': 'string',
});
```

**❌ WRONG:**
```typescript
// This creates a mutable array type - compile error with type.declare<>()
const PrimaryKeySchema = type.declare<PrimaryKey>().type({
  columns: 'string[]',  // Type mismatch: mutable vs readonly
  'name?': 'string',
});
```

**For arrays of schema-typed values**, apply `.readonly()` to the array:

```typescript
type Item = { id: string };

const ItemSchema = type.declare<Item>().type({ id: 'string' });

const ContainerSchema = type.declare<{ readonly items: readonly Item[] }>().type({
  items: ItemSchema.array().readonly(),  // Readonly array of Item objects
});
```

## Avoiding Redundant Validation

**❌ WRONG:**
```typescript
const contractResult = SqlContractSchema(value);
if (contractResult instanceof type.errors) {
  throw new Error(...);
}

// Redundant - Arktype already validated this
if (typeof value.storage !== 'object' || value.storage === null) {
  throw new Error('Contract must have a "storage" object');
}
```

**✅ CORRECT:**
```typescript
const contractResult = SqlContractSchema(value);
if (contractResult instanceof type.errors) {
  throw new Error(...);
}

// Arktype has already validated the structure, so we can safely access nested properties
const storage = contractResult.storage;
```

Once Arktype validation passes, you can trust that the structure matches the schema. Don't manually re-validate what Arktype already checked.

## Error Handling

Arktype returns a `type.errors` instance on validation failure:

```typescript
import { type } from 'arktype';

const result = Schema(value);
if (result instanceof type.errors) {
  // result is an array-like object with problem objects that have 'message' property
  const messages = result.map((p: { message: string }) => p.message).join('; ');
  throw new Error(`Validation failed: ${messages}`);
}
// Otherwise, result is the validated value
// TypeScript narrows the type after the instanceof check
```

Use `instanceof type.errors` to check for validation errors. This provides proper type narrowing in TypeScript.

## Returning Validated Values

When validating JSON imports with generic type parameters, consider whether to return the original value or the validated result:

**Option 1: Return original value (preserves literal types from JSON)**
```typescript
export function validateContractStructure<T extends SqlContract>(value: T): T {
  const contractResult = SqlContractSchema(value);
  if (contractResult instanceof type.errors) {
    throw new Error(...);
  }
  // Return original value to preserve literal types from JSON imports
  return value;
}
```

**Option 2: Return validated result (standard approach)**
```typescript
export function validate(value: unknown): Contract {
  const contractResult = SqlContractSchema(value);
  if (contractResult instanceof type.errors) {
    throw new Error(...);
  }
  // Return validated result - Arktype has confirmed it matches the schema
  return contractResult;
}
```

## Complete Example

```typescript
import { type } from 'arktype';

type User = {
  id: string;
  name: string;
  roles: readonly string[];
  metadata?: Record<string, unknown>;
};

const UserSchema = type.declare<User>().type({
  id: 'string',
  name: 'string',
  roles: type.string.array().readonly(),
  'metadata?': type({ '[string]': 'unknown' }),
});

export function validateUser(value: unknown): User {
  const result = UserSchema(value);
  if (result instanceof type.errors) {
    throw new Error(result.map((p) => p.message).join('; '));
  }
  return result;
}
```

For a comprehensive real-world example, see `packages/2-sql/2-authoring/contract-ts/src/contract.ts`.
