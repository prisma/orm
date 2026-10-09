# ADR 259 — Query fragments are functions

**Status:** Accepted
**Date:** 2026-10-05
**Builds on:** [ADR 265 — A collection keeps its class through the chain](ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

An application hides soft-deleted rows on every model that has a `deletedAt` field, restricts every query to the caller's tenant, and lists posts for a request that may carry a search term and a sort field:

```ts
import { field } from '@prisma/orm-postgres/contract-builder';
import { orderByField } from '@prisma/orm-postgres/orm-client';

const { Post, Comment, Tag } = db.orm.public;

const notDeleted = db.orm.fragment(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

const forTenant = (tenantId: string) =>
  db.orm.fragment({ tenantId: field.uuidString() }, (rows) =>
    rows.where((r) => r.tenantId.eq(tenantId)),
  );

const summary = Post.fragment((posts) => posts.select('id', 'title').include('user'));

const posts = await Post
  .with((posts) => (input.search ? posts.where((p) => p.title.ilike(`%${input.search}%`)) : posts))
  .with(notDeleted)
  .with(forTenant(ctx.tenantId))
  .orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']))
  .with(summary)
  .limit(20)
  .all();

Comment.with(notDeleted);   // Comment has deletedAt
Tag.with(notDeleted);       // error: Tag has no deletedAt
```

- A **row fragment** is a function of the model accessor, and `where` and `orderBy` take it. A **query fragment**, or **fragment** for short, is a function from a collection to a collection (ADR 265), and `with` runs it. A **scope** is a fragment that only imposes conditions on the query, and is also run with `with`; this ADR uses the word only in that sense. A class method such as `published()` is a named fragment.
- A condition on one row that needs no declared fields is `where(rowFragment)`, as the search filter inside the first `with` is. A condition that should apply to every model with some fields is a scope: `notDeleted` and `forTenant` declare the fields they need, check them at run time, and return the receiver with the `Filtered` fact. `with` also runs what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant. The declaration uses the same field builders as the schema.
- `summary` is a fragment for one model. It changes the row, so it is typed once against a plain `Post` collection.
- The conditional inside `with` is an ordinary function. Its result is typed as not known to be filtered, so `deleteAll` directly after it would be refused; after `notDeleted` the chain is filtered.
- `orderByField` turns a request string into an order and rejects a field outside the allowed list at run time.

## Decision

A piece of a query shared between places is a function: a row fragment, a query fragment or a scope, as At a glance defines them. The query API gains no methods for control flow: whatever the application would write in a function body, it writes inside the fragment, and the result is sound because a filtered collection is a subtype of an unfiltered one (ADR 265). The same holds inside the body of a fragment for any model, whose collection carries what it has established in a declared property.

Three helpers cover the fragments applications share most. This ADR names the first two "a fragment for any model with given fields" and "a fragment for one model"; in the code they are the declared-fields fragment (`DeclaredFieldsFragment`, `declared-fields-fragment` tests) and the model fragment (`model-fragment` tests). A model fragment is a plain `QueryFragment<In, Out>`; a declared-fields fragment needs its own type only because it is generic over the collection it receives.

1. **A fragment for any model with given fields: `db.orm.fragment(fields, body)`**, a method of the client `orm()` returns. Its type is `DeclaredFieldsFragment`. `fields` names each field the fragment needs, with a field builder from the contract DSL, or with `{ codecId, nullable }` in a package that does not import the facade. The body is typed against a collection that has only those fields. The fragment is accepted by every collection of a model that has them, and refused for the rest.
2. **A fragment for one model: `Post.fragment(body)`**, a method of every collection. The body is typed once against the plain collection of the model of the collection `fragment` is called on. The fragment can be applied to any collection of that model whose rows still have every field of the model, and is refused by one narrowed by `select` or `variant`. The fragment is built from the model alone, so `fragment` is called on the model's root collection, such as `db.Post`; on `db.Post.where(...)` the filter would be ignored. The rule is checked at run time: any chained call makes `fragment` throw `ORM.ARGUMENT_INVALID`. The type check is partial. It refuses a collection whose type records a filter, an order or an include, and a collection typed by a type parameter, such as `this` in a class method, which may be chained. It does not see `limit`, `offset`, `select`, `cursor`, `distinct`, `variant` or a lock, a union of a chained collection with a root collection, or a value typed as the plain collection. The facts of ADR 265 record what is known to be present, so the absence of a fact does not prove a root collection.
3. **An order field from a request: `orderByField(collection, name, direction, allowed)`.** The allowed list is required and typed against the model's orderable fields. The name and the direction are checked at run time, before any query is built.

`CodecField<Contract, CodecId, Nullable>` is the type of a model accessor field named by its codec instead of its model. It is what a declared field becomes inside the body of a fragment for any model, and what a row fragment for any model with a field is written with. `CodecListField<Contract, CodecId, Nullable, ElementNullable>` is the same for a list field.

## Why a fragment is a function

A query is a chain of method calls on a collection. Each call returns a collection whose type records what is known: the rows it produces, whether it has a filter, whether it has an order. That record is how the client refuses `deleteAll` on a collection with no filter and `cursor` on a collection with no order.

Applications share parts of queries. The same soft-delete filter belongs on every model that has the field. The same tenant filter belongs on every query. The same `select` and `include` serve every endpoint that returns a summary. In a query language made of objects these are objects, spread into each query. In a query language made of calls they are functions, run on each collection.

A function can be run with no support from the collection at all: `notDeleted(Post)`. `with` exists so that a fragment reads in the same order as the rest of the chain, and so that it can sit in the middle of one.

## How it works

### 1. A fragment for any model with given fields

```ts
const notDeleted = db.orm.fragment(
  { deletedAt: field.temporal.timestamptz().optional() },
  (rows) => rows.where((r) => r.deletedAt.isNull()),
);

Post.with(notDeleted);                    // Filtered<typeof Post>
Comment.where({ postId }).with(notDeleted);
Tag.with(notDeleted);                     // error: Tag has no deletedAt
```

The field map says what the fragment needs: a field of that name, with that codec and that nullability, that holds one value or, when the builder ends in `.many()`, a list whose elements are never null, or, with `.many({ elementsNullable: true })`, a list whose elements may be null. The builder means these as the contract DSL does: `.many()` is a `String[]` and `.many({ elementsNullable: true })` a `String?[]`. A field builder from the contract DSL carries exactly that, so the application declares a fragment's needs in the words it used to write its schema. The Postgres facade's `contract-builder` entry exports `field`, the same builders the `defineContract` callback receives, composed from the SQL family and the Postgres target: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()` and the rest. The helpers an extension adds, such as pgvector's, are not in it, because they depend on the extensions a contract lists. `field.column(timestamptzTemporalColumn)` is the explicit form, with a column type from the `adapter/column-types` entry. A package that offers a fragment and does not import the facade declares a field as `{ codecId: 'pg/timestamptz-temporal@1', nullable: true }`, adding `many` for a list as a contract field records it: `many: { elementNullable: false }`, or `many: { elementNullable: true }` when the elements may be null. The codec must be one of the contract's codecs; a misspelled one is refused where it is declared. The builder's side of this contract is a type both packages share: `ScalarFieldDeclarationBuilder` in the framework components, which the DSL's field builders implement and the client reads, so the client does not depend on the DSL. A builder that names no column type, such as `field.namedType(...)`, throws `ORM.ARGUMENT_INVALID` when the fragment is defined.

The body receives a collection whose model accessor has only the declared fields, each typed as a `CodecField`, or for a list as a `CodecListField`, whose value is a list of the codec's values, with `null` among them when the declaration says the elements may be null, so it cannot touch a field it did not ask for. It may call `where`, `orderBy`, `limit` and `offset`; it cannot `select` or `include`. What the body has established is a declared property of that collection, as on every collection (ADR 265), and a flag that is not established is `boolean`. So the facts take part in assignment: a reassigned `let` that may or may not hold the filtered collection is typed as not known to be filtered, an explicit type argument that claims a filter the body did not apply is refused, and so is a body that returns some other collection. At run time the fragment also checks that the body returned a collection of the receiver's model, namespace and class, and throws `ORM.ARGUMENT_INVALID` otherwise.

The body's collection carries its facts under its own property, not under the `TypeState` property of ADR 265, although the facts are the same two flags. A real collection has `TypeState`, so with that property a body could return any collection, such as `db.orm.public.Post.where(...)`, in place of the one it received, and the type would accept it. The separate property is what refuses that.

The fragment is generic over the collection it receives. It accepts any collection, of any model, whose fields include the declared ones with the same codec and nullability, and a list with the same element nullability exactly where the declaration declares one: a root collection, a custom class, a chained collection, one narrowed by `select`, an include refinement, `this` in a class. It returns that collection's own type plus what the body established: a `where` in the body gives `Filtered<Self>`, so `update` is allowed after it, and an `orderBy` gives `Ordered<Self>`. The body may also call `limit` and `offset`, which the type does not record. A write refuses what it would ignore. `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter, and the statement they run cannot apply a limit, an offset, a cursor, `distinct` or `distinctOn`, so they throw `ORM.ARGUMENT_INVALID` on a collection that has any of them, whether a fragment added it or the chain did; an order does not change which rows they change, and they accept it. `update` and `delete` change one row, the one `first()` returns, so the order, the offset, the cursor, `distinct` and `distinctOn` choose it; after `limit(0)` they change nothing and return `null`, where `first()` would replace the limit with 1 and return a row, and they refuse a limit that a read refuses, such as `limit(-1)`, with the same `ORM.ARGUMENT_INVALID`. `update` with a relation callback finds its row by the filter alone, so it throws `ORM.ARGUMENT_INVALID` on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`. The fragment reads the receiver's contract, model and namespace from the receiver's type and checks the declared fields against that one model only; a union of collections is accepted when every model in it has the fields. `with` builds the result from the receiver's own type and the facts the fragment carries in its type, so the result keeps the receiver's own name, such as `Collection<Contract, 'Post', ...>`, and an exported chain emits a declaration. A model that lacks a field, has it with another codec or another nullability, has a list where the fragment declares one value or the reverse, or has a list whose elements differ in nullability from the declared ones, is refused, and the error names the field. For a fragment that declares `deletedAt` and `title`, applied to a model that has only `deletedAt`:

```
Property ''the model has no field that matches the declaration in the fragment'' is missing in type 'CollectionBase<Contract, "Comment", ...>' but required in type '{ readonly 'the model has no field that matches the declaration in the fragment': "title"; }'.
```

When TypeScript cannot read one model name from the receiver's type, the error says so instead: the property is `'the fragment could not read the model of the collection from its type'`. This happens for a `Collection<Contract, string>`, and for `fragment.call(undefined, collection)` and `fragment.apply(undefined, [collection])`, which erase the fragment's type parameters; calling the fragment directly, `bind`, and `collection.with(fragment)` infer them. A union of two fragments is accepted by `with` only when both establish the same facts. Otherwise TypeScript reports that no overload of `with` matches, because the types of `[FragmentFactsType].hasWhere` or `[FragmentFactsType].hasOrderBy` are incompatible between the two fragments.

A field matches on its codec and its nullability. The rest of the column type, its type parameters, is not compared, so `field.uuidString()`, a `char(36)` column, matches a field of any `char(n)`. A declaration of one value does not match a list field, such as a `String[]`. A list declaration matches only a list field whose elements have the declared nullability: `.many()` matches a `String[]` and not a `String?[]`, and `.many({ elementsNullable: true })` matches a `String?[]` and not a `String[]`. Both checks read whether the field is a list, and the nullability of its elements, from the model's field, and the codec and the nullability from its column. So a list of value objects, such as `addresses Address[]`, which is stored as one `jsonb` value, is declared as a list: `field.column(jsonbColumn).many()` or `{ codecId: 'pg/jsonb@1', nullable: false, many: { elementNullable: false } }`. The field is matched by its name in the model, not its column name, so `@map` makes no difference. The namespace is read from the receiver, so a model of the same name in another namespace matches only if it has the fields itself. A collection whose type carries no namespace, such as a custom collection class, is checked at compile time against every model of that name in the contract: it matches only a field that each of those models has, with the same codec and nullability. Its real namespace is checked at run time. A relation, or a field that only one variant of a polymorphic model has, does not match. At run time the fragment checks the receiver's model once per application, before the body runs, and throws `ORM.FIELD_UNKNOWN` with `why`, `fix` and `meta` for a JavaScript caller whose model does not match. A field map, a declaration or a body of the wrong kind throws `ORM.ARGUMENT_INVALID` when the fragment is defined.

Inside the body, `CodecField` has the same methods as the field on a model, including operations a package contributes, and checks values against the codec's output type rather than one model's narrower field type. A fragment therefore accepts `kind.eq('superuser')` for an enum field where the same call written inline on that model is refused.

The method lives on the client because the body's field types need the contract's codecs and operations, which the client knows. If the contract has a namespace named `fragment`, the namespace keeps the name and the client has no `fragment` method, so such an application cannot make a fragment for any model. This is a known limitation; the fix, putting the namespaces or the client's methods under a member of their own, is recorded in the project's deferred items.

### 2. A fragment for one model

```ts
const summary = Post.fragment((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

Post.with(summary);
Post.where({ userId }).with(summary);
User.include('posts', (posts) => posts.with(summary));
Comment.with(summary);                    // error: not a Post collection
Post.select('id').with(summary);          // error: the rows no longer have every Post field
```

A class method is the usual way to name a query on one model. `Post.fragment` serves the cases a class method does not: an application that does not subclass `Collection`, a fragment kept as a value and passed around, and an include refinement, where a class method is not available.

The body is typed once, against the plain collection of the model in the namespace of the collection `fragment` is called on, such as the type of `db.orm.public.Post`, so `posts` needs no annotation. It is the plain collection even when `fragment` is called on a custom class, so the class's methods are not available in the body. The method reads the contract, the model and the namespace from the collection it is called on, through a `this` parameter, so its type does not mention the class's type arguments. A fragment made from `db.orm.auth.User` is typed with `auth.User`'s fields and refused by `db.orm.public.User`. A collection whose namespace is not known in its type, such as a custom class, gives a fragment that names none and accepts the model in any namespace whose rows match; its real namespace is checked only at run time. At run time a fragment for one model checks that it is applied to a collection of the model and namespace it was made from, and throws `ORM.ARGUMENT_INVALID` otherwise. A collection of one model therefore stays assignable to a collection of any model, `Collection<Contract, string>`. The type check on the collection `fragment` is called on reads its state and its row, so the method is instantiated again for each collection type it is called on; the cost section gives the number. The fragment can be applied to any collection of that model whose row is the model's full row or wider: a root or filtered collection, a collection after `include`, an include refinement, `this` in a custom class through `this.with(fragment)`. It refuses a collection whose row was narrowed by `select`, because the body was typed against the full row and on a narrowed collection its result would claim fields the query does not return. It refuses a collection narrowed by `variant` for the reason ADR 265 gives for `variant`. `CollectionRowOf` reads the row type off the result, so the application can name it.

The result of a fragment for one model is always the body's result on the plain collection. This holds even when the body keeps the row: `PostCollection.where(...).with(Post.fragment((p) => p.orderBy(...)))` is typed as an ordered plain `Post` collection, without the custom class and without the earlier filter, although at run time both are still there. A filter or an order for one model therefore belongs in a class method or in a fragment for any model, which keep the receiver's type; a fragment for one model is for changing the row. A filter applied before it is not recorded after it, so `update` is refused after `with(summary)` even when a `where` came first. Carrying the receiver's type through a body that keeps the row is recorded as a possible later improvement.

### 3. An order field from a request

```ts
Post.orderBy(orderByField(Post, input.sort, input.direction, ['title', 'createdAt']));
```

`orderByField` takes a collection, a field name from the request, a direction from the request (a string, or `undefined` for `asc`) and an allowed list. The allowed list is required, because without it request text could order rows by any field, including one whose value is secret, and the order of the results would leak it. It is typed against the fields of the model whose codec has the `order` trait, so a relation, an unknown field, or a field that cannot be ordered is a compile error in the list. The name and direction from the request are checked at run time: a value that is not a string, an unknown name, a relation, a field that cannot be ordered, or a name outside the allowed list throws `ORM.ARGUMENT_INVALID` before any query is built. The request string reaches SQL only as the quoted identifier of a column the model owns. The selector it returns fits any collection of a model that has the allowed fields, and `orderBy` records the order, so `cursor` is allowed afterwards.

## What it costs

Measured as type instantiations with TypeScript 5.9.3. Every count was measured twice with the same result.

On the `prisma-8-demo` example, which checks at 735,059 instantiations on main at commit 7bc1b4dd20, without these helpers. The unused cost checks the demo files as they are at that commit with `pnpm typecheck --extendedDiagnostics`, after a fresh build, once against the packages of that commit and once against the packages with these helpers. The last column is the cost of ten uses at different sites (root collections of three models, a custom class, a collection after `where`, `orderBy`, `select` or `limit`, an include refinement, `this` in a class), over the same ten sites written inline. For `db.orm.fragment` the definition and the uses are measured on the same demo files against the packages with these helpers, with one more file in the demo that defines a fragment on `createdAt` and applies it at those ten sites, against the same file with the ten filters written inline. The rows for a conditional inside `with`, `Post.fragment` and `orderByField` were measured in the same way on an earlier main and were not measured again.

| Feature | Present but unused | Definition | Ten uses, over the same code written inline |
| --- | --- | --- | --- |
| A conditional inside `with` | none | — | 10,000 to 14,000 once per pair of collection types, then under 10 |
| `db.orm.fragment` and `Post.fragment` together | +342 (+0.05%) | | |
| `db.orm.fragment` | | 8,305 for the first in a program, 145 for each later one | +3,147: 4,089 for the ten uses, against 942 for the same ten sites written inline |
| `Post.fragment` | | 21 | −7,109: the body is typed once instead of at each site |
| `orderByField` | none | — | about 550 once, then under 20 |

The check that refuses `fragment` on a collection whose type records a filter, an order or an include was measured later, on main at commit 97eeab5dd6, in the same way: the demo files and the client package's files as they are at that commit, checked once against the packages with the check and once against the same packages without it. Every count was measured twice with the same result. The demo calls `fragment` once, on a root collection.

| | Without the check | With the check | Difference |
| --- | --- | --- | --- |
| `prisma-8-demo` | 793,119 | 793,326 | +207 (+0.03%) |
| The client package | 1,862,933 | 1,863,330 | +397 (+0.02%) |

On a generated contract of 200 models, half of them with `deletedAt`, with a scope that filters on `deletedAt` and ten uses on ten different models:

| | Instantiations |
| --- | --- |
| One `db.orm.fragment` definition | 19,732 |
| Its first use | 1,136 |
| Each later use | about 890 |
| Ten uses, with the definition | 28,887 |
| The same ten filters written inline | 17,775 |
| Ten uses over inline, with the definition | +11,112 |

Each use checks the declared fields against the receiver's model only, and computes nothing for the other models of the contract. The definition costs more on the larger contract; which part of the contract's type drives that was not measured.

## Consequences

- **Any function is a fragment.** Control flow stays in the language. The query API gains no combinators.
- **A package can offer a fragment for any model.** It declares fields with `{ codecId, nullable }` and needs no knowledge of the application's models; it takes the client as an argument to call `fragment`. A package that introduces a kind of index can offer a fragment built from the index definition, as proposed in prisma/orm#30428.
- **A fragment declared with a field map sees only those fields.** Its body cannot filter or order on a field it did not declare.
- **A single-model fragment takes its model from the collection it is called on**, not from a type parameter, because TypeScript cannot tell one model name from a union of names.
- **`fragment` is a member of every collection and of the client.** A custom collection class cannot declare its own `fragment` with another signature, an aggregate operation cannot be named `fragment`, and a contract namespace named `fragment` hides the client method.
- **The `field` that `@prisma/orm-postgres/contract-builder` exports has the Postgres presets.** It is the callback's `field` without extension helpers. Its `field.column(...).default(...)` checks the value against the Postgres target's column types, as the callback's does; it does not know the column types an extension adds, such as pgvector's `vector`, so it does not check those. Importing it at run time brings the SQL family and Postgres target packs into the application's bundle; the client itself reads builders through a structural `build()` interface and does not import the entry.
- **Public names added** to the `orm-client` entry: `orderByField`, `OrderableFieldNames`, `CodecField`, `CodecListField`, `DeclaredFieldsFragment`, `DeclaredField` and `FragmentFacts`; `CodecListField` because a row fragment for a list field is written with it, and the last three because declaration output needs them for an exported fragment for any model; to the framework components' `codec` entry, `CodecDescriptorRef`, `ScalarFieldDeclaration` and `ScalarFieldDeclarationBuilder`, the builder type the DSL and the client share. The type a single-model fragment accepts is printed in terms of names already public (`HasRow`, `HasTypeState`, `DefaultModelRow`). The `contract-builder` entry's `field` gains the presets.

## Non-goals

- **A default scope per model.** A scope that every query of a model must have, such as soft delete, is a separate decision.
- **Recording an earlier filter after a fragment that changes the row.** Such a fragment produces the default state.
- **Selecting fields by shape across models.** A fragment for any model may filter and order on its declared fields; it does not select or include.

## Alternatives considered

- **A `when(value, fn)` combinator** whose result keeps the caller's type, as the way to write conditional fragments. It moves control flow into the query API, and every construct would need its own combinator. The subtyping rule of ADR 265 makes the plain conditional sound.
- **`where(undefined)` and `orderBy(undefined)` as no-ops**, so that a conditional filter is `posts.where(search ? (p) => ... : undefined)`. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **Declaring a fragment's fields by pointing at an existing model's field**, `{ deletedAt: Post.fields.deletedAt }`. It ties a reusable fragment to one model's field, so renaming that field breaks every fragment that named it.
- **A fragment for one model written with type arguments**, `fragment<Contract, 'Post'>()(body)`. The empty call exists only because TypeScript cannot take two type arguments explicitly and infer the body's type in the same call. Taking the model from the collection removes it.
- **A single-model `fragment` typed with the class's type arguments**, `fragment(body: (c: Collection<TContract, ModelName>) => R): QueryFragment<..., R>`. The model then appears in the parameter of the returned fragment, so `Collection<Contract, 'Post'>` is no longer assignable to `Collection<Contract, string>`, which generic helpers rely on. Typing the body against the namespace of the collection `fragment` is called on, through the class's state argument, costs 6,611 instantiations (+0.9%) in the demo when unused, because the method is instantiated again for every state a collection type reaches. Reading the model and the namespace from `this` avoids both.
- **Query fragments as objects**, as in a query language made of objects. The chain is the query language here, and an object fragment would need a second way to express every method, kept in step with the first.
