# ADR 318 — MongoDB prepared statements

**Status:** Accepted
**Builds on:** [ADR 210 — Prepared Statements: Author Surface and Driver SPI](ADR%20210%20-%20Prepared%20Statements%20-%20Author%20Surface%20and%20Driver%20SPI.md), [ADR 271 — The runtime middleware observes a tree of activities](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities%2C%20each%20started%2C%20ended%20and%20finalized.md)

## At a glance

```ts
import mongo from '@prisma/orm-mongo/runtime';
import { contract } from './contract';

const db = mongo({ contract, url: process.env['MONGODB_URL']! });

const byStatus = await db.prepare(
  { status: 'mongo/string@1', skip: 'mongo/int32@1', take: 'mongo/int32@1' },
  (p) =>
    db.query
      .from('accounts')
      .match((f) => f.status.eq(p.status))
      .sort({ email: 1 })
      .skip(p.skip)
      .limit(p.take)
      .build(),
);

const runtime = await db.runtime();
const page = await byStatus.query(runtime, { status: 'active', skip: 0, take: 20 }).toArray();

const promote = await db.prepare({ from: 'mongo/string@1', to: 'mongo/string@1' }, (p) =>
  db.query
    .from('accounts')
    .match((f) => f.status.eq(p.from))
    .updateMany((f) => [f.status.set(p.to)]),
);
const { affectedRows } = await promote.execute(runtime, { from: 'new', to: 'active' });
```

## Decision

MongoDB has `prepare(declaration, callback)` with the author surface ADR 210 gives SQL. A declaration maps each parameter name to a codec id. The callback receives one placeholder per name and returns a plan. `prepare` returns a handle, and the handle runs against an explicit target with `query(target, params)` (and, for updates and deletes, `execute(target, params)`).

MongoDB has no server-side prepared statements, so all the saving is on the client. The callback, the plan building and the structural lowering run once, at `prepare`. Each run fills in the values, runs `beforeEncode`, encodes the values with codecs and sends the command. The driver is unchanged.

## The placeholder is its own node

`@internal/mongo-value` has a frozen class `MongoPreparedParamRef { name, codecId, nullable }`. It is the counterpart of SQL's `PreparedParamRef`, holds no value, and is part of the `MongoValue` union, so it goes wherever a value goes. One predicate, `isMongoPreparedParamRef`, recognises it.

The walkers that meet values treat it as follows:

- `resolveValue` and `resolveDraftSlot` in the MongoDB adapter refuse it with `RUNTIME.PREPARE_BIND_ON_ADHOC`. Reaching it there means a plan built inside `prepare` was run without it.
- `needsLiteralWrap` wraps an aggregation literal that holds one in `$literal`, as it does a `MongoParamRef`, because its value is known only when the run resolves it.
- The runtime walks a lowered draft with one shared walk, `flattenMongoDraftLeaves` and `mapMongoDraftLeaves` in `@internal/mongo-runtime`. The parameter mutator, the placeholder collector at `prepare` and the bind step of each run all use it. It recurses through arrays and plain records only, as `resolveDraftSlot` does, and visits raw commands too.

## `prepare` lives on the runtime, and the client exposes it

`MongoRuntime.prepare` is the primitive. In order, it:

1. Checks each declared codec id against the execution context's codecs. An unknown id throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` with `{ codecId }`.
2. Builds one frozen placeholder per declared name.
3. Calls the callback once.
4. Runs `runBeforeCompile` once. MongoDB has no `beforeCompile` hook, so this returns the plan unchanged; it is called so a future hook runs at prepare time, as ADR 210 requires.
5. Runs `structuralLower` once and keeps the draft.
6. Collects the placeholders in the draft. A placeholder in a raw command throws `RUNTIME.PREPARE_RAW_PLACEHOLDER` with `{ name }`, because raw commands go to the driver as written and the placeholder object would be sent as a document. A declared name the plan does not use throws `RUNTIME.PREPARE_UNUSED_PARAM` with `{ unused }`.
7. Returns a frozen handle.

It does no I/O. It is `async`, so a future async `beforeCompile` fits without an interface change. A raw plan with no placeholders may be prepared; each run sends it as it is.

`db.prepare` on the `mongo()` client rejects with `DRIVER.NOT_CONNECTED` (`'Mongo client is closed'`) on a closed client. Otherwise it builds the runtime without connecting and calls its `prepare`. So a client with no binding yet can prepare, and an error that stops the runtime being built, such as `RUNTIME.MIDDLEWARE_TARGET_MISMATCH`, comes out of `db.prepare`. `mongoStatic()` has no runtime and no `prepare`, as `postgresStatic()` has none.

## Each run fills the draft, then follows the ad-hoc path

`handle.query(target, params, options?)`:

