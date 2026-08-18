# Codec authoring guide

This guide describes the canonical authoring shape for codecs in Prisma Next: **class-based codecs and descriptors** (`CodecImpl`, `CodecDescriptorImpl`, and target-owned SQL descriptor subclasses), per-codec column helpers, and `satisfies` for compile-time wiring. The design rationale and the broader codec model live in [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md); this document is the practical "how to write a codec" reference for contributors.

## At a glance

A codec is **three artifacts**:

1. A **codec class** that extends `CodecImpl<Id, TTraits, TWire, TInput>` and implements all four conversion methods: `encode`, `decode`, `encodeJson`, and `decodeJson`.
2. A **descriptor class** that extends `CodecDescriptorImpl<P>` for a target-neutral codec, or the target-owned `PostgresCodecDescriptor<P>` / `SqliteCodecDescriptor<P>` for a target-bound SQL codec, and declares the codec id, traits, target types, params schema, and the curried factory that materializes codec instances.
3. A **per-codec column helper function** that calls `descriptor.factory(...)` directly and packages the result into a `ColumnSpec` via the framework-supplied `column(...)` packager. The helper carries a `satisfies ColumnHelperFor<D>` clause that ties it to its descriptor at compile time.

The framework imports live at `@internal/framework-components/codec`:

- `CodecImpl<Id, TTraits, TWire, TInput>` — abstract codec base class.
- `CodecDescriptorImpl<P>` — abstract descriptor base class.
- `ColumnHelperFor<D>` / `ColumnHelperForStrict<D>` — `satisfies` shapes for per-codec helpers.
- `column(codecFactory, codecId, typeParams, nativeType)` — column-spec packager (`nativeType` is the database spelling for migrations and contract meta).
- `voidParamsSchema` — Standard Schema validator for `P = void` (non-parameterized codecs).
- `Codec<...>`, `CodecDescriptor<P>`, `AnyCodecDescriptor` — consumer-facing interfaces (consumers depend on these; target-neutral authors extend the `*Impl` classes, while target-bound SQL authors use target-owned bases).

SQL codecs use the same framework `CodecImpl` base. Their `encodeJson` and `decodeJson` methods define the codec's JSON-safe contract representation; `decode` remains responsible for the driver's ordinary column wire value. Keep that representation stable and mutually consistent, and keep `decodeJson` compatible with the values the current SQL JSON renderer returns for the codec. This distinction matters for types such as PostgreSQL `bytea` and extension-defined types whose values inside database-produced JSON may differ from their normal driver representation.

PostgreSQL and SQLite target descriptors also declare AST-to-AST JSON projection hooks, described below. The production JSON renderers call `projectJson()` for every column-valued entry they build, so a descriptor's projection is what a database actually returns — see [The canonical JSON guarantee](#the-canonical-json-guarantee).

## The canonical JSON guarantee

**A value read back through database-produced JSON is the value that was stored.** Where a query returns JSON — an `.include()`'s nested rows, an aggregated child row set — each column reaches that JSON through its own codec's projection, and `decodeJson` returns the application value the column holds. A `numeric` arrives as its exact decimal text rather than rounded through a double; a `bytea` as base64 rather than a hex escape; a `bigint` as decimal text rather than a JSON number that cannot hold it. Absence is preserved: a `NULL` column reads back as `null`, never as a zero or an empty value.

The guarantee reaches values the query **computes** as well as values it stores. An aggregate has no column codec to be canonical against, so its target declares one — see the [aggregate descriptor guide](./aggregate-descriptor-guide.md) — and the declared codec is what the value enters JSON under and is read back through. A count inside an `.include()` arrives under `pg/int8number@1`, whose canonical JSON is a JSON number and whose post-parse guard refuses a value the safe-integer range cannot hold; a `countBigInt` in the same position arrives under `pg/int8@1` as decimal text. An aggregate no target declares an overload for does not weaken this: the call is a type error on the typed surfaces, and a dynamic invocation is rejected with `ORM.AGGREGATE_UNSUPPORTED` before any SQL is built — no undeclared value ever reaches JSON.

The guarantee rests on the codec, not on the database's own JSON conversion, which is why it can be stated at all. It has exactly two limits, and both are real:

