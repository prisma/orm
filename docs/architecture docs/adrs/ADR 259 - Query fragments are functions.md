# ADR 259 — Query fragments are functions

**Status:** Accepted
**Date:** 2026-10-05
**Builds on:** [ADR 258 — A collection keeps its class through the chain](ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

An application hides soft-deleted rows on every model that has a `deletedAt` field, restricts every query to the caller's tenant, and lists posts for a request that may carry a search term and a sort field:

```ts
import { field } from '@prisma/orm-postgres/contract-builder';
import { orderByField } from '@prisma/orm-postgres/orm-client';

const { Post, Comment, Tag } = db.orm.public;

const notDeleted = db.orm.scope(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

const forTenant = (tenantId: string) =>
  db.orm.scope({ tenantId: field.uuidString() }, (rows) =>
    rows.where((r) => r.tenantId.eq(tenantId)),
  );

const summary = Post.scope((posts) => posts.select('id', 'title').include('user'));

const posts = await Post
  .apply((posts) => (input.search ? posts.where((p) => p.title.ilike(`%${input.search}%`)) : posts))
  .apply(notDeleted)
  .apply(forTenant(ctx.tenantId))
  .orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']))
  .apply(summary)
  .limit(20)
  .all();

Comment.apply(notDeleted);   // Comment has deletedAt
Tag.apply(notDeleted);       // error: Tag has no deletedAt
```

- A **scope** is a function from a collection to a collection (ADR 258). `apply` runs one. A class method such as `published()` is a named scope.
- `notDeleted` and `forTenant` are scopes for any model that has the fields they declare. The declaration uses the same field builders as the schema.
- `summary` is a scope for one model. It changes the row, so it is typed once against a plain `Post` collection.
- The conditional inside `apply` is an ordinary function. Its result is typed as not known to be filtered, so `deleteAll` directly after it would be refused; after `notDeleted` the chain is filtered.
- `orderByField` turns a request string into an order and rejects a field outside the allowed list at run time.

## Decision

A **query fragment** is a function. A fragment of a row is a function of the model accessor, and `where` and `orderBy` take it. A fragment of a query is a scope, and `apply` runs it. The query API gains no methods for control flow: whatever the application would write in a function body, it writes inside the scope, and the result is sound because a filtered collection is a subtype of an unfiltered one (ADR 258). The same holds inside the body of a scope for any model, whose collection carries what it has established in a declared property.

Three helpers cover the fragments applications share most. This ADR names the first two "a scope for any model with given fields" and "a scope for one model"; in the code they are the field scope (`FieldScope`, `field-scope` tests) and the model scope (`model-scope` tests). A model scope is a plain `Scope<In, Out>`; a field scope needs its own type only because it is generic over the collection it receives.

1. **A scope for any model with given fields: `db.orm.scope(fields, body)`**, a method of the client `orm()` returns. Its type is `FieldScope`. `fields` names each field the scope needs, with a field builder from the contract DSL, or with `{ codecId, nullable }` in a package that does not import the facade. The body is typed against a collection that has only those fields. The scope is accepted by every collection of a model that has them, and refused for the rest.
2. **A scope for one model: `Post.scope(body)`**, a method of every collection. The body is typed once against the plain collection of the receiver's model. The scope is accepted by any collection of that model whose rows still have every field of the model, and refused for one narrowed by `select` or `variant`.
3. **An order field from a request: `orderByField(collection, name, direction, allowed)`.** The allowed list is required and typed against the model's orderable fields. The name and the direction are checked at run time, before any query is built.

`CodecField<Contract, CodecId, Nullable>` is the type of a model accessor field named by its codec instead of its model. It is what a declared field becomes inside the body of a scope for any model, and what a row fragment for any model with a field is written with.

## Why a fragment is a function

A query is a chain of method calls on a collection. Each call returns a collection whose type records what is known: the rows it produces, whether it has a filter, whether it has an order. That record is how the client refuses `deleteAll` on a collection with no filter and `cursor` on a collection with no order.

Applications share parts of queries. The same soft-delete filter belongs on every model that has the field. The same tenant filter belongs on every query. The same `select` and `include` serve every endpoint that returns a summary. In a query language made of objects these are objects, spread into each query. In a query language made of calls they are functions, run on each collection.

A function can be run with no support from the collection at all: `notDeleted(Post)`. `apply` exists so that a fragment reads in the same order as the rest of the chain, and so that it can sit in the middle of one.

## How it works

### 1. A scope for any model with given fields

```ts
const notDeleted = db.orm.scope(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

Post.apply(notDeleted);                    // Filtered<typeof Post>
Comment.where({ postId }).apply(notDeleted);
Tag.apply(notDeleted);                     // error: Tag has no deletedAt
```

The field map says what the scope needs: a field of that name, with that codec and that nullability, that holds one value or, when the builder ends in `.many()`, a list whose elements are never null, or, with `.many({ elementsNullable: true })`, a list whose elements may be null. The builder means these as the contract DSL does: `.many()` is a `String[]` and `.many({ elementsNullable: true })` a `String?[]`. A field builder from the contract DSL carries exactly that, so the application declares a scope's needs in the words it used to write its schema. The Postgres facade's `contract-builder` entry exports `field`, the same builders the `defineContract` callback receives, composed from the SQL family and the Postgres target: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()` and the rest. The helpers an extension adds, such as pgvector's, are not in it, because they depend on the extensions a contract lists. `field.column(timestamptzTemporalColumn)` is the explicit form, with a column type from the `adapter/column-types` entry. A package that offers a scope and does not import the facade declares a field as `{ codecId: 'pg/timestamptz-temporal@1', nullable: true }`, adding `many` for a list as a contract field records it: `many: { elementNullable: false }`, or `many: { elementNullable: true }` when the elements may be null. The codec must be one of the contract's codecs; a misspelled one is refused where it is declared. The builder's side of this contract is a type both packages share: `ScalarFieldDeclarationBuilder` in the framework components, which the DSL's field builders implement and the client reads, so the client does not depend on the DSL. A builder that names no column type, such as `field.namedType(...)`, throws `ORM.ARGUMENT_INVALID` when the scope is defined.

The body receives a collection whose model accessor has only the declared fields, each typed as a `CodecField`, or for a list as a `CodecListField`, whose value is a list of the codec's values, with `null` among them when the declaration says the elements may be null, so it cannot touch a field it did not ask for. It may call `where`, `orderBy`, `limit` and `offset`; it cannot `select` or `include`. What the body has established is a declared property of that collection, as on every collection (ADR 258), and a flag that is not established is `boolean`. So the facts take part in assignment: a reassigned `let` that may or may not hold the filtered collection is typed as not known to be filtered, an explicit type argument that claims a filter the body did not apply is refused, and so is a body that returns some other collection. At run time the scope also checks that the body returned a collection of the receiver's model, namespace and class, and throws `ORM.ARGUMENT_INVALID` otherwise.

The body's collection carries its facts under its own property, not under the `TypeState` property of ADR 258, although the facts are the same two flags. A real collection has `TypeState`, so with that property a body could return any collection, such as `db.orm.public.Post.where(...)`, in place of the one it received, and the type would accept it. The separate property is what refuses that.

The scope is generic over the collection it receives. It accepts any collection, of any model, whose fields include the declared ones with the same codec and nullability, and a list with the same element nullability exactly where the declaration declares one: a root collection, a custom class, a chained collection, one narrowed by `select`, an include refinement, `this` in a class. It returns that collection's own type plus what the body established: a `where` in the body gives `Filtered<Self>`, so `update` is allowed after it, and an `orderBy` gives `Ordered<Self>`. The body may also call `limit` and `offset`, which the type does not record. `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter, and the statement they run cannot apply a limit or an offset, so they throw `ORM.ARGUMENT_INVALID` on a collection that has one, whether a scope added it or the chain did; an order does not change which rows they change, and they accept it. `update` and `delete` change one row, the one `first()` returns, so the order and the offset choose it. `update` with a relation callback finds its row by the filter alone, so it throws `ORM.ARGUMENT_INVALID` on a collection with an order, a limit or an offset. The scope reads the receiver's contract, model and namespace from the receiver's type and checks the declared fields against that one model only; a union of collections is accepted when every model in it has the fields. `apply` builds the result from the receiver's own type and the facts the scope carries in its type, so the result keeps the receiver's own name, such as `Collection<Contract, 'Post', ...>`, and an exported chain emits a declaration. A model that lacks a field, has it with another codec or another nullability, has a list where the scope declares one value or the reverse, or has a list whose elements differ in nullability from the declared ones, is refused, and the error names the field. For a scope that declares `deletedAt` and `title`, applied to a model that has only `deletedAt`:

```
Property ''the model has no field that matches the declaration in the scope'' is missing in type 'CollectionBase<Contract, "Comment", ...>' but required in type '{ readonly 'the model has no field that matches the declaration in the scope': "title"; }'.
```

When TypeScript cannot read one model name from the receiver's type, the error says so instead: the property is `'the scope could not read the model of the collection from its type'`. This happens for a `Collection<Contract, string>`, and for `scope.call(undefined, collection)` and `scope.apply(undefined, [collection])`, which erase the scope's type parameters; calling the scope directly, `bind`, and `collection.apply(scope)` infer them. A union of two scopes is accepted by `apply` only when both establish the same facts; otherwise the error says the facts of one are not those of the other.

A field matches on its codec and its nullability. The rest of the column type, its type parameters, is not compared, so `field.uuidString()`, a `char(36)` column, matches a field of any `char(n)`. A declaration of one value does not match a list field, such as a `String[]`. A list declaration matches only a list field whose elements have the declared nullability: `.many()` matches a `String[]` and not a `String?[]`, and `.many({ elementsNullable: true })` matches a `String?[]` and not a `String[]`. The run-time check reads the same fact from the storage column's `many`. The field is matched by its name in the model, not its column name, so `@map` makes no difference. The namespace is read from the receiver, so a model of the same name in another namespace matches only if it has the fields itself. A collection whose type carries no namespace, such as a custom collection class, is checked at compile time against every model of that name in the contract: it matches only a field that each of those models has, with the same codec and nullability. Its real namespace is checked at run time. A relation, or a field that only one variant of a polymorphic model has, does not match. At run time the scope checks the receiver's model once per application, before the body runs, and throws `ORM.FIELD_UNKNOWN` with `why`, `fix` and `meta` for a JavaScript caller whose model does not match. A field map, a declaration or a body of the wrong kind throws `ORM.ARGUMENT_INVALID` when the scope is defined.

Inside the body, `CodecField` has the same methods as the field on a model, including operations a package contributes, and checks values against the codec's output type rather than one model's narrower field type. A scope therefore accepts `kind.eq('superuser')` for an enum field where the same call written inline on that model is refused.

The method lives on the client because the body's field types need the contract's codecs and operations, which the client knows. If the contract has a namespace named `scope`, the namespace keeps the name and the client has no `scope` method, so such an application cannot make a scope for any model. This is a known limitation; the fix, putting the namespaces or the client's methods under a member of their own, is recorded in the project's deferred items.

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

The body is typed once, against the plain collection of the model in the receiver's namespace, such as the type of `db.orm.public.Post`, so `posts` needs no annotation. It is the plain collection even when the receiver is a custom class, so the class's methods are not available in the body. The method reads the contract, the model and the namespace from the collection it is called on, through a `this` parameter, so its type does not mention the class's type arguments. A scope made from `db.orm.auth.User` is typed with `auth.User`'s fields and refused by `db.orm.public.User`. A collection whose namespace is not known in its type, such as a custom class, gives a scope that names none and accepts the model in any namespace whose rows match; its real namespace is checked only at run time. At run time a scope for one model checks that it is applied to a collection of the model and namespace it was made from, and throws `ORM.ARGUMENT_INVALID` otherwise. A collection of one model therefore stays assignable to a collection of any model, `Collection<Contract, string>`, and the method is not instantiated again for every row and state a collection type reaches. The scope accepts any collection of that model whose row is the model's full row or wider: a root or filtered collection, a collection after `include`, an include refinement, `this` in a custom class. It refuses a collection whose row was narrowed by `select`, because the body was typed against the full row and on a narrowed collection its result would claim fields the query does not return. It refuses a collection narrowed by `variant` for the reason ADR 258 gives for `variant`. `CollectionRowOf` reads the row type off the result, so the application can name it.

The result of a scope for one model is always the body's result on the plain collection. This holds even when the body keeps the row: `PostCollection.where(...).apply(Post.scope((p) => p.orderBy(...)))` is typed as an ordered plain `Post` collection, without the custom class and without the earlier filter, although at run time both are still there. A filter or an order for one model therefore belongs in a class method or in a scope for any model, which keep the receiver's type; a scope for one model is for changing the row. A filter applied before it is not recorded after it, so `update` is refused after `apply(summary)` even when a `where` came first. Carrying the receiver's type through a body that keeps the row is recorded as a possible later improvement.

### 3. An order field from a request

```ts
Post.orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']));
```

`orderByField` takes a collection, a field name from the request, a direction from the request (a string, or `undefined` for `asc`) and an allowed list. The allowed list is required, because without it request text could order rows by any field, including one whose value is secret, and the order of the results would leak it. It is typed against the fields of the model whose codec has the `order` trait, so a relation, an unknown field, or a field that cannot be ordered is a compile error in the list. The name and direction from the request are checked at run time: a value that is not a string, an unknown name, a relation, a field that cannot be ordered, or a name outside the allowed list throws `ORM.ARGUMENT_INVALID` before any query is built. The request string reaches SQL only as the quoted identifier of a column the model owns. The selector it returns fits any collection of a model that has the allowed fields, and `orderBy` records the order, so `cursor` is allowed afterwards.

## What it costs

Measured as type instantiations with TypeScript 5.9.3. Every count was measured twice with the same result.

On the `prisma-8-demo` example, which checks at 702,050 instantiations without these helpers. The unused cost is measured with `pnpm typecheck --extendedDiagnostics` after a fresh build, on the demo files that existed before ADR 258. The last column is the cost of ten uses at different sites (root collections of three models, a custom class, a collection after `where`, `orderBy`, `select` or `limit`, an include refinement, `this` in a class), over the same ten sites written inline. For `db.orm.scope` the definition and the uses are measured the same way, with one more file in the demo that defines a scope on `createdAt` and applies it at those ten sites, against the same file with the ten filters written inline.

| Feature | Present but unused | Definition | Ten uses, over the same code written inline |
| --- | --- | --- | --- |
| A conditional inside `apply` | none | — | 10,000 to 14,000 once per pair of collection types, then under 10 |
| `db.orm.scope` and `Post.scope` together | +308 (+0.04%) | | |
| `db.orm.scope` | | 7,869 for the first in a program, 143 for each later one | +3,163: 4,253 for the ten uses, against 1,090 for the same ten sites written inline |
| `Post.scope` | | 21 | −7,109: the body is typed once instead of at each site |
| `orderByField` | none | — | about 550 once, then under 20 |

On a generated contract of 200 models, half of them with `deletedAt`, with a scope that filters on `deletedAt` and ten uses on ten different models:

| | Instantiations |
| --- | --- |
| One `db.orm.scope` definition | 18,615 |
| Its first use | 1,129 |
| Each later use | about 890 |
| Ten uses, with the definition | 27,754 |
| The same ten filters written inline | 17,052 |
| Ten uses over inline, with the definition | +10,702 |

Each use checks the declared fields against the receiver's model only, and computes nothing for the other models of the contract. The definition costs more on the larger contract; which part of the contract's type drives that was not measured.

## Consequences

- **Any function is a fragment.** Control flow stays in the language. The query API gains no combinators.
- **A package can offer a scope for any model.** It declares fields with `{ codecId, nullable }` and needs no knowledge of the application's models; it takes the client as an argument to call `scope`. A package that introduces a kind of index can offer a scope built from the index definition (ADR 260).
- **A scope declared with a field map sees only those fields.** Its body cannot filter or order on a field it did not declare.
- **A single-model scope takes its model from the collection it is called on**, not from a type parameter, because TypeScript cannot tell one model name from a union of names.
- **`scope` is a member of every collection and of the client.** A custom collection class cannot declare its own `scope` with another signature, an aggregate operation cannot be named `scope`, and a contract namespace named `scope` hides the client method.
- **The `field` that `@prisma/orm-postgres/contract-builder` exports has the Postgres presets.** It is the callback's `field` without extension helpers. Its `field.column(...).default(...)` checks the value against the Postgres target's column types, as the callback's does; it does not know the column types an extension adds, such as pgvector's `vector`, so it does not check those. Importing it at run time brings the SQL family and Postgres target packs into the application's bundle; the client itself reads builders through a structural `build()` interface and does not import the entry.
- **Public names added** to the `orm-client` entry: `orderByField`, `OrderableFieldNames`, `CodecField`, `FieldScope`, `DeclaredField` and `ScopeFacts`, the last three because declaration output needs them for an exported scope for any model; to the framework components' `codec` entry, `CodecDescriptorRef`, `ScalarFieldDeclaration` and `ScalarFieldDeclarationBuilder`, the builder type the DSL and the client share. The type a single-model scope accepts is printed in terms of names already public (`HasRow`, `HasTypeState`, `DefaultModelRow`). The `contract-builder` entry's `field` gains the presets.

## Non-goals

- **A default scope per model.** A scope that every query of a model must have, such as soft delete, is a separate decision.
- **Recording a fragment's filter after a scope that changes the row.** Such a scope produces the default state.
- **Selecting fields by shape across models.** A scope for any model may filter and order on its declared fields; it does not select or include.

## Alternatives considered

- **A `when(value, fn)` combinator** whose result keeps the caller's type, as the way to write conditional fragments. It moves control flow into the query API, and every construct would need its own combinator. The subtyping rule of ADR 258 makes the plain conditional sound.
- **`where(undefined)` and `orderBy(undefined)` as no-ops**, so that a conditional filter is `posts.where(search ? (p) => ... : undefined)`. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **Declaring a scope's fields by pointing at an existing model's field**, `{ deletedAt: Post.fields.deletedAt }`. It ties a reusable scope to one model's field, so renaming that field breaks every scope that named it.
- **A scope for one model written with type arguments**, `scope<Contract, 'Post'>()(body)`. The empty call exists only because TypeScript cannot take two type arguments explicitly and infer the body's type in the same call. Taking the model from the collection removes it.
- **A single-model `scope` typed with the class's type arguments**, `scope(body: (c: Collection<TContract, ModelName>) => R): Scope<..., R>`. The model then appears in the parameter of the returned scope, so `Collection<Contract, 'Post'>` is no longer assignable to `Collection<Contract, string>`, which generic helpers rely on. Typing the body against the receiver's namespace through the class's state argument costs 6,611 instantiations (+0.9%) in the demo when unused, because the method is instantiated again for every state a collection type reaches. Reading the model and the namespace from `this` avoids both.
- **Query fragments as objects**, as in a query language made of objects. The chain is the query language here, and an object fragment would need a second way to express every method, kept in step with the first.