1. Finds the internal bridge on `target`.
2. Checks `params`. A missing name throws `RUNTIME.PREPARE_MISSING_PARAM` with `{ name }`; `params` that is not an object throws the same code with no details, because no single name is missing. Extra names are ignored.
3. Binds the draft. Each placeholder becomes one `MongoParamRef(value, { name, codecId, nullable })`, placed at every position the placeholder holds. A placeholder used twice is one parameter in two places, so `beforeEncode`'s `entries()` lists it twice and one `replaceValue` changes both.
4. Continues as an ad-hoc run does after structural lowering: the statement activity, `beforeEncode`, a check of every `$limit` and `$skip` value, `resolveParams`, the driver, and row decoding with the result shape kept from `prepare`. Ad-hoc and prepared runs share this code.

The activity's `plan` is the handle, as on SQL. `intercept.onQuery`, `onRow` and `contentHash` receive the execution plan built for each run, so a prepared run has the same content hash as the same query run ad hoc with the same values.

Steps 1 to 3 happen before the activity starts: on the first iteration for `query`, and as a rejected promise for `execute`. SQL checks params inside the activity. A MongoDB run on a closed runtime fails with `DRIVER.NOT_CONNECTED` (`'Runtime is closed'`) in the driver step, after `beforeEncode`, which is where an ad-hoc MongoDB run fails.

A value bound from a placeholder carries the declared name and no collection, so a codec failure says "parameter email", not "field email in collection 'accounts'". SQL loses the same detail.

## Placeholders are encoded with the declared codec

Each run encodes a placeholder's value with the codec its declaration names, in the query builder as in any other lane. With `{ id: 'mongo/objectId@1' }`, a hex string is sent as an `ObjectId`.

The query builder does not encode its literal values: `f._id.eq('65f…')` run directly sends the string. So the same query-builder query can send different values prepared and run directly, and a declaration of `mongo/string@1` compared with `_id` sends a string and matches nothing, with no error. Both come from the query builder never encoding literals, which this decision does not change. The query builder also does not check a placeholder's codec against the field's.

## Where a placeholder may go

- Every query-builder operator that takes a `MongoValue`: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `type`, each element of `in` and `nin`, `set`, `min`, `max`, `push`, `addToSet`, `pull`, `setOnInsert`, each element of `pullAll`, insert documents, and update pipeline stages.
- Aggregation literals, through `fn.literal(p.name)`.
- `limit` and `skip`. They take a number or a non-nullable placeholder whose codec's `input` type is `number` (the query builder's `PagingCount`). `MongoLimitStage.limit` and `MongoSkipStage.skip` are `number | MongoPreparedParamRef`; their constructors still check a number: a limit must be a positive integer, because MongoDB refuses `$limit: 0`, and a skip a non-negative integer. After `beforeEncode`, each run checks every parameter in a `$limit` or `$skip` the same way, in the pipeline and in the sub-pipelines of `$lookup`, `$facet`, `$unionWith` and `$merge.whenMatched`, and throws `ORM.ARGUMENT_INVALID` otherwise, as `limit(-1)` does. The error names the stage, and the parameter when the value came from one (`meta: { stage, name }`). Checking after middleware covers a value middleware replaced.

Paging is the most common prepared query, and SQL accepts placeholders there, so `limit` and `skip` take them even though they are numbers rather than values.

## Two handles, picked from the command

- `MongoPreparedStatement<Params, Row>` has `query(target, params, options?)`, which returns `AsyncIterableResult<Row>`.
- `MongoPreparedExecution<Params, Row>` is for the commands that report statement statistics: `updateOne`, `updateMany`, `deleteOne` and `deleteMany`, from the query builder or the raw lane. It has `query`, which yields the driver's result row as `runtime.query(plan)` does, and `execute(target, params, options?)`, which returns the statistics `runtime.execute(plan)` returns.

`MongoPreparedFor<Params, Row, Command>` picks the handle from the plan's `Command` type, and `prepare` builds the matching class from the draft's command kind. The rule is the one ad-hoc `execute` uses: a raw `updateOne` lowers to an `updateOne` wire command, which `runtime.execute` gives statistics for, so its prepared handle has `execute` too. The raw lane's plans carry their raw command type, so the type agrees. A method a plan cannot use is absent from the value, not only from the type, as on SQL.

The second handle has both methods because a MongoDB update or delete plan, typed or raw, supports both `query` and `execute`. SQL's `PreparedExecution` has `execute` only; the MongoDB class shares the name because it is the handle that has `execute`.

## The runtime is the only target, and the bridge is internal

Handles type `target` as `MongoQueryExecutor { query(plan); execute(plan) }`, which `@internal/mongo-query-ast/execution` declares beside `MongoQueryPlan`. SQL types its target the same way, as `RuntimeScope`. `MongoRuntime` extends it. At run time the handle looks for an internal bridge symbol on the target; `MongoRuntimeImpl` installs it, and no public entry point exports it. A target without it throws an invariant error that names what to pass: "A prepared statement runs against a MongoRuntime, such as `await db.runtime()`. The target passed to query() is not one: it has no prepared statement query bridge." (`execute` for the other face).