- **`pg/geometry@1` is exempt.** The PostGIS geometry codec has no canonical JSON projection, so a geometry column inside database-produced JSON carries whatever PostGIS's own JSON conversion emits, and round-tripping it is not guaranteed. Tracked as [TML-3105](https://linear.app/prisma-company/issue/TML-3105).
- **Float codecs need `extra_float_digits >= 1`.** `pg/float4@1`, `pg/float8@1`, `pg/float@1` and `sql/float@1` render through PostgreSQL's float-to-text conversion, which `extra_float_digits` controls. At `1` (the default since PostgreSQL 12) it prints the shortest decimal that round-trips exactly, and the guarantee holds. A session that lowers it to `0` or below prints fewer digits than the value needs, and a float read back through JSON may differ from the one stored. Nothing in the framework enforces the setting; if your deployment changes it, floats are outside the guarantee.

Non-finite floats are rejected rather than silently mangled: JSON has no spelling for `NaN` or an infinity, and a database that holds one emits it as a *string*, so `sql/float@1` and `sqlite/real@1` refuse them in both directions rather than hand back a string typed as `number`. `pg/numeric@1` accepts all three, because its application value is already text.

The consumer-facing [`BigInt`, `BigIntNumber`, and `UnboundedInt` representation choices](./integer-representation-types.md), including `BigIntNumber`'s deliberate JSON-number exception, are documented separately from this contributor guide.

The PostgreSQL temporal codecs pair a `Temporal`-valued codec with a raw-text one for each native type; the [consumer-facing representation choice](./postgres-temporal-types.md) covers when each applies and what the Temporal global is required for.

## Three case studies

The same three artifacts express the full spectrum: non-parameterized, parameterized with literal preservation, and parameterized with a typed schema.

Case 1 carries the full framework import block; Cases 2 and 3 continue from it and list only the imports each one adds. All three elide the pack's own internals — `Vector` / `parseVector` in Case 2, `ArktypeSchemaLike` / `rehydrateSchema` / `validateSchema` in Case 3 — so read them as descriptor shape rather than as complete files.

### Case 1 — Non-parameterized codec (`pg/text@1`)

```ts
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  type CodecInstanceContext,
  CodecImpl,
  type ColumnHelperFor,
  column,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';

class PgTextCodec extends CodecImpl<
  'pg/text@1',
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext) { return value; }
  async decode(wire: string, _ctx: CodecCallContext) { return wire; }
  encodeJson(value: string) { return value; }
  decodeJson(json: JsonValue) {
    if (typeof json !== 'string') {
      throw new TypeError('Expected a string JSON value');
    }
    return json;
  }
}

class PgTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override nativeType(): string {
    return 'text';
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = 'pg/text@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    const shared = new PgTextCodec(this);
    return () => shared;
  }
}

export const pgTextDescriptor = new PgTextDescriptor();

export const text = () =>
  column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined, 'text');
text satisfies ColumnHelperFor<PgTextDescriptor>;
```

The factory is **constant**: every call returns the same shared codec instance. The runtime relies on this contract — non-parameterized columns sharing a codec id share one resolved codec without explicit caching.

### Case 2 — Parameterized codec with literal preservation (`pg/vector@1`)

```ts
import { type } from 'arktype';

class VectorCodec<N extends number> extends CodecImpl<
  'pg/vector@1',
  readonly ['equality'],
  string,
  Vector<N>
> {
  constructor(descriptor: PgVectorDescriptor, readonly dimension: N) {
    super(descriptor);
  }
  async encode(value: Vector<N>, _ctx: CodecCallContext) {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return parseVector(wire) as Vector<N>;
  }
}

class PgVectorDescriptor extends PostgresCodecDescriptor<{ readonly length: number }> {
  protected override nativeType(): string {
    return 'vector';
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = 'pg/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = type({ length: 'number > 0' });
  override renderOutputType({ length }: { length: number }) { return `Vector<${length}>`; }
  override factory<N extends number>(
    params: { readonly length: N },
  ): (ctx: CodecInstanceContext) => VectorCodec<N> {
    return (ctx) => new VectorCodec<N>(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

export const vector = <N extends number>(length: N) =>
  column(
    pgVectorDescriptor.factory({ length }),
    pgVectorDescriptor.codecId,
    { length },
    'vector',
  );
vector satisfies ColumnHelperFor<PgVectorDescriptor>;
```

The class-level params type is `{ readonly length: number }` (widest bound). The **method-level generic** `<N extends number>` on `factory` is what preserves the literal at the call site: when `vector(1536)` calls `pgVectorDescriptor.factory({ length: 1536 })` *directly*, TypeScript binds `N=1536`. The literal flows through `column(...)`'s generics into the column spec, into the contract type, and into `contract.d.ts`.

