# ADR 259 — Query fragments are functions

**Status:** Accepted
**Date:** 2026-09-30
**Builds on:** [ADR 258 — A collection keeps its class through the chain](ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

An application lists posts for a request that may or may not carry a search term:

```ts
const posts = await db.Post
  .apply((posts) => (input.search ? posts.where((p) => p.title.ilike(`%${input.search}%`)) : posts))
  .orderBy((p) => p.createdAt.desc())
  .limit(20)
  .all();
```

- `apply` runs a step, a function from a collection to a collection, and returns whatever the step returns (ADR 258).
- The step may contain any code: here a conditional, elsewhere an early return or a loop.
- The result is a collection that may or may not be filtered. Its type says the filter is not known, so `deleteAll` would be refused on it.

A query is a chain of calls, so a piece of a query that is shared between places is a function. This decision adds three small helpers for the pieces applications share most: a filter that fits any model with a given field, a shared `select` and `include`, and a field to order by, taken from a request.

## Decision

A **query fragment** is a function. A **row fragment** is a function from the model accessor to an expression, and `where` and `orderBy` take it. A **step** is a function from a collection to a collection, and a collection's `apply` method runs it.

1. **A step is run with `apply`** (ADR 258). The step receives the caller's exact type, including a custom collection class, and the result is whatever the step returns.
2. **The query API has no control-flow methods.** Whatever the application would write in a function body, it writes inside the step. The type stays sound because a filtered collection is a subtype of an unfiltered one, so a step that may or may not filter yields the unfiltered type (ADR 258).
3. **A field type is named by its codec.** `CodecField<Contract, CodecId, Nullable>` is the model accessor's type for any field with that codec and nullability. It has the same set of comparison methods and operations as such a field on the model accessor, and it checks values against the codec's output type. A row fragment typed with it fits every model that has such a field.
4. **A step that changes the row is defined once per model.** `modelStep<Contract, Model>()(body)` types the body against the plain collection of one model of the contract and returns a step. The step accepts a collection of that model under two conditions:
   - **`select` has not narrowed its rows.** The body was typed against the model's full row, so on a narrowed collection its result would claim fields the query does not return.
   - **`variant` has not narrowed it.** `variant` changes the collection's type argument, and after it the model's class methods no longer apply (ADR 258). A step defined once for the model follows the same rule as a class method of the model.

   `CollectionRowOf` (ADR 258) names the row the step produces.
5. **A field to order by, named by a string, is checked at run time.** `orderByField(collection, name, direction, allowed)` returns an `orderBy` selector. The allowed list may name only fields whose codec can be ordered. A name outside it throws before the query runs.

## Why a fragment is a function

A query is a chain of method calls on a collection. Each call returns a collection whose type records what is known: the rows it produces, whether it has a filter, whether it has an order. That record is how the client refuses `deleteAll` on a collection with no filter and `cursor` on a collection with no order.

Applications share parts of queries. The same filter for deleted rows belongs on every query of a model. The same conditional filters are built from every list request. The same `select` and `include` serve every endpoint that returns a summary. In a query language made of objects these are objects, spread into each query. In a query language made of calls they are functions, applied to each collection.

A step can be called with no support from the collection at all: `step(db.Post)`. `apply` exists so that a step reads in the same order as the rest of the chain, and so that it can sit in the middle of one.

## How it works

### 1. `apply` runs a step

```ts
const byUser = (posts: PostCollection) => posts.where((p) => p.userId.eq(userId)).orderBy((p) => p.createdAt.desc());
db.Post.apply(byUser);   // Ordered<Filtered<PostCollection>>
```

`apply` calls the step with the receiver (ADR 258). A custom collection class receives itself, an include refinement receives the refinement, a collection after `select` receives the narrowed row. A step that filters yields `Filtered<Self>`, and a step that selects yields a new row.

### 2. Any function body is sound

```ts
db.Post.apply((posts) => (search ? posts.where((p) => p.title.ilike(`%${search}%`)) : posts));

class PostCollection extends Collection<Contract, 'Post'> {
  matching(search: string | undefined) {
    return this.apply((posts) => (search ? posts.where((p) => p.title.ilike(`%${search}%`)) : posts));
  }
}
```

The two branches have the types `Filtered<Self>` and `Self`. The first is a subtype of the second, so TypeScript reduces the union to `Self`: the unfiltered collection, or the unfiltered class. `update`, `delete` and `cursor` stay refused. An `if` with an early return, a `switch`, a loop that may run zero times, and a reassigned `let` reduce the same way. A function whose every return path filters yields `Filtered<Self>`, and `update` is allowed on it.

All of this is the subtyping rule of ADR 258. `apply` adds nothing to it.

### 3. A row fragment names its fields by codec

```ts
type DeletedAt = CodecField<Contract, 'pg/timestamptz-temporal@1', true>;
const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

db.Post.where(notDeleted);
db.Comment.where((c) => and(notDeleted(c), c.postId.eq(postId)));
db.Tag.where(notDeleted); // error: Tag has no deletedAt
```

`where` takes a function of the model accessor, an object with one member per field. TypeScript compares objects by their members, so a function whose parameter asks for one field accepts every model accessor that has it. All that a shared filter needs is a way to write that field's type without naming a model.

`CodecField` is that type: an expression of the given codec, the comparison methods the codec's traits allow, and the query operations registered for the codec. It is built from the same parts as the field type on the model accessor, so the set of methods is the same, and an operation a package contributes, such as `fullTextMatches`, is available on it. A fragment is rejected for a model without the field, for a field of another codec, and for a field of another nullability. The codec id must be one of the contract's codecs; a PSL `DateTime` field has the codec `pg/timestamptz-temporal@1`.

The values the methods take come from the codec, not from the field. A field on the model accessor takes its value type from the field's own output type, which can be narrower than the codec's: a PSL enum stored as text takes `'admin' | 'user'`, a `char(36)` column takes `Char<36>`, a JSON value object takes its own shape. A fragment that serves many models can only know the codec, so it takes the codec's output type, `string` in the first two cases. `(row: { kind: CodecField<Contract, 'pg/text@1'> }) => row.kind.eq('superuser')` compiles, while `db.User.where((u) => u.kind.eq('superuser'))` is refused. A filter on such a field that needs the field's own values is written on the model. A test in the client package compares every scalar field of its test contract with the matching `CodecField`, method by method, and lists exactly these differences.

The error for a refused fragment names the field. For `db.Tag.where(notDeleted)`, TypeScript reports each overload of `where`, and the first, the callback overload, ends with `Property 'deletedAt' is missing in type 'ModelAccessor<Contract, "Tag", "public">'`. TypeScript reports every overload's error only when a call has at most three overloads; with more, it reports only the last, the shorthand filter object, which does not mention the field. So `where` has exactly three overloads: the callback, a filter expression, and the shorthand filter object. A test compiles this call with the TypeScript compiler API and checks the message.

### 4. A step that changes the row is defined once per model

```ts
const summary = modelStep<Contract, 'Post'>()((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

db.Post.apply(summary);
db.Post.where({ userId }).apply(summary);
db.User.include('posts', (posts) => posts.apply(summary));
db.Comment.apply(summary);                  // error: not a Post collection
db.Post.select('id').apply(summary);        // error: the rows no longer have every Post field
```

A step that calls `select` produces a new row, so its type cannot be the caller's type. `modelStep` types the body once, against the plain collection of the model, and returns a `ModelStep<Contract, Model, Result>`: a step whose parameter is `UnnarrowedCollection<Contract, Model>`. The model name must be one model of the contract; a misspelled name or a union of names is a compile error. A model name that is a type parameter is refused too, because TypeScript cannot tell whether a type parameter is one name or a union, so `modelStep` is called with a literal model name.

`UnnarrowedCollection` states the two conditions of the decision. Its row must be assignable to the model's row, `DefaultModelRow<Contract, Model>`: the row subtyping of ADR 258 refuses a row that `select` narrowed and accepts one that `include` widened. Its type state must have `variantName: undefined`, which `variant` sets to the variant's name. A variant's row has every field of the base model, so the row alone would not refuse it; the type state does. It accepts a root or filtered collection, a custom class, a collection after `include`, an include refinement, and `this` in a custom class.

`CollectionRowOf` reads the row type off the result, so the application can name it.

The step's result has the default state. A filter or order applied before the step still runs, but it is not recorded after it, so `update` is refused after `apply(summary)` even when a `where` came first. Row-changing steps are for reading.

### 5. A field to order by, from a request

```ts
db.Post.orderBy(orderByField(db.Post, input.orderBy, input.direction, ['title', 'createdAt']));
```

`orderByField` takes a collection, a field name from the request, a direction and an allowed list. The direction is the relational core's `Direction`, `'asc'` or `'desc'`, and defaults to `'asc'`; without a list, every field that can be ordered is allowed. The allowed list is typed against `OrderableFieldName<Contract, Model>`, the fields of the model whose codec has the `order` trait, so a relation, an unknown field, or a field that cannot be ordered is a compile error in the list.

The name from the request is checked when `orderByField` is called, before the query runs. A name that is not a field of the model, a relation, a field whose codec has no `order` trait, or a name outside the allowed list throws `ORM.ARGUMENT_INVALID`, and so does a direction that `isOrderByDirection` refuses. A request value can be anything, so a name or a direction that is not a string, such as a missing query parameter, throws `ORM.ARGUMENT_INVALID` with what was received; an undefined direction takes the default. The error says why the name was refused and lists the names that are allowed, or asks for an allowed list that names an orderable field when the list is empty. It quotes the request text and cuts it to 64 characters, never inside a character; `meta` keeps it whole. The codec of the field and its traits are read with the same run-time lookup the model accessor uses, from the codec descriptors of the execution context, the run-time counterpart of the codec types that `OrderableFieldName` reads.

Both checks use the fields of the collection's model. On a collection narrowed by `variant`, a field that only the variant has cannot be named; the base model's fields can.

The selector it returns fits any collection of a model that has the allowed fields, and `orderBy` records the order, so `cursor` is allowed afterwards.

## What it costs

Measured as type instantiations, TypeScript 5.9.3, on `examples/prisma-8-demo`, an application of about 730,000 instantiations. A use is one of ten call sites in a probe: a root collection, a custom class, a filtered, ordered or included collection, an include refinement, and `this` in a class.

| Feature | Present but unused | Per use |
| --- | --- | --- |
| `apply` | +608 (+0.08%) | about 7 |
| A conditional step | none | 10,000 to 14,000 once per pair of collection types, then under 10 |
| `CodecField` row fragment | none | about 20 once, then no more than the same `where` written inline |
| `modelStep` | none | about 700 less than the same `select` and `include` written inline |
| `orderByField` | none | about 550 once, then under 20 |

The three helpers present and unused cost the application nothing: it checks with fewer instantiations than without them.

## Consequences

- **Any function is a step.** Control flow stays in the language. The query API gains no combinators.
- **A package can offer a fragment for any model.** A row fragment typed with `CodecField` needs no knowledge of the application's models. A package that introduces a kind of index can offer a step built from the index definition, and the application runs it with `apply`.
- **A shared fragment checks values more loosely than the field.** Where a field refines its codec's value, a `CodecField` fragment accepts values the field does not. Filters that depend on an enum's members are written on the model.
- **A refused row fragment is reported against each overload of `where`.** The message is long, but the first overload's part names the missing or mismatched field. `where` keeps three overloads so that this stays true.
- **A row-changing step is written against one model.** `modelStep` cannot serve two models that share fields; a filter that serves several models is a `CodecField` row fragment instead.
- **These names are public**, because applications write them and declaration output prints them: `CodecField`, `modelStep`, `ModelStep`, `UnnarrowedCollection`, `orderByField` and `OrderableFieldName`. Declaration output of an exported step names `ModelStep`, and an error for a refused collection names `UnnarrowedCollection`. The direction is the existing `Direction` of `@prisma/orm-postgres/relational-core/ast`.

## Non-goals

- **A default fragment per model.** A filter that every query of a model must apply, such as soft delete, is a separate feature. `apply` is called per query.
- **Recording a fragment's filter after a row-changing step.** `modelStep` produces the default state.
- **A field-keyed fragment type** that takes a field's own value type for enum-like fields. One fragment serving several models can only rely on the codec.

## Alternatives considered

- **A `when(value, step)` combinator** whose result keeps the caller's type, as the way to write conditional steps. It moves control flow into the query API, and every construct would need its own combinator. The subtyping rule of ADR 258 makes the plain conditional sound.
- **`where(undefined)` and `orderBy(undefined)` as no-ops**, so that a conditional filter is `posts.where(search ? (p) => ... : undefined)`. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **A plain function typed with `Pick<typeof db.Post, 'select'>`** as the row-changing step, with no helper. It is accepted wherever `modelStep` is, but each use costs about 1,800 type instantiations in the demo application, because TypeScript compares the collection's `select` method with the picked one, where a `modelStep` use saves about 700 over the same chain written inline. It also accepts a collection narrowed by `select` or `variant`, because the picked `select` does not depend on the row. A function typed with `Collection<Contract, 'Post'>` is refused on the client's root collections, whose type state names their namespace, and in include refinements; one typed with `Pick` of it is refused on the client's root collections.
- **A `fragment` builder** that declares the fields a step needs by codec and runs it with `apply`, keeping the caller's type. It works, but its result's state is not updated, and one definition costs about 10,000 instantiations for a reason not found. `CodecField` covers the same need as a plain row fragment.
- **Query fragments as objects**, as in a query language made of objects. The chain is the query language here, and an object fragment would need a second way to express every method, kept in step with the first.
