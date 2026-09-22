# Mongo pipeline builder

The Mongo pipeline builder is a typed query API that turns chained method calls into MongoDB aggregation pipelines. It is the entry point for reads, writes, and find-and-modify operations on a Mongo-backed Prisma 8 contract.

This page is a working reference: a concrete example to ground the mental model, then an explanation of how queries are shaped, then the surface itself.

## A grounding example

Imagine an `orders` collection where each document has `customerId`, `amount`, and `status`. We want the top ten customers by total spend on active orders:

```ts
import { mongoQuery } from '@internal/mongo-query-builder';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const query = mongoQuery<Contract>({ contractJson });

const plan = query
  .from('orders')
  .match((f) => f.status.eq('active'))
  .group((f, acc) => ({
    _id: f.customerId,
    total: acc.sum(f.amount),
  }))
  .sort({ total: -1 })
  .limit(10)
  .build();
```

`build()` returns a `MongoQueryPlan` ready for the Mongo runtime to execute. The chain reads top-to-bottom in the same order the aggregation pipeline does — filter, group, sort, limit — and every step is type-checked against the contract.

## The decision: aggregation-only reads

Prisma 8's Mongo surface has **one read API: aggregation pipelines**. There is no `find()`. Every read — including the simple ones that would normally call `db.collection.find({...})` — is expressed as a pipeline that ends in a read terminal.

This is a deliberate design choice ([ADR 183](../architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md)). It has three consequences worth keeping in mind:

- **One filter language.** A simple lookup and a multi-stage analytical query share the same `match(...)` syntax. There is no "this is the `find` filter, that is the `$match` filter" split.
- **Composition is the default.** A read and the join, group, or projection on top of it are written as one chain, not stitched together by hand.
- **Performance work pays once.** Index hints, codec encoding, and projection rules apply to every read, not just to the analytical ones.

If you need a single document, it's a pipeline ending in `.limit(1)`. If you want a count, it's a pipeline ending in `.count(...)`. If you need an upsert, it's a pipeline ending in a write terminal. The shape never changes.

## Building a query

Every query starts at `query.from(collectionName)` and walks through up to three states:

```text
CollectionHandle  →  FilteredCollection  →  PipelineChain  →  Terminal
       (root)         (after .match)         (after any
                                              other stage)
```

The state name decides what you are allowed to do next, and it changes as you chain stages:

- **`CollectionHandle`** — the root. From here you can run unqualified writes (`insertOne`, `updateAll`, `deleteAll`), filtered reads (via `match`), or jump straight to a read terminal (`build`).
- **`FilteredCollection`** — what you get after `.match(...)`. From here you can run filtered writes (`updateMany`, `deleteMany`, `upsertOne`), find-and-modify (`findOneAndUpdate`, `findOneAndDelete`), or continue chaining.
- **`PipelineChain`** — what you get after any other stage (`group`, `sort`, `lookup`, `addFields`, …). From here only reads are valid; the pipeline can no longer be expressed as a single `update`/`delete` wire command. Chains end at a read terminal (`build`, `aggregate`) or at a pipeline write terminal (`out`, `merge`).

Most users never need to think about the state names directly — the type system enforces them. But when an editor refuses to autocomplete a method, "the state I'm in doesn't allow that operation" is almost always the answer.

## Reading

Reads always end at a read terminal:

- `.build()` or `.aggregate()` — execute and return rows.
- `.findOneAndUpdate(fn, opts?)` / `.findOneAndDelete()` — execute and return the matched document (or `null`).

What goes in between is the pipeline. The stages below are organised by what they do; for the unfamiliar names, MongoDB's [aggregation reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/) is the canonical source.

Examples in the rest of this page assume:

```ts
const orders = query.from('orders');
import { acc, fn } from '@internal/mongo-query-builder';
```

`fn` is a namespace of typed expression helpers (`fn.toUpper(...)`, `fn.concat(...)`, `fn.literal(...)`); `acc` is the parallel namespace of accumulators (`acc.sum(...)`, `acc.count(...)`, …). Both produce `MongoAggExpr` AST nodes under the hood, but you rarely need to think about that.

### Filter, sort, paginate