This is the **load-bearing variance pattern**: method generics on the descriptor's factory are preserved by direct invocation inside the per-codec helper, not by structural extraction at a polymorphic helper. A polymorphic `column<P, R>(descriptor, params)` helper that tried to extract `R` from the descriptor's `factory` would lose the literal — TypeScript instantiates method generics to their constraint at every form of structural extraction (structural match, indexed access, `Parameters` / `ReturnType`, etc.).

### Case 3 — Parameterized codec with typed schema (`arktype/json@1`)

The schema's TypeScript-level inferred type `S['infer']` is only available at the column-author site (where the user passes their typed schema), not at the descriptor's factory site (where only the serialized IR is available). This drives a slightly richer shape than Case 2:

```ts
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';

class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  'arktype/json@1',
  readonly ['equality'],
  string,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) { super(descriptor); }
  async encode(value: TInferred, _ctx: CodecCallContext) {
    return serializeToJsonSafe(this.schema, value).wire;
  }
  async decode(wire: string, _ctx: CodecCallContext) {
    return validateSchema<TInferred>(this.schema, JSON.parse(wire));
  }
}

class ArktypeJsonDescriptor extends PostgresCodecDescriptor<ArktypeJsonTypeParams> {
  protected override nativeType(): string {
    return 'jsonb';
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly codecId = 'arktype/json@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['jsonb'] as const;
  override readonly paramsSchema = type({
    expression: 'string',
    jsonIr: 'object',
  }) satisfies StandardSchemaV1<ArktypeJsonTypeParams>;
  override renderOutputType(params: ArktypeJsonTypeParams) { return params.expression; }
  override factory(
    params: ArktypeJsonTypeParams,
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown> {
    const schema = rehydrateSchema(params.jsonIr);
    return () => new ArktypeJsonCodecClass<unknown>(this, schema);
  }
}

export const arktypeJsonDescriptor = new ArktypeJsonDescriptor();

export function arktypeJsonColumn<S extends Type<unknown>>(
  schema: S,
): ColumnSpec<ArktypeJsonCodecClass<S['infer']>, ArktypeJsonTypeParams> {
  // Eager serialization captures `expression` (emit-path) and `jsonIr` (runtime rehydration) at the column-author site.
  const params: ArktypeJsonTypeParams = { expression: schema.expression, jsonIr: schema.json };
  return column(
    (_ctx) => new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptor, schema),
    arktypeJsonDescriptor.codecId,
    params,
    'jsonb',
  );
}
arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
```

Two things to note:

1. The descriptor's factory return is `ArktypeJsonCodecClass<unknown>` (the descriptor only sees IR — `S` is erased). The runtime path through `descriptor.factory(params)` always exists (e.g. for `validateContract` re-materialization); it just loses the typed inferred shape.
2. The column helper bypasses `descriptor.factory(...)` and constructs the typed codec directly so `S['infer']` flows through the column spec into the contract type. It satisfies `ColumnHelperFor<D>` (coarse) but not `ColumnHelperForStrict<D>` — the descriptor's factory return is `ArktypeJsonCodecClass<unknown>` while the helper produces `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is invariant. Negative type tests cover the literal-preservation property the strict variant would otherwise enforce.

JSON-Schema validation lives **inside `decode`**: the rehydrated schema is closure-captured by the codec instance, and `decode` calls into it synchronously. There is no parallel validator registry — the framework deleted `JsonSchemaValidatorRegistry` when unified descriptors and inline decode validation replaced the parallel registry.

## Target-owned SQL codec descriptors

A SQL extension binds each codec descriptor to the target that owns its native storage and JSON projection rules. Import the target protocol from the target package's lean `./codec-descriptor` export; this is a runtime dependency whenever production extension source imports it. Target-neutral framework and SQL-family descriptors may continue to extend `CodecDescriptorImpl<P>`, but they must be explicitly adapted before a PostgreSQL or SQLite adapter accepts them.

### PostgreSQL

Subclass `PostgresCodecDescriptor<P>` when the codec itself is PostgreSQL-bound. Keep all ordinary descriptor members from the generic authoring model, and add the two protected target hooks:

