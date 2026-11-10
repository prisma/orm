# ADR 202 — Codec trait system

> **Update — `targetTypes` is removed** by [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md): a codec names the data type it represents, and the data type declares how the database names the type. Where this ADR names `targetTypes`, it describes the codec shape of its time.

> **Retrospective note.** This ADR's examples show codec definitions via `defineCodec({...})`. That factory was retired in favor of class-based descriptors (`CodecDescriptorImpl`); traits are now declared as `override readonly traits = [...] as const` on the descriptor class. The `'json-validator'` trait this ADR introduced was also retired — JSON-Schema validation now lives uniformly inside the resolved codec's `decode` body rather than behind a parallel `JsonSchemaValidatorRegistry`. The trait system itself, the operator-gating semantics, and the canonical traits set are all unchanged. See [ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) and the [Codec authoring guide](../../reference/codec-authoring-guide.md).

## Context

Data types in the system are identified by codec IDs (e.g., `pg/int4@1`, `pg/text@1`, `pg/vector@1`). Query surfaces need to know which operators and functions are valid for a given data type — for example, ordering a `jsonb` column with `lt` or applying `sum` to a `text` column are not meaningful SQL. Today there is no generic mechanism to express these semantic constraints.

Meanwhile, the ORM aggregate layer has already been forced to work around the absence of type-level semantic information. `NumericNativeType` in `sql-orm-client/src/types.ts` enumerates 14 Postgres-specific native type strings to decide which fields support `sum` and `avg`. This is brittle, target-specific, and violates the adapter boundary.

