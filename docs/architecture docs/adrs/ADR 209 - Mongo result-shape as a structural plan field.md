# ADR 209 — Mongo result-shape as a structural plan field

> **Decision (in one sentence):** Mongo plans carry a recursive structural `resultShape` field that tells the runtime how to decode each row; if no `resultShape` is attached, the runtime yields the row from the driver verbatim.

## A grounding example

Suppose we read a `User` model from MongoDB:

```ts
// Contract field types for User:
//   _id:       ObjectId
//   name:      string
//   tags:      string[]
//   address:   { city: string }      // a value-object subdocument
//   posts:     Post[]                // a relation populated by $lookup
```

The driver hands the runtime a row that looks like this on the wire:

```js
{
  _id:     ObjectId('64aa…'),
  name:    'Ada',
  tags:    ['admin', 'staff'],
  address: { city: 'London' },
  posts:   [/* subdocuments */],
}
```

Application code expects something like this — `_id` decoded to a hex string, `tags` decoded element-by-element, the rest passed through:

```js
{
  _id:     '64aa…',
  name:    'Ada',
  tags:    ['admin', 'staff'],
  address: { city: 'London' },     // value-object: not decoded yet
  posts:   [/* subdocuments */],   // relation: not decoded yet
}
```

The plan that produced the read tells the runtime how to do that translation by carrying a description of its own result shape:

```ts
plan.resultShape = {
  kind: 'document',
  fields: {
    _id:     { kind: 'leaf',    codecId: 'mongo/objectId@1', nullable: false },
    name:    { kind: 'leaf',    codecId: 'mongo/string@1',   nullable: false },
    tags:    { kind: 'array',   nullable: false,
               element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false } },
    address: { kind: 'unknown' },
    posts:   { kind: 'unknown' },
  },
};
```

The runtime walks `(row, resultShape)` in lockstep, runs the codec at each leaf, and yields the decoded row. `kind: 'unknown'` says "the lane vouches for the surrounding shape but cannot vouch for this position" — the value passes through.

That's the whole shape of this ADR. The rest fills in the type, the rules, and why it's a *plan field* rather than a metadata annotation.

## Decision

Plans gain an optional structural carrier:

```ts
interface MongoQueryPlan<Row, Command> {
  // …existing fields…
  readonly resultShape?: MongoResultShape;
}
```

The carrier is **recursive** (documents nest; arrays carry an element shape), **immutable** (deep-frozen at construction), and **structural** (it lives on the plan, not on `meta`). When the field is absent, the runtime yields rows from the driver unchanged — that is the raw escape hatch, used by `rawCommand(...)` and any future plan source the runtime should not transform.

The carrier propagates through lowering: `MongoExecutionPlan` carries the same `resultShape` after the adapter has produced the wire command. Lowering does not reshape it; lowering is about the wire command, not about the result.

## The result-shape vocabulary

The full type is small and intentionally orthogonal to the codec interface:

```ts
export type MongoResultShape =
  | { readonly kind: 'document'; readonly fields: Readonly<Record<string, MongoFieldShape>> }
  | { readonly kind: 'unknown' };

export type MongoFieldShape =
  | { readonly kind: 'leaf';     readonly codecId: string; readonly nullable: boolean }
  | { readonly kind: 'document'; readonly nullable: boolean;
                                 readonly fields: Readonly<Record<string, MongoFieldShape>> }
  | { readonly kind: 'array';    readonly nullable: boolean; readonly element: MongoFieldShape }
  | { readonly kind: 'unknown' };
```

Walking through the example one variant at a time:

