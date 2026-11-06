# MongoDB `prepare()` — design

Linear: TML-3792. Research with file paths and line numbers: `wip/research/mongo-prepare-research.md` (gitignored, in this worktree). Design reviews: `wip/review-design/`.

## The goal

```ts
const db = mongo({ contract, url });
const runtime = await db.runtime();

const findByEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
  db.query.from('users').match((f) => f.email.eq(p.email)).build(),
);
for await (const user of findByEmail.query(runtime, { email: 'alice@example.com' })) {
  // ...
}

const byStatus = await db.prepare({ status: 'mongo/string@1', take: 'mongo/int32@1' }, (p) =>
  db.orm.users.where({ status: p.status }).limit(p.take).prepared.all(),
);
const rows = await byStatus.query(runtime, { status: 'active', take: 20 }).toArray();
```

`mongo()` gets `prepare(declaration, callback)` with the same author surface as the SQL clients (ADR 210): a declaration of parameter names and codec ids, a callback that takes placeholders and returns a plan, and a handle run against an explicit target. MongoDB has no server-side prepared statements, so the benefit is on the client. The callback, plan building, ORM compilation and structural lowering run once. Each run fills in values, runs `beforeEncode`, encodes with codecs and sends the command.

## Terms

- **Declaration:** a record from parameter name to codec id, or `{ codecId, nullable: true }`.
- **Placeholder:** the value the callback receives for each declared name. It goes into the query where a value goes. Each run supplies the real value. SQL calls this a bind site.
- **Structural lowering:** `MongoAdapter.structuralLower(plan)`. It turns a plan into a draft MongoDB command with values still as nodes, and calls no codecs.
- **Resolving params:** `MongoAdapter.resolveParams(draft, ctx)`. It encodes each value node with its codec and builds the wire command.
- **Target:** the object a handle runs against. On MongoDB that is a `MongoRuntime`.

## Non-goals

- No server-side preparation and no driver change. `MongoQueryable` and `MongoDriver` stay as they are.
- No change under `packages/1-framework`.
- **The client is not a target.** No SQL client is one either: Postgres, SQLite and MySQL handles run against `db.runtime()`, a connection or a transaction (`postgres/9-facade/test/prepared-rows.types.test-d.ts`). Making clients targets would be one decision for every family, not a MongoDB difference. MongoDB has no connections or transactions, so its only target is the runtime.
- No placeholders in the raw lane. `prepare` refuses them (D2).
- No placeholders in `inc`/`mul`/`pop` amounts, sort directions, field names, `$sample` sizes or `$vectorSearch` settings. These positions are typed as plain numbers or strings, and making them accept placeholders is separate work.
- No prepared ORM writes. SQL has none either. ORM writes return promises, so a `prepare` callback cannot return one: that is a type error. A JavaScript caller can still call a write inside the callback, and the write runs at once. `ormParam`, which every ORM value passes through on its way into a `MongoParamRef`, refuses a placeholder at any depth with `ORM.ARGUMENT_INVALID`, so the message is clear whatever the codec.
- No placeholders inside ORM value-object literals (`{ address: { city: p.city } }`) or in `variant(...)`. In a value-object literal in a `where`, the placeholder reaches `ormParam`, which refuses it with `ORM.ARGUMENT_INVALID`. This holds because the placeholder pass-through sits only in the two `where` entry points (D9), so a top-level `where` value never reaches `ormParam`. `variant` chooses the model at build time, so it cannot take a value that arrives later.
- No codec type parameters in a declaration. MongoDB builds a codec once without field parameters (TML-3793), so a declaration names a codec id and nullability only.
- No check that a prepared handle runs against a runtime for the same contract. SQL has none either (ADR 210, cross-adapter reuse).

## Design decisions

### D1. A placeholder is its own node: `MongoPreparedParamRef`

`@internal/mongo-value` gets a frozen class `MongoPreparedParamRef { name, codecId, nullable }`, the counterpart of SQL's `PreparedParamRef`. It joins the `MongoValue` union, and it holds no value. One type predicate, `isMongoPreparedParamRef`, is used by every walker.

A separate class is clearer than a `MongoParamRef` without a value. But the compiler does not force the walkers to handle it: they use `instanceof` and `isPlainRecord`, and nothing narrows `MongoValue` exhaustively. So each walker is listed here and covered by a test.