The MongoDB runtime has no connections or transactions to run a handle on, so its only target is the runtime. The `mongo()` client is not a target: `db.query` is the query builder, so the client has no `query(plan)`.

## Declaration types

- `MongoDeclaration<CT>` maps names to a codec id (`keyof CT & string`) or `{ codecId, nullable?: boolean }`.
- `MongoPlaceholders<D>` gives the callback a `MongoPreparedParamRef<CodecId, Nullable>` per name.
- `MongoParamsFromDeclaration<D, CT>` gives each run's values: each codec's `input` type, plus `null` when the parameter is nullable. It reads `input` through `MongoCodecInput<CT, Id>` in `@internal/mongo-contract`, beside `ExtractMongoCodecTypes`.
- `MongoPrepareMember<DefaultCodecTypes>` is the `prepare` method. `MongoRuntime` uses it with the base codec types; `MongoClient` binds them to `ExtractMongoCodecTypes<TContract>`, so an unknown codec id fails to compile. A declaration names a codec id and nullability only; MongoDB builds each codec once, with no type parameters.

The handle and declaration types, and `MongoPreparedParamRef` as a type, are exported from `@prisma/orm-mongo/family-runtime`.

## `null` values

A `null` binds to `MongoParamRef(null, { name, codecId, nullable })`, so middleware sees it like any other value. `resolveValue` sends `null` without calling the codec only when the parameter holds `null` and is marked nullable. Every other `null` still goes to the codec, which refuses it with `RUNTIME.ENCODE_FAILED`.

SQL skips the codec for every `null`. MongoDB cannot: the ORM wraps a `null` element written to a list whose elements are not nullable as `MongoParamRef(null, { codecId })` so the codec refuses it. A non-nullable placeholder given `null` at run time is refused the same way, which matches its type.

## Codec ids are checked at `prepare`

SQL raises `RUNTIME.CODEC_DESCRIPTOR_MISSING` at the first run. MongoDB raises it at `prepare`, because MongoDB's adapter sends a value whose codec id it does not know as it is, so waiting for the run would send wrong data without an error.

## Errors

| Case | Code | When |
|---|---|---|
| Unknown codec id in the declaration | `RUNTIME.CODEC_DESCRIPTOR_MISSING` | `prepare` |
| Placeholder in a raw command | `RUNTIME.PREPARE_RAW_PLACEHOLDER` | `prepare` |
| Declared name not used | `RUNTIME.PREPARE_UNUSED_PARAM` | `prepare` |
| Closed client | `DRIVER.NOT_CONNECTED` | `db.prepare` |
| Name missing at run, or params not an object | `RUNTIME.PREPARE_MISSING_PARAM` | run, before the activity |
| `$limit` value not a positive integer, or `$skip` value not a non-negative integer | `ORM.ARGUMENT_INVALID` | run, after `beforeEncode` |
| Target without the bridge | invariant error | run |
| Plan with a placeholder run without `prepare` | `RUNTIME.PREPARE_BIND_ON_ADHOC` | ad-hoc run |
| Codec fails on a value | `RUNTIME.ENCODE_FAILED` | run |
| Closed runtime | `DRIVER.NOT_CONNECTED` | run, in the driver step |

## Non-goals

- No server-side preparation and no driver change.
- No placeholders in the raw lane; `prepare` refuses them.
- No placeholders in `inc`, `mul` or `pop` amounts, sort directions, field names, `$sample` sizes or `$vectorSearch` settings. These positions are typed as plain numbers or strings.
- No prepared ORM writes, as on SQL. ORM reads (`.prepared.all()` and `.prepared.first()`) are a separate step.
- No check that a handle runs against a runtime for the same contract, as on SQL (ADR 210, cross-adapter reuse).
- The client is not a target. No SQL client is one either: Postgres, SQLite and MySQL handles run against `db.runtime()`, a connection or a transaction. Making clients targets would be one decision for every family.

## Alternatives considered

- **A `MongoParamRef` without a value instead of a new class.** It would reuse every walker unchanged, but each walker would have to tell a missing value from an `undefined` one, and a forgotten case would send `undefined`. A separate class is explicit, and the walkers that must refuse or wrap it are listed above and tested.
- **The client as a target.** `db.query` is the query builder, so the client cannot have `query(plan)` without a rename, and no other family's client is a target.
- **One handle class with both methods for every plan.** `execute` on a read or an insert would fail at run time with `RUNTIME.MONGO_STATISTICS_UNSUPPORTED`. Two classes make the unusable method absent.
- **Skipping the codec for every `null`, as SQL does.** This would let a `null` element through to a list whose elements are not nullable.
- **Checking codec ids at the first run, as SQL does.** MongoDB would send the raw value instead of failing.
