# ADR 208 — Higher-order codecs for parameterized types

## Context

ADR 207 (`cfe1b6dee`, [PR #400](https://github.com/prisma/prisma-next/pull/400) / TML-2330) was claimed by *Codec call context: per-query AbortSignal and column metadata* on a parallel branch; this ADR took the next free slot at 208.

The framework codec layering documented here mirrors PR #400's family-extension split: the framework `CodecInstanceContext` is family-agnostic (`{ name }` only); the SQL `SqlCodecInstanceContext` extends it with `usedAt: ReadonlyArray<{ table; column }>` in `sql-relational-core`. PR #400 shipped the same pattern at the per-call context: framework-level `CodecCallContext` (signal-only); SQL-level `SqlCodecCallContext extends CodecCallContext` adding `column?: SqlColumnRef`. The two split-points (per-instance materialization here, per-call dispatch in PR #400) share one principle — SQL-domain vocabulary lives in the SQL family layer; family-agnostic code uses the family-agnostic base.

## At a glance

A user authors one line of TypeScript:

```ts
import { vector } from '@internal/extension-pgvector/column-types';

const Document = model('Document', {
  fields: {
    embedding: field.column(vector(1536)).optional(),
  },
});
```

Three surfaces resolve from that single function call:

- The TypeScript view of `Document.embedding` is `Vector<1536> | null` — the literal `1536` is preserved, not widened to `number`.
- `pnpm emit` writes the same type into `contract.d.ts`.
- At runtime, decoding the wire form `'[1.2, 3.4, …]'` produces a value the type system already named `Vector<1536>`.

Before this ADR, each parameterized codec encoded its parameter relationship in three places: the column-helper factory function, an optional `paramsSchema` / `init` slot on the runtime `Codec`, and an optional `renderOutputType` slot (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). This ADR unifies those three surfaces under a single descriptor record so the user's `vector(1536)` is *the* source of truth across authoring, type checking, emitting, and runtime decoding.

## Decision

Every codec is described by a single descriptor type. The consumer surface is the `CodecDescriptor<P>` interface; codec authors extend the abstract class `CodecDescriptorImpl<P>`:

```ts
// Consumer surface (interface, in @internal/framework-components/codec)
export interface CodecDescriptor<P = void> {
  readonly codecId: string;
  readonly traits: readonly CodecTrait[];
  readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;
  readonly paramsSchema: StandardSchemaV1<P> | undefined; // undefined when P = void
  readonly isParameterized: boolean; // paramsSchema !== undefined
  readonly renderOutputType?: (params: P) => string | undefined;
  readonly factory: (params: P) => (ctx: CodecInstanceContext) => Codec;
}

// Codec-author surface (abstract class — what codec authors `extends`)
export abstract class CodecDescriptorImpl<P = void> implements CodecDescriptor<P> {
  abstract readonly codecId: string;
  abstract readonly traits: readonly CodecTrait[];
  abstract readonly targetTypes: readonly string[];
  readonly meta?: CodecMeta;
  abstract readonly paramsSchema: StandardSchemaV1<P> | undefined; // undefined when P = void
  readonly isParameterized: boolean; // derived from `paramsSchema !== undefined`
  renderOutputType?(params: P): string | undefined;
  abstract factory(params: P): (ctx: CodecInstanceContext) => Codec;
}
```

A **parameterized codec** is three artifacts: the codec class (extending `CodecImpl`), the descriptor class (extending `CodecDescriptorImpl<P>`), and a per-codec column helper that calls `descriptor.factory(...)` directly so TypeScript binds the method-level generic at the call site. The `vector(N)` codec authors as:

```ts
// 1. Codec class — `encode`/`decode` (and JSON variants where applicable).
class VectorCodec<N extends number> extends CodecImpl<
  'pg/vector@1', readonly ['equality'], string, Vector<N>
> {
  constructor(descriptor: PgVectorDescriptor, readonly dimension: N) {
    super(descriptor);
  }
  async encode(value: Vector<N>) { return `[${value.join(',')}]`; }
  async decode(wire: string) { return parseVector(wire) as Vector<N>; }
}

// 2. Descriptor class — codec id, metadata, factory.
class PgVectorDescriptor extends CodecDescriptorImpl<{ readonly length: number }> {
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

// 3. Per-codec column helper — direct invocation of `descriptor.factory(...)`
//    preserves `<N>` at the call site through TypeScript's variance rules.
export const vector = <N extends number>(length: N) =>
  column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length });
vector satisfies ColumnHelperFor<PgVectorDescriptor>;
```

The descriptor registers the codec id with the framework and carries the codec-id-keyed metadata the framework consults without the runtime instance in scope: traits and target types for trait gating; `paramsSchema` for JSON-boundary validation; `renderOutputType` for `contract.d.ts`; the curried `factory` for runtime materialization. The `satisfies ColumnHelperFor<PgVectorDescriptor>` clause ties the helper to its descriptor at compile time, catching wiring mistakes (wrong `codecId`, wrong factory wired in, mismatched typeParams shape).

**Non-parameterized codecs are the degenerate case.** A non-parameterized codec uses `P = void` and a constant factory that returns the same shared codec instance for every column:

```ts
class PgTextCodec extends CodecImpl<'pg/text@1', readonly ['equality', 'order', 'textual'], string, string> {
  async encode(value: string) { return value; }
  async decode(wire: string) { return wire; }
}

class PgTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'pg/text@1' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => PgTextCodec {
    const shared = new PgTextCodec(this);
    return () => shared;
  }
}

export const pgTextDescriptor = new PgTextDescriptor();
export const text = () => column(pgTextDescriptor.factory(), pgTextDescriptor.codecId, undefined);
text satisfies ColumnHelperFor<PgTextDescriptor>;
```

Whether a codec id "is parameterized" stops being a registration-time distinction; it's a property of `P` on the descriptor. The descriptor map indexes every descriptor by `codecId`; both `descriptorFor(codecId)` (codec-id-keyed metadata reads) and `forColumn(table, column)` (column-aware dispatch reads) resolve through the same map without branching.

> **Authoring guide.** The class-form authoring pattern (descriptor class + codec class + per-codec helper, tied by `satisfies`), the variance rationale, and the three case studies that pin the design (non-parameterized, parameterized with literal preservation, parameterized with arktype schema) live in [`docs/reference/codec-authoring-guide.md`](../../reference/codec-authoring-guide.md).

`CodecInstanceContext` is a small framework-supplied input the curried factory closes over. The base shape is family-agnostic; SQL-family extensions augment it with domain-shaped column-set metadata.

```ts
// packages/1-framework/1-core/framework-components/src/codec-types.ts
export interface CodecInstanceContext {
  readonly name: string;
}

// packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts
export interface SqlCodecInstanceContext extends CodecInstanceContext {
  readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}
```

Pack authors never construct it. The runtime synthesizes it at contract-load time: `name` is the family-agnostic instance identity (in SQL, the `storage.types` entry name, a `<col:t.c>` for inline-`typeParams` columns, a `<codec:codecId>` sentinel for non-parameterized codecs, or the canonical cache key for ad-hoc refs the contract walk did not pre-populate); the SQL-extended `usedAt` is plural so a `storage.types` entry shared across multiple columns can derive shared per-instance state from the aggregated set (e.g. a column-scoped encryption codec deriving one key for every column referencing the entry). SQL extensions that consume `usedAt` author against `SqlCodecInstanceContext`; extensions that don't read it stay on the family-agnostic base.

The split mirrors PR #400's `CodecCallContext` / `SqlCodecCallContext` precedent for the per-call context: SQL-domain vocabulary lives in `sql-relational-core`; framework-components stays family-agnostic.

`paramsSchema` is typed as **Standard Schema** (`StandardSchemaV1<P>`), not arktype-specific. The arktype `Type` already implements Standard Schema via its `~standard` getter, so existing arktype-typed descriptors satisfy the new shape transparently while `framework-components` itself takes no dependency on arktype. The runtime calls `paramsSchema['~standard'].validate(typeParams)` synchronously and rejects Promise-returning validators with `RUNTIME.TYPE_PARAMS_INVALID`.

## How it composes

The same `vector(1536)` participates in four code paths. Each reads a different aspect of the same artifact — never a parallel one.

### 1. Column authoring

`vector(1536)` returns a `ColumnTypeDescriptor` carrying both the data the contract IR needs (`codecId: 'pg/vector@1'`, `nativeType: 'vector'`, `typeParams: { length: 1536 }`) and, for codecs that need it, the curried factory itself, threaded through a first-class `type: (ctx: CodecInstanceContext) => Codec<…>` slot. The contract-authoring builder consumes the data part for the IR; the `type` slot is authoring-time only and is never serialized to `contract.json`.

### 2. No-emit type resolution

`@internal/sql-contract-ts`'s `FieldOutputType<Definition, Model, Field>` follows `typeRef` through `storage.types`, then synthetically applies `CodecInstanceContext` to the column's `type` slot at the type level and reads the `Js` parameter off the resulting `Codec<…, Js>`. For `vector(1536)`, this produces `Vector<1536>` (literal `N` preserved through curried application). For non-parameterized columns (no `type` slot), it falls back to `CodecTypes[codecId]['output']`. Nullability is reattached uniformly.

### 3. Emit-path rendering

`pnpm emit` walks the contract IR's models. For each scalar field, it looks up the codec by `codecId` and consults `renderOutputType(typeParams)`. The result is stamped into `FieldOutputTypes[Model][Field]` in `contract.d.ts`. If the codec has no renderer, the emitter falls through to the codec's base output type.

For columns that reference a named storage type via `typeRef` (rather than carrying inline `typeParams`), the SQL emitter implements an `EmissionSpi.resolveFieldTypeParams(modelName, fieldName, model, contract)` callback that walks `storage.fields → storage.tables → storage.types` and returns the named instance's `typeParams`. The framework consults this resolver before falling back to inline params, so typeRef-based columns render with the same fidelity as inline-`typeParams` columns. Mongo and other families that don't use named storage types simply don't implement the optional hook.

### 4. Runtime materialization and dispatch

When `contract.json` loads, `sql-runtime` builds a **descriptor map** keyed by `codecId`. Every contributor (target, adapter, extension pack) ships native `CodecDescriptor`s through the unified `codecs:` slot — both parameterized and non-parameterized descriptors live side-by-side in one array. The framework registers them directly; no synthesis or auto-lifting happens at runtime. The map exposes two read APIs:

- **`descriptorFor(codecId)`** — codec-id-keyed metadata reads (consumed by trait gating, startup validation, the emit path's `renderOutputType` lookup). Non-branching for parameterized vs. non-parameterized.
- **`forColumn(table, column)`** — column-aware dispatch reads. Convenience wrapper retained as public API; internally calls `forCodecRef(codecRefForColumn(table, column))`.

> **Retrospective (ADR 212).** The original dispatch path used column references (`ParamRef.refs: { table; column }`) and resolved codecs at encode time via `forColumn`. [ADR 212 — AST-bound codec resolution](ADR%20212%20-%20AST-bound%20codec%20resolution.md) replaced this with `CodecRef`-based dispatch: every AST node carries `codec: CodecRef` directly, and the runtime resolves via a content-keyed `AstCodecResolver`. The `forCodecId` fallback, `alias-resolver.ts`, codec-id consistency check, `ambiguousCodecIds` set, `parameterizedRepresentatives` map, and `validateParamRefRefs` pass were all deleted. See ADR 212 for the full rationale.

The runtime's **`AstCodecResolver`** wraps `descriptorFor(codecId).factory(typeParams)(ctx)` with content-keyed memoization. The cache key is `${codecId}:${canonicalizeJson(typeParams)}`; non-parameterized codecs key as `${codecId}:undefined` and share one instance. The contract walk pre-populates the cache at context construction time by walking `storage.tables[].columns[]`:

1. Look up the descriptor by `codecId`.
2. For typeRef columns, reuse the resolved codec materialized once for the `storage.types` entry; `usedAt` aggregates every column referencing that entry.
3. For inline-`typeParams` columns, validate via `descriptor.paramsSchema['~standard'].validate(typeParams)` and call `descriptor.factory(validatedParams)({ name: '<col:t.c>', usedAt: [{ table, column }] })` once.
4. For non-parameterized columns, call `descriptor.factory(undefined)(ctx)` once and cache the resulting `Codec` by codec id (the constant-factory contract guarantees the result is shared across columns).

JSON-with-schema validation lives **inside the resolved codec's `decode` body** rather than in a parallel validator registry. The per-library extension's factory rehydrates the schema at materialization time and closes over it; `decode(wire)` parses then validates, throwing a uniform `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` on rejection (which the runtime decode wrapper surfaces as `RUNTIME.DECODE_FAILED` with the original error reachable on `cause`).

## Why this shape

Two pre-existing problems shaped the design:

**The no-emit TypeScript type didn't reflect parameterization.** Importing a contract definition without running `pnpm emit` was the fast path for iteration. But the type-level resolver `FieldOutputTypes<Definition>` ignored `typeParams`, so `vector(1536)` resolved to `number[]` and `json(productSchema)` resolved to `JsonValue`. Authors who relied on no-emit during development would only discover the precise type after a full emit step (TML-2229).

**Parameterization had been bolted onto the codec interface.** The codec carried `paramsSchema?` for runtime params validation, `init?` for materializing per-instance state, and `renderOutputType?` (added by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)) for the emit path. None of these are wire-conversion concerns — they're framework-side metadata that just happened to share a record with `encode` / `decode`. Each parameterized codec also shipped a hand-rolled column-descriptor factory whose return type collapsed to a generic `ColumnTypeDescriptor`. The function knew the shape of the output type; the codec didn't; the renderer encoded the relationship a third time. Three places to keep in sync, each owned by a different artifact.

Both problems share a root cause: the type-level facts about a parameterized column lived in three places (the column-helper factory, the codec record, the renderer) with no single source of truth.

[ADR 206](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) had already faced the analogous problem on the operations side: a declarative argument-spec record was replaced by a TypeScript function whose signature was the type-level surface and whose body was the runtime. We apply that pattern here. The function the column author writes is the function the runtime invokes is the function whose return type the no-emit resolver reads. Drift between a declarative record and a matching runtime function is impossible because there is no declarative record.

## Consequences

### What works better

- **One artifact per codec.** The pack author writes one curried factory function and one descriptor. The descriptor's `renderOutputType` is the only piece the framework owns separately, and only because the emit path runs without the factory in scope.
- **Type fidelity end-to-end.** `vector(1536)` resolves to `Vector<1536>` at authoring time, in the no-emit path, in the emitted `contract.d.ts`, and at runtime decode. `arktypeJson(ProductSchema)` resolves to the schema's inferred output. Future column-scoped stateful codecs (e.g. encryption) resolve to their declared output even though the wire is ciphertext.
- **Non-branching descriptor reads.** `descriptorFor('pg/text@1').traits` and `descriptorFor('pg/vector@1').traits` use the same call shape. Non-parameterized codecs are the degenerate `P = void` case; consumers don't ask "is this codec parameterized" before reading metadata. The four sites that previously read traits via `context.codecs.traitsOf(codecId)` migrated to `context.codecDescriptors.descriptorFor(codecId).traits` without behavior change.
- **Framework-components stays library-agnostic.** `paramsSchema: StandardSchemaV1<P>` keeps arktype confined to the codec authors that opt into it; a future extension that prefers zod or valibot satisfies the same descriptor shape without `framework-components` depending on either library.
- **Forward-compat for column-scoped stateful codecs.** Column-scoped encryption and similar codecs author against `(params, ctx)` today using the same surface pack authors already adopted. The contract-load runtime materialization is a documented contract.

### Trade-offs

- **`ColumnTypeDescriptor` grew an authoring-time `type` slot.** The optional `type?: (ctx: CodecInstanceContext) => Codec` field is the price of letting the no-emit resolver read the factory's return type without reaching into the runtime codec registry. The slot is structurally optional, ignored by the IR serializer, and never appears in `contract.json`.
- **Per-library extensions own JSON-with-schema.** A schema-typed JSON column is not a postgres-adapter concept; it's a per-library concept. The cost is one more import for users who want a typed JSON column; the benefit is that each library ships a lossless pipeline rather than a generic Standard-Schema-driven shape that's lossy for narrowed types.
- **Heterogeneous-`P` registry boundary.** `descriptorFor(codecId): CodecDescriptor<unknown>` is structurally heterogeneous across codec ids — `P` is `void` for `pg/text@1`, `{ length: number }` for `pg/vector@1`, `{ expression; jsonIr }` for `arktype/json@1`, etc. The registry's interface methods cannot be honestly typed at the registry level without `unknown` at the boundary; consumers narrow per codec id at the call site (where the descriptor's `paramsSchema` validates JSON-sourced params before the factory ever sees them, so the runtime narrow is safe). A typed-dispatch / sealed-visitor refactor would eliminate the boundary widening but is not in scope.
- ~~**`forCodecId` retained only for non-parameterized codec ids.**~~ **Superseded by [ADR 212 — AST-bound codec resolution](ADR%20212%20-%20AST-bound%20codec%20resolution.md).** `forCodecId` is retired. Every AST node carries `codec: CodecRef` directly; the runtime resolves via `resolver.forCodecRef(node.codec)` using a content-keyed cache. The `ParamRef.refs` indirection, `validateParamRefRefs` pass, alias resolver, and codec-id consistency check are all deleted. Non-parameterized codecs key as `${codecId}:undefined` in the same cache; there is no separate fallback path.

### Per-library JSON extensions

`@internal/extension-arktype-json` ships `arktypeJson(schema)`. The codec id (`arktype/json@1`) is library-bound, not target-bound. The factory eagerly serializes `schema.expression` (TypeScript-source-like rendering) and `schema.json` (arktype's internal IR) into `typeParams` at the column-author site; the descriptor's factory rehydrates via `ark.schema(typeParams.jsonIr)`, fails fast if the rehydrated expression diverges, and validates internally in `decode`. The no-emit resolver and emit-path renderer read the factory return type / `expression` so `contract.d.ts` carries the schema's source-like rendering with full fidelity.

The postgres adapter retains only the non-parameterized raw-JSON / raw-JSONB codecs (`pg/json@1`, `pg/jsonb@1`) — schema-typed JSON columns ship from extension packages. Future per-library extensions (`zod/json@1`, `valibot/json@1`) follow the same pattern when each library has a clean serialize / rehydrate story.

## Alternatives considered

**Type-level brand or `OutputType` HKT field on the codec.** The codec carries an `OutputType: CodecOutputTypeFn<Params>` field, and `FieldOutputType` consults `Apply<codec.OutputType, typeParams>`. Rejected because the same information already lives in the factory function's TypeScript return type — encoding it twice and synchronizing the two encodings via `renderOutputType` is exactly the drift `function-is-signature` is meant to prevent.

**Optional `init(params, instance)` hook on the codec.** Codec carries `init?` separately from a factory; runtime calls `init` per `storage.types` instance for stateful codecs. Rejected because the higher-order factory IS what `init` was — the same signature, the same lifecycle, the same purpose. One artifact, not two. The legacy `init?` slot on the SQL `Codec` extension was retired alongside the unified-descriptor migration.

**A shared `columnFor(codec)(params)` helper.** A single `columnFor` helper turns any codec into a column-descriptor factory, type-discriminated on whether the codec is parameterized. Rejected because each pack ships a typed factory directly — `columnFor` would add no type information and would add an indirection at the call site.

**Global declaration-merged `CodecOutputTypes` interface.** Each codec augments a global registry; `FieldOutputType` reads the JS type from the merged registry. Rejected for ambient global pollution, order-dependent merging, and identity brittleness across two contracts in one program.

## Supersedes

The transitional `paramsSchema?` and `init?` fields on the SQL `Codec` extension and the `renderOutputType?` field on the SQL `Codec` and Mongo `MongoCodec` extensions (introduced by [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md)). All three migrated to `CodecDescriptor`. Pack-author column-descriptor factories (`vector(N)`, `charColumn(N)`, `numericColumn(p, s)`, …) are reshaped to return `ColumnTypeDescriptor & { type?: (ctx) => Codec<…> }` for codecs that need no-emit type-level access — the user-call site (`field.column(vector(1536))`) is unchanged.

The legacy `defineCodec({...})` factory and the family-side `mkCodec({...})` instance constructor were the previous canonical author surface; they have been retired in favor of class-based codecs and descriptors (`CodecImpl`, `CodecDescriptorImpl`, per-codec column helpers, `satisfies`) as described above. The earlier ADRs that show `defineCodec({...})` examples ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md), [ADR 202](ADR%20202%20-%20Codec%20trait%20system.md), [ADR 204](ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md), [ADR 205](ADR%20205%20-%20SQL%20cast%20emission%20is%20adapter%20policy.md)) are accurate as historical records of those decisions, but the authoring shape they show is no longer current — see the retrospective notes at the top of each.