- **Must change:**
  - `resolveValue` and `resolveDraftSlot` in `packages/3-targets/mongo/2-adapter/src/resolve-value.ts`. Today a placeholder would fall through to `Object.entries` and reach the wire as `{ name, codecId, nullable }`. Both throw `RUNTIME.PREPARE_BIND_ON_ADHOC` with `{ name }` when they meet one, because that means the plan was run without `prepare`.
  - `needsLiteralWrap` in `lowering.ts` returns true for a placeholder, so an aggregation literal holding one is wrapped in `$literal`, as a `MongoParamRef` is.
  - `MongoParamRefOptions` in `@internal/mongo-value` gains `nullable?: boolean`, and `substituteSlot` copies it, as it copies `name` and `codecId` (D3).
  - `MongoLimitStage` and `MongoSkipStage` (D5).
  - The ORM helpers in D9. Every ORM path that wraps a value calls `ormParam` (in `orm/src/orm-param.ts`), which refuses a placeholder at any depth of the value: `#fieldParam`, untyped and embedded fields, and the callback-form update operators all go through it.
- **Already treat it as a leaf, no change:** `flattenDraftSlot` and `substituteSlot` in the runtime's `param-ref-mutator.ts` (a class instance fails `isPlainRecord`), and the structural lowering walkers, which copy values as they are.
- **Cannot see one, no change:** the content hash (it reads only resolved wire commands), migration factories, the in-memory filter evaluator and the control adapter's ledger documents. These build values from contract data, never from a plan.
- **Tests that mirror the walks and must learn the new leaf:** `test/integration/test/mongo/runtime/flatten-resolve-parity.test.ts` and `execute-param-mutator-wiring.test.ts`, and the ORM's `collection.param-refs.test.ts`, `collection.variant-fields.test.ts` and `collection.mutation-defaults.test.ts`.

The new bind function (D3) and the placeholder collector (D2) walk the same slots as `flattenDraftSlot`. They share one slot walk with the mutator rather than adding two more copies, because the mutator's walk already has to stay in step with `resolveDraftSlot`.

### D2. `prepare` lives on the runtime, and the client exposes it

`MongoRuntime.prepare(declaration, callback)` is the primitive, as on SQL. It takes plans only; ORM descriptions are unwrapped by the client (D9). It:

1. Checks each declared codec id against the execution context's codec registry. An unknown id throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` with `{ codecId }`. SQL raises the same code at the first run. MongoDB checks earlier because today an unknown codec id on MongoDB is silently ignored and the raw value is sent, so waiting would send wrong data.
2. Builds one placeholder per declared name.
3. Calls the callback once and gets a plan.
4. Runs `runBeforeCompile` once. MongoDB has no `beforeCompile` hook today, so this returns the plan unchanged. It is called so that a future hook runs at prepare time, as ADR 210 requires.
5. Runs `structuralLower` once and keeps the draft.
6. Walks the draft for placeholders, including raw drafts:
   - A placeholder in a raw draft throws `RUNTIME.PREPARE_RAW_PLACEHOLDER` with `{ name }`. This is a new code. `resolveParams` sends raw documents to the driver as they are, so the placeholder object would be sent as a document and the query would match nothing.
   - A declared name that does not appear throws `RUNTIME.PREPARE_UNUSED_PARAM` with `{ unused }`.
7. Returns a frozen handle (D6).

A raw plan with no placeholders may be prepared. It has nothing to bind, and each run sends it as it is.

It does no I/O, as on SQL. It is `async`, as on SQL, so a future async `beforeCompile` fits without an interface change.

`db.prepare` on the `mongo()` client:

- Rejects with `DRIVER.NOT_CONNECTED` `'Mongo client is closed'` if the client is closed. It checks before creating anything, because `createRuntime()` has no closed check.
- Calls `createRuntime()`, not `getRuntime()`. `createRuntime()` builds the runtime and an unconnected driver object and opens no connection. `getRuntime()` would connect, and would reject with `RUNTIME.BINDING_MISSING` on a client with no binding yet. So a client with no binding can prepare.
- Surfaces any error `createRuntime()` throws, such as `RUNTIME.MIDDLEWARE_TARGET_MISMATCH`, from `prepare`.

`mongoStatic()` has no runtime and gets no `prepare`, as `postgresStatic()` has none.

### D3. Each run fills the draft, then follows the ad-hoc path

`handle.query(target, params, options?)`:

