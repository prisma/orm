# TypeScript and Architecture Patterns

This document covers important TypeScript patterns and architectural principles used in this codebase.

## Generic Parameter Defaults

**CRITICAL RULE**: Generic types or interfaces should **not** provide defaults unless the type actually makes sense with non-specific values. Most of the time, we need a generic parameter to be provided or it's not worth having.

### The Problem

Default generic parameters can create a false sense of flexibility. If a type is useless without specific values, defaults are misleading and add unnecessary complexity.

### When Defaults Are Appropriate

**✅ CORRECT: Default makes sense - type is useful with default value**

```typescript
// Array is useful even with unknown element type
interface Array<T = unknown> {
  length: number;
  [index: number]: T;
}

// Optional generic with sensible default
interface EventEmitter<T = unknown> {
  emit(event: string, data: T): void;
}
```

### When Defaults Are NOT Appropriate

**❌ WRONG: Type is useless without specific values**

```typescript
// This type is useless without specific Name, Nullable, Type values
interface ColumnBuilderState<
  Name extends string = string,
  Nullable extends boolean = boolean,
  Type extends string = string,
> {
  readonly name: Name;
  readonly nullable: Nullable;
  readonly type: Type;
}
```

**✅ CORRECT: Remove defaults - type requires specific values**

```typescript
// Type requires specific values to be useful
interface ColumnBuilderState<
  Name extends string,
  Nullable extends boolean,
  Type extends string,
> {
  readonly name: Name;
  readonly nullable: Nullable;
  readonly type: Type;
}
```

### Why This Matters

1. **Clarity**: Makes it clear that specific values are required
2. **Type Safety**: Prevents accidental use with default (often too-broad) types
3. **Simplicity**: Removes unused defaults that add noise
4. **Intent**: Signals that the type is designed for specific use cases, not generic ones

### Pattern

**Before adding defaults, ask:**
- Does this type make sense with the default values?
- Would someone ever want to use this type with defaults?
- Are the defaults just there "in case" or do they serve a real purpose?

**If the answer is "no" or "just in case", remove the defaults.**

## Interface-Based Design with Factory Functions

This architectural pattern is now documented in the architecture pattern catalogue under [`interface-plus-factory.md`](../architecture%20docs/patterns/interface-plus-factory.md). The catalogue is the source of truth for the pattern's intent, structure, when-to-use boundaries, and reference implementations.

This reference doc retains only the TypeScript-mechanical guidance below — the language-level caveat about classes with private properties in exported types — because that is a TypeScript trap rather than a structural pattern.

## AST/IR class hierarchies

The previous section's interface-plus-factory pattern is for **stateful services** (registries, runtimes, adapters, drivers) that consumers hold as opaque handles. AST/IR nodes are a different shape — they round-trip through JSON, support polymorphic dispatch on `kind`, and target authors extend them with new kinds the framework cannot anticipate. They are codified as the **three-layer polymorphic IR** pattern; consult the catalogue entries for intent, structure, and reference implementations:

- [`three-layer-polymorphic-ir.md`](../architecture%20docs/patterns/three-layer-polymorphic-ir.md) — framework interface → family abstract base → target concrete classes; the layering rule when an IR crosses the framework/target boundary.
- [`frozen-class-ast.md`](../architecture%20docs/patterns/frozen-class-ast.md) — the in-class shape: abstract base + concrete kind classes + visitor for exhaustive dispatch; `freeze()` in the constructor.
- [`json-canonical-class-in-memory.md`](../architecture%20docs/patterns/json-canonical-class-in-memory.md) — the persistence rule that pairs with the AST shape: on-disk JSON is canonical; in-memory classes are JSON-clean by construction.

### When to use which pattern

| Situation | Pattern |
|-----------|---------|
| Stateful service with a lifecycle (registry, runtime, adapter, driver) | [Interface + factory](../architecture%20docs/patterns/interface-plus-factory.md) |
| Tree of kinds with multiple polymorphic-dispatch consumers, no target-specific extension | [Frozen-class AST + visitor](../architecture%20docs/patterns/frozen-class-ast.md) |
| AST/IR that crosses the framework/target boundary and admits target-only kinds | [Three-layer polymorphic IR](../architecture%20docs/patterns/three-layer-polymorphic-ir.md) (which builds on the frozen-class AST shape) |

The heuristic: ask whether the type *is* a polymorphic data tree (AST/IR) or whether it *holds* one (a service). AST/IR uses the class hierarchy and exports its concrete classes; services hide their classes and export interface + factory.

### `kind` discriminator strategy

The framework's `IRNodeBase` declares `kind` as `abstract readonly kind?: string` — **optional at the framework level**. Family bases and concrete classes commit per-leaf as needed:

- **Polymorphic dispatch today** (verifiers / walkers dispatch on `kind`): each leaf class declares an enumerable literal `kind = '<family>-<leaf>' as const`. The leaf literal dominates union narrowing; framework consumers and target consumers both narrow through it. Reference: `StorageValueSet.kind = 'valueSet' as const`.
- **No polymorphic dispatch today** (consumers walk by structural position, not by `kind`): the family base installs a single non-enumerable own `kind` property in its constructor via `Object.defineProperty(this, 'kind', { enumerable: false, … })`. This keeps `JSON.stringify(node)` envelope-compatible with the pre-class shape (no `kind` field on disk), keeps `toEqual({…})` assertions against pre-lift flat shapes passing, and still allows direct access and runtime narrowing. Reference: `SqlNode.kind = 'sql'` non-enumerable on the family base.