- **`kind: 'leaf'`** — a position holding a single codec-managed value. `_id` and `name` in the example. The runtime resolves `codecId` against the registry and runs `decode` on the wire value.
- **`kind: 'array'`** — a position holding an array; the element shape applies to each entry. `tags` in the example. The runtime walks the array, applying the element shape recursively at every index. Paths in error messages join with dots: `tags.0`, `tags.1`, …
- **`kind: 'document'`** — a position holding a sub-object with its own field map. The example doesn't use this on `address` (it shows `unknown` instead — see below); a future lane upgrade that knows the value-object's shape would write `kind: 'document'` here, and the runtime would recurse.
- **`kind: 'unknown'`** — a position the lane decides not to describe. The runtime returns the value unchanged. `address` and `posts` in the example.

A row field that the shape *doesn't mention at all* also passes through unchanged. The decode walk is structurally additive: it transforms positions the shape describes and leaves the rest alone. Drop semantics belongs to projection (`select(...)`, `$project`), not to decode.

### `undefined` vs. `kind: 'unknown'` — distinct on purpose

These look similar but signal different things, and the difference is load-bearing:

- **`resultShape: undefined`** — the lane has not produced any shape. Used by raw commands. The runtime treats the entire row as opaque and yields it untouched.
- **`resultShape.kind: 'unknown'`** (or a `kind: 'unknown'` slot inside a larger shape) — the lane *has* produced a shape and vouches for the surrounding structure, but cannot vouch for this specific position. The runtime decodes everything else around it; this position is pass-through.

Collapsing the two would lose information. A typed read with one unknown slot is a different artifact from a raw command, and middleware that wants to inspect the result shape (for telemetry, validation, or future strict-mode checks) needs to tell them apart.

### How decode runs

`MongoRuntimeImpl.execute` overrides the framework's runtime base to layer per-row decode between the middleware loop's `yield` and the consumer-visible `yield`:

```ts
for await (const rawRow of stream) {
  if (exec.resultShape === undefined) {
    yield rawRow;
  } else {
    yield await decodeMongoRow(rawRow, exec.resultShape, codecs, exec.command.collection);
  }
}
```

`decodeMongoRow` walks the shape and the row in lockstep, gathering one flat list of leaf-decode tasks as it descends, then awaits a single `Promise.all` per row. That keeps the per-row dispatch to one microtask hop regardless of nesting depth (the invariant from ADR 204). Three short-circuits at the leaf level honour the natural escape hatches: `null` and `undefined` cells skip the codec call; an unknown `codecId` (no entry in the registry) returns the wire value unchanged; a `kind: 'unknown'` slot anywhere in the tree is pass-through.

When a leaf decode throws, the runtime wraps the original error in a `RUNTIME.DECODE_FAILED` envelope keyed by the cell's dot-path:

```ts
RuntimeError {
  code: 'RUNTIME.DECODE_FAILED',
  message: "Failed to decode field address.city in collection 'users' with codec 'mongo/string@1': boom",
  details: {
    collection: 'users',
    path: 'address.city',          // dot-joined; arrays use numeric indices, e.g. tags.0
    codec: 'mongo/string@1',
    wirePreview: 'San Francisco',  // bounded preview of the offending wire value
  },
  cause: <original Error>,
}
```

The envelope code, fields, and `cause` chain are unchanged from ADR 027.

## Layer responsibilities

