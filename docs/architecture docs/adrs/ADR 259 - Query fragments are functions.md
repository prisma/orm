# ADR 259 — Query fragments are functions

**Status:** Accepted
**Date:** 2026-10-05
**Builds on:** [ADR 258 — A collection keeps its class through the chain](ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

An application hides soft-deleted rows on every model that has a `deletedAt` field, restricts every query to the caller's tenant, and lists posts for a request that may carry a search term and a sort field:

```ts
import { textColumn, timestamptzTemporalColumn } from '@prisma/orm-postgres/adapter/column-types';
import { field } from '@prisma/orm-postgres/contract-builder';
import { orderByField } from '@prisma/orm-postgres/orm-client';

const { Post, Comment, Tag } = db.orm.public;

const notDeleted = db.orm.scope(
  { deletedAt: field.column(timestamptzTemporalColumn).optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

const forTenant = (tenantId: string) =>
  db.orm.scope({ tenantId: field.column(textColumn) }, (rows) =>
    rows.where((r) => r.tenantId.eq(tenantId)),
  );

const summary = Post.scope((posts) => posts.select('id', 'title').include('user'));

const posts = await Post
  .apply(notDeleted)
  .apply(forTenant(ctx.tenantId))
  .apply((posts) => (input.search ? posts.where((p) => p.title.ilike(`%${input.search}%`)) : posts))
  .orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']))
  .apply(summary)
  .limit(20)
  .all();

Comment.apply(notDeleted);   // Comment has deletedAt
Tag.apply(notDeleted);       // error: Tag has no deletedAt
```

- A **scope** is a function from a collection to a collection (ADR 258). `apply` runs one. A class method such as `published()` is a named scope.
- `notDeleted` and `forTenant` are scopes for any model that has the fields they declare. The declaration uses the field builders of the contract DSL.
- `summary` is a scope for one model. It changes the row, so it is typed once against a plain `Post` collection.
- The conditional inside `apply` is an ordinary function. Its result is typed as unfiltered, so `deleteAll` is refused on it.
- `orderByField` turns a request string into an order and rejects a field outside the allowed list at run time.

## Decision

A **query fragment** is a function. A fragment of a row is a function of the model accessor, and `where` and `orderBy` take it. A fragment of a query is a scope, and `apply` runs it. The query API gains no methods for control flow: whatever the application would write in a function body, it writes inside the scope, and the result is sound because a filtered collection is a subtype of an unfiltered one (ADR 258).

Three helpers cover the fragments applications share most.

1. **A scope for any model with given fields: `db.orm.scope(fields, body)`**, a method of the client `orm()` returns. `fields` names each field the scope needs, with a field builder from the contract DSL or with `{ codecId, nullable }`. The body is typed against a collection that has only those fields. The scope is accepted by every collection of a model that has them, and refused for the rest.
2. **A scope for one model: `Post.scope(body)`**, a method of every collection. The body is typed once against the plain collection of the receiver's model. The scope is accepted by any collection of that model whose rows still have every field of the model, and refused for one narrowed by `select` or `variant`.
3. **An order field from a request: `orderByField(collection, name, direction, allowed)`.** The allowed list is typed against the model's orderable fields. The name is checked at run time, before any query is built.

`CodecField<Contract, CodecId, Nullable>` is the type of a model accessor field named by its codec instead of its model. It is what a declared field becomes inside the body of a scope for any model, and what a row fragment for any model with a field is written with.

## Why a fragment is a function

A query is a chain of method calls on a collection. Each call returns a collection whose type records what is known: the rows it produces, whether it has a filter, whether it has an order. That record is how the client refuses `deleteAll` on a collection with no filter and `cursor` on a collection with no order.

Applications share parts of queries. The same soft-delete filter belongs on every model that has the field. The same tenant filter belongs on every query. The same `select` and `include` serve every endpoint that returns a summary. In a query language made of objects these are objects, spread into each query. In a query language made of calls they are functions, run on each collection.

A function can be run with no support from the collection at all: `notDeleted(Post)`. `apply` exists so that a fragment reads in the same order as the rest of the chain, and so that it can sit in the middle of one.

## How it works

### 1. A scope for any model with given fields

```ts
const notDeleted = db.orm.scope(
  { deletedAt: field.column(timestamptzTemporalColumn).optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

Post.apply(notDeleted);                    // Filtered<typeof Post>
Comment.where({ postId }).apply(notDeleted);
Tag.apply(notDeleted);                     // error: Tag has no deletedAt
```

The field map says what the scope needs: a field of that name, that column type, and that nullability. A field builder from the contract DSL carries exactly that, so the application declares a scope's needs in the words it used to write its schema. `field.column(...)` takes a column type from the target's `adapter/column-types` entry and needs no contract, so a package can declare fields the same way; `{ codecId: 'pg/timestamptz-temporal@1', nullable: true }` says the same without a builder. A builder that names no column type, such as `field.namedType(...)`, throws `ORM.ARGUMENT_INVALID` when the scope is defined.

The body receives a collection whose model accessor has only the declared fields, each typed as a `CodecField`, so it cannot touch a field it did not ask for. It may call `where`, `orderBy`, `limit` and `offset`; it cannot `select` or `include`.

The scope is generic over the collection it receives. It accepts any collection, of any model, whose fields include the declared ones with the same column type and nullability: a root collection, a custom class, a chained collection, one narrowed by `select`, an include refinement, `this` in a class. It returns that collection's own type plus what the body established: a `where` in the body gives `Filtered<Self>`, so `update` is allowed after it, and an `orderBy` gives `Ordered<Self>`. A model that lacks a field, has it with another column type, or has it with another nullability is refused with an error that names the field:

```
Property ''the model has no field with the column type and nullability the scope declares'' is missing in type 'CollectionBase<Contract, "Tag", ...>' but required in type '{ readonly 'the model has no field with the column type and nullability the scope declares': "deletedAt"; }'.
```

The field is matched by its name in the model, not its column name, so `@map` makes no difference. A relation, or a field that only one variant of a polymorphic model has, does not match. At run time the scope checks the receiver's model once per application, before building anything, and throws `ORM.FIELD_UNKNOWN` with `why`, `fix` and `meta` for a JavaScript caller whose model does not match.

Inside the body, `CodecField` has the same methods as the field on a model, including operations a package contributes, and checks values against the column type's output type rather than one model's narrower field type. A scope therefore accepts `kind.eq('superuser')` for an enum field where the same call written inline on that model is refused.

The method lives on the client because the body's field types need the contract's codecs and operations, which the client knows. If the contract has a namespace named `scope`, the namespace keeps the name and the client has no `scope` method.

### 2. A scope for one model

```ts
const summary = Post.scope((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

Post.apply(summary);
Post.where({ userId }).apply(summary);
User.include('posts', (posts) => posts.apply(summary));
Comment.apply(summary);                    // error: not a Post collection
Post.select('id').apply(summary);          // error: the rows no longer have every Post field
```

A class method is the usual way to name a query on one model. `Post.scope` serves the cases a class method does not: an application that does not subclass `Collection`, a scope kept as a value and passed around, and an include refinement, where a class method is not available.

The body is typed once, against `Collection<Contract, 'Post'>`, so `posts` needs no annotation. It is the plain collection even when the receiver is a custom class, so the class's methods are not available in the body. The method reads the contract and the model from the collection it is called on, through a `this` parameter, so its type does not mention the class's type arguments. A collection of one model therefore stays assignable to a collection of any model, `Collection<Contract, string>`, and the method is not instantiated again for every row and state a collection type reaches. The scope accepts any collection of that model whose row is the model's full row or wider: a root or filtered collection, a collection after `include`, an include refinement, `this` in a custom class. It refuses a collection whose row was narrowed by `select`, because the body was typed against the full row and on a narrowed collection its result would claim fields the query does not return. It refuses a collection narrowed by `variant` for the reason ADR 258 gives for `variant`. `CollectionRowOf` reads the row type off the result, so the application can name it.

A scope that changes the row produces a collection with the default state. A filter applied before it is not recorded after it, so `update` is refused after `apply(summary)` even when a `where` came first.

### 3. An order field from a request

```ts
Post.orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']));
```

`orderByField` takes a collection, a field name from the request, a direction and an allowed list. The allowed list is typed against the fields of the model whose column type can be ordered, so a relation, an unknown field, or a field that cannot be ordered is a compile error in the list. The name and direction from the request are checked at run time: a value that is not a string, an unknown name, a relation, a field that cannot be ordered, or a name outside the allowed list throws `ORM.ARGUMENT_INVALID` before any query is built. The request string reaches SQL only as the quoted identifier of a column the model owns. The selector it returns fits any collection of a model that has the allowed fields, and `orderBy` records the order, so `cursor` is allowed afterwards.

## What it costs

Measured as type instantiations with TypeScript 5.9.3 on the `prisma-8-demo` example, which checks at about 730,000 instantiations without these helpers. Every count was measured twice with the same result. The last column is the cost of ten uses at different sites (root collections of three models, a custom class, a collection after `where`, `orderBy`, `select` or `limit`, an include refinement, `this` in a class), over the same ten sites written inline.

| Feature | Present but unused | Definition | Ten uses, over the same code written inline |
| --- | --- | --- | --- |
| A conditional inside `apply` | none | — | 10,000 to 14,000 once per pair of collection types, then under 10 |
| `db.orm.scope` and `Post.scope` together | +978 (+0.13%) | | |
| `db.orm.scope` | | 149 | +9,045 with the definition: about 1,750 for the first use, then 500 to 1,100 each |
| `Post.scope` | | 21 | −7,623: the body is typed once instead of at each site |
| `orderByField` | none | — | about 550 once, then under 20 |

An earlier prototype of the scope for any model, built before ADR 258 changed `include`, cost about 10,000 instantiations for each definition in the same example, for a reason that was not found. The method here costs 149 per definition. Its cost is in the uses: each one infers the receiver's model and namespace and checks the declared fields against that model, and the check is cached per model and receiver type.

## Consequences

- **Any function is a fragment.** Control flow stays in the language. The query API gains no combinators.
- **A package can offer a scope for any model.** It declares fields with `field.column(...)` or `{ codecId, nullable }` and needs no knowledge of the application's models; it takes the client as an argument to call `scope`. A package that introduces a kind of index can offer a scope built from the index definition (ADR 260).
- **A scope declared with a field map sees only those fields.** Its body cannot filter or order on a field it did not declare.
- **A single-model scope takes its model from the collection it is called on**, not from a type parameter, because TypeScript cannot tell one model name from a union of names.
- **`scope` is a member of every collection and of the client.** A custom collection class cannot declare its own `scope` with another signature, an aggregate operation cannot be named `scope`, and a contract namespace named `scope` hides the client method.
- **The field builders that `defineContract` passes to its callback, such as `field.text()` or `field.temporal.timestamptz()`, are not importable on their own.** A scope declares fields with `field.column(...)` and a column type, which the facade exports.
- **Public names added:** `FieldScope` and `ScopeFieldSpec`, which declaration output needs for an exported scope for any model. The type a single-model scope accepts is printed in terms of names already public (`HasRow`, `HasState`, `DefaultModelRow`).

## Non-goals

- **A default scope per model.** A scope that every query of a model must have, such as soft delete, is a separate decision.
- **Recording a fragment's filter after a scope that changes the row.** Such a scope produces the default state.
- **Selecting fields by shape across models.** A scope for any model may filter and order on its declared fields; it does not select or include.

## Alternatives considered

- **A `when(value, fn)` combinator** whose result keeps the caller's type, as the way to write conditional fragments. It moves control flow into the query API, and every construct would need its own combinator. The subtyping rule of ADR 258 makes the plain conditional sound.
- **`where(undefined)` and `orderBy(undefined)` as no-ops**, so that a conditional filter is `posts.where(search ? (p) => ... : undefined)`. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **Declaring a scope's fields by pointing at an existing model's field**, `{ deletedAt: Post.fields.deletedAt }`. It ties a reusable scope to one model's field, so renaming that field breaks every scope that named it.
- **A scope for one model written with type arguments**, `scope<Contract, 'Post'>()(body)`. The empty call exists only because TypeScript cannot take two type arguments explicitly and infer the body's type in the same call. Taking the model from the collection removes it.
- **A single-model `scope` typed with the class's type arguments**, `scope(body: (c: Collection<TContract, ModelName>) => R): Scope<..., R>`. The model then appears in the parameter of the returned scope, so `Collection<Contract, 'Post'>` is no longer assignable to `Collection<Contract, string>`, which generic helpers rely on. Typing the body against the receiver's namespace as well costs 6,611 instantiations (+0.9%) in the demo when unused, because the method is instantiated again for every state a collection type reaches. Reading the model from `this` avoids both.
- **Query fragments as objects**, as in a query language made of objects. The chain is the query language here, and an object fragment would need a second way to express every method, kept in step with the first.