The optional framework-level contract is intentional — a required-`kind` contract forced hundreds of edits to literal storage shapes that never carried one, and no framework consumer dispatches on the base type's `kind` anyway. Per-leaf literals are added where polymorphic dispatch earns them.

### `freezeNode(this)` convention

Concrete IR classes call `freezeNode(this)` in their constructors after assigning their fields. This is exposed as a free function (or as a `protected freeze()` helper on the abstract base) so subclasses don't reach for `Object.freeze` directly; the convention name carries the intent that *every* IR class instance is immutable once constructed.

### Hydration via the per-target `ContractSerializer` SPI

JSON envelopes hydrate into class instances through the target's `ContractSerializer` implementation (`descriptor.contractSerializer.deserializeContract(json)`). Family-shared validation lives on `SqlContractSerializerBase` / `MongoContractSerializerBase`; per-target subclasses override protected hooks (`hydrateEnumType`, `constructTargetContract`, etc.) to construct the concrete subclass. The inverse direction — `serializeContract(contract)` — owns the on-disk JSON envelope shape; runtime-only class fields stay enumerable on instances and the serializer elides them on the way out. The pattern is the architectural home for "what's on disk" decisions; do not reach for non-enumerable property tricks on the class layer.

### Pack-contributed entity authoring

Target packs contribute new entity kinds (Postgres enums, Postgres schemas, future RLS policies) via the `entityTypes` namespace on `AuthoringContributions`. Each entity descriptor carries a factory `(input, ctx) => IRNode` that constructs the IR-class instance; pack-bag-driven type narrowing surfaces the contributed kind at `helpers.entityTypes.<entityName>(input)` in the TS DSL with full type narrowing on `input`. PSL syntax for the same kind lowers through the same descriptor. The mechanism is the authoring counterpart of the IR's target-extensibility — once the IR admits target-specific kinds, the authoring surface admits them too without hand-edited family-layer construction sites.

### Exception: Classes with Private Properties in Exported Types

**CRITICAL**: When a class with private properties is part of an exported type (e.g., returned from an exported function), the class must be explicitly exported from the exports file, not just from the source file. Otherwise, TypeScript treats it as an anonymous class type, which cannot have private or protected properties.

**❌ WRONG: Class not exported from exports file**

```typescript
// src/schema.ts
export class TableBuilderImpl {
  private readonly _name: string;
  // ...
}

export function schema() {
  return { tables: { user: new TableBuilderImpl('user', ...) } };
}

// src/exports/schema.ts
export { schema } from '../schema';
// TableBuilderImpl is NOT exported here
```

When `schema.tables` is exported, TypeScript infers the type and sees `TableBuilderImpl` as an anonymous class type, causing:
```
error TS4094: Property '_name' of exported anonymous class type may not be private or protected.
```

**✅ CORRECT: Export class from exports file**

```typescript
// src/schema.ts
export class TableBuilderImpl {
  private readonly _name: string;
  // ...
}

export function schema() {
  return { tables: { user: new TableBuilderImpl('user', ...) } };
}

// src/exports/schema.ts
export { schema, TableBuilderImpl } from '../schema';
// TableBuilderImpl is explicitly exported so TypeScript recognizes it as a named class
```

**Why this matters:**
- TypeScript requires named classes (not anonymous) to have private properties in exported types
- Exporting the class from the exports file makes it part of the public API, allowing TypeScript to recognize it as a named class
- This is an exception to the "don't export classes" rule when the class is part of exported types

**When to use this pattern:**
- When a class with private properties is returned from an exported function
- When the class type is part of an exported type (e.g., in a return type)
- When TypeScript would otherwise treat the class as anonymous in exported types

## Runtime Values Cannot Be Type Parameters

**CRITICAL RULE**: TypeScript cannot use runtime values as type parameters. When iterating over object properties in a loop, you cannot use the loop variable as a type parameter.

### The Problem

TypeScript's type system operates at compile time, while runtime values exist at execution time. You cannot use a runtime value (like a loop variable) as a type parameter.

**❌ WRONG: Using runtime value as type parameter**

```typescript
type Columns = Contract['storage']['tables'][TableName]['columns'];
for (const columnName in table.columns) {
  const columnNameKey = columnName as keyof Columns;
  // Error: 'columnNameKey' refers to a value, but is being used as a type
  const columnBuilder = new ColumnBuilderImpl<columnNameKey & string, Columns[columnNameKey]>(...);
}
```

### The Solution

Use generic types (`string`, `StorageColumn`) in runtime code and rely on mapped types in the return type to preserve exact literal types:

**✅ CORRECT: Use generic types in runtime code**

```typescript
for (const columnName in table.columns) {
  const columnDef = table.columns[columnName];
  // Use generic types in runtime code
  const columnBuilder = new ColumnBuilderImpl<string, StorageColumn>(
    tableName,
    columnName,
    columnDef,
  );
  // Type system preserves exact types via mapped types in return type
}
```

**Key Point:** The return type uses mapped types (`{ readonly [K in keyof Columns]: ... }`) that preserve exact column names and types at the type level, even though the runtime code uses generic types.

### When This Pattern Applies

- When iterating over object properties in a loop
- When building dynamic structures from runtime data
- When you need to preserve exact literal types in the return type
- When the type system needs to infer types from the structure, not from runtime values

### Related Pattern

This is related to the "Type Preservation in Generics" pattern below, which covers preserving literal types through mapped types.

## Type Preservation in Generics

**Challenge**: Preserving literal string types (e.g., `'pg/text@1'`) through complex generic type manipulations.

### The Problem

TypeScript's `infer` in conditional types widens literal types to their base types (`'pg/text@1'` → `string`). This is problematic when working with codec IDs, which must remain as literal types.

### The Solution