```ts
orders.match((f) => f.status.eq('active')).build();

orders.sort({ amount: -1 }).build();

orders.limit(10).build();
orders.skip(20).build();
orders.sample(3).build();
```

`match` accepts either a callback over a typed `FieldAccessor` (recommended — full type-checking) or a raw `MongoFilterExpr` (escape hatch). The callback form is what the type system can verify; the raw form is what the runtime ultimately sees.

### Reshape

`addFields` adds computed fields without touching existing ones:

```ts
orders
  .addFields((f) => ({ label: fn.concat(f.status, fn.literal('!')) }))
  .build();
```

`project` narrows or computes the row shape:

```ts
orders.project('status', 'amount').build();

orders
  .project((f) => ({ status: 1 as const, upper: fn.toUpper(f.status) }))
  .build();
```

`replaceRoot` swaps the entire row for one of its sub-objects, and `unwind` flattens an array field into one row per element:

```ts
orders.replaceRoot((f) => f.customer).build();

orders.unwind('items', { preserveNullAndEmptyArrays: true }).build();
```

### Aggregate

`group` is the workhorse. Its `_id` may be `null` (single bucket — whole-collection aggregation), a field path, or any expression. Every other key must be an accumulator:

```ts
orders
  .group((f) => ({
    _id: f.customerId,
    total: acc.sum(f.amount),
    orderCount: acc.count(),
  }))
  .build();
```

Convenience aggregations:

```ts
orders.count('totalOrders').build();
orders.sortByCount((f) => f.status).build();
```

For bucketing the typed surface gives you the chain entry point but the bucket boundaries / grouping expression flow as raw AST nodes (most commonly `MongoAggFieldRef.of('field')` — see [the primitives reference](./mongodb-primitives-reference.md)):

```ts
import { MongoAggFieldRef } from '@internal/mongo-query-ast/execution';

orders
  .bucket({ groupBy: MongoAggFieldRef.of('amount'), boundaries: [0, 100, 1000] })
  .build();

orders.bucketAuto({ groupBy: MongoAggFieldRef.of('amount'), buckets: 5 }).build();
```

### Join

`lookup` is a typed equi-join. The callback grounds the foreign root, then `on(...)` selects the matching fields and `as(...)` names the sidecar array:

```ts
orders
  .lookup((from) =>
    from('users')
      .on((local, foreign) => ({ local: local.customerId, foreign: foreign._id }))
      .as('customer'),
  )
  .build();
```

`graphLookup` is the recursive form. `unionWith` appends another collection's rows to the current pipeline. Both expose option objects rather than fluent chains:

```ts
import { MongoAggFieldRef } from '@internal/mongo-query-ast/execution';

orders
  .graphLookup({
    from: 'orders',
    startWith: MongoAggFieldRef.of('parentId'),
    connectFromField: 'parentId',
    connectToField: '_id',
    as: 'ancestors',
  })
  .build();

orders.unionWith('archivedOrders').build();
```

### Specialised stages

Geo, window, multi-pipeline, search, and densify/fill stages are also exposed. Their signatures take option objects rather than fluent chains because the underlying MongoDB stage shapes are non-uniform:

| Stage | Builder method |
| --- | --- |
| `$geoNear` | `.geoNear({ near, distanceField, spherical?, … })` |
| `$setWindowFields` | `.setWindowFields({ partitionBy, sortBy, output })` |
| `$densify` / `$fill` | `.densify({ … })`, `.fill({ … })` |
| `$facet` | `.facet({ branchName: MongoPipelineStage[], … })` |
| `$redact` | `.redact((f) => …)` |
| `$search` / `$searchMeta` | `.search(config, indexName?)`, `.searchMeta(config)` |
| `$vectorSearch` | `.vectorSearch({ index, path, queryVector, … })` |

The Atlas-only search stages take their config as an object that mirrors the MongoDB Atlas Search shape — Prisma 8 does not provide a typed wrapper for those configs.

## Writing

Writes branch by where in the chain they live:

**Unqualified writes** are valid only on the root `CollectionHandle`:

```ts
query.from('orders').insertOne({ customerId: '…', amount: 99, status: 'active' });
query.from('orders').insertMany([ /* … */ ]);
query.from('orders').updateAll((f) => f.status.set('archived'));
query.from('orders').deleteAll();
query.from('orders').upsertOne((f) => f._id.eq('o-1'), (f) => f.amount.set(0));
```