Operations already have a capability-gating mechanism (ADR 117), but that gates *extension operations* (e.g., pgvector's `cosineDistance`) — it does not describe the *intrinsic semantic capabilities* of a data type. We need a layer between individual codec identity and individual operation signatures: a vocabulary of **traits** that codecs declare and that DSL surfaces can require.

## Problem

1. **No type-safety for built-in operators** — comparison operators (`gt`, `lt`, `gte`, `lte`) could be applied to any column, even types where ordering is meaningless (e.g., `json`, `bytea`). Equality (`eq`, `neq`) is similarly unconstrained.

2. **No boolean gating for WHERE/HAVING** — there is no way for a query surface to verify that an expression produces a boolean-like result before accepting it in a predicate position.

3. **Hardcoded target-specific type lists** — the ORM's `NumericNativeType` union enumerates Postgres native type names to detect numeric fields. This breaks for other targets and for extension types that are numeric (e.g., a hypothetical custom decimal codec).

4. **No math-function gating** — when we add built-in math expressions (`abs`, `ceil`, `round`, etc.), there is no mechanism to restrict them to numeric types without hardcoding codec IDs.

## Decision

Introduce a **trait system** for codecs. A trait is a named semantic capability that a codec declares. DSL surfaces use traits — not codec IDs or native type names — to decide which operators and functions are valid for a given type.

### Trait vocabulary

The initial trait set is:

| Trait | Meaning | Enables |
|-------|---------|---------|
| `equality` | Values can be compared for equality | `eq`, `neq` |
| `order` | Values have a total or partial order | `gt`, `lt`, `gte`, `lte`, `asc`, `desc`, `orderBy` |
| `boolean` | Values are truth-valued | Usable in `where`, `having`, `and`, `or`, `not` |
| `numeric` | Values support arithmetic | `sum`, `avg`, `abs`, `ceil`, `floor`, `round`, math operators |
| `textual` | Values are character strings | `like`, `ilike`, `concat`, `substring`, `trim`, `lower`, `upper` |

Traits are **not mutually exclusive**. A numeric type is typically also order-comparable and equality-comparable. A boolean type is typically also equality-comparable. Codecs declare the full set of traits they support.

### Codec interface extension

```ts
/**
 * Semantic traits a codec declares.
 * Used by DSL surfaces to gate which operators and functions are available.
 */
type CodecTrait = 'equality' | 'order' | 'boolean' | 'numeric' | 'textual';

interface Codec<Id, TTraits, TWire, TJs, TParams, THelper> {
  // ... existing fields ...

  /**
   * Traits this codec's type supports.
   * When omitted, the codec is treated as having no traits — only explicit
   * operations registered for this codec ID are available.
   */
  readonly traits?: TTraits;
}
```

### Trait declaration by adapters

Traits are declared at codec registration time. Core SQL codecs and adapter codecs declare traits alongside their existing definitions:

```ts
// sql-codecs.ts
const sqlIntCodec = defineCodec({
  typeId: SQL_INT_CODEC_ID,
  targetTypes: ['int'],
  traits: ['equality', 'order', 'numeric'],
  encode: (value) => value,
  decode: (wire) => wire,
});
```

```ts
// postgres adapter codecs
const pgTextCodec = defineCodec({
  typeId: 'pg/text@1',
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgBoolCodec = defineCodec({
  typeId: 'pg/bool@1',
  targetTypes: ['bool'],
  traits: ['equality', 'boolean'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const pgJsonbCodec = defineCodec({
  typeId: 'pg/jsonb@1',
  targetTypes: ['jsonb'],
  traits: ['equality'],  // equality only; not order-comparable
  encode: (value) => value,
  decode: (wire) => wire,
});
```

Extension codecs declare traits the same way:

```ts
// pgvector codec — vectors have equality but are not order-comparable or numeric
const pgVectorCodec = defineCodec({
  typeId: 'pg/vector@1',
  targetTypes: ['vector'],
  traits: ['equality'],
  // ...
});
```

### Trait lookup

The `CodecRegistry` gains a trait-query method:

```ts
interface CodecRegistry {
  // ... existing methods ...

  /** Returns true if the codec with this ID has the given trait. */
  hasTrait(codecId: string, trait: CodecTrait): boolean;

  /** Returns all traits for a codec, or an empty array if not found. */
  traitsOf(codecId: string): readonly CodecTrait[];
}
```

### Contract-level trait maps

Traits are codec metadata — they travel with the codec, not with the contract. The contract continues to store `codecId` per column. At runtime, the `ExecutionContext` resolves traits via the codec registry.

For **type-level** gating (TypeScript compile-time constraints), we need trait information in the type system. Rather than introducing a separate type map, we extend the existing `CodecTypes` — each entry already carries `output` (the JS type); we add a `traits` tuple:

```ts
// In emitted contract.d.ts — CodecTypes already exists, we extend each entry
export type CodecTypes = {
  readonly 'pg/int4@1': { readonly input: number; readonly output: number; readonly traits: 'equality' | 'order' | 'numeric' };
  readonly 'pg/text@1': { readonly input: string; readonly output: string; readonly traits: 'equality' | 'order' | 'textual' };
  readonly 'pg/bool@1': { readonly input: boolean; readonly output: boolean; readonly traits: 'equality' | 'boolean' };
  readonly 'pg/jsonb@1': { readonly input: JsonValue; readonly output: JsonValue; readonly traits: 'equality' };
  // ...
};
```

Traits are a **union type** rather than a tuple. This simplifies type-level checks — `'numeric' extends CTypes[Id]['traits']` reads naturally and avoids indexed-access gymnastics on tuple positions.

This keeps a single source of truth per codec ID — no need to keep two parallel maps in sync.

### DSL gating

Query surfaces use traits to gate which operators and functions are available on a given column or expression. This works at two levels:

**Type level** — conditional types resolve a codec's traits from `CodecTypes` and include or exclude method signatures:

```ts
type TraitMethods<Name, Meta, JsType, Traits extends CodecTrait> =
  & ('equality' extends Traits
      ? EqualityMethods<Name, Meta, JsType>
      : Record<string, never>)
  & ('order' extends Traits
      ? OrderMethods<Name, Meta, JsType>
      : Record<string, never>)
  // etc.
```

**Runtime level** — column/expression builders query the codec registry at construction time and only attach methods for traits the codec declares:

```ts
const traits = codecRegistry.traitsOf(columnMeta.codecId);

if (traits.includes('equality')) {
  builder.eq = createComparisonMethod('eq');
  builder.neq = createComparisonMethod('neq');
}

if (traits.includes('order')) {
  builder.gt = createComparisonMethod('gt');
  // ...
  builder.asc = createOrderMethod('asc');
  builder.desc = createOrderMethod('desc');
}
```

### Replacing NumericNativeType

The ORM's `NumericNativeType` union is replaced by a trait-based check:

```ts
// Before: hardcoded native type enumeration
type IsNumericStorageColumn<Column> =
  Column extends { readonly nativeType: infer N extends NumericNativeType } ? true : false;

// After: trait-based check via CodecTypes
type IsNumericStorageColumn<Column, CTypes extends Record<string, { readonly traits: CodecTrait }>> =
  Column extends { readonly codecId: infer Id extends string }
    ? Id extends keyof CTypes
      ? 'numeric' extends CTypes[Id]['traits']
        ? true
        : false
      : false
    : false;
```

### Trait precedence and overrides

Traits are **declared by the codec** and are immutable after registration. There is no mechanism for app code to add traits to a codec it did not author. If an app needs a codec with different traits, it registers a new codec with the desired traits and uses that codec ID in its contract.

## Layer ownership

| Layer | Responsibility |
|-------|---------------|
| **Codec** (adapter/pack) | Declares traits at registration time |
| **CodecRegistry** (relational-core) | Stores and queries traits |
| **Contract emitter** (authoring) | Emits `traits` into each `CodecTypes` entry in `contract.d.ts` |
| **Query surfaces** (lanes, ORM) | Gate operators and functions based on traits at type level and runtime |
| **Contract** | Unchanged — stores `codecId` per column, no trait data |

## Examples

### End-to-end: numeric column

1. **Adapter** registers `pg/int4@1` codec with `traits: ['equality', 'order', 'numeric']`
2. **Contract emitter** inspects codecs used in the contract, emits `traits` union into `CodecTypes` entry
3. **At type level**, a column builder for an `int4` column includes `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `asc`, `desc`
4. **At runtime**, the column builder attaches all comparison, ordering, and (future) math methods
5. **ORM aggregate** `sum(field)` constrains `field` to columns whose codec has `numeric` trait

### End-to-end: JSON column

1. **Adapter** registers `pg/jsonb@1` codec with `traits: ['equality']`
2. **At type level**, a column builder for a `jsonb` column includes only `eq`, `neq` — no `gt`, `lt`, `asc`, `desc`
3. **At runtime**, calling `.gt()` on a `jsonb` column is a type error at compile time and absent at runtime

### End-to-end: boolean column in WHERE

1. **Adapter** registers `pg/bool@1` codec with `traits: ['equality', 'boolean']`
2. **At type level**, the `where()` method constrains its argument to builders whose expression type has the `boolean` trait (or is a comparison result which is implicitly boolean)
3. Passing a raw `int4` column to `where()` without a comparison is a type error

## Scope and non-goals

### In scope (MVP)

- `CodecTrait` type and five initial traits
- `traits` field on `Codec` interface
- `hasTrait` / `traitsOf` on `CodecRegistry`
- Trait declarations on all core SQL and Postgres adapter codecs
- Runtime trait queries usable by any query surface
- `traits` union in each `CodecTypes` entry in emitted `contract.d.ts`
- Type-level trait resolution from `CodecTypes` for query surfaces
- Replace `NumericNativeType` in ORM with trait-based check

### Trait-gating extends to value object dot-path access

Trait-gating is not limited to direct column access. The dot-path field accessor ([ADR 180](ADR%20180%20-%20Dot-path%20field%20accessor.md)) navigates into value objects and returns an `Expression` at the leaf. That expression carries the same trait-gated operators as a direct column — a text field reached via `u("homeAddress.city")` has `eq`, `gt`, `like` (the same methods as `u.email`), and a vector field reached via `u("specs.featureVector")` has `cosineDistance`. The trait resolution is the same: the leaf field's `codecId` determines which traits apply.

### Non-goals

- Custom user-defined traits (trait vocabulary is fixed in framework)
- Trait-based gating in the migration planner
- Traits for non-SQL (document) codecs
- Automatic trait inference from native types (traits are explicit)

## Alternatives considered

### Hardcode codec IDs in the query builder

Gate methods by checking `codecId` against known lists (e.g., `['pg/int4@1', 'pg/float8@1', ...]` for numeric). Rejected because it couples core DSL code to specific targets and breaks for extension or custom codecs.

### Use native type names (current ORM approach)

Continue using `nativeType` string matching. Rejected because it is target-specific, does not work for extension types, and requires maintaining parallel type enumerations.

### Reuse the capability system (ADR 117)

Add traits as capability keys (e.g., `sql.order`). Rejected because capabilities describe *environment features* negotiated at connect time, not *intrinsic type semantics*. Traits are static properties of a codec — they do not depend on the server version, installed extensions, or adapter profile.

### Trait interfaces instead of string tags

Model traits as TypeScript interfaces that codecs extend (e.g., `interface OrderCodec extends Codec`). Rejected because it complicates the registry and type extraction without clear benefit — the set of traits is small and fixed, making a union of string literals simpler.

## Consequences

### Positive

- Query builder methods are only available on columns where they are semantically meaningful
- Type errors at compile time prevent invalid queries (e.g., ordering a JSON column)
- Removes all target-specific native type enumerations from core and ORM code
- Extension codecs get first-class integration with built-in operators by declaring traits
- Small, additive change to the Codec interface — fully backward compatible (traits field is optional)

### Negative

- All existing adapter codecs must be updated to declare traits (mechanical but widespread)
- Each `CodecTypes` entry in emitted `contract.d.ts` grows by a `traits` field
- Query surfaces that previously assumed all operators are available on all types will need to check traits

## Open questions


- Comparison results (e.g., `col.eq(value)`) are implicitly boolean in SQL. Should query surfaces treat them as carrying the `boolean` trait automatically, or should they be a distinct predicate type? The former is simpler; the latter is more precise and would let type-level checks distinguish between "comparison result" and "boolean column".

## References

- ADR 030 — Result decoding & codecs registry
- ADR 114 — Extension codecs & branded types
- ADR 117 — Extension capability keys
- ADR 113 — Extension function & operator registry
- [ADR 180 — Dot-path field accessor](ADR%20180%20-%20Dot-path%20field%20accessor.md) — trait-gating applies to expressions returned by the dot-path accessor
- PR #247 — feat: Introduce codec trait system