Use mapped types with careful constraints to avoid index signatures:

**❌ WRONG: `Record<string, T>` introduces index signature**

```typescript
type ExtractCodecTypes<ScalarNames extends Record<string, Codec<string>>> = {
  [K in keyof ScalarNames]: ScalarNames[K] extends Codec<infer Id>
    ? { input: unknown; output: unknown }
    : never;
};
```

This creates an index signature `[x: string]: ...`, which loses literal key types.

**✅ CORRECT: Mapped type preserves literal keys**

```typescript
type ExtractCodecTypes<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> }
> = {
  readonly [K in keyof ScalarNames]: ScalarNames[K] extends Codec<infer Id>
    ? { input: unknown; output: unknown }
    : never;
};
```

This preserves literal keys like `'text'` and `'int4'` instead of widening them to `string`.

### Empty Defaults

Use `Record<never, never>` for empty object types without index signatures:

**❌ WRONG: `{}` can be problematic**

```typescript
type CodecMap<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = {}
> = {
  // ...
};
```

**✅ CORRECT: `Record<never, never>` is explicit empty type**

```typescript
type CodecMap<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> } = Record<never, never>
> = {
  // ...
};
```

`Record<never, never>` is an explicit way to represent an empty object type that has no index signature.

### Key Insight

When extracting literal types from codecs, use mapped types that extract keys (which preserve literals) rather than inferring values (which widen to `string`):

```typescript
// Extract the Id type from a Codec by using the key in a mapped type
type ExtractCodecIds<
  ScalarNames extends { readonly [K in keyof ScalarNames]: Codec<string> }
> = {
  readonly [K in keyof ScalarNames]: ScalarNames[K] extends Codec<infer Id>
    ? Id extends string
      ? Id
      : never
    : never;
};
```

### Type Constraint Errors

**CRITICAL**: When fixing type errors by replacing `any` with `unknown`, ensure the constraints match the actual interface requirements.

**❌ WRONG: Using `unknown` for type parameters with specific constraints**

```typescript
// This will fail because unknown doesn't satisfy string constraint
type ExtractColumns<T extends TableBuilderState<unknown, unknown, unknown>> =
  T extends TableBuilderState<unknown, infer C, unknown> ? C : never;
```

**✅ CORRECT: Use actual constraint types from the interface**

```typescript
// Use the actual constraint types from TableBuilderState interface
type ExtractColumns<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, string, boolean, string | undefined>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<string, infer C, readonly string[] | undefined> ? C : never;
```

**Why this matters:**
- TypeScript requires that generic type parameters satisfy their constraints
- `unknown` doesn't satisfy constraints like `string` or `Record<...>`
- You must use the actual constraint types from the interface definition
- Check the interface definition to see what the actual constraints are

## Contract Validation in Tests

**Always validate contracts in tests** - contracts must have fully qualified type IDs.

### The Problem

Contracts must contain fully qualified type IDs (e.g., `type: 'pg/text@1'`), not bare scalars (e.g., `type: 'text'`). Type canonicalization happens at authoring time, not during validation.

### The Solution

**❌ WRONG: Test contract with bare scalars**

```typescript
const testContract: SqlContract<SqlStorage> = {
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'text', nullable: false },  // Bare scalar - invalid!
        },
      },
    },
  },
};
```

**✅ CORRECT: Use fully qualified type IDs**

```typescript
import { validateContract } from '@internal/sql-query/schema';

const testContract = validateContract<SqlContract<SqlStorage>>({
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/text@1', nullable: false },  // Fully qualified type ID
        },
      },
    },
  },
});

// Now contract is validated and ready to use
const runtime = createRuntime({ contract: testContract, adapter });
```

### Why This Matters

1. **Type IDs required**: Contracts must use fully qualified type IDs (`ns/name@version`)
2. **Type safety**: Validation ensures the contract structure is correct
3. **Consistency**: Validated contracts match the types defined in `contract.d.ts`
4. **No target branching**: Type mappings come from extension packs, not target-specific branches

### No Target-Specific Branches

**CRITICAL**: Never branch on `target` in core packages. See `.cursor/rules/no-target-branches.mdc` for details.

## Test Port Management

**Automatic Port Allocation**: Ports are automatically allocated using `get-port` to find available ports in the range 10,000-65,000. This eliminates port conflicts in parallel test execution without requiring manual port assignment.

### Pattern

```typescript
// Ports are automatically allocated - no need to specify them
const database = await createDevDatabase();

// Or with withDevDatabase
await withDevDatabase(async ({ connectionString }) => {
  await withClient(connectionString, async (client) => {
    // ... test code
  });
});
```

### Benefits

- No port conflicts: Ports are checked for availability before use
- No manual assignment: No need to track and assign port ranges
- Better parallel execution: Multiple tests can run simultaneously without conflicts
- Simpler code: Less boilerplate in test files
- `codecs.integration.test.ts`: 54003-54005
- `budgets.integration.test.ts`: 54010-54012
- `runtime.integration.test.ts`: 53213-53215
- `marker.test.ts`: 54216-54218
- `e2e-tests/runtime.e2e.test.ts`: 54020-54112 (multiple tests, each with unique range)

### Best Practices

1. **Assign ranges**: Use ranges of 3-5 ports per test suite
2. **Leave gaps**: Leave gaps between ranges to avoid conflicts
3. **Document**: Update port assignments in this file when adding new test suites
4. **Consistency**: Use the same port range for all ports in a test suite (e.g., 54000-54002)

## Forbidden: Blind Type Casts

**CRITICAL RULE**: Blind type casts (`as unknown as X`) are **forbidden** in production code. Use type predicates instead.

### The Rule