**Filtered writes** are valid after `.match(...)`:

```ts
orders.match((f) => f.status.eq('cancelled')).deleteMany();

orders
  .match((f) => f._id.eq('o-1'))
  .updateOne((f) => f.amount.set(99));

orders
  .match((f) => f._id.eq('o-1'))
  .upsertOne((f) => f.amount.set(99));
```

**Find-and-modify** also requires a `.match(...)` and returns the matched document (or `null`):

```ts
orders
  .match((f) => f._id.eq('o-1'))
  .findOneAndUpdate((f) => f.status.set('shipped'), { returnNewDocument: true });

orders.match((f) => f._id.eq('o-1')).findOneAndDelete();
```

**Pipeline write terminals** (`$out`, `$merge`) are valid at the end of any pipeline. They write the pipeline's output to a destination collection rather than returning rows:

```ts
orders.match((f) => f.status.eq('archived')).out('archivedOrders');

orders
  .group((f) => ({ _id: f.customerId, total: acc.sum(f.amount) }))
  .merge({
    into: 'customerTotals',
    on: '_id',
    whenMatched: 'replace',
    whenNotMatched: 'insert',
  });
```

After any non-`match` stage, the chain has entered `PipelineChain` state and only reads or pipeline-write terminals are reachable. The `update`/`delete` wire commands cannot represent arbitrary pipelines, so the type system gates the shorter forms behind the earlier states.

## Codecs

Codecs are how the contract translates between BSON wire values and TypeScript values (`mongo/objectid@1`, `mongo/double@1`, `mongo/string@1`, …). The pipeline builder's relationship to codecs is asymmetric across the three sites where values cross the boundary:

| Site | Codec applied? | What this means in practice |
| --- | --- | --- |
| Read terminal results | Yes | `.build()` / `.aggregate()` / `.findOneAndUpdate(...)` return TypeScript values, not raw BSON. |
| Write inputs (insert / set / push) | Yes | `insertOne({...})`, `f.amount.set(123)`, `f.tags.push('x')` go through the contract's encoders ([ADR 184](../architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md)). |
| `match(...)` filter values | **No** | Filter values are passed through as-is. ObjectId fields, in particular, must be filtered with already-encoded values; passing a string where an ObjectId is expected will not match. |

The filter-side asymmetry is a known limitation; in practice it is mostly visible to users querying ObjectId fields. Until it is closed, build a small wrapper or use a `MongoParamRef` with the appropriate `codecId`. The retail-store example's [`middleware.ts`](../../examples/retail-store/middleware.ts) shows one way to set this up.

For the codec model see [Subsystem 5 — Adapters & Targets](../architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md) and the [Codec authoring guide](./codec-authoring-guide.md).

## Type guarantees

The builder propagates the row shape through any stage whose result shape can be derived statically:

- **Additive** stages (`addFields`, `lookup`) extend the row.
- **Narrowing** stages (`project`, `unwind`) restrict the row.
- **Replacing** stages (`group`, `replaceRoot`, `count`, `sortByCount`) substitute a new row shape.
- **Opaque** stages (`bucket`, `facet`, `geoNear`, `graphLookup`, `setWindowFields`, `searchMeta`, raw `pipe`) collapse the shape to `DocShape`. To opt back into types after one of these, supply a shape parameter to `pipe<NewShape>(...)`.

Field-path expressions inside callbacks (`(f) => f.amount.eq(...)`, including nested `f('address.city')` and the typed `rawPath('a.b')`) are statically resolved against the contract.

Two phantom marker types track which terminals are still legal as the chain advances ([ADR 201](../architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md) covers the full design):

- **`UpdateEnabled`** — gates the no-arg `.updateMany()` / `.updateOne()` form, where the chain itself is consumed as the update pipeline. Cleared by stages the `update` wire command cannot accept (`group`, `lookup`, `limit`, `skip`, `sort`, …).
- **`FindAndModifyEnabled`** — gates `.findOneAndUpdate(...)` and `.findOneAndDelete(...)`. Cleared by stages incompatible with the slots in the `findAndModify` wire command (`skip`, `limit`, `group`, `lookup`, mutating stages, …).

