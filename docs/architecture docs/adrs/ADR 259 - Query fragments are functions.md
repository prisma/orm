# ADR 259 — Query fragments are functions

**Status:** Proposed
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

A query is a chain of calls, so a piece of a query that is shared between places is a step. This decision adds three small helpers for the pieces applications share most: a filter that fits any model with a given field, a shared `select` and `include`, and a sort field taken from a request.

## Decision

A **query fragment** is a function. A fragment of a row is a function from the row accessor to an expression, and `where` and `orderBy` take it. A fragment of a query is a function from a collection to a collection, and a collection's `apply` method runs it.

1. **A collection fragment is a step, run with `apply`** (ADR 258). The step receives the caller's exact type, including a custom collection class, and the result is whatever the step returns.
2. **The query API has no control-flow methods.** Whatever the application would write in a function body, it writes inside the step. The type stays sound because a filtered collection is a subtype of an unfiltered one, so a step that may or may not filter yields the unfiltered type (ADR 258).
3. **A field type is named by its codec.** `FieldExpression<Contract, CodecId, Nullable>` is the type of any row field with that codec and nullability, with the same comparison methods and operations as the field on a model. A row fragment typed with it fits every model that has such a field.
4. **A step that changes the row is defined once per model.** `rowFragment<Contract, Model>()(body)` types the body against the plain collection of that model and returns a step that takes any collection of that model whose rows still have every field of the model. `CollectionRowOf` (ADR 258) names the row the step produces.
5. **A sort field from a string is checked at run time.** `sortField(collection, name, direction, allowed)` returns an `orderBy` selector. The allowed list may name only fields whose codec can be ordered. A name outside it throws before the query runs.

## Why a fragment is a function

A query is a chain of method calls on a collection. Each call returns a collection whose type records what is known: the rows it produces, whether it has a filter, whether it has an order. That record is how the client refuses `deleteAll` on a collection with no filter and `cursor` on a collection with no order.

Applications share parts of queries. The same filter for deleted rows belongs on every query of a model. The same conditional filters are built from every list request. The same `select` and `include` serve every endpoint that returns a summary. In a query language made of objects these are objects, spread into each query. In a query language made of calls they are functions, applied to each collection.

A function can be applied with no support from the collection at all: `notDeleted(db.Post)`. `apply` exists so that a fragment reads in the same order as the rest of the chain, and so that it can sit in the middle of one.

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
type DeletedAt = FieldExpression<Contract, 'pg/timestamptz@1', true>;
const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

db.Post.where(notDeleted);
db.Comment.where((c) => and(notDeleted(c), c.postId.eq(postId)));
db.Tag.where(notDeleted); // error: Tag has no deletedAt
```

`where` takes a function of the row accessor, an object with one member per field. TypeScript compares objects by their members, so a function whose parameter asks for one field accepts every row accessor that has it. All that a shared filter needs is a way to write that field's type without naming a model.

`FieldExpression` is that type: an expression of the given codec, the comparison methods the codec's traits allow, and the query operations registered for the codec. It is built from the same parts as the field type on a model's row accessor, so the two are assignable to each other in both directions, and an operation a package contributes, such as `fullTextMatches`, is available on it. A fragment is rejected for a model without the field, for a field of another codec, and for a field of another nullability.

### 4. A step that changes the row is defined once per model

```ts
const summary = rowFragment<Contract, 'Post'>()((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;

db.Post.apply(summary);
db.Post.where({ userId }).apply(summary);
db.User.include('posts', (posts) => posts.apply(summary));
db.Comment.apply(summary);                  // error: not a Post collection
db.Post.select('id').apply(summary);        // error: the rows no longer have every Post field
```

A step that calls `select` produces a new row, so its type cannot be the caller's type. `rowFragment` types the body once, against the plain collection of the model, and returns a step that accepts any collection of that model whose row is the model's full row or wider: a root or filtered collection, a collection after `include`, an include refinement, `this` in a custom class.

It refuses a collection whose row was narrowed by `select` or `variant`. The body was typed against the full row, so on a narrowed collection its result would claim fields the query does not return: `(posts) => posts.include('user')` applied after `select('id')` would be typed with every field of a post. The rule is the row subtyping of ADR 258: a narrowed row is not assignable to the full row, a widened one is. On a widened collection the result can omit relations the caller included, which refuses more and never claims more.

`CollectionRowOf` reads the row type off the result, so the application can name it.

The step's result has the default state. A filter or order applied before the step is not recorded after it, so `update` is refused after `apply(summary)` even when a `where` came first. Row-changing steps are for reading.

### 5. A sort field from a request

```ts
db.Post.orderBy(sortField(db.Post, input.sort, input.direction, ['title', 'createdAt']));
```

`sortField` takes a collection, a field name from the request, a direction and an allowed list. The allowed list is typed against the fields of the model whose codec has the `order` trait, so a relation, an unknown field, or a field that cannot be ordered is a compile error in the list. The name from the request is checked at run time against the allowed list and the model, and `ORM.ARGUMENT_INVALID` is thrown for a name that is not allowed. The selector it returns fits any collection of a model that has the allowed fields, and `orderBy` records the order, so `cursor` is allowed afterwards.

## What it costs

Measured as type instantiations on an application of about 750,000 instantiations.

| Feature | Present but unused | Per use |
| --- | --- | --- |
| `apply` | +608 (+0.08%) | about 7 |
| A conditional step | none | 10,000 to 14,000 once per pair of collection types, then under 10 |
| `FieldExpression` row fragment | none | about 350 once, then under 3 |
| `rowFragment` | none | less than the same `select` and `include` written inline |
| `sortField` | none | about 1,250 once, then about 100 |

## Consequences

- **Any function is a step.** Control flow stays in the language. The query API gains no combinators.
- **A package can offer a fragment for any model.** A row fragment typed with `FieldExpression` needs no knowledge of the application's models. A package that introduces a kind of index can offer a step built from the index definition, and the application runs it with `apply`.
- **The error for a missing field names the wrong overload.** `db.Tag.where(notDeleted)` fails, but the message reports the shorthand filter overload of `where` rather than the missing field.

## Non-goals

- **A default fragment per model.** A filter that every query of a model must apply, such as soft delete, is a separate feature. `apply` is applied per query.
- **Recording a fragment's filter after a row-changing step.** `rowFragment` produces the default state.

## Alternatives considered

- **A `when(value, step)` combinator** whose result keeps the caller's type, as the way to write conditional steps. It moves control flow into the query API, and every construct would need its own combinator. The subtyping rule of ADR 258 makes the plain conditional sound.
- **`where(undefined)` and `orderBy(undefined)` as no-ops**, so that a conditional filter is `posts.where(search ? (p) => ... : undefined)`. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **A `fragment` builder** that declares the fields a step needs by codec and runs it with `apply`, keeping the caller's type. It works, but its result's state is not updated, and one definition costs about 10,000 instantiations for a reason not found. `FieldExpression` covers the same need as a plain function of the row.
- **Query fragments as objects**, as in a query language made of objects. The chain is the query language here, and an object fragment would need a second way to express every method, kept in step with the first.
