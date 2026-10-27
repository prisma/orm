# @internal/sql-orm-client

ORM client for Prisma 8 — fluent, type-safe model collections.

This package provides a high-level ORM client surface on top of the runtime. Ordinary and prepared SELECT reads with includes compile to a single correlated-subquery plan and use the supplied runtime without acquiring an additional connection scope. Caller-owned connections and transactions remain caller-owned; nested mutations orchestrate several statements inside one scope.

## Responsibilities

- Expose typed `Collection` primitives for model-level data access
- Build filter/order/include state from fluent APIs (`where`, `include`, `orderBy`, `limit`, `offset`)
- Accept lane-agnostic `WhereArg` filter inputs (`WhereExpr` or `ToWhereExpr`) and normalize bound payloads inside ORM while preserving bound params/descriptors for runtime encoding and adapter lowering
- Compile collection state into SQL AST query plans (`SqlQueryPlan`) without rendering SQL in ORM
- Buffer SELECT include results and read embedded include payloads in the ORM consumer
- Orchestrate multi-statement mutations, such as nested creates
- Run each terminal method as one `orm-call` activity that carries the user's annotations
- Map storage-column rows back to model-field row shapes
- Expose an `orm()` client with typed collection keys (for example `db.Post`)

## Dependency Boundaries

This package depends on:

- `@internal/sql-contract` for contract shape and mappings
- `@internal/contract` for the contract shape and `PlanMeta`
- `@internal/framework-components` for `AsyncIterableResult`
- `@internal/sql-relational-core` for SQL AST, plan types, the `RuntimeScope` interface, and the function surface and index references it shares with the SQL query builder

This package should not depend on target adapters or drivers directly; execution is delegated to the runtime queryable interface.

## Runtime surface

`RuntimeQueryable` is the SQL-domain wrapper this client uses to talk to a runtime. It extends `RuntimeScope` from `@internal/sql-relational-core` and adds the optional primitives the ORM needs for nested-mutation orchestration:

- `query<Row>(plan)` — streams rows; `execute(plan)` — returns statement stats. Both come from `RuntimeScope` and accept AST-level `SqlQueryPlan` and pre-lowered `SqlExecutionPlan`.
- `connection?()` — opt-in connection acquisition for grouped multi-statement work.
- `transaction?()` — opt-in transaction acquisition for atomic mutation scopes.
- `[activitySource]` — the SQL runtime's activity source, through which the client starts an `orm-call` activity for each terminal method (see [Calls are activities](#calls-are-activities)). The runtime's queryables, connections, transactions and activity handles carry it. The type marks it optional only because the public runtime types do not show it; a runtime passed to `orm()` must carry it. A hand-built `{ query, execute }` object does not, and every terminal method on it fails with `ORM.ACTIVITY_SOURCE_MISSING`.

`connection()` and `transaction()` are SQL-specific orchestration capabilities and are intentionally absent from the cross-family `RuntimeExecutor` contract. Runtimes that don't expose them are still used for single-statement execution.

## Architecture

```mermaid
flowchart LR
  A[Collection API] --> B[CollectionState]
  B --> C[ORM Query Planner]
  C --> D[SqlQueryPlan (AST + params + meta)]
  D --> E[RuntimeQueryable.execute]
  E --> F[Rows by storage column]
  F --> G[Row mapping + include stitching]
  G --> H[Model-field result rows]
```

## Calls are activities