**❌ FORBIDDEN: Blind casts in production code**

```typescript
// ❌ FORBIDDEN: Blind cast bypasses type checking
const colBuilder = where.left as unknown as {
  table: string;
  column: string;
};

// ❌ FORBIDDEN: Double cast to force type assertion
const builder = (o as unknown as { user: () => unknown }).user();
```

**✅ CORRECT: Use type predicates for proper type narrowing**

```typescript
// ✅ CORRECT: Use type predicate to narrow the type
if (isColumnBuilder(where.left)) {
  const { table, column } = getColumnInfo(where.left);
  // TypeScript knows where.left is ColumnBuilder here
}
```

### Why Blind Casts Are Forbidden

1. **Bypasses type safety**: Blind casts tell TypeScript to trust you without verification
2. **Hides runtime errors**: Type mismatches won't be caught until runtime
3. **Makes code brittle**: Changes to types won't be caught by the compiler
4. **Violates type safety principles**: This codebase prioritizes type safety

### Exception: Test Code Only

Blind casts are **only acceptable** in test files when:
- Creating test mocks that intentionally don't match the full interface
- Testing invalid inputs or error cases
- Working with dynamic proxy objects in test contexts

**✅ ACCEPTABLE: Blind casts in test files only**

```typescript
// ✅ ACCEPTABLE: In test file, creating simplified mock
function createMockColumnBuilder(): AnyColumnBuilder {
  return {
    kind: 'column',
    eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
  } as unknown as AnyColumnBuilder;
}

// ✅ ACCEPTABLE: In test file, working with dynamic proxy
const builder = (o as unknown as { user: () => unknown }).user();
```

**❌ FORBIDDEN: Blind casts in production code**

```typescript
// ❌ FORBIDDEN: Production code must use type predicates
const colBuilder = where.left as unknown as { table: string; column: string };
```

### How to Replace Blind Casts

1. **Create or use a type predicate**: Check if a value matches a type using a type guard function
2. **Use helper functions**: Extract common type-checking logic into reusable helpers
3. **Throw errors for invalid states**: If a value doesn't match expected types, throw an error

**Example: Replacing blind cast with type predicate**

```typescript
// ❌ BEFORE: Blind cast
const colBuilder = where.left as unknown as {
  table: string;
  column: string;
};

// ✅ AFTER: Type predicate with error handling
if (isColumnBuilder(where.left)) {
  const { table, column } = getColumnInfo(where.left);
  // Use table and column safely
} else {
  errorFailedToBuildWhereClause(); // Throw error for invalid state
}
```

### Creating Type Predicates

When you need to check if a value matches a type, create a type predicate:

```typescript
/**
 * Type predicate to check if a value is a ColumnBuilder.
 */
export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}
```

### Related Patterns

- See "Type Predicates" section below for more examples
- See "Type Safety is Non-Negotiable" section for why type safety matters
- See "Test Mock Type Assertions" section for acceptable test patterns

## Avoiding Unnecessary Type Casts and Optional Chaining

**Always check the actual type signature before adding type casts or optional chaining.**

**Note**: This section covers avoiding *unnecessary* casts. For the rule on *blind casts*, see the "Forbidden: Blind Type Casts" section above.

### The Problem

It's easy to add unnecessary type casts (`as unknown as T`) or optional chaining (`?.`) when TypeScript complains, but this is often a code smell that indicates:
1. The actual type already supports what you're trying to do
2. You're working around a type inference issue that should be fixed properly
3. You're adding defensive code for values that are guaranteed to exist

**Note**: This section covers avoiding *unnecessary* casts. For the rule on *blind casts*, see the "Forbidden: Blind Type Casts" section above.

### Type Casts

**❌ WRONG: Adding unnecessary type casts without checking the actual type**

```typescript
// Assumed the codec wanted text, so the value got cast on the way in
const c = codecLookup.get('pg/timestamptz-temporal@1');
const encoded = c.encode(instant as unknown as string);  // Unnecessary cast!
```

**✅ CORRECT: Check the actual type signature first**

```typescript
// Codec interface: encode(value: Temporal.Instant): Promise<string>
const c = codecLookup.get('pg/timestamptz-temporal@1');
const encoded = await c.encode(instant);  // A Temporal.Instant is what it takes
```

The cast is not merely redundant here — it is load-bearing in the wrong direction. `pg/timestamptz-temporal@1` encodes a `Temporal.Instant` and checks that nominally, so a cast that smuggles a `string` or a `Date` past the compiler buys a `RUNTIME.ENCODE_FAILED` at the boundary. Its sibling `pg/timestamptz-string@1` is the one that takes a `string`; which one a column uses is a contract decision, not something to paper over at the call site.

**When to use type casts:**
- Only when testing invalid inputs: `// @ts-expect-error - Testing invalid input`
- When you've verified the type system genuinely can't infer the correct type
- Never cast valid inputs to work around type errors - fix the type definition instead

### Optional Chaining

**❌ WRONG: Using optional chaining when values are guaranteed to exist**

```typescript
// codecLookup.get('pg/timestamptz-temporal@1') is guaranteed to return a codec in tests
const c = codecLookup.get('pg/timestamptz-temporal@1') as
  | { encode: (value: Temporal.Instant) => Promise<string> }
  | undefined;
if (!c) {
  throw new Error('codec not found');
}
```

**✅ CORRECT: Use a non-null assertion (or assert) when values are guaranteed**

```typescript
// In test context, the codec lookup always has the timestamp codec registered
const c = codecLookup.get('pg/timestamptz-temporal@1')!;
```