1. Finds the bridge on `target` (D7).
2. Checks `params` is an object and every placeholder name in the draft has a value. A missing name throws `RUNTIME.PREPARE_MISSING_PARAM` with `{ name }`. `params` that is not an object throws the same code with no details, as on SQL, because no single name is missing. The check runs before the activity starts: on the first iteration for `query`, and as a rejected promise for `execute`. SQL checks inside the activity; the ADR notes the difference. Extra names are ignored, as on SQL.
3. Builds a bound draft. Each placeholder becomes one `MongoParamRef(value, { name, codecId, nullable })`, created once per placeholder and placed at every position that placeholder holds. A placeholder used twice is one `MongoParamRef` in two places, as when the ORM reuses one. So `mutator.entries()` lists it twice, and one `replaceValue` changes both positions.
4. Continues as the ad-hoc path does after structural lowering: the `streamStatement` activity, `beforeEncode` with a `MongoParamRefMutator` over the bound draft, then a check of the `limit` and `skip` values in the draft after middleware (D5), `resolveParams`, the driver, and row decoding with the handle's `resultShape`. The ad-hoc `prepareOperation` is split so both paths share this code, instead of copying it.

**`null` values.** Each bound `MongoParamRef` carries the placeholder's `nullable` flag. A `null` binds to `MongoParamRef(null, { name, codecId, nullable })`, so middleware sees it like any other value. `resolveValue` returns `null` without calling the codec only when the ref holds `null` and is marked nullable, as SQL's `encodeParamValue` skips the codec for `null`.

Every other `MongoParamRef` holding `null` still goes to the codec, which refuses it with `RUNTIME.ENCODE_FAILED`. The ORM relies on this: it wraps a `null` element written to a list whose elements are not nullable as `MongoParamRef(null, { codecId })` (`#scalarParam`, `#wrapFieldOpValue`) so the codec refuses it, and `bson-scalars.lists.test.ts` tests that. A non-nullable placeholder given `null` at run time is refused the same way, which matches its type. Middleware that calls `replaceValue(ref, null)` on a nullable prepared value now works; on any other ref it is refused as today. This is narrower than SQL, which skips the codec for every `null`. MongoDB cannot do that, because the ORM relies on the codec to refuse `null` list elements. The ADR says so. `MongoParamRef` is not public, so the new flag is internal.

**What middleware sees.** The activity's `plan` is the handle, as on SQL, so the handle carries `meta`. `intercept.onQuery`, `onRow` and `contentHash` receive the execution plan built for each run, as on the ad-hoc path. The content hash of a prepared run equals the hash of the same query run ad hoc with the same values.

**Error labels.** A value bound from a placeholder has the declared name and no collection. So a codec failure reads "parameter email", not "field email in collection 'users'". SQL loses the same detail.

**Closed runtime.** A run on a closed runtime fails with `DRIVER.NOT_CONNECTED` `'Runtime is closed'` where the ad-hoc MongoDB path fails today: in the driver step, after `activityStarted` and `beforeEncode`. SQL refuses before middleware; MongoDB's ad-hoc path does not, and prepared runs match it.

### D4. Placeholders are encoded with the declared codec, in every lane

The declaration names each value's codec, so each run encodes the value with that codec, in the query builder as well as in the ORM. SQL encodes prepared values the same way.

The query builder does not do this for its literals today: `f._id.eq('65f…')` sends the string, and no codec runs. With `prepare`, `{ id: 'mongo/objectId@1' }` sends an `ObjectId`. So the same query-builder query encodes its values differently when prepared and when run directly. The query builder also does not know a field's codec, so a declaration of `mongo/string@1` compared with `_id` sends a string and matches nothing, with no error.

Both come from an existing gap: the query builder never encodes literal values. That gap is out of scope. The ADR records it as a known difference, and `deferred.md` records the follow-up: query-builder literals should be encoded with the field's codec.

### D5. Placeholders go wherever a value goes, plus `limit` and `skip`

- **Query builder:** every operator that takes a `MongoValue` takes a placeholder:
  - filter operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `type`, and each element of `in` and `nin`;
  - update operators that take a value: `set`, `min`, `max`, `push`, `addToSet`, `pull`, `setOnInsert`, and each element of `pullAll`;
  - insert documents, update pipeline stages and aggregation literals.

  The query builder does not check a literal against the field's codec today, and it does not check a placeholder's codec either.
