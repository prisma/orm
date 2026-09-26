# ADR 204 — Single-Path Async Codec Runtime

> **Retrospective note.** This ADR documents the single-path async codec runtime through the `defineCodec({...})` / `mongoCodec({...})` factories of the time. The `defineCodec({...})` factory was later retired in favor of class-based codecs extending `CodecImpl` with `async encode` / `async decode` methods. The decision this ADR records — that `encode` and `decode` are uniformly Promise-returning at the public boundary, and the runtime always awaits — is unchanged. The sync-lifting that the factory used to perform is now a property of the abstract base class's method signatures: subclasses author `async` methods directly, and synchronous bodies are returned as resolved promises by the engine without an explicit lift step. See [ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) and the [Codec authoring guide](../../reference/codec-authoring-guide.md).

## Context

Codecs are pure value transformers that bridge contract-typed JS values and a target's wire types: SQL parameter bytes, Postgres OID-tagged literals, MongoDB BSON shapes, and so on. Until this ADR, every codec method ran on the call stack of the query that invoked it. Rows were assembled from plain values; `encodeParams` and `decodeRow` were synchronous loops; build-time helpers (`encodeJson`, `decodeJson`, `renderOutputType`) were synchronous as well. This was a clean, fast shape for the common case (in-process scalar transforms) but blocked a small but real class of codecs that need asynchronous work: KMS-resolved encryption keys, externally-resolved secrets, deferred reference lookups, secret rotation.

A first attempt at async support (the rejected approach) was shaped as a **per-codec opt-in**:

- A `runtime: 'sync' | 'async'` flag on the public `Codec` interface.
- A `TRuntime` generic on `Codec` that propagated through every consumer.
- Conditional return types on `encode` / `decode` (one shape for sync codecs, another for async).
- A dual-path SQL runtime that branched on the marker per call.
- A read/write type-map split in the ORM client to keep input surfaces sync-only.
- A defensive `instanceof Promise` guard in the runtime to catch authorship errors.

That direction was rejected during architectural review. The salient critique:

- **The cost lived in the wrong place.** A property of two codec methods became a property of the whole interface, the ORM type system, and every codec author's mental model.
- **There was nowhere to walk back to.** Once `runtime: 'async'` and conditional return types are public, removing them is a breaking change. The optimization (sync fast-path) and the public surface were tangled.
- **The sync/async split was the wrong seam.** The actual structural seam is between **query-time methods** (per-row, IO-relevant: `encode`, `decode`) and **build-time methods** (per-contract-load, sync: `encodeJson`, `decodeJson`, `renderOutputType`).
- **Cross-family portability was harder, not easier.** Mongo and SQL would each need to interpret the marker; a single `defineCodec({...})` value couldn't be reused without re-typing.

This ADR replaces that direction with a **single-path** design that localizes the cost of supporting both sync and async authoring to one place — the runtime's two codec invocation loops — and leaves the public interface uniform, the ORM type surfaces single-ended, and the build-time path synchronous.

## Decision

The runtime treats codec query-time methods as **uniformly Promise-returning** at the public interface and **always awaits** them. Codec authors may write either sync or async functions; the `defineCodec()` factory transparently lifts sync ones to Promise-returning methods. Build-time methods stay synchronous.

Concretely:

1. **Public `Codec` interface (uniform).**
   - `encode(value: TInput): Promise<TWire>` — query-time, required, Promise-returning.
   - `decode(wire: TWire): Promise<TInput>` — query-time, required, Promise-returning.
   - `encodeJson(value: TInput): JsonValue` — build-time, required, synchronous.
   - `decodeJson(json: JsonValue): TInput` — build-time, required, synchronous.
   - `renderOutputType?(typeParams): string | undefined` — build-time, optional, synchronous.
   - **No** `runtime` / `kind` / equivalent marker. **No** `TRuntime` generic. **No** conditional return types.

2. **Single factory.** `defineCodec()` (in `relational-core`) and its cross-family analog `mongoCodec()` (in `mongo-codec`) accept `encode` and `decode` in either sync or async form. Sync functions are wrapped to return `Promise.resolve(...)`; async functions pass through unchanged. The constructed `Codec` value always exposes Promise-returning query-time methods, regardless of how it was authored. `encode` may be omitted (identity default); `decode` is required.

3. **Runtime always awaits.**
   - `encodeParams` is `async` and dispatches all parameter codec calls concurrently via `Promise.all`.
   - `decodeRow` is `async` and dispatches all field codec calls concurrently via `Promise.all`.
   - `decodeField` is single-armed: call codec → await → run JSON-Schema validation on the resolved value → return plain value.
   - Rows yielded to user code (one-shot `.first()` / `.all()` and streaming via `AsyncIterableResult`) carry plain field values. No `Promise`-typed fields ever reach user code.