**When to use optional chaining:**
- When accessing values that might not exist (e.g., user input, API responses)
- When working with optional properties that are truly optional
- Never use `?.` for values that are guaranteed to exist (e.g., in test fixtures, constants)

### Type Assertions

**❌ WRONG: Adding `| undefined` to type assertions when values are guaranteed**

```typescript
const c = codecLookup.get('pg/timestamptz-temporal@1') as
  | { encode: (value: Temporal.Instant) => Promise<string> }
  | undefined;  // Unnecessary - value is guaranteed to exist
```

**✅ CORRECT: Only include `| undefined` if the value might actually be undefined**

```typescript
const c = codecLookup.get('pg/timestamptz-temporal@1')!;
```

### Best Practices

1. **Check the actual type first**: Read the interface/type definition before adding casts
2. **Use dot notation for guaranteed values**: If a value is guaranteed to exist (e.g., in tests), use `.` not `?.`
3. **Avoid defensive casts**: Don't cast valid inputs - fix the type definition if needed
4. **Use `@ts-expect-error` for invalid inputs**: When testing error cases, use `@ts-expect-error` with a comment explaining why
5. **Remove unnecessary `| undefined`**: If a value is guaranteed to exist, don't include `| undefined` in type assertions

## Biome Configuration

### Disable Comments

**Pattern**: If you need to disable a rule for more than a couple of lines in a file, use a file-level disable comment at the top of the file instead of many inline comments.

**❌ WRONG: Many inline disable comments**

```typescript
// biome-ignore lint/suspicious/noExplicitAny: <reason>
const invalid = { ...validContractInput, targetFamily: undefined } as any;
// biome-ignore lint/suspicious/noExplicitAny: <reason>
const invalid2 = { ...validContractInput, target: undefined } as any;
// biome-ignore lint/suspicious/noExplicitAny: <reason>
const invalid3 = { ...validContractInput, storageHash: undefined } as any;
// ... many more
```

**✅ CORRECT: File-level disable comment**

```typescript
// biome-ignore lint: test file with type assertions
import { describe, expect, it } from 'vitest';

// Now all as any usages in the file are allowed
const invalid = { ...validContractInput, targetFamily: undefined } as any;
const invalid2 = { ...validContractInput, target: undefined } as any;
const invalid3 = { ...validContractInput, storageHash: undefined } as any;
```

**When to use file-level disables:**
- When you have more than 2-3 occurrences of the same rule violation
- When the violations are intentional (e.g., testing invalid inputs)
- When the violations are throughout the file, not isolated to a few lines

**When to use inline disables:**
- When you have 1-2 isolated violations
- When the violation is specific to a single line or small block

### Unused Variables

**Pattern**: Variables that are only used as types should be prefixed with `_` to indicate they're intentionally unused.

**❌ WRONG: Variable only used as type without prefix**

```typescript
const plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(userTable)
  .select({ id: userTable.columns.id })
  .build();

type Row = ResultType<typeof plan>;  // plan is only used as a type
```

**✅ CORRECT: Prefix with `_` to indicate intentional unused variable**

```typescript
const _plan = sql<Contract, CodecTypes>({ contract, adapter })
  .from(userTable)
  .select({ id: userTable.columns.id })
  .build();

type Row = ResultType<typeof _plan>;  // _plan indicates it's intentionally unused
```

**Biome Configuration:** The `noUnusedVariables` rule is configured to ignore variables starting with `_` via the `ignorePattern: '^_'` option.

### Empty Object Types

**Pattern**: Use `Record<string, never>` instead of `{}` for empty object types in type definitions.

**❌ WRONG: Using `{}` for empty object types**

```typescript
type BuildStorage<
  Tables extends Record<string, TableBuilderState<string, unknown, unknown>>,
  Target extends string,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      NormalizeColumns<ExtractColumns<Tables[K]>>,
      ExtractPrimaryKey<Tables[K]>,
      Target
    >;
  };
} & (PK extends readonly string[] ? { readonly primaryKey: { readonly columns: PK } } : {});
```

**✅ CORRECT: Use `Record<string, never>` for empty object types**

```typescript
type BuildStorage<
  Tables extends Record<string, TableBuilderState<string, unknown, unknown>>,
  Target extends string,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: BuildStorageTable<
      K & string,
      NormalizeColumns<ExtractColumns<Tables[K]>>,
      ExtractPrimaryKey<Tables[K]>,
      Target
    >;
  };
} & (PK extends readonly string[] ? { readonly primaryKey: { readonly columns: PK } } : Record<string, never>);
```

**Why this matters:**
- `{}` allows any non-nullish value, which is too permissive
- `Record<string, never>` is an explicit empty object type with no index signature
- Provides better type safety

### JSON Imports

**Pattern**: Use `import` statements with `with { type: 'json' }` instead of `require()` for JSON files.

**❌ WRONG: Using `require()` for JSON files**

```typescript
const fixtureContract = validateContract<Contract>(
  // biome-ignore lint: CommonJS require in test context
  require('./fixtures/contract.json'),
);
```

**✅ CORRECT: Use `import` with `with { type: 'json' }`**

```typescript
import contractJson from './fixtures/contract.json' with { type: 'json' };

const fixtureContract = validateContract<Contract>(contractJson);
```

**Why this matters:**
- `require()` is CommonJS and doesn't work well with ESM
- `import` with `with { type: 'json' }` is the ESM way to import JSON (ES2022+)
- `assert { type: 'json' }` is deprecated in favor of `with { type: 'json' }`
- Avoids linting errors about `require()` and undefined globals
- Better type safety and module resolution

## Dynamic Imports

**CRITICAL RULE**: Never use dynamic imports (`import()`) of TypeScript packages, not even for types only, unless explicitly required by the user.