| Layer | What it does for `resultShape` |
|---|---|
| **Lanes** (ORM, query-builder typed-read terminals) | Produce the `resultShape` from the contract by replaying the pipeline stages against it (`reifyPipelineResultShape`). Identity stages (`$match`, `$sort`, `$limit`, `$skip`, `$sample`) and `$vectorSearch` preserve the source shape; `$project`/`$addFields` reify per-field (a bare field reference or kept key copies the source field's shape, a computed expression emits `kind: 'unknown'` at that position). Remaining reshaping stages (`$group`, `$unwind`, `$replaceRoot`) currently emit `kind: 'unknown'` for the whole shape (per-stage value-level reification is mechanical follow-up work — see *Consequences*). Raw commands omit `resultShape` entirely. |
| **Runtime** (`MongoRuntimeImpl.execute`) | Reads `exec.resultShape` and decodes per-row when present. Walks the shape and the row in lockstep, dispatches all leaf decodes through one `Promise.all`, wraps failures in the envelope above. Sources the `collection` name from `exec.command` (post-lowering authoritative) so middleware that rewrites collection names is reflected in error envelopes. |
| **Adapter** (`MongoAdapter.lower`) | Untouched. Lowering is about producing the wire command; the result shape passes through unchanged. |
| **Codec registry** (`MongoCodecLookup`) | Resolves `codecId` → `MongoCodec`. Aggregated by the framework's execution-stack composition machinery: each component descriptor (target, adapter, extension packs) declares its codecs via `ComponentMetadata.types.codecTypes.codecDescriptors`; `createMongoExecutionContext({ contract, stack })` walks `[stack.target, stack.adapter, ...stack.extensions]` and folds the declarations into a single registry. The runtime sees a read-only `MongoCodecLookup` (`get` / `has`); `register` stays internal to the aggregator. **Users never construct a `MongoCodecRegistry` themselves** — they compose a stack and a context, and codec aggregation falls out. |
| **Driver** | Untouched. Continues to surface BSON-shaped wire values. |

## Consequences

### Positive

- **Recursive decode lands by construction.** Subsequent lane work (value-object subtrees, `$lookup` arrays, per-stage shape rebuild for aggregation pipelines) replaces `kind: 'unknown'` slots with concrete subtrees and the runtime handles them automatically — no runtime changes needed.
- **`meta` keeps its job.** `PlanMeta` is for cross-cutting plan metadata and lane↔middleware annotations (telemetry tags, lane intent, observability hooks). The result shape is structural — describing what the plan returns — and now lives next to the rest of the plan's structural fields.
- **The runtime never reads the contract.** All contract knowledge stays in lanes; the runtime consumes a self-contained description of the row. That keeps the runtime agnostic to authoring decisions (TS-first vs. PSL-first, custom value objects, polymorphic models).
- **Codec aggregation falls out for free.** Future Mongo extension packs (encryption, vendor-specific scalars) declare their codecs on a descriptor; stack composition surfaces them everywhere they're needed — the same pattern `pgvector` already uses for SQL.

### Negative

- **SQL and Mongo diverge on where codec resolution comes from.** SQL still uses `meta.annotations.codecs` and `meta.projectionTypes`; Mongo uses the structural `resultShape`. A reader looking at one runtime cannot infer the other's pattern by symmetry. Mitigated by this ADR documenting the intentional split, and by the runtime *invocation* pattern (always-await, one `Promise.all` per row, ADR 027 envelopes) staying identical across both.
- **Lanes carry a small amount of additional value-level work** (reify the existing type-level `DocShape` into a `MongoResultShape` value alongside it). Mostly mechanical translation; the type-level shape is already there.
- **`kind: 'unknown'` opens a class of "lane forgot to populate" bugs.** A lane that quietly emits `kind: 'unknown'` when it could have produced a concrete shape produces silent pass-through (rows undecoded), not a loud failure. Mitigated by always-on integration tests around the headline cases (ObjectId, vector, Date, scalar arrays, end-to-end roundtrips). A strict-mode codec-registry-completeness check is a planned follow-up.

### Walk-back path

If the structural seam later proves heavier than the annotational seam in lane code, the additive walk-back is to keep `resultShape` as the canonical structural carrier and add a small lane helper that constructs one from a SQL-style `Record<string, codecId>` map for callers that don't need recursion. That helper produces a `kind: 'document'` shape with leaf entries — non-breaking; existing consumers continue to work.

## Alternatives considered

### Reuse SQL's `meta.annotations.codecs` / `meta.projectionTypes`

The SQL runtime resolves codecs from two flat alias→codec maps populated by the SQL builder, in `meta`:

```ts
plan.meta.annotations.codecs = { _id: 'mongo/objectId@1', /* … */ };
plan.meta.projectionTypes    = { _id: 'mongo/objectId@1', /* … */ };
```

This is a flat map: each projected alias points to a codec id. It works for SQL because SQL rows are flat from the runtime's perspective — one alias per cell, with nested JSON aggregates handled by a single JSON codec at the leaf.

Mongo rows are not flat. A row carrying `tags: string[]` plus `address: { city: string }` plus `posts: Post[]` (where each post has its own scalar fields) cannot be described by a flat `Record<string, codecId>`. We would have to encode structure into the keys (`'address.city': 'mongo/string@1'`, `'posts.0.title': 'mongo/string@1'`, …) — which both encodes structure as a string at every consumer's edge, and depends on knowing the array length up-front for elements that are positional. Or we'd have to add a sidecar tree on `meta`. Either is structure-on-`meta` — same problem the structural carrier solves, except hidden in a metadata bag whose original purpose was something else.

The honest framing is that SQL's `meta.annotations.codecs` was a pragmatic seam, not a design intent — it works because SQL's rows happened to be flat. Mongo's are not. Recurring the SQL seam in a domain where it doesn't fit would compound an existing architectural debt instead of paying it down.

### Migrate SQL to the structural seam in the same change

The structural carrier could just as well live on `SqlQueryPlan`. Migrating SQL to it would unify both runtimes on the same model.

We didn't, deliberately. SQL's `meta.annotations.codecs` is in production and works correctly for every shape SQL plans produce today. The recursion problem that motivates the structural carrier on Mongo doesn't exist on SQL: SQL runs decode against flat aliases. A SQL migration would be a behaviour-preserving refactor with no immediate correctness payoff, while doubling the change's blast radius. Defer until SQL grows a recursion problem of its own (e.g. typed nested JSON aggregates, or cross-family parity becomes load-bearing for some other reason).

### Have the user thread a `MongoCodecRegistry` through the runtime

An earlier draft of this work added a required `codecs: MongoCodecRegistry` field to `MongoRuntimeOptions` and asked the user — or the `mongo()` extension — to construct one and pass the same instance to both adapter and runtime. It worked, but it leaked an internal coordination problem onto every call site: the same-instance invariant was enforced by the user remembering to do it correctly.

The framework already had the right model for this. SQL's runtime composes from a stack of component descriptors (`SqlExecutionStack`), each of which declares its codec contributions on `ComponentMetadata.types.codecTypes.codecDescriptors`; `createExecutionContext({ contract, stack })` walks the stack and aggregates the contributions into a single registry. The Mongo runtime simply hadn't joined that model. This ADR's design plugs Mongo in: descriptors declare `codecDescriptors`, `createMongoExecutionContext` aggregates them, the runtime takes a context whole. `MongoCodecRegistry` doesn't appear in any user-facing surface; the read-only `MongoCodecLookup` is what the runtime uses internally.

This is the same shape SQL already uses, applied to Mongo — not a new pattern.

## References

- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md). Defines the `RUNTIME.DECODE_FAILED` envelope shape used here.
- [ADR 030 — Result decoding & codecs registry](./ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md). Registry model and error-mapping codes (still in force; this ADR refines decoding for Mongo specifically).
- [ADR 152 — Execution Plane Descriptors and Instances](./ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md). The execution-stack composition model Mongo joins for codec aggregation.
- [ADR 204 — Single-Path Async Codec Runtime](./ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). Always-await, one-`Promise.all`-per-row invocation pattern preserved here. Originally deferred Mongo decode; this ADR closes that.
- SQL reference for runtime invocation parity: `packages/2-sql-family/5-runtime/src/codecs/decoding.ts` and `packages/2-sql-family/4-lanes/sql-builder/src/runtime/builder-base.ts`.
- Existing type-level shape vocabulary: `packages/2-mongo-family/5-query-builders/query-builder/src/{types,resolve-path}.ts` (`DocField`, `DocShape`, `NestedDocShape`, `ObjectField`).