Every terminal method (`all`, `first`, `firstOrThrow`, `aggregate`, `groupBy().aggregate`, `create`, `createAll`, `createAndCount`, `upsert`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`, and each execution of a prepared collection) runs as one `orm-call` activity, started with `startActivityOn` on the queryable the client holds:

```ts
const audit: SqlMiddleware = {
  name: 'audit',
  familyId: 'sql',
  async activityStarted(activity) {
    if (activity.kind === 'orm-call') console.log(activity.annotations);
  },
};

await db.orm.public.User.first({ id: 1 }, (meta) => meta.annotate(cacheAnnotation({ key: 'user-1' })));
```

- **Statements go through the call.** Reads, the statements of a mutation graph, nested-relation mutations and the read-back after a nested create or update are the call's children. The client's own transaction is `handle.transaction()`; inside `db.transaction(fn)` the call is a child of that transaction and opens none of its own.
- **Annotations live on the call.** The annotations the `configure` callback records are the call's, including for writes with relation callbacks. The statements the call sends carry only the reserved keys the client sets itself, so a middleware that reads annotations from `plan.meta.annotations` sees none from an ORM call.
- **The call ends with the value the method returns:** the model rows, the row or `null`, the aggregate object or the count. A failed call ends `failed`. A streaming terminal such as `all()` starts its call when the caller first reads it and ends it when the caller reads to the end (`succeeded`), stops early (`stopped`) or the stream fails (`failed`); it keeps the rows for the call's result only when the call carries annotations. Read a streaming terminal with `for await` or `await`, or call `return()` on its iterator when you stop early: an iterator dropped after `next()` leaves its call open, and `close()` then waits for it for ever.
- **Middleware can answer the call.** When an `intercept.onActivity` handler supplies a result, the client returns it without sending any statement. A value of the wrong shape for the method rejects with `ORM.INTERCEPTED_RESULT_INVALID`.
- **Content hash.** The call's `activity.contentHash()` is computed only when a middleware asks: for a read, a digest of `orm-call`, the method and the content hash of the statement it sends first (for a prepared collection, the statement with that execution's parameters); for a write, of `orm-call`, the method and the model.
- **A call that resolves to one value starts in the same turn as the method,** so a runtime closed after the method returns waits for it.
- **The queryable must carry an activity source.** The SQL runtime's runtimes, connections, transactions and activity handles do. A terminal method on a queryable without one, such as a custom object or a wrapper that copies only `query` and `execute`, fails with `ORM.ACTIVITY_SOURCE_MISSING`: a streaming terminal such as `all()` throws when called, and the others reject, so a call's annotations are never dropped silently. A wrapper that replaces `query` and `execute` must also wrap `[activitySource]`, because the call sends its statements through the handle the source opens.

## Basic Usage

An application reaches the ORM through its client, `postgres()`, `postgresServerless()`'s connections, `sqlite()` or `supabase()`'s role-bound clients:

```ts
const db = postgres({ contract, url }).orm.public;

const posts = await db.Post
  .where((post) => post.userId.eq(userId))
  .limit(10)
  .all();
```

## Functions and indexes in callbacks

A `where` or `orderBy` callback receives a second argument, `{ fns, indexes }`. So do the filter of `first` and `firstOrThrow`, and these callbacks inside an include refinement, a fragment body and a relation filter (`some`, `every`, `none`, `count`).

```ts
const q = websearchToTsquery(input.search);

db.Post
  .where((p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
  .orderBy((p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc())
  .limit(20)
  .all();
```

- `fns` is the SQL query builder's function surface for the contract: `eq`, `and`, `or`, `in`, `exists`, `raw` and every query operation the target and extensions register. It accepts ORM fields as expressions. Conditions combine in both directions: `and`, `or` and `not` from this package take ORM conditions such as `p.title.ilike('%x%')` and conditions from `fns`, and `fns.and` and `fns.or` take both too. `fns` has no `not`; use the package's `not`. A condition from `fns` also goes straight to `where`. A value it returns, and the result of `fns.raw`, has `asc()` and `desc()` for `orderBy`; a value keeps its own methods. `fns.raw` binds an interpolated value through the adapter's codec inferer, which the execution context carries when it is built from an execution stack, as a database client's `db.context` is.
- `indexes` holds the indexes of the model's table, keyed by the name the contract source gave each, as the SQL query builder's `table.indexes` gives them. Each index's columns are bound to the table reference the query uses, so inside an include refinement or a relation filter they follow the alias the ORM gives the related table. A name that more than one index shares is left out of the type; at run time it is a key whose getter throws `ORM.ARGUMENT_INVALID` when read. On a collection narrowed by `variant`, `indexes` is the base model's table's indexes. The body of a fragment for any model receives an `indexes` with no members, since it does not know its model.

A reusable condition types its second parameter as `ModelCallbackTools<Contract, 'Post'>`, beside `ModelAccessor<Contract, 'Post'>` for the first. `OrmFunctions<Contract>` and `ModelIndexReferences<Contract, 'Post'>` name its two members.

Naming the index makes the query search the document the index was built over, so Postgres uses the index. See [ADR 270](../../../docs/architecture%20docs/adrs/ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md).

## Collection methods packages contribute

A package can contribute collection methods. For each model, it reads the model's definition in the contract and returns the methods it offers, under names it chooses. Every collection offers them under `using`. With `db` from `postgres({ contract })`:

```ts
const q = websearchToTsquery(input.search);

await db.orm.public.Post.using.post_search(q).limit(10).all();
await db.orm.public.Post.where({ userId }).using.embedding_nearest(vector, 0.5).limit(5).all();
await db.orm.public.User.include('posts', (posts) => posts.using.post_search(q).limit(3)).all();
```

- The Postgres target contributes one method for each full-text index, named after the index, so `postgres()` and the serverless client both offer it. It filters with `fns.fullTextMatches` and orders by `fns.fullTextRank`, descending, both naming the index. A name two indexes of one table share gets no method.
- The pgvector package contributes `<field>_nearest(vector, maxDistance?)` for each vector field. It orders by cosine distance to `vector`, nearest first, and keeps only the rows within `maxDistance` when one is given. Without `maxDistance` it only orders, so rows whose field is null are returned too, last. The vector's length is typed from the field. It declares no filter, because it filters only when `maxDistance` is given, so `updateAll` and `deleteAll` do not compile after it.
- A method returns the collection it was called on, with `Filtered` and `Ordered` added as the method declares: a custom class stays the class. It works on a root collection, after other methods, inside an include refinement, inside `with` and a fragment for one model, and on `this` in a custom class. In the body of a fragment for any model (`db.orm.fragment(fields, body)`), the collection's type has no `using` member, and at run time its `using` is an empty object.
- Its order is an ordinary order, added where it is called: an `orderBy` before it comes first, and one after it comes after.
- A model that no contribution serves has a `using` with no members. On a collection narrowed by `variant`, a contribution sees the base model.
- `using` is a member of every collection: a custom class cannot declare its own `using`, and an aggregate operation named `using` is refused.

A contribution has two halves with the same id, both typed in `@internal/sql-relational-core/collection-methods` (published as `@prisma/orm-family-sql/relational-core/collection-methods`):

- **The type half** is an interface extending `CollectionMethodContributionType`. The ORM fills its `model` with one model's `CollectionMethodModelType` (target, name, fields, relations, and storage table with columns and indexes), and reads back `methods`: for each method name, a `ContributedMethodSignature` with its `parameters` and whether it `filters` and `orders`. The package registers the interface in `CollectionMethodRegistry` by declaration merging, and type-exports it from each entry point that should load it: a value import alone is dropped from declaration output. The emitted `contract.d.ts` must not load it. A package outside this repository augments the published module name.
- **The run-time half**, a `CollectionMethodContribution` whose `id` satisfies `CollectionMethodContributionId`, goes on a target or extension descriptor as `collectionMethods`. Its `methodsFor(model)` receives a `CollectionMethodModel` and returns one model's methods by name; each method receives the collection and the caller's arguments and returns the collection with a `where`, an `orderBy` or both added.
- A contribution produces methods only from contract data its own package introduces (its codecs, its index types) or that every contract of its target has, because the registry is global to a program.

`orm()` asks each contribution for each model's methods once per execution context. It refuses, with `ORM.ARGUMENT_INVALID`, two contributions with the same id, two contributions that give one model a method with the same name, a contribution that throws (naming it and the model, with its error as the cause), and a method that is not a function. In the types, a name two contributions give is a `CollectionMethodNameClash`, which cannot be called.

The registry is global to a program: if anything in the program imports a package, every client in it shows that package's methods. See the [declaration-merging registries](../../../docs/architecture%20docs/patterns/declaration-merging-registries.md) pattern and [ADR 272](../../../docs/architecture%20docs/adrs/ADR%20272%20-%20Packages%20contribute%20collection%20methods%20computed%20from%20a%20model.md).

## Custom collections

An application extends `Collection` with its own query methods and passes the class to its database client with the `collections` option:

```ts
import { Collection } from '@prisma/orm-postgres/orm-client';
import postgres from '@prisma/orm-postgres/runtime';

class PostCollection extends Collection<Contract, 'Post'> {
  withTitle(term: string) { return this.where((p) => p.title.ilike(`%${term}%`)); }
  newestFirst()           { return this.orderBy((p) => p.createdAt.desc()); }
}

const client = postgres({ contract, url, collections: { Post: PostCollection } });
const db = client.orm.public;

db.Post.where({ userId }).withTitle('orm').newestFirst().limit(10).all();
db.Post.include('user').withTitle('orm');
```

Every SQL client takes the option: `postgres()`, `postgresServerless()` (every connection), `sqlite()` and `supabase()` (every role-bound client). The classes reach every ORM the client offers, including `tx.orm` inside `client.transaction(...)`, where `tx` offers the client's query members (`sql`, `orm`, `raw`, `prepare`, `query`, `execute`) with the same types, and the client's type carries them as its second type parameter, such as `PostgresClient<Contract, { Post: typeof PostCollection }>`. The clients are built on `orm({ runtime, context, collections })`, which takes the same classes; an application has no reason to call it.

`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` and `include` return the collection they were called on, so the class's methods stay available. What a chain has established is added to the type as a fact: `where` gives `Filtered<Self>`, `orderBy` gives `Ordered<Self>`, and `include` gives `Including<Self, ...>`, whose rows also have the included relation. Write a filtered collection's type as `Filtered<C>`; it is `C & HasWhere`, and `HasWhere` is the name error messages print. `select` changes the row and `variant` changes the collection's type argument, so both return the base `Collection` type and the class's methods are gone after them.

Inside an include refinement, the related collection is typed as the base `Collection`, so the registered class's methods are not available there in the types ([ADR 265](../../../docs/architecture%20docs/adrs/ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), "Later decisions"). Write the shared part as a fragment for the model and apply it with `with`: `db.User.include('posts', (posts) => posts.with(search).limit(3))`.

Inside a class body, a class method called on the result of another call loses what that call established, and so does `.prepared` after `.include(...)`: in `latest() { return this.withTitle('orm').newestFirst(); }` the result is known to be ordered but not filtered, for every caller of `latest()` (TML-3434). Inside the class, follow a class method with built-in methods (`this.withTitle('orm').orderBy(...)`), or chain the class methods from outside the class, where they keep every fact.

`with(fn)` calls `fn` with the collection and returns its result. `fn` is a query fragment, described in [Query fragments](#query-fragments) below, of type `QueryFragment<In, Out>`: `db.Post.with((posts) => posts.withTitle('orm'))` has the same type as `db.Post.withTitle('orm')`.

The type state holds the flags `hasWhere` and `hasOrderBy`. A flag that has not been established is `boolean`; a method that establishes it sets it to `true`. `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount` need `hasWhere: true`; `cursor` and `distinctOn` need `hasOrderBy: true`. Because `true` is a subtype of `boolean`, a filtered collection is a subtype of an unfiltered one: `search ? db.Post.withTitle(search) : db.Post` is a `PostCollection` that may have no filter, and `deleteAll()` on it does not compile. Each fact has three names: the flag `hasWhere` is set to `true` by the interface `HasWhere`, which is what `Filtered<C>` adds and what error messages print; `hasOrderBy`, `HasOrderBy` and `Ordered<C>` are the same for an order. `variant` needs a collection with no variant selected: the type-state field `variantValue` must be `undefined`, which error messages print as `HasNoVariant`. Read a collection's type state and row with `CollectionTypeStateOf<C>` and `CollectionRowOf<C>`. The row includes the relations and values `include` adds. See [ADR 265](../../../docs/architecture%20docs/adrs/ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md).

`examples/prisma-8-demo/test/declaration-emit.test.ts` checks that a library exporting collection classes emits declarations with these names and that a consumer can use them. It runs in the demo's `pnpm test`, not in `pnpm test:packages`.

## Query fragments

A piece of a query shared between places is a function. A **row fragment** is a function of the model accessor, and `where` and `orderBy` take it. A **query fragment**, or **fragment** for short, is a function from a collection to a collection, and `with` runs it. A **scope** is a fragment that only imposes conditions on the query, such as `notDeleted` below, and is also run with `with`. When the condition is a function of one row and needs no declared fields, pass a row fragment to `where`. When the same condition should apply to every model that has some fields, write a scope: it declares the fields, checks them at run time, and returns the receiver with the `Filtered` fact. `with` also runs what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant. Three helpers make the fragments TypeScript cannot type on its own. See [ADR 259](../../../docs/architecture%20docs/adrs/ADR%20259%20-%20Query%20fragments%20are%20functions.md).

**A fragment for any model with given fields.** The client's `fragment` method, `fragment(fields, body)` on the client `orm()` returns (`db.orm.fragment` and `tx.orm.fragment` on the Postgres and SQLite clients; SQLite offers it beside the models, unless a model is named `fragment`), declares the fields the fragment needs and returns a fragment for every model that has them:

```ts
import { field, type } from '@prisma/orm-postgres/contract-builder';

const notDeleted = db.orm.fragment(
  { deletedAt: field.column(type.TimestamptzTemporal()).optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

db.orm.public.Post.with(notDeleted);   // Filtered<typeof db.orm.public.Post>
db.orm.public.Comment.with(notDeleted);
db.orm.public.Tag.with(notDeleted);    // error: Tag has no deletedAt
```

Declare each field with the builders the schema uses: the facade's `contract-builder` entry exports `field` and `type`, the same builders and type constructors the `defineContract` callback receives (`field.column(type.String())`, `field.column(type.TimestamptzTemporal())`, `field.column(type.Char(36))`, …), and `field.column(columnType)` with a column type from `adapter/column-types` is the explicit form. A package that offers a fragment and has no facade to import from declares a field as `{ codecId: 'pg/timestamptz-temporal@1', nullable: true }`. A list field is declared as the contract records it: a `String[]` with `.many()` on the builder or `many: { elementNullable: false }` in the object, and a `String?[]`, whose elements may be null, with `.many({ elementsNullable: true })` or `many: { elementNullable: true }`. A declaration without it does not match a list field, and one with it matches only a list field whose elements have the declared nullability. A list of value objects, such as `Address[]`, is a list field although it is stored as one `jsonb` value: declare it as `field.column(jsonbColumn).many()`. The codec must be one of the contract's codecs. A builder that names no column type, such as `field.namedType(...)`, throws `ORM.ARGUMENT_INVALID`. The body sees only the declared fields, each typed as a `CodecField` (for a list, a `CodecListField`, whose value is a list of the codec's values, with `null` among them when the elements may be null), and may call `where`, `orderBy`, `limit` and `offset`; `select` and `include` are not available. The fragment accepts a collection of any model whose fields include the declared ones with the same codec and nullability: a root collection, a custom class, a chained or narrowed collection, an include refinement, `this` in a class. It returns the receiver's own type plus what the body established, `Filtered<C>` after a `where` and `Ordered<C>` after an `orderBy`, so `update` is allowed after a fragment that filters. A write refuses what it would ignore. `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter, so they throw `ORM.ARGUMENT_INVALID` on a collection with a `limit`, an `offset`, a `cursor`, `distinct` or `distinctOn`, which their statement cannot apply; this includes a limit a fragment added. `update` and `delete` change one row, the one `first()` returns, so the order, the offset, the cursor, `distinct` and `distinctOn` choose it; after `limit(0)` they change nothing and return `null`, and they refuse a limit that a read refuses, such as `limit(-1)`. Of `update` and `delete`, only `update` with a relation callback, which finds its row by the filter alone, throws on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`. A model that lacks a field, or has it with another codec or nullability, is a compile error that names the field. When the model cannot be read from the receiver's type, as for `fragment.call(undefined, collection)` or a `Collection<Contract, string>`, the error says that instead. `with` accepts a union of two fragments only when both establish the same filter and order. A field matches on its codec and nullability; type parameters of the column type are not compared, so `field.column(type.Char(36))`, a `char(36)` column, matches a field of any `char(n)`. The field is matched by its name in the model, not its column name, and a relation or a field that only a variant has does not match. A collection whose type carries no namespace, such as a custom collection class, is matched against the model of that name in every namespace at compile time; in a contract with the same model name in several namespaces it is checked against its real namespace only at run time. What the body established is part of the type of the collection it works on, so a body that may or may not filter, such as one that reassigns a `let`, gives a fragment that is not known to filter. At run time the fragment checks the fields before the body runs and throws `ORM.FIELD_UNKNOWN` for a model that does not match, and checks that the body returned a collection of the receiver's model, namespace and class, throwing `ORM.ARGUMENT_INVALID` otherwise. If the contract has a namespace named `fragment`, the namespace takes the name and the client has no `fragment` method. A fragment that needs a value is a function that returns a fragment: `const forTenant = (id: string) => db.orm.fragment({ tenantId: field.column(type.Char(36)) }, (rows) => rows.where((r) => r.tenantId.eq(id)))`.

**A filter for every model with a field, as a row fragment.** `CodecField<Contract, CodecId, Nullable>` is the model accessor's type for any field with that codec and nullability. A row fragment whose parameter asks for that one field fits every model that has it:

```ts
type DeletedAt = CodecField<Contract, 'pg/timestamptz-temporal@1', true>;
const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

db.Post.where(notDeleted);
db.Comment.where((c) => and(notDeleted(c), c.postId.eq(postId)));
db.Tag.where(notDeleted); // error: Property 'deletedAt' is missing in type 'ModelAccessor<Contract, "Tag", ...>'
```

It has the same set of comparison methods as the field on the model accessor, chosen by the codec's traits, and the operations registered for the codec, such as `fullTextMatches` on a text field. A model without the field, a field of another codec and a field of another nullability are compile errors. The codec id must be one of the contract's codecs.

A `CodecField` checks values against the codec's input type, not against the field's own type. Where a field refines its codec's value, such as a PSL enum stored as text, the fragment accepts values the field does not: `(row: { kind: CodecField<Contract, 'pg/text@1'> }) => row.kind.eq('superuser')` compiles, while `user.kind.eq('superuser')` written on the model is refused. One fragment serves many models, so it can only know the codec.

**A fragment for one model, such as a shared `select` and `include`.** `collection.fragment(body)` types the body once, against the plain collection of the receiver's model, and returns a fragment:

```ts
const summary = db.Post.fragment((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

db.Post.where({ userId }).with(summary);
db.User.include('posts', (posts) => posts.with(summary));
db.Post.select('id').with(summary); // error: the rows no longer have every Post field
```

Define a fragment on the model's root collection, such as `db.Post`. The fragment is built from the model alone, so calls chained before `.fragment(...)` would be ignored: on a collection with chained calls, such as `db.Post.where(...)`, `fragment` throws `ORM.ARGUMENT_INVALID`. The type check catches part of this. A collection whose type records a filter, an order or an include is a compile error, and so is a collection typed by a type parameter, such as `this` in a class method or `C` in a generic function, because it may be chained. The type check does not see `limit`, `offset`, `select`, `cursor`, `distinct`, `variant` or a lock, a union with a root collection, or a value typed as the plain collection; the run-time check does. Inside a class method, chain on `this` directly instead of defining a fragment from it.

The body receives the plain collection of the model, in the namespace of the collection `fragment` is called on, even when that is a custom class, so the class's methods are not available in it. A fragment can be applied, with `with`, to a root, filtered, ordered or included collection of the model, a custom class, an include refinement, or `this` in a custom class: `this.with(summary)` works, while `this.fragment(...)` does not compile. A fragment made from a collection in one namespace refuses a collection of the same model name in another. It refuses a collection of another model, one narrowed by `select`, whose rows lack fields the body's result would claim, and one narrowed by `variant`. Its result is always the body's result on the plain collection, even when the body keeps the row: a custom class's methods and a filter or order applied before it are not in the result's type, although they still run. So `update` and `cursor` are refused after it unless the body itself calls `where` or `orderBy`, which the result records. Use a class method or a fragment for any model for a filter on one model. At run time the fragment refuses a collection of another model or namespace with `ORM.ARGUMENT_INVALID`. A custom collection class carries no namespace in its type, so with the same model name in several namespaces it is checked only at run time.

**A field to order by, from a request.** `orderByField(collection, name, direction, allowed)` returns an `orderBy` selector:

```ts
db.Post.orderBy(orderByField(db.Post, input.orderBy, input.direction, ['title', 'createdAt']));
```

`direction` is the request's string, `'asc'` or `'desc'`; `undefined` means `'asc'`. `allowed` is required and names at least one field; it takes only fields whose codec has the `order` trait (`OrderableFieldNames<Contract, Model>`). It is required because request text that may order by any field can order rows by a secret one and learn its value from the order of the results. `orderByField` throws `ORM.ARGUMENT_INVALID`, before any query runs, for a `name` that is not a field of the model, is a relation, has a codec without the `order` trait or is not in `allowed`, and for any other direction, including a name or direction that is not a string, such as a missing query parameter. An `allowed` that is not a list of names, from a JavaScript caller, throws `ORM.ARGUMENT_INVALID`; an empty one refuses every name. The error quotes the name and cuts it to 64 characters; `meta` has it in full. The trait is read with the same run-time lookup the model accessor uses. Only the model's own fields can be named: on a collection narrowed by `variant`, a field that only the variant has is refused. The selector fits any collection of a model with the allowed fields, and `orderBy` records the order, so `cursor` is allowed after it.

## Reading or writing one record by its key

`whereUnique(criterion)` filters a collection to at most one record. The criterion is an object that gives a value for every field of the model's primary key, or for every field of one of its unique constraints:

```ts
const post = await db.Post.whereUnique({ id }).first();
const membership = await db.Membership.whereUnique({ tenantId, userId }).first();

const renamed = await db.Post.whereUnique({ id }).where({ userId }).update({ title });
const removed = await db.User.whereUnique({ email }).delete();
```

It applies the same filter as `where` with the same object, and returns the collection it was called on, so a custom collection class keeps its methods. `first()`, `update()` and `delete()` return the record or `null`; `firstOrThrow()` returns the record, or rejects with `RUNTIME.NO_ROWS` when no record has the key. A following `where` narrows further: `whereUnique({ id }).where({ userId })` is the record with that `id` if it also has that `userId`.

The argument is checked at compile time. These are refused:

- a field that is not a primary key or a unique constraint: `whereUnique({ title })`;
- part of a compound key: `whereUnique({ tenantId })` when the key is `(tenantId, userId)`;
- `null`, or a value whose type includes `null`, for a nullable unique column, because any number of rows can have no value there; use `where({ handle: null })` for those rows;
- a callback. Only the object form exists.

The same rule is checked again when the call runs, for code that gets past the types, such as plain JavaScript or a value cast to the key's type. A criterion that does not give a value for every field of the primary key or of one unique constraint throws `ORM.ARGUMENT_INVALID`. A field whose value is `undefined` or `null` counts as not given, so `whereUnique({ id: undefined })` throws instead of reading or writing some other row. A query expression is not accepted as a key value either: a key field given as an expression, such as another column, counts as not given.

On a polymorphic model, the accepted keys are those of the model's own table. `conflictOn` in `upsert` and the criteria of a relation `connect` or `disconnect` take the same object and follow the same rules.

After `whereUnique`:

| Calls | |
| --- | --- |
| `where`, `variant`, `include`, `select`, `with`, `first`, `firstOrThrow`, `update`, `delete`, `prepared.first`, `prepared.firstOrThrow`, `forUpdate`, `forNoKeyUpdate`, `forShare`, `forKeyShare` | available |
| `create`, `createAll`, `createAndCount`, `upsert` | unchanged; they do not use the filter |
| `orderBy`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn`, `all`, `aggregate`, `groupBy`, `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount`, `prepared.all`, `prepared.aggregate` | compile error |

The refused methods still appear in editor completion; calling one is the error. The error message names `HasNoUniqueFilter`.

A row lock keeps the unique filter and the collection's class: after `whereUnique({ id }).forUpdate()` the same calls are available and the same calls are compile errors.

`whereUnique` is not available inside an `include` refinement. The refinement collection does not have the method, and a call that reaches it another way, such as through a fragment made by `collection.fragment`, throws `ORM.INCLUDE_INVALID`.

A helper that takes or returns such a collection writes its type as `UniquelyFiltered<C>`, which is `C & HasWhere & HasUniqueFilter`. Constrained as below, it accepts a custom collection class and the plain collection of the model, with or without an `include`, and its result keeps the class's methods:

```ts
function ownedBy<C extends Collection<Contract, 'Post', unknown, CollectionTypeState>>(
  post: UniquelyFiltered<C>,
  userId: string,
) {
  return post.where({ userId });
}
```

These cases are not refused:

- A method of a custom collection class is callable on a uniquely filtered collection whatever its body does, and so is a fragment made by the client's `fragment` method or by `collection.fragment`, run with `with`. One that adds an order or a limit is accepted; the query still matches at most one record. A function passed to `with` directly is checked: `db.Post.whereUnique({ id }).with((posts) => posts.limit(1))` is refused.
- The result of `with(fragment)` for a fragment made by `collection.fragment` is the fragment's own result type and no longer records the unique filter, so the many-record methods compile on it.
- Inside a method of a custom collection class, two results no longer record the unique filter: the result of another method of the class called after `this.whereUnique(...)`, and `.prepared` after `this.whereUnique(...)`, as `.prepared` after `.include(...)` loses what `include` established (see [Custom collections](#custom-collections)). `this.whereUnique({ id }).withTitle('orm').all()` and `this.whereUnique({ id }).prepared.all()` compile there, while the same calls from outside the class are refused. Every other many-record call after `this.whereUnique(...)` is refused inside the class as it is outside.
- A conditional that mixes a uniquely filtered collection with another one, such as `flag ? db.Post.whereUnique({ id }) : db.Post.where({ userId })`, has the many-record methods.

## Skipping rows that collide with a unique constraint

`createAll` and `createAndCount` take an options object in second position that asks the database to skip rows colliding with a unique constraint instead of failing the whole statement.

```ts
// Skip on any unique constraint of the table.
const inserted = await db.User.createAll(rows, { onConflict: 'skip' });

// Skip only on the constraint over `email`.
const added = await db.User.createAndCount(rows, {
  onConflict: 'skip',
  conflictOn: ['email'],
});
```

`createAll` yields only the rows the database inserted; `createAndCount` returns its count. A collision on a constraint other than the one `conflictOn` names is not skipped — it surfaces as a unique violation.

The option needs the contract capability `insertOnConflictSkip`, and `insertOnConflictWithoutTarget` as well when `conflictOn` is omitted. A contract emitted before the adapters reported these keys is refused with `ORM.CAPABILITY_MISSING`; re-emit it. MTI variant collections refuse the option with `ORM.OPERATION_UNSUPPORTED`. `create()` does not take it.

The optional `configure` callback may still be passed in second position when there are no options.

## Prepared row descriptions

Built-in collection chains expose terminal-only `.prepared.all(configure?)`, `.prepared.first(filter?, configure?)` and `.prepared.firstOrThrow(filter?, configure?)` views. They synchronously return a `Preparable<DbRow, Result>` without executing it: a description containing a SQL `plan` and a required `consume` function. The description is not itself a `SqlQueryPlan`. Filters, projection, includes, variants and first-row limit replacement use the ordinary row pipeline. Read annotations go on the `orm-call` activity of each execution, not on the plan.

`createPreparedRowQuery(description, statement)` is the composition seam for client integrations: prepare `description.plan` through SQL runtime, then wrap that SQL row statement with the description. SQL runtime remains plan-only; the ORM consumer owns model mapping and include decoding.

```ts
import { createPreparedRowQuery } from '@internal/sql-orm-client';

const description = posts.select('title').prepared.all();
const statement = await runtime.prepare({}, () => description.plan);
const prepared = createPreparedRowQuery(description, statement);
const rows = prepared.query(runtime, {});
for await (const row of rows) {
  console.log(row.title);
}
```

`query(target, params, options?)` requires an explicit compatible runtime, connection or transaction, independent of the authoring collection. A prepared statement runs on what it is given: `ps.query(tx, params)` inside `db.transaction(async (tx) => ...)` runs inside the transaction. It returns the terminal result directly: a thenable `AsyncIterableResult<Row>` for `all`, `Promise<Row | null>` for `first`, or `Promise<Row>` for `firstOrThrow`, which rejects with `RUNTIME.NO_ROWS` when no row matches. Each call creates independent consumption state. Include paths retain their existing buffering; database value decoding and execution lifecycle remain SQL runtime responsibilities.

The [Postgres](../../3-targets/postgres/9-facade/README.md#prepared-sql-and-orm-rows) and [SQLite](../../3-targets/sqlite/9-facade/README.md#prepared-sql-and-orm-rows) facades compose this surface through `db.prepare({}, () => db.orm.public.Post.select('title').prepared.all())` (SQLite uses `db.orm.Post`). SQL callbacks capture `db.sql` and receive only params. Non-nullable scalar placeholders work in shorthand filters, callback comparisons, relation/include predicates, `prepared.first` filters and fixed lists such as `user.id.in([params.first, 42, params.second])`. Repeated placeholders retain their bind identity; each target keeps its stable slot layout across invocations. Comparisons retain codec identity, existing literal types and field trait requirements.

ORM equality and inequality accept nullable prepared parameters: two nulls compare equal, and null differs from every non-null value. Declaration nullability selects the null-safe operator when the ORM callback or shorthand comparison is created, so the SQL stays fixed across invocations. Ordering, pattern and list comparisons still reject nullable prepared operands with `ORM.FILTER_UNSUPPORTED`. A nullable column can still be compared to a non-nullable parameter; literal-null filters retain their existing null checks. Raw SQL remains opaque, including its interpolations: ORM does not parse, rewrite or reject raw SQL based on parameter nullability. Hand-authored structured ASTs and SQL-builder comparisons retain their explicit operators; ORM does not rewrite them.

Root and nested `.limit(params.take).offset(params.skip)` accept SQL's non-nullable numeric expression operands, including paginated row/scalar/combine include refinements and distinct wrappers. Prepared executions keep SQL and binding slots fixed while pagination values change. `prepared.first()` replaces an earlier limit with `1`; a placeholder used only by that replaced limit remains subject to unused-declaration validation.

Ungrouped collections also expose `.prepared.aggregate(selector, configure?)`. For example, `db.prepare({}, () => db.orm.public.Post.prepared.aggregate((agg) => ({ total: agg.count() })))` returns a query whose `query(target, {})` produces `Promise<{ total: number }>`. Preparation invokes the selector and annotation callback once and retains alias, empty-result descriptor and codec metadata. Executions return fresh objects; projected values are already decoded by SQL runtime, while contributed empty-result conversion runs separately whenever a fallback is needed. WHERE parameters and pre-aggregate pagination use the same collection chain as ordinary aggregates.

Grouped collections expose the same `.prepared.aggregate(selector, configure?)` terminal and return `Promise<Array<GroupKeys & AggregateResult<Spec>>>`. Group keys retain model names and decoded values; empty input produces `[]`. The prepared consumer captures the storage-to-model mapper and aggregate aliases once, then allocates fresh arrays and objects for each execution.

Prepared HAVING comparands must use the selected aggregate's output codec (for example, Postgres `count()` uses `pg/int8number@1`, not the counted column's codec). Equality and inequality select null-safe operators for nullable prepared parameters at construction; ordered comparisons reject nullable parameters. Literal HAVING comparisons retain their existing numeric types. Projection-only aggregate operations remain unavailable in HAVING. After grouping, `.limit(params.take).offset(params.skip)` requires a prior group-key `.orderBy(...)` and accepts non-nullable numeric expressions. Pre-group pagination limits input rows; post-group pagination limits groups.

Mutation preparation, custom helper preparation and dynamic parameter lists are not supported.

## Pagination

`.orderBy(...)` accepts model-accessor callbacks that return `OrderByItem`s via the column's `.asc()` / `.desc()` helpers:

```ts
// Newest first.
const posts = await db.Post
  .orderBy((post) => post.createdAt.desc())
  .limit(10)
  .all();
```

Every `.asc()` / `.desc()` takes an optional `{ nulls: 'first' | 'last' }`, rendered as `NULLS FIRST` / `NULLS LAST` after the direction. Without it, the database's default null placement applies.

### Ordering by a relation

Inside `.orderBy(...)`, a relation offers more than `some` / `every` / `none`:

- A to-one relation (`1:1`, `N:1`) exposes each orderable scalar field of the related model, with `.asc()` / `.desc()` and nothing else. A row whose related row is missing (a null foreign key) orders as `NULL`.
- A to-many relation (`1:N`, `N:M`) exposes `count(predicate?)`, the number of related rows, optionally only those matching a predicate on the related model. An `N:M` count goes through the junction table.

```ts
// Posts by their author's name, then by id.
const posts = await db.Post
  .orderBy([(post) => post.author.name.asc(), (post) => post.id.asc()])
  .all();

// Users with the most posts first.
const users = await db.User
  .orderBy((user) => user.posts.count().desc())
  .all();

// Count only the posts with more than 10 views.
const byPopularPosts = await db.User
  .orderBy((user) => user.posts.count((post) => post.views.gt(10)).desc())
  .all();

// N:M: count tags through the junction table.
const byTagCount = await db.User
  .orderBy((user) => user.tags.count().desc())
  .all();

// Users with no inviter last, in either direction.
const byInviter = await db.User
  .orderBy((user) => user.invitedBy.name.desc({ nulls: 'last' }))
  .all();
```

Each relation order is a correlated scalar subquery built from the same join the relation filters use, so the main query gains no join and its rows never multiply:

```sql
SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY (SELECT COUNT(*) AS "count" FROM "public"."posts" WHERE "posts"."user_id" = "users"."id") DESC
```

The reach is one hop: the related model's own relations are not exposed. A to-one relation has no `count`, and a to-many relation exposes no fields. If a related field is named `some`, `every`, `none` or `count`, the relation method wins and that field cannot be ordered through the relation.

`cursor()` builds its keyset from plain columns only. It throws `ORM.ARGUMENT_INVALID`, naming the `orderBy` position, when an active order is a relation column, a relation count, an extension-operation result, or sets `nulls`. `distinctOn()` throws the same error when one of its leading orders (as many as there are `distinctOn` columns) is not a plain column, because Postgres needs those orders to match the `DISTINCT ON` columns; a relation order after them is accepted. Paginate such orders with `.limit(...)` / `.offset(...)`.

## Tables in collection state

`CollectionState.tables` holds a table scope and the aliased root table and multi-table-inheritance variant tables of the collection. Build it with `createCollectionTables(contract, namespaceId, modelName)` and pass it to `emptyState(tables)` and `createModelAccessor(context, namespaceId, modelName, tables)`.

Every table a collection chain puts in a statement gets its alias from that scope. Relation filters, relation orders and includes at any depth take theirs from the scope of the collection they are called on. `createCollectionTables` starts a new scope, so build an include whose table already appears in the parent chain through `collection.include(...)` and read `collection.state`, not by hand.

## Codec Roundtrip

Included JSON payloads are read with each column's `codec.fromWire`, the method that reads an ordinary row, including nested relations and scalar/combine branches; each column's JSON projection writes the value a row of it carries ([ADR 254](../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#reading-and-writing-a-stored-value)). An aggregate over no rows answers with its descriptor's `emptyResultWire`, read with the same `fromWire`. Prepared descriptions precompute nested codec bindings and row mappers. Fixed non-polymorphic child selections are read directly into model-field names, without an intermediate storage object. Polymorphic or unexpected row shapes retain generic reading and mapping. Envelope snapshots remain intact.

The runtime always awaits codec query-time methods, but rows yielded to user code carry **plain field values** — no `Promise`-typed fields ever reach `.first()` / `.all()` / streaming consumers, regardless of whether a column's codec is sync or async. This is true for both one-shot and streaming usage:

```ts
// Even if `secretCodec.fromWire` is async, `posts[0].secret` is a plain string here.
const posts = await db.Post.where((p) => p.userId.eq(userId)).all();
posts[0].secret.length;

// Same for streaming via AsyncIterableResult.
for await (const post of db.Post.where(...).all()) {
  post.secret.length;
}
```

Read and write surfaces share **one** field type-map. `MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, and `ShorthandWhereFilter` accept plain `T` regardless of how the corresponding codec was authored.

See [ADR 204 — Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md).

## Related Docs

- [Architecture Overview](../../../docs/Architecture%20Overview.md)
- [ADR 164 - Repository Layer](../../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)
- [ADR 204 - Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)
- [Query Lanes Subsystem](../../../docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- [Naming model and result types](../../../docs/reference/model-and-result-types.md)