### The Problem

Dynamic imports create several issues:
1. **Build complexity**: Bundlers must handle code splitting and lazy loading
2. **Type resolution**: TypeScript's type system works best with static imports
3. **Dependency analysis**: Static analysis tools can't properly track dependencies
4. **Runtime overhead**: Dynamic imports add runtime module resolution overhead
5. **Type-only imports**: Even `import type` in dynamic imports can cause issues with type resolution

**❌ WRONG: Dynamic import of TypeScript package**

```typescript
// ❌ WRONG: Dynamic import for runtime code
const { validateContract } = await import('@internal/sql-query/schema');

// ❌ WRONG: Dynamic import with type-only usage
const module = await import('@internal/sql-lane/sql');
type SqlBuilder = typeof module.sql;

// ❌ WRONG: Type-only dynamic import (type import() syntax)
type SqlContract = import('@internal/sql-contract/types').SqlContract;

// ❌ WRONG: Localized dynamic import with type-only cast usage
const builder = { /* .. */ } as import('@internal/sql-relational-core/types').AnyBinaryBuilder;
```

**✅ CORRECT: Use static imports**

```typescript
// ✅ CORRECT: Static import for types
import type { SqlContract } from '@internal/sql-contract/types';

// ✅ CORRECT: Static import for runtime code
import { validateContract } from '@internal/sql-query/schema';

// ✅ CORRECT: Static import for both types and values
import { sql } from '@internal/sql-lane/sql';
import type { ResultType } from '@internal/sql-query/types';
```

### Exception: User-Explicit Requirement

Dynamic imports are **only acceptable** when:
- The user explicitly requires dynamic loading (e.g., lazy loading for performance)
- The use case genuinely requires runtime module resolution
- The requirement is documented and justified

**✅ ACCEPTABLE: When user explicitly requires dynamic loading**

```typescript
// ✅ ACCEPTABLE: User explicitly requested lazy loading
// Only use when user requirement is documented
async function loadAdapterLazily(adapterName: string) {
  const adapterModule = await import(`@internal/adapter-${adapterName}`);
  return adapterModule.createAdapter();
}
```

### Why This Matters

1. **Type safety**: Static imports allow TypeScript to properly resolve and check types
2. **Build optimization**: Bundlers can optimize static imports better than dynamic ones
3. **Dependency tracking**: Static analysis tools can properly track dependencies
4. **Performance**: Static imports are resolved at build time, not runtime
5. **Consistency**: Static imports are the standard pattern in TypeScript codebases
6. **IDE support**: Better autocomplete and type checking with static imports

### Best Practices

1. **Always use static imports**: Use `import` and `import type` statements at the top of files
2. **Avoid `import()`**: Never use dynamic `import()` unless explicitly required by the user
3. **Type-only imports**: Use `import type` for type-only imports, but still use static imports
4. **Document exceptions**: If dynamic imports are required, document why in comments

## Type Extraction from Column Builders

**Pattern**: When extracting types from `ColumnBuilder` instances, use `infer` for all type parameters to allow correct type inference.

### The Problem

When extracting the `JsType` from a `ColumnBuilder`, constraining type parameters too strictly prevents TypeScript from correctly inferring types from column builders with specific operation types.

**❌ WRONG: Constraining type parameters too strictly**

```typescript
type ExtractJsTypeFromColumnBuilder<CB extends AnyColumnBuilder> = CB extends ColumnBuilder<
  string,
  StorageColumn,
  infer JsType,
  infer _Ops extends OperationTypes
>
  ? JsType
  : never;
```

**Problem**: The constraint `infer _Ops extends OperationTypes` prevents TypeScript from matching column builders with specific operation types (e.g., `PgVectorOperationTypes`).

### The Solution

**✅ CORRECT: Use `infer` for all type parameters without constraints**

```typescript
type ExtractJsTypeFromColumnBuilder<CB extends AnyColumnBuilder> = CB extends ColumnBuilder<
  infer _ColumnName extends string,
  infer _ColumnMeta extends StorageColumn,
  infer JsType,
  infer _Ops
>
  ? JsType
  : never;
```

**Why?**
- Using `infer` for all parameters allows TypeScript to match any `ColumnBuilder` structure
- The `extends` constraints on inferred types (e.g., `infer _ColumnName extends string`) provide type safety without preventing matches
- This allows correct type inference for column builders with any operation types structure

### When This Pattern Applies

- Extracting `JsType` from `ColumnBuilder` instances in projection type inference
- Creating helper types that extract information from generic types with multiple parameters
- When you need to match types with specific generic parameters without constraining them too strictly

## AnyColumnBuilder and Generic Variance

**Pattern**: `AnyColumnBuilder` must use `any` for the `Operations` parameter due to TypeScript's variance limitations.

### The Problem

TypeScript's variance rules don't allow expressing "any type that extends `OperationTypes`" in a way that works for assignment. Contract-specific `OperationTypes` (e.g., `PgVectorOperationTypes`) are not assignable to the base `OperationTypes` in generic parameter position, even though they extend it structurally.

**❌ WRONG: Using `OperationTypes` directly**

```typescript
export type AnyColumnBuilder = ColumnBuilder<string, StorageColumn, unknown, OperationTypes>;
```

**Problem**: `ColumnBuilder<..., PgVectorOperationTypes>` is not assignable to `ColumnBuilder<..., OperationTypes>` due to variance rules, even though `PgVectorOperationTypes` extends `OperationTypes`.

### The Solution

**✅ CORRECT: Use `any` with documented explanation**