4. **Build-time stays synchronous.** `validateContract<Contract>(contractJson)` returns synchronously. `postgres({...})` and equivalent client constructors stay synchronous. Build-time `decodeJson` / `encodeJson` are not awaited anywhere on the load path.

5. **ORM client type surfaces are uniform.** `DefaultModelRow` / `InferRootRow` field types are plain `T`. Write surfaces (`MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`, `DefaultModelInputRow`) accept plain `T`. Reads, where filters and unique criteria take each field's type from `FieldOutputTypes`; create and update inputs (`CreateInput`, `MutationUpdateInput`, `DefaultModelInputRow`) take it from `FieldInputTypes`. Neither map carries `Promise<T>`, so this is not the sync-only input split rejected above.

6. **Cross-family portability.** The `Codec` interface in SQL (`framework-components` / `relational-core`) and Mongo (`mongo-codec`) is structurally identical: same generics, same Promise-returning query-time methods, same synchronous build-time methods. A single `defineCodec({...})` value is structurally usable in both runtimes.

## Architecture

### `Codec` interface shape

```ts
interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;

  // Query-time (per-row): always Promise-returning at the public boundary.
  encode(value: TInput): Promise<TWire>;
  decode(wire: TWire): Promise<TInput>;

  // Build-time (per-contract-load): synchronous.
  encodeJson(value: TInput): JsonValue;
  decodeJson(json: JsonValue): TInput;
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

The interface uses the same four generics across SQL and Mongo (`Id`, `TTraits`, `TWire`, `TInput`). `decode` returns `Promise<TInput>`: a codec's decoded value is the same JS-side type its `encode` accepts, so a single round-trip type variable `TInput` is sufficient. There is no `TOutput`. There is no `TRuntime`. There is no `kind` discriminant. There is no conditional return type.

### `defineCodec()` / `mongoCodec()` factories

The factory is the **only** place where author-side sync/async authoring is observable. It accepts each query-time method in either form and constructs a `Codec` whose query-time methods always return Promises:

```ts
// Sync authoring — works exactly the same end-to-end.
const textCodec = defineCodec({
  typeId: 'pg/text@1',
  targetTypes: ['text'],
  encode: (v: string) => v,
  decode: (w: string) => w,
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j,
});

// Async authoring — same factory, same shape.
const secretCodec = defineCodec({
  typeId: 'pg/secret@1',
  targetTypes: ['text'],
  encode: async (v: string) => encrypt(v, await getKey()),
  decode: async (w: string) => decrypt(w, await getKey()),
  encodeJson: (v: string) => v,
  decodeJson: (j: string) => j as string,
});
```

Internally, the factory wraps sync `encode` / `decode` with `(...args) => Promise.resolve(fn(...args))`. Async functions pass through unchanged. The constructed `Codec` value is the same shape in both cases; consumers cannot distinguish how it was authored, and they don't need to.

### Runtime: always-await + per-row `Promise.all`

The SQL runtime has exactly one encoding path and one decoding path. Both are `async` and dispatch codec work concurrently:

```ts
// encodeParams: dispatch all parameter codecs concurrently for one statement.
async function encodeParams(plan, registry) {
  return Promise.all(
    plan.params.map((p, i) => registry.get(p.codec).encode(p.value)),
  );
}

// decodeRow: dispatch all field codecs concurrently for one row.
async function decodeRow(rawRow, decoders) {
  const cells = await Promise.all(
    decoders.map((d, i) => d.codec.decode(rawRow[i])),
  );
  return assembleRow(cells, decoders);
}

// decodeField: single-armed; JSON-Schema validation runs against the resolved value.
async function decodeField(wire, codec, schema) {
  const value = await codec.decode(wire);
  if (schema) validateAgainst(schema, value);
  return value;
}
```

`Promise.all` resumption batches: when N codec calls all settle synchronously (the sync-lifted majority case), the continuation runs on a **single microtask tick** after the last one settles. Per-row microtask cost is O(1), independent of cell count. Per-cell allocation overhead is one Promise.

### Cross-family parity

Mongo gets the same `Codec` shape and the same encode-side always-await pattern:

- `MongoCodec` is structurally identical to the SQL `Codec` (same four generics, same Promise-returning query-time methods, same synchronous build-time methods).
- `mongoCodec()` is the cross-family analog of `defineCodec()` and lifts sync authoring identically.
- `resolveValue` is `async` and dispatches codec-encoded leaves concurrently via `Promise.all` when a value tree carries multiple of them.
- `MongoAdapter.lower()` is `async`; `MongoAdapter` in `mongo-lowering` reflects this.
- `MongoRuntime.execute()` awaits `adapter.lower(plan)` before issuing the wire command.

A single `defineCodec({...})` module is structurally usable in both SQL and Mongo runtimes; a portability test exercises this.

### Error envelopes (unchanged)

Encode and decode failures continue to be wrapped in the standard envelope shape:

- Encode failures throw `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original error on `cause`.
- Decode failures throw `RUNTIME.DECODE_FAILED` with `{ table, column, codec }`, bounded `wirePreview`, and the original error on `cause`.
- The redaction policy (cause routing, bounded `wirePreview`, validator-message redaction trigger) is preserved as-is. The redaction-trigger spelling itself is independent of this design and is tracked separately.