- **`limit` and `skip`** in the query builder, and `limit` and `offset` in the ORM, also take a placeholder. Paging is the most common prepared query, and SQL accepts placeholders there.
  - The types accept a non-nullable placeholder whose codec's `input` is `number`, as SQL accepts non-nullable numeric operands. They do not list codec ids, so an extension codec with a numeric input works.
  - `MongoLimitStage.limit` and `MongoSkipStage.skip` become `number | MongoPreparedParamRef`. Their constructors keep the integer check for numbers and accept a placeholder.
  - Each run checks, after `beforeEncode`, that the value in `$limit` or `$skip` is a non-negative integer, and throws `ORM.ARGUMENT_INVALID` otherwise, the same code an ad-hoc `limit(-1)` throws. Checking after middleware covers a value middleware replaced. The check walks every pipeline in the draft, including the sub-pipelines of `$lookup`, `$facet`, `$unionWith` and `$merge.whenMatched`. `mongo/double@1` encodes an integer to `Double(20)`, which MongoDB accepts in `$limit`.
  - Lowering keeps the placeholder in `$limit` and `$skip`, and resolving fills it in. No other code reads these stages' values: the result-shape code treats both as stages that do not change the shape.
- **ORM:** see D9.

The positions listed under non-goals keep their current types.

### D6. Two handle classes, picked at prepare time

SQL picks a rows handle or a statistics handle at prepare time from the plan's declared result. MongoDB picks at prepare time too, from the command kind. The kind is a static part of the plan type (`MongoQueryPlan<Row, Command>`), and the draft carries it.

- **`MongoPreparedStatement<Params, Row>`** has `.query(target, params, options?)`, which returns `AsyncIterableResult<Row>`. Every plan except the statistics commands below gets this class.
- **A second class** (name open, see below) is for the commands that report statement statistics: `updateOne`, `updateMany`, `deleteOne` and `deleteMany`, from the query builder or the raw lane. This is the same rule ad-hoc `execute` uses, which decides from the wire command kind. It has `.query(...)`, which yields the driver's result row as `runtime.query(plan)` does today, and `.execute(target, params, options?)`, which returns the statistics `runtime.execute(plan)` returns.

The second class has both methods because a MongoDB update or delete plan supports both today, while a SQL affected-count plan supports `execute` only.

**Its name is open.** It is a public type. "Write" would be wrong, because inserts and `findOneAnd*` are writes and get the first class. SQL's `PreparedExecution` has `execute` only. The recommendation is `MongoPreparedExecution`, the SQL name for "the handle with `execute`", with the ADR saying it also has `query`. Until Will picks, the code uses that name.

The return type of `prepare` picks the class from the plan's `Command` type. The handle does not check the command kind at run time: the method a plan cannot use is absent from the value, not only from the type, as on SQL. The shared `runtime.execute` code still reads the command kind to find the statistics field, as it does for ad-hoc runs.

### D7. Targets are typed structurally, and the bridge stays internal

SQL types `target` as the structural `RuntimeScope { query(plan); execute(plan) }` and finds an internal bridge symbol on it at run time. MongoDB does the same:

- `MongoQueryExecutor { query(plan); execute(plan) }` moves from the ORM package to `@internal/mongo-query-ast/execution`, beside `MongoQueryPlan`, where SQL keeps `RuntimeScope`. The ORM keeps using it from there.
- Handles type `target` as `MongoQueryExecutor`.
- A bridge symbol and its interface live in `@internal/mongo-runtime` and are not exported from any public entry point. `MongoRuntimeImpl` installs the bridge.
- A target without the bridge throws an invariant error at the call, with SQL's message pattern.

The `mongo()` client has no `query(plan)` method, because `db.query` is the query builder, so it does not type-check as a target. Users run handles against `await db.runtime()`.

### D8. Declarations and parameter types

- `MongoDeclaration<CT>`: names to `keyof CT & string`, or `{ codecId; nullable?: boolean }`.
- The callback receives `MongoPlaceholders<D>`: each name maps to a `MongoPreparedParamRef` typed with its codec id and nullability.
- Run params are `MongoParamsFromDeclaration<D, CT>`: each codec's `input` type, plus `null` when nullable.
- `CT` is the contract's codec types from `ExtractMongoCodecTypes`. Its constraint mentions `output` only, but the codec types it returns carry `input`. A conditional type, `MongoCodecInput<CT, Id>`, reads `input` from them. It lives in `@internal/mongo-contract` beside `ExtractMongoCodecTypes`, so the facade and the ORM (D9) use one definition. Unknown codec ids fail to compile.