```typescript
// Helper aliases for usage sites where the specific column parameters are irrelevant
// Accepts any ColumnBuilder regardless of its Operations parameter
// Note: We use `any` here because TypeScript's variance rules don't allow us to express
// "any type that extends OperationTypes" in a way that works for assignment.
// Contract-specific OperationTypes (e.g., PgVectorOperationTypes) are not assignable
// to the base OperationTypes in generic parameter position, even though they extend it structurally.
// biome-ignore lint/suspicious/noExplicitAny: AnyColumnBuilder must accept column builders with any operation types
export type AnyColumnBuilder = ColumnBuilder<string, StorageColumn, unknown, any>;
```

**Why?**
- `AnyColumnBuilder` is intentionally permissive - it needs to accept column builders with any operation types
- The constraint is still checked at the `ColumnBuilder` level - `any` only bypasses the assignment check for `AnyColumnBuilder`
- The `any` is only in the type definition, not in runtime code
- This is a known TypeScript limitation with generic variance

### When This Pattern Applies

- Creating helper types that need to accept instances with any specific type parameter
- When TypeScript's variance rules prevent expressing the needed type relationship
- When the constraint is checked elsewhere (e.g., at the generic type definition level)

## Query Patterns

**Pattern**: Export `tables` from `query.ts` and import directly for better DX. See `.cursor/rules/query-patterns.mdc` for comprehensive query patterns.

**✅ CORRECT: Export tables from query.ts**

```typescript
// src/prisma/query.ts
export const tables = schema.tables;

// In query files
import { sql, tables } from '../prisma/query';

const plan = sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .build();
```

**✅ CORRECT: Extract variables for reuse**

```typescript
const userTable = tables.user;
const userColumns = userTable.columns;

const plan = sql
  .from(userTable)
  .select({ id: userColumns.id })
  .build();
```

See `.cursor/rules/query-patterns.mdc` for full details on query patterns, type inference, and common usage patterns.

## Type Safety is Non-Negotiable

**CRITICAL RULE**: Never disable type checking with `@ts-expect-error` or type assertions to work around broken types. Type safety is one of the most important characteristics of this codebase, especially for the ORM implementation. If types aren't working, you haven't done your job - fix the type definitions, not the usage.

**❌ WRONG: Suppressing type errors instead of fixing them**

```typescript
// @ts-expect-error - Plan type is complex, runtime works correctly
const result = await runtime.execute(plan);
```

**✅ CORRECT: Fix the type by properly typing the plan**

```typescript
import type { Plan } from '@internal/contract/types';

const plan = orm.user().create({ email }) as Plan<number>;
const result = runtime.execute(plan);
```

**Why this matters:**
- Type safety is a core feature that users rely on
- Suppressing errors hides real type problems
- Broken types indicate incomplete implementation
- Users deserve full type safety, not workarounds

**When type inference fails:**
1. Check if the return type is correctly defined in the interface
2. Use explicit type assertions (`as Plan<number>`) if the type is correct but inference fails
3. Fix the type definitions if they're incorrect
4. Never use `@ts-expect-error` to silence type errors in production code

## Type Assertions in Test Files

**Pattern**: Use `@ts-expect-error` comments for intentional type assertions in test files when working with dynamic proxy objects or complex type scenarios. This is ONLY acceptable in test files, never in production code.

**Note**: Blind casts (`as unknown as X`) are also acceptable in test files only. See "Forbidden: Blind Type Casts" section above for the general rule.

**❌ WRONG: Adding type assertions without explanation**

```typescript
const builderWithInclude: unknown = (
  builder as {
    include: {
      posts: (child: unknown) => unknown;
    };
  }
).include.posts((child) => { /* ... */ });
```

**✅ CORRECT: Use `@ts-expect-error` with explanation**

```typescript
// @ts-expect-error - intentionally using type assertions in test
const builderWithInclude: unknown = (
  builder as {
    include: {
      posts: (child: unknown) => unknown;
    };
  }
).include.posts((child) => { /* ... */ });
```

**When to use `@ts-expect-error`:**
- When working with dynamic proxy objects (e.g., ORM model registry) in test files only
- When intentionally testing invalid inputs or error cases
- When TypeScript can't infer complex dynamic types correctly in test contexts
- Always include a comment explaining why the assertion is needed

**CRITICAL: Never use `@ts-expect-error` to suppress type errors in production code or to work around broken types. Type safety is a core feature of this codebase. If types aren't working, fix the type definitions, not the usage.**

**Handling Implicit `any` in Test Callbacks:**

**❌ WRONG: Implicit `any` in callback parameters**

```typescript
const plan = o.user().include.posts((child) => {
  // child is implicitly any
  return child.select((p) => { /* ... */ });
});
```

**✅ CORRECT: Explicit `unknown` annotations**

```typescript
const plan = o.user().include.posts((child: unknown) => {
  const childBuilder = child as {
    select: (fn: (model: unknown) => unknown) => unknown;
  };
  return childBuilder.select((p: unknown) => {
    const model = p as { id: unknown; title: unknown };
    return { id: model.id, title: model.title };
  });
});
```

**Type Assertions for Dynamic Proxy Objects:**

**Pattern**: When working with dynamic proxy objects (e.g., ORM model registry) **in test files only**, cast to `unknown` first, then to the specific shape.

**Note**: This pattern is **only acceptable in test code**. Production code must use type predicates. See "Forbidden: Blind Type Casts" section above.

**❌ WRONG: Direct type assertion**

```typescript
const builder = (o as { user: () => unknown }).user();
```

**✅ CORRECT: Cast to `unknown` first (test code only)**

```typescript
// ✅ ACCEPTABLE: In test file only - working with dynamic proxy
const builder = (o as unknown as { user: () => unknown }).user();
```