The static row type for read terminals is computed from the chain's `Shape` and the contract's codec type maps. `null` is added to the row type for `findOneAndUpdate` and `findOneAndDelete`, since either may match no document.

What is *not* statically guaranteed:

- Filter values in the raw-AST form of `match(filter)` — use the callback form for full checking.
- Stage option objects whose shape the typed accessor cannot reach (`bucket.groupBy`, `setWindowFields.partitionBy`, `geoNear.near`, …). The [primitives reference](./mongodb-primitives-reference.md) covers the wire-level shapes.
- Atlas Search and `$vectorSearch` configs — these are passed through as plain objects.

## Escape hatches

Two levels of escape hatch are available when the typed surface does not reach a use case:

```ts
import { MongoLimitStage } from '@internal/mongo-query-ast/execution';

// Append a raw stage; preserves the chain but collapses the shape unless
// you supply a NewShape to pipe<NewShape>().
orders.pipe(new MongoLimitStage(5)).build();

// Drop entirely below the pipeline builder for arbitrary commands.
query.rawCommand({ /* full Mongo command */ });
```

Prefer `pipe(...)` over `rawCommand(...)` when possible — `pipe` keeps the rest of the chain typed, while `rawCommand` is a complete bypass.

## Limitations

A few corners of the API are intentionally not yet typed:

- **Filter values** (the `match(...)` callback's right-hand sides) are not encoded through codecs. ObjectId field filters must use already-encoded values or a `MongoParamRef` with the correct `codecId`.
- **`$vectorSearch`** and **`$search` / `$searchMeta`** configs are accepted as raw option objects; the builder does not yet provide typed wrappers or shape-aware result typing for them.
- **`$facet` branches** are arrays of raw `MongoPipelineStage`, not chained typed builders. Branch results do not propagate per-branch shapes.
- **Polymorphic-variant filtering** has known gaps in the Mongo migration planner that may surface as runtime mismatches against the generated `$jsonSchema` validators. See [Subsystem 10 — MongoDB Family § Migration authoring](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md#migration-authoring) for the current state.

For unknown stages on a known shape, use `pipe(...)`. For commands the typed surface cannot express at all (`createIndex`, `runCommand`, …), use `query.rawCommand(...)`.

## Alternatives considered

**A `find()` API alongside aggregation.** Most ODMs expose both a "simple" `find()` interface and a separate aggregation interface. We considered the same shape and rejected it for two reasons. First, it would mean two filter syntaxes — the `find` query language and the `$match` expression language — that are similar but not identical, with subtle semantic gaps users hit at the worst time. Second, it would split user knowledge across two surfaces: every team that started on `find()` would need to relearn aggregation the moment they needed a `$lookup` or a `$group`, and the simple-query path would silently encourage anti-patterns (full collection scans where a filter index would have served, missing projections that pull large documents over the wire). A single pipeline-shaped API costs a small amount of friction on trivial queries and pays a much larger dividend the moment a query stops being trivial.

**A schema-aware filter DSL** that compiles down to either `find` or `$match` depending on what's needed. We rejected this because it adds a translation layer for users to learn, and because the static-typing properties we wanted (callback-typed field accessors, expression composition with `fn.*`, accumulator typing with `acc.*`) compose more cleanly when the surface and the runtime shape match one-to-one.

The full reasoning, including the criteria the decision was evaluated against, is in [ADR 183](../architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md).

## Related

- [Subsystem 10 — MongoDB Family](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — architectural overview, lane contract, runtime layering.
- [ADR 183 — Aggregation pipeline only, never `find()` API](../architecture%20docs/adrs/ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md) — the read-API decision.
- [ADR 184 — Codec-owned value serialization](../architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md) — write-input encoding through codecs.
- [ADR 201 — State-machine pattern for typed DSL builders](../architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md) — the marker types behind state transitions.
- [Codec authoring guide](./codec-authoring-guide.md) — author codecs that flow through the builder.
- [MongoDB primitives reference](./mongodb-primitives-reference.md) — wire-level filter, expression, and accumulator nodes.