```ts
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';

class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  protected override nativeType(_params: VectorParams): string {
    return 'vector';
  }

  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: VectorParams,
  ): ProjectionExpr {
    return expression;
  }

  // codecId, traits, targetTypes, paramsSchema, factory and renderOutputType
  // stay on the ordinary descriptor.
}

export const pgVectorDescriptor = new PgVectorDescriptor();
export const codecDescriptors = definePostgresCodecs([pgVectorDescriptor]);
```

`nativeType(params)` returns the same trusted PostgreSQL type spelling used by the existing column, metadata, and control hooks. The public `nativeTypeFor(ref)` method validates `ref.typeParams` through `paramsSchema` before calling the protected hook; PostgreSQL parameter rendering uses this result for its cast policy. `jsonProjection(expression, params)` declares the scalar AST transformation. Identity is an explicit, behavior-preserving declaration during the 0.17 transition, not an implicit default.

The public `projectJson(expression, ref)` method validates parameters and dispatches scalar versus stored-array projection. For `ref.many === true`, the default `jsonArrayProjection` binds the input expression once, unnests with ordinality, applies the scalar hook to each non-null element, and preserves a null array, an empty array, null elements, and element order. Override `jsonArrayProjection` only when the target codec has an equivalent optimized transformation.

Adapt a reusable generic descriptor with `postgresCodec(...)` instead of subclassing it solely to add target behavior:

```ts
import { sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';

const postgresSqlIntDescriptor = postgresCodec(sqlIntDescriptor, {
  nativeType: () => 'integer',
  jsonProjection: (expression) => expression,
});
```

The adapter delegates the wrapped descriptor's codec id, literals, parameter schema, factory, renderers and target types. It adds the PostgreSQL discriminant and target methods without changing codec materialization.

### SQLite

Subclass `SqliteCodecDescriptor<P>` for a SQLite-bound codec and implement the scalar projection hook. SQLite has no stored scalar-array descriptor protocol; `projectJson()` rejects `CodecRef.many` rather than guessing a storage representation.

```ts
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  defineSqliteCodecs,
  SqliteCodecDescriptor,
} from '@internal/target-sqlite/codec-descriptor';

class SqliteTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(
    expression: ProjectionExpr,
    _params: void,
  ): ProjectionExpr {
    return expression;
  }

  // Keep the ordinary descriptor members unchanged.
}

export const sqliteTextDescriptor = new SqliteTextDescriptor();
export const codecDescriptors = defineSqliteCodecs([sqliteTextDescriptor]);
```

Generic SQL descriptors are adapted explicitly with `sqliteCodec(...)`:

```ts
import { sqlIntDescriptor } from '@internal/sql-relational-core/ast';
import { sqliteCodec } from '@internal/target-sqlite/codec-descriptor';

const sqliteSqlIntDescriptor = sqliteCodec(sqlIntDescriptor, {
  jsonProjection: (expression) => expression,
});
```

### Target-typed tuples and structural validation

`definePostgresCodecs(...)` and `defineSqliteCodecs(...)` are identity-style tuple helpers. They preserve each concrete descriptor's literal and factory types while rejecting a raw generic or wrong-target descriptor at authoring time. Prefer them to broad annotations such as `readonly AnyCodecDescriptor[]`; use `readonly AnyPostgresCodecDescriptor[]` or `readonly AnySqliteCodecDescriptor[]` only where an erased target-typed collection is necessary.

Adapter composition validates erased contributions structurally through `buildPostgresCodecDescriptorRegistry(...)` or `buildSqliteCodecDescriptorRegistry(...)`. Validation checks the stable `descriptorKind`, the ordinary descriptor contract, and the target's public methods, then rejects malformed, raw generic, wrong-target, or duplicate-id contributions before lowering a query. It deliberately does not rely on `instanceof`, so an extension remains valid when its package manager loads a separate copy of the target package. This is an open-world boundary: each target owns its descriptor subtype, validator, and registry rather than participating in a framework-global target map.

### Stack contribution and direct adapter injection

Contribute one canonical target-typed descriptor set through the existing target-neutral stack metadata. Runtime and control descriptors for the same extension must expose the same set; when the runtime SPI also requires `codecs()`, return that canonical set there as well.

```ts
const codecDescriptors = definePostgresCodecs([
  pgVectorDescriptor,
  postgisGeometryDescriptor,
]);

const codecTypes = { codecDescriptors };

export const runtimeExtension = {
  types: { codecTypes },
  codecs: () => codecDescriptors,
  // remaining runtime extension members
};

export const controlExtension = {
  types: { codecTypes },
  // remaining control extension members
};
```