**Why?**
- Dynamic proxy objects have complex types that TypeScript can't always infer correctly
- Casting to `unknown` first allows TypeScript to accept the subsequent type assertion
- This pattern is common when working with Proxy-based APIs
- **Exception to blind cast rule**: Test code only

## Test Mock Type Assertions

**Pattern**: When creating test mocks that don't perfectly match types, use `as unknown as Type` (double cast). **This is the ONLY acceptable use of blind casts.**

**Note**: Blind casts (`as unknown as X`) are forbidden in production code. See "Forbidden: Blind Type Casts" section above. This exception applies **only** to test code.

**❌ WRONG: Using `any` in test mocks**
```typescript
function createMockColumnBuilder(...): any {
  return {
    kind: 'column',
    eq: () => ({ kind: 'binary', op: 'eq', left: {} as any, right: {} as any }),
  };
}
```

**✅ CORRECT: Using `unknown` with proper type assertions (test code only)**
```typescript
// ✅ ACCEPTABLE: In test file only - creating simplified mock
function createMockColumnBuilder(...): AnyColumnBuilder {
  return {
    kind: 'column',
    eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
  } as unknown as AnyColumnBuilder;
}
```

**Why?**
- `unknown` is type-safe (requires explicit checks)
- Double cast (`as unknown as Type`) allows TypeScript to accept the assertion when types don't perfectly overlap
- Avoids lint errors from `noExplicitAny` rule
- Makes it clear the mock is intentionally simplified
- **Exception to blind cast rule**: Test code only

**When to use:**
- Creating test mocks that don't implement the full interface
- Mocking complex types where full implementation isn't needed
- Test utilities that return simplified versions of types
- **Only in test files** - never in production code

## Mocking Class Instances in Tests

**CRITICAL**: When mocking class instances in tests, never use the spread operator (`...`) as it loses methods. Use `Object.create()` and `Object.assign()` to preserve the prototype.

**❌ WRONG: Spreading class instance loses methods**

```typescript
// Spreading a class instance loses all methods
const mockedFamily = {
  ...config.family,  // Methods are lost!
  verify: mockedVerify,
};
// config.family.validateContract is now undefined
```

**✅ CORRECT: Preserve prototype when mocking class instances**

```typescript
// Preserve all methods from the original class instance
const mockedFamily = Object.create(Object.getPrototypeOf(config.family));
Object.assign(mockedFamily, config.family, {
  verify: mockedVerify,
});
// All methods (validateContract, convertOperationManifest, etc.) are preserved
```

**Why?**
- The spread operator only copies enumerable own properties, not methods from the prototype
- `Object.create(Object.getPrototypeOf(instance))` creates a new object with the same prototype
- `Object.assign()` copies all properties (including methods) from the original instance
- This preserves all methods while allowing you to override specific properties

**When to use:**
- Mocking class instances in tests where you need to override some properties but keep methods
- Creating partial mocks of class instances
- Preserving prototype chain when modifying instances

## DRY Test Patterns

**Pattern**: Common patterns in test files should be extracted into helper functions with JSDoc comments explaining their purpose.

**Use `@repo/test-utils` for generic shared helpers** - Check the shared package first before creating new helpers. Note that `@repo/test-utils` has zero dependencies on other `@internal/*` packages to avoid circular dependencies. For runtime-specific utilities, use `@internal/runtime/test/utils`. For contract-related utilities in E2E tests, use `e2e-tests/test/utils.ts`.

**❌ WRONG: Repeated pattern throughout test file or creating helpers that already exist**

```typescript
// ❌ WRONG: Repeated 20+ times throughout the file
for await (const _row of runtime.execute(mockPlan)) {
  void _row;
  break;
}

// ❌ WRONG: Creating helpers in test files when they're used across suites
async function emitAndLoadContract(...) { /* ... */ }
async function setupDatabase(...) { /* ... */ }
```

**✅ CORRECT: Use shared utilities from appropriate locations**

```typescript
import { withDevDatabase, withClient } from '@repo/test-utils';
import {
  executePlanAndCollect,
  setupE2EDatabase,
  createTestRuntimeFromClient,
} from '@internal/runtime/test/utils';
import { loadContractFromDisk } from './utils';

// Use shared helpers - return type is automatically inferred from plan
const rows = await executePlanAndCollect(runtime, plan);
type Row = ResultType<typeof plan>;  // Optional: for type tests
const contract = await loadContractFromDisk<Contract>(contractJsonPath);
await setupE2EDatabase(client, contract, async (c) => { /* ... */ });
```

**✅ CORRECT: Extract to helper function only when pattern is package-specific**

```typescript
/**
 * Creates a stub adapter for testing query building.
 * Package-specific helper - not used elsewhere.
 */
function createStubAdapter(): Adapter<...> {
  // ... package-specific implementation
}
```

**When to use shared package:**
- ✅ Pattern is used across multiple test suites
- ✅ Pattern involves common infrastructure (database, contracts, runtime)
- ✅ Pattern would benefit from centralized maintenance

**When to create package-specific helper:**
- ✅ Pattern is specific to one package's tests
- ✅ Pattern involves package-specific mocks or stubs
- ✅ Pattern is unlikely to be reused elsewhere

**Why this matters:**
- Reduces code duplication across test suites
- Makes tests more maintainable
- Centralizes common patterns in one place
- Easier to update patterns across all tests

**See `docs/Testing Guide.md` for comprehensive testing practices, including:**
- When to create helpers (3+ occurrences, multiple steps, obscures intent)
- Helper characteristics (hide implementation, express intent, reduce lines)
- Common helper patterns from the codebase
- Testing anti-patterns and solutions