### D9. ORM reads: `.prepared.all()` and `.prepared.first()` (slice 2)

As on Postgres, the client's `prepare` also takes an ORM read description. The MongoDB ORM has `all()` and `first()` reads and no aggregates, so its collections get `.prepared.all()` and `.prepared.first()`.

- They return a `MongoPreparable<Row, Result>`: the plan, and a consumer that turns each run's rows into the result (a row stream for `all`, `Row | null` for `first`). It lives in `@internal/mongo-query-ast/execution` beside `MongoQueryPlan`, where SQL keeps `Preparable`.
- The client passes only the plan to `runtime.prepare` and wraps the handle with the consumer, as SQL's `prepareQuery` does. The wrapper's `query(target, params)` returns the consumer's result directly.
- The MongoDB ORM has no activity source, so there is no counterpart to SQL's prepared ORM call record.

Positions that take a placeholder:

- **Where the pass-through sits.** The code that keeps a placeholder as it is goes in the two `where` entry points only: `#compileWhereObject` and `#encodeFieldFilter`, before `#wrapFieldValue` is called. `#wrapFieldValue` and `#wrapValueObject` stay as they are; `#fieldParam` refuses any placeholder that reaches it. So a placeholder is accepted only as a top-level field value in a `where`.
- **Object-form `where`** (`{ status: p.status }`). The ORM keeps the placeholder as it is instead of wrapping it in a second `MongoParamRef`. The types require the placeholder's codec to be the field's codec.
  - A nullable placeholder is accepted only on a nullable field, as a literal `null` is. MongoDB's `$eq: null` matches `null` and missing, which is what the ORM sends for a literal `null`. SQL needs `IS NOT DISTINCT FROM` for this; MongoDB does not.
  - On a list field, a placeholder means "the list holds this item" (`$elemMatch: { $eq: … }`), as a single literal does. Its codec must be the element codec, and it must not be nullable, because a literal `null` on a list field means "not a list", which a placeholder cannot express. A whole-list placeholder is not possible: a declaration has no list form.
- **Filter-expression `where`** (`where((f) => f.status.eq(p.status))`). `#encodeFieldFilter` keeps a placeholder as it is, as it keeps a `MongoParamRef` that has a codec, for comparison and membership operators.
- **`limit` and `offset`** (D5). `MongoCollectionState.limit` and `offset` widen to accept a placeholder.
- **`first()`** sets `limit` to 1. A declared `limit` placeholder that this replaces fails as unused, as on SQL.
- **Includes, `orderBy` and `select`** carry relation names, field names and directions, not values. Nothing changes.

### D10. Errors

| Case | Code | When |
|---|---|---|
| Unknown codec id in the declaration | `RUNTIME.CODEC_DESCRIPTOR_MISSING` (existing) | `prepare` |
| Placeholder in a raw command | `RUNTIME.PREPARE_RAW_PLACEHOLDER` (new) | `prepare` |
| Declared name not used | `RUNTIME.PREPARE_UNUSED_PARAM` | `prepare` |
| Closed client | `DRIVER.NOT_CONNECTED` | `db.prepare` |
| Placeholder in an ORM write or value-object literal | `ORM.ARGUMENT_INVALID` (existing) | when the write runs, or when the `where` is built |
| Name missing at run, or params not an object | `RUNTIME.PREPARE_MISSING_PARAM` | run |
| `limit` or `skip` value not a non-negative integer | `ORM.ARGUMENT_INVALID` (existing) | run, after `beforeEncode` |
| Target without the bridge | invariant error | run |
| Plan with a placeholder run without `prepare` | `RUNTIME.PREPARE_BIND_ON_ADHOC` | ad-hoc run |
| Codec fails on a value | `RUNTIME.ENCODE_FAILED` (existing) | run |
| Closed runtime | `DRIVER.NOT_CONNECTED` `'Runtime is closed'` (existing) | run, in the driver step |

The error reference gains `RUNTIME.PREPARE_RAW_PLACEHOLDER`, and MongoDB as a source for the other `PREPARE_*` codes and for `RUNTIME.CODEC_DESCRIPTOR_MISSING` at prepare time.

### D11. Where the code lives