Runtime and control stacks may assemble through different framework paths, but each target adapter validates the resulting ordered descriptor set once and builds one coherent registry for ordinary codec materialization and target behavior. Bare adapters remain built-ins-only. For focused construction outside a stack, pass target-typed descriptors through the adapter's single coherent option; custom descriptors append to built-ins:

```ts
import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { createSqliteAdapter } from '@internal/adapter-sqlite/adapter';

const postgresAdapter = createPostgresAdapter({
  codecDescriptors: postgresExtensionCodecs,
});

const sqliteAdapter = createSqliteAdapter({
  codecDescriptors: sqliteExtensionCodecs,
});
```

Do not inject an independent generic codec lookup and target registry: both views are derived from the same validated target descriptors so they cannot drift. Stack composition order remains target contributions, the full adapter descriptor set, then ordered extension contributions.

### One source of target truth

The descriptor is the only place a target's behaviour for a codec is declared. `nativeTypeFor()` gives PostgreSQL's parameter-cast rendering and the column's declared type; `projectJson()` gives the expression that produces the column's canonical JSON. There is no parallel metadata channel to keep in step with them.

An identity `jsonProjection` is a claim, not a placeholder: it says this codec's stored form *is* its canonical JSON, as it is for `pg/text@1` and `pg/int4@1`. Write one only when that holds. A codec whose stored form cannot survive JSON — a wide integer, a byte string, a value whose text depends on a session setting — needs a projection that converts it, because the renderer will ask and then use the answer.

## `satisfies` discipline

The framework exports two helper-shape constraints:

- `ColumnHelperFor<D>` — checks the helper returns a `ColumnSpec` whose typeParams shape matches `Parameters<D['factory']>[0]`. Catches wiring the wrong descriptor's factory in by typeParams shape; doesn't catch literal-preservation violations (those are covered by negative type tests).
- `ColumnHelperForStrict<D>` — also checks the helper's promised codec type matches `ReturnType<D['factory']>`. Use this when the codec's resolved type is well-defined (most cases). The strict form fails for helpers like `arktypeJsonColumn` whose typed return is more specific than the descriptor's factory return; in that case use the coarse form and rely on `expectTypeOf` tests for the literal-preservation property.

Both are exported from `@internal/framework-components/codec`.

## Reusing generic SQL descriptors in PostgreSQL

A reusable SQL-family descriptor remains target-neutral. Bind it to PostgreSQL with `postgresCodec(...)`; do not subclass the generic descriptor, because the PostgreSQL registry requires the target discriminant and target methods.

```ts
import { sqlCharDescriptor } from '@internal/sql-relational-core/ast';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';

const postgresSqlCharDescriptor = postgresCodec(sqlCharDescriptor, {
  nativeType: () => 'character',
  jsonProjection: (expression) => expression,
});
```

The adapter preserves the generic codec id, params schema, traits, factory, output renderer, target types, and metadata while adding PostgreSQL native-type and projection behavior.

When PostgreSQL owns a distinct codec id, define a `PostgresCodecDescriptor` subclass and delegate only the reusable SQL behavior explicitly:

```ts
class PgCharDescriptor extends PostgresCodecDescriptor<LengthParams> {
  protected override nativeType(): string {
    return 'character';
  }

  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }

  override readonly codecId = 'pg/char@1' as const;
  override readonly targetTypes = ['character'] as const;
  override readonly traits = sqlCharDescriptor.traits;
  override readonly paramsSchema = sqlCharDescriptor.paramsSchema;

  override renderOutputType(params: LengthParams): string | undefined {
    return sqlCharDescriptor.renderOutputType(params);
  }

  override factory(_params: LengthParams): (ctx: CodecInstanceContext) => SqlCharCodec {
    return () => new SqlCharCodec(this);
  }
}
```

This keeps target ownership explicit: adaptation is for a reusable descriptor with its existing id; target-owned subclassing is for a PostgreSQL codec with PostgreSQL identity or behavior. In both cases the result satisfies the PostgreSQL descriptor protocol and can participate in `definePostgresCodecs(...)`.

See [packages/3-targets/3-targets/postgres/src/core/codecs.ts](../../packages/3-targets/3-targets/postgres/src/core/codecs.ts) (`postgresSqlCharDescriptor`, `PgCharDescriptor`) for both patterns.