## Walk-back framing

A synchronous fast-path for sustained-throughput workloads is a future, **additive**, opt-in change — not a constraint on the public interface today. The walk-back path is:

- A new `codecSync()` factory (in addition to, not replacing, `defineCodec()`) that constructs a codec whose query-time methods are typed as synchronous returns at the public boundary.
- Predicates `isSyncEncoder(codec)` / `isSyncDecoder(codec)` that the runtime can call to take a faster, fully-sync encode/decode path that skips the `Promise.all` allocation and microtask hop.
- The runtime gains a sync fast-path arm; the existing async path remains, unchanged, for codecs that opt in to async or that don't opt in to sync.

For this opt-in to land cleanly, the design today must **not** introduce any of the following walk-back constraints:

1. A sync/async marker on the public `Codec` interface (no `runtime`, `kind`, or equivalent field).
2. Multiple factory variants (`codecSync` / `codecAsync`) — there is **one** factory, `defineCodec()`, today; `codecSync()` is the future additive opt-in.
3. Exported sync-vs-async predicates.
4. Conditional return types tied to async-ness on the public interface.
5. A `TRuntime` generic on `Codec`.
6. Documentation framing the author surface as "codec functions return Promises" (instead: "you may write sync or async; the factory accepts both").
7. Public guarantees that depend on async-ness (e.g., "errors arrive via promise rejection" instead of "errors are wrapped in the standard envelope").

Each of these would force the future `codecSync()` opt-in to be either a breaking change or a parallel, divergent code path. The single-path always-await design avoids all seven by keeping the sync/async distinction **invisible** at the public boundary. This list is the canonical statement of those constraints; downstream specs and plans defer to it.

## Trade-offs

### Promise allocation in the always-await path

Every cell encode/decode allocates one Promise even when the codec body is synchronous (the lifted majority case). For a query returning N rows × M cells, total allocation is N × M Promises plus N × `Promise.all` continuation closures. Promises are small young-generation objects; allocation is fast and GC pressure is bounded.

The runtime is mitigated by two factors:

- **V8/JSC fast-async paths.** Modern engines (V8 since the 2018 fast-async revamp; JSC similarly) recognize already-resolved Promises in `Promise.all` continuations and resume on a single microtask tick after the last cell settles. Per-row microtask cost is O(1), not O(M).
- **The future sync fast-path.** When sustained-throughput workloads make per-cell allocation load-bearing, the additive `codecSync()` opt-in (above) eliminates allocation entirely for the codecs that adopt it. The opt-in is non-breaking and lives alongside the always-await path.

The assumption is that load-bearing scale is not yet present in production; the simpler shape ships now and the optimization layers on when measurement says it's needed. Performance assumptions are documented, not benchmarked; reviewers can stress-test them once.

### Type-checking overhead

The single-path interface has **fewer** generic parameters than the rejected per-codec marker shape (no `TRuntime`) and no conditional return types. Type-checking time is net-neutral or improved versus the rejected design. (Tracked qualitatively; no measurement gate.)

### One factory, one mental model

Codec authors write either sync or async query-time functions, with no annotations. The factory accepts both forms. The constructed value is always the same shape. No author has to think about "is my codec sync or async" at the type level, and no consumer has to handle two cases.

## Risks & mitigations

### Cleartext leakage via error envelopes