| Piece | Package |
|---|---|
| `MongoPreparedParamRef`, `isMongoPreparedParamRef`, `MongoValue` union | `@internal/mongo-value` |
| `resolveValue`, `resolveDraftSlot`, `needsLiteralWrap` | `@internal/adapter-mongo` (`packages/3-targets/mongo/2-adapter/src`) |
| `MongoLoweredDraft` doc comment (it now holds either kind of leaf) | `mongo-lowering` |
| `MongoLimitStage`, `MongoSkipStage`, `MongoQueryExecutor`, `MongoPreparable` | `@internal/mongo-query-ast` |
| `MongoCodecInput` | `@internal/mongo-contract` |
| `prepare`, the handle classes, the bridge, the bind function, declaration types | `@internal/mongo-runtime` |
| Operator signatures, `limit`/`skip` | MongoDB query builder |
| `.prepared` reads, placeholder handling in `where`, `limit`, `offset` | MongoDB ORM |
| `db.prepare` | MongoDB facade |

Public exports from `@prisma/orm-mongo`: `MongoPreparedStatement`, the second handle class (D6), `MongoDeclaration`, `MongoParamsFromDeclaration`, and `MongoPreparedParamRef` as a type, because `MongoPlaceholders` names it.

Nothing under `packages/1-framework` changes. The MongoDB runtime already imports `streamStatement`, `executeStatement`, `RuntimeExecuteOptions`, `AsyncIterableResult` and `runtimeError` from the framework, and those are all prepare needs.

### D12. Documents

- A new ADR: MongoDB prepared statements. It records D1 to D9, the known difference in D4, and links ADR 210. ADR 210 gets an update note: its "SQL-only" line now points to the new ADR. The next free number on `main` is 318; check open PRs before using it.
- `ADR-INDEX.md`, the MongoDB family subsystem doc (runtime section), the runtime and middleware subsystem doc, the error reference, the facade README, the `@prisma/orm-mongo` README, `skills/prisma-8/references/queries.md` and `queries-mongo.md`.
- Adding a member to `MongoValue` breaks no code in the repo, because nothing switches on every `MongoValue` kind. So no upgrade note, unless the implementer finds an exported type whose shape changes for users.
- A release-note fragment.

## Slices

1. **Runtime, query builder, client.** D1 to D8, D10, D11, the ADR and the docs.
2. **ORM reads.** D9, its tests and docs.

Each slice is one PR, branched from `main`. Slice 2 starts after slice 1 merges.

## Tests

Each mirrors a SQL prepare test listed in the research file, section 1.10, where one exists.

- Prepare runs the callback, `runBeforeCompile` and `structuralLower` once. It calls neither the driver nor `connect`.
- Each run encodes values with the declared codecs: `mongo/objectId@1`, an extension codec, a nullable value given `null` (sent as `null`, codec not called), a non-nullable value given `null` (refused with `RUNTIME.ENCODE_FAILED`), a placeholder used twice.
- `bson-scalars.lists.test.ts` stays green: a `null` element written to a list whose elements are not nullable is still refused.
- A `limit` value replaced by middleware with `-1` is refused.
- A placeholder in an ORM write is refused with `ORM.ARGUMENT_INVALID`, in object form and in callback-form updates such as `u.tags.push(p.tag)`.
- A placeholder `limit` inside a `$lookup` sub-pipeline is filled in and checked.
- Placeholders in `eq`, in `in`, in an update operator, in an update pipeline stage, in an insert document, in an aggregation literal (wrapped in `$literal`), and in `limit` and `skip`.
- Two runs of one handle give independent results. Extra params are ignored.
- `beforeEncode` sees the declared names in `entries()`. A replacement reaches the wire, including both positions of a placeholder used twice, and including a replacement with `null`.
- A prepared run's content hash equals the hash of the same query run ad hoc with the same values, and differs between runs with different values.
- Abort set before a run, and abort during encoding, as on the ad-hoc path.
- Every row of the D10 table, and a raw plan with no placeholders prepared and run.
- The walk-parity test extended with a placeholder.
- Type tests: unknown codec ids; run param types, including nullable; `.execute` present on update and delete handles and absent on others; a `MongoRuntime` is a target and the `mongo()` client is not; `mongoStatic()` has no `prepare`; `limit` with a codec whose input is not a number is rejected; slice 2's `where` rules (codec match, nullability, list fields).
- Integration tests against an in-memory replica set, through `mongo()` and through `createMongoRuntime` directly.

## Definition of done

- `db.prepare` and `runtime.prepare` work with query-builder plans (slice 1) and ORM reads (slice 2), run against a `MongoRuntime`.
- Every test in the list above passes.
- No change under `packages/1-framework`.
- The docs in D12 are updated.