## Aggregate result codecs

What an aggregate returns is a declaration of its target, not a property of the input codec. That contribution surface — `SqlAggregateDescriptor` on `types.aggregateDescriptors`, a sibling of `codecTypes` — has its own reference: the [aggregate descriptor guide](./aggregate-descriptor-guide.md).

## Heterogeneous storage at the runtime layer

The framework's descriptor registry is keyed by `codecId: string` and stores type-erased descriptor instances. The canonical erasure type is `AnyCodecDescriptor` (defined in `packages/1-framework/1-core/framework-components/src/shared/codec-descriptor.ts`):

```ts
interface CodecDescriptorRegistry {
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  values(): IterableIterator<CodecDescriptor<unknown>>;
  byTargetType(targetType: string): readonly CodecDescriptor<unknown>[];
}
```

Registries are built from flat descriptor lists (see `buildCodecDescriptorRegistry` in `@internal/sql-relational-core`); there is no imperative `register` on the public surface.

`CodecDescriptor<P>` is invariant in `P` (the `factory` and `renderOutputType` slots use `P` contravariantly), so `CodecDescriptor<unknown>` is **not** assignable from concrete `CodecDescriptor<SpecificParams>` subclasses — the `<unknown>` shape would force `as` casts at every register/retrieve boundary. `AnyCodecDescriptor` is the only erasure form that admits cast-free heterogeneous storage.

Per-codec helpers don't pass through the registry — they're imported directly by extension authors and column-defining sites. The registry exists for runtime lookup (by codec id string), where types are already erased.

## Why classes work for this design

The class hierarchy isn't load-bearing for variance preservation (per-codec helpers' direct calls do that work). It's load-bearing for **structure**:

1. **Codec instance ↔ descriptor reference is structural.** The abstract `CodecImpl` constructor takes a `descriptor: AnyCodecDescriptor`; concrete codec subclasses pass it via `super(descriptor)`. `codec.id` proxies through this reference, so a target-owned descriptor can reuse a generic codec class while preserving the target-owned codec id without object spreads or prototype loss.
2. **Subclass-based authoring is uniform within each ownership boundary.** Target-neutral descriptors extend `CodecDescriptorImpl<...>`; PostgreSQL- and SQLite-bound descriptors extend their target-owned bases. Generic descriptors cross into a target through explicit adapters such as `postgresCodec(...)`. The variance behavior remains the same: the per-codec helper handles literal preservation via direct calls, while the descriptor class or adapter declares the target shape.

## Reference implementations in the repo

- **Non-parameterized base codecs** (text, int, float, bool, etc.): `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts`.
- **PostgreSQL target codecs and generic descriptor adapters**: `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
- **SQLite target codecs and generic descriptor adapters**: `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`.
- **Parameterized codec with literal preservation** (pgvector): `packages/3-extensions/pgvector/src/core/codecs.ts`.
- **Parameterized codec with typed schema** (arktype-json): `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts`.

## Pitfalls

- **`override` discipline.** With `noImplicitOverride`, every concrete-subclass member that touches an inherited member must carry `override`. Forgetting it surfaces as a typecheck error.
- **Don't widen the factory return at the descriptor.** Concrete descriptors should declare their factory's typed return (`(ctx) => VectorCodec<N>`, not `(ctx) => Codec<...>`). The widened return loses literal preservation at consumer sites.
- **Don't extract codec types via `Parameters` / `ReturnType` of the descriptor's `factory`.** TypeScript widens method generics to their constraint in those forms. Use the per-codec helper's typed return (`ColumnSpec<R, P>`) and project with `R extends Codec<any, any, any, infer T> ? T : never`.
- **Don't reach through the codec instance for metadata.** The runtime `Codec` instance is narrow (id + four conversion methods). Read traits / target types / meta from `descriptor` (e.g. `context.codecDescriptors.descriptorFor(codecId).traits`).

## See also

- [ADR 208 — Higher-order codecs for parameterized types](../architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) — design rationale and how the codec composes across authoring, emit, and runtime dispatch.
- [ADR 204 — Single-Path Async Codec Runtime](../architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — `encode` / `decode` are uniformly Promise-returning at the public boundary.
- [ADR 207 — Codec call context](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the `CodecCallContext` (per-call signal + family-extended column metadata) threaded into every encode/decode invocation.