The expanded encrypting-codec surface means encode/decode failures can carry plaintext into `error.message`, `details.errors`, or other envelope fields. The redaction policy (cause routing, bounded `wirePreview`, validator-message redaction trigger) is preserved unchanged from the prior runtime, but trait-gated redaction (e.g. omitting `wirePreview` and scrubbing `cause` for codecs that carry the `secret` trait) is **not** spelled in this ADR. Tracked as a follow-up; see [framework-gaps G9](../../reference/framework-gaps.md#g9--trait-gated-redaction-in-error-envelopes-cleartext-leakage-policy). The existing `it.skip` in the JSON-Schema validation tests pins the redaction-trigger seam.

### `Promise.all` codec dispatch is unbounded

The runtime encodes parameters and decodes cells via `Promise.all`. For sync-lifted codecs this is cheap (the lifted majority case). For codecs whose body performs IO — KMS-backed envelope encryption, network-backed key derivation, remote redaction policy lookups — every codec call becomes a real concurrent request, and `Promise.all` issues them all at once with no rate limit and no cooperative cancellation. A query that touches N rows × M codec'd cells can therefore burst N × M concurrent KMS calls.

This is **acceptable but not safe at scale**. The standard-library `Promise.all` also propagates the first rejection without cancelling already-dispatched bodies; their results are discarded but the IO still runs to completion. Mitigations are intentionally deferred:

- **Concurrency control (rate limit, batched dispatch).** Tracked under [framework-gaps G4](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs). The likely landing is a per-codec-or-per-trait dispatcher that bounds in-flight requests and lifts the public `Promise.all` shape into a configurable scheduler.
- **`AbortSignal` plumbing.** **Resolved by [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](./ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).** The codec dispatch surface now threads a per-execute `CodecCallContext` (`{ signal? }` at the framework level; `SqlCodecCallContext extends CodecCallContext { column? }` at the SQL layer) to every `codec.encode` / `codec.decode` call, and `runtime.execute(plan, { signal })` surfaces `RUNTIME.ABORTED` with cooperative cancellation. None of the seven walk-back constraints below are reintroduced.

The single-path always-await design does not preclude either mitigation; both can land additively without changing the codec author surface.

## Cross-family scope notes

Mongo decode is **in place**: the Mongo runtime walks a structural `MongoResultShape` attached to `MongoQueryPlan` / `MongoExecutionPlan` (see `packages/2-mongo-family/4-query/query-ast/src/result-shape.ts`), dispatches leaf decodes via `Promise.all` per row, and maps failures to `RUNTIME.DECODE_FAILED` with `{ collection, path, codec, wirePreview }`. Lanes populate `resultShape` for flat typed reads; raw commands omit it so rows pass through unchanged. SQL continues to use `meta.annotations` / `meta.projectionTypes`; Mongo does not use those fields for decode.

Mongo's codec registry is now aggregated by the framework's execution-stack composition machinery (matching the SQL pattern that has been in place since ADR 152): component descriptors declare codecs on `ComponentMetadata.types.codecTypes.codecDescriptors`, and `createMongoExecutionContext({ contract, stack })` walks the stack to fold them into a single `MongoCodecRegistry` exposed on `context.codecs`. `MongoRuntimeOptions` no longer accepts a `codecs` field — users do not construct or thread a registry. See `packages/2-mongo-family/7-runtime/src/mongo-execution-stack.ts` for the Mongo-side implementation and `packages/2-sql/5-runtime/src/sql-context.ts` for the SQL counterpart.

The earlier "Mongo decode out of scope" note below is **historical** — it described the state before this work landed.

---
_Historical note (pre–TML-2324):_

Mongo decode was **out of scope** for the original ADR 204 work. At that time, the Mongo runtime did not decode rows: documents passed through from the driver directly, and `decodeRow`-like machinery did not exist on the Mongo side.

---

Concretely, in this ADR’s original encode-focused slice:

- **In scope (Mongo):** the encode-side runtime invocation pattern. `resolveValue`, `MongoAdapter.lower()`, and `MongoRuntime.execute()` are reshaped to async + `Promise.all` for consistency with SQL.
- **Decode (Mongo), follow-up to this ADR:** row decoding now uses structural `MongoResultShape` and `decodeMongoRow` in `@internal/mongo-runtime` (TML-2324); JSON-Schema validation on decoded cells remains SQL-only for now.
- **In scope (cross-family):** the structural identity of `Codec` and `MongoCodec`, and the structural reusability of a single `defineCodec({...})` module across both runtimes' encode paths.

## References

- [ADR 030 — Result decoding & codecs registry](./ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md). The async-runtime-related sections of ADR 030 (decode boundary, codec async semantics, runtime invocation pattern) are superseded by this ADR; ADR 030 carries a "Superseded by" pointer for those sections. The codec **registry** model (precedence rules, registry metadata, error mapping codes) in ADR 030 is unchanged and remains in force.
- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md). Defines the stable codes (`RUNTIME.ENCODE_FAILED`, `RUNTIME.DECODE_FAILED`) and envelope shape used here.
- [ADR 184 — Codec-owned value serialization](./ADR%20184%20-%20Codec-owned%20value%20serialization.md). Defines the build-time `encodeJson` / `decodeJson` seam (kept synchronous here).
- [ADR 131 — Codec typing separation](./ADR%20131%20-%20Codec%20typing%20separation.md). Defines the codec generic shape (`Id`, `TTraits`, `TWire`, `TInput`); the generics are unchanged here, and the query-time method return shape is updated to `Promise<...>`.
- [V8 fast-async revamp (2018)](https://v8.dev/blog/fast-async). Grounding for the resolved-await microtask-tick claim.