## Resolves

- **Parameterized columns (no-emit and emit).** `vector(1536)`, `arktypeJson(schema)`, and other parameterized columns resolve correctly in the no-emit path AND through the emit path (typeRef columns included, via `EmissionSpi.resolveFieldTypeParams`).
- **The deferred no-emit fix from [ADR 186](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md).** The `renderOutputType` it introduced moves to its long-term home on the descriptor; the no-emit path now resolves through the factory's return type without consulting it.

## References

- [ADR 186 — Codec-dispatched type rendering](ADR%20186%20-%20Codec-dispatched%20type%20rendering.md). Established codec ownership of TypeScript output rendering; deferred the no-emit fix this ADR closes.
- [ADR 204 — Single-Path Async Codec Runtime](ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). The async codec interface this ADR composes with — `factory(params)(ctx)` returns a `Codec` whose `encode`/`decode` are Promise-returning at the public boundary, and the synthesis bridge wraps existing async codecs without touching their methods.
- [ADR 206 — Operations as TypeScript functions](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md). The "function is the signature" precedent applied here.
- [ADR 212 — AST-bound codec resolution](ADR%20212%20-%20AST-bound%20codec%20resolution.md). Supersedes this ADR's `ParamRef.refs`-based dispatch (§ "Trade-offs") with `CodecRef`-based dispatch; dissolves eight runtime heuristics.
- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md). Established the pattern of codecs owning their representations.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md). Established `typeParams` on storage columns.
- [ADR 168 — Postgres JSON and JSONB typed columns](ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md). Introduced typed JSON columns with Standard Schema. Per-library extensions (`@internal/extension-arktype-json`) now own the typed JSON column shape.
- [ADR 202 — Codec trait system](ADR%20202%20-%20Codec%20trait%20system.md). The trait system. The `'json-validator'` trait was a transitional gate for the now-deleted `JsonSchemaValidatorRegistry`; both the trait and the registry were retired — JSON-Schema validation lives uniformly inside the resolved codec's `decode` body.

## Future work

- **`pgEnumCodec` factory audit.** The current factory is a placeholder (enum values aren't parameterized in the curried-factory sense). A separate ticket reshapes it.
- **Mongo registration migration + Mongo runtime `forColumn`.** Separate follow-up for the Mongo family. Mongo demos don't use parameterized codecs today, so the gap is authoring-time only.
- **Mongo control-plane unified `codecs:` registration surface.** Aligns Mongo with the SQL family's single-slot shape — separate ticket.
- **Future schema libraries.** zod, valibot, etc. ship as parallel per-library extensions when each library has a clean serialize / rehydrate story. The arktype-json package is the structural template.
