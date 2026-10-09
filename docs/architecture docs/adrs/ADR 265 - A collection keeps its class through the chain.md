# ADR 265 — A collection keeps its class through the chain

**Status:** Accepted
**Date:** 2026-09-30
**Builds on:** [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)

---

## At a glance

An application extends `Collection` with its own query methods and registers the class with the client. The methods are the application's named queries, in the way Rails scopes are. A Rails scope is any named query, and these methods match that usage; in this project's vocabulary a scope is narrower, a query fragment that only imposes conditions on the query (ADR 259):

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  withTitle(term: string) { return this.where((p) => p.title.ilike(`%${term}%`)); }
  newestFirst()           { return this.orderBy((p) => p.createdAt.desc()); }
}

const db = orm({ runtime, context, collections: { Post: PostCollection } }).public;
```

The methods are available on every collection of posts, whatever came before in the chain:

```ts
db.Post.withTitle('orm').newestFirst().limit(10).all();  // still a PostCollection, known to be filtered and ordered
db.Post.where({ userId }).withTitle('orm');              // still a PostCollection
db.Post.include('user').withTitle('orm');                // still a PostCollection; each row also has a user
db.Post.select('id', 'title').withTitle('orm');          // error: after select the rows are no longer posts

const posts = search ? db.Post.withTitle(search) : db.Post;  // a PostCollection, not known to be filtered
await posts.deleteAll();                                     // error: the collection may have no filter
```

- A method that keeps the model's rows, such as `where`, `orderBy`, `limit` or `include`, returns the collection's own class.
- What the chain has established so far, a filter, an order, extra fields on each row, is added to the type as a fact. It is never taken away, and it never replaces the class.
- When the code may or may not have applied a filter, the type says the filter is not known, and the methods that need one are refused.

## What this decision covers

This decision changes the SQL ORM client's `Collection`. The MongoDB ORM client, which ADR 175 says shares the collection interface, is unchanged: its chaining methods still return `MongoCollection<...>`. Aligning it is a later decision.

## Decision

A collection's type is its class plus what the chain has established. Every method either keeps that class and adds a fact, or produces a different row and returns the base `Collection` type.

**A chaining method has the shape of a query fragment.** A query fragment, or fragment, is a function from a collection to a collection (ADR 259). A fragment that only imposes conditions on the query is called a scope. The built-in methods, the methods of a custom class, and a fragment an application or a package writes all have the same type: a function from a receiver type `Self` to `Self` plus a fact. The facts have names, and the names are the vocabulary all three share. These are the declarations:

```ts
export type Filtered<C> = C & HasWhere;
export type Ordered<C> = C & HasOrderBy;
export type Including<C extends HasRow, Added> = C & HasRow<CollectionRowOf<C> & Added>;
export type QueryFragment<In, Out> = (collection: In) => Out;
```

`QueryFragment` places no constraint between `In` and `Out`, because a fragment written for one model may narrow the row, for example with `select`, so its output is not always a subtype of its input.

Each fact has three names. The flag `hasWhere` in the type state is set to `true` by the interface `HasWhere`, and `Filtered<C>` is `C & HasWhere`. Users write `Filtered<C>`; TypeScript prints `HasWhere` when it explains why a type does not match. `hasOrderBy`, `HasOrderBy` and `Ordered<C>` are the same fact for an order.

| Method | Returns | Class kept | What the type gains |
| --- | --- | --- | --- |
| `where` | `Filtered<Self>` | yes | a filter has been applied |
| `orderBy` | `Ordered<Self>` | yes | an order has been applied |
| `limit`, `offset`, `distinct`, `distinctOn`, `cursor` | `Self` | yes | nothing |
| `forUpdate`, `forNoKeyUpdate`, `forShare`, `forKeyShare` | `Self` | yes | nothing; the contract's capabilities decide which arguments each accepts |
| `include` | `Including<Self, { [K in Rel]: ... }>` | yes | each row has the included relation |
| `with(fn)` | whatever `fn(this)` returns | as the function | as the function |
| `select` | `Collection<Contract, Model, NarrowedRow, State>` | no | a different row |
| `variant` | `Collection<Contract, Model, VariantRow, VariantState>` | no | a different row and a different type argument |

`with` is the principle made explicit: it calls a function with the receiver and returns the result. A condition on one row that needs no declared fields is `where(rowFragment)`. `with` runs a fragment: either a scope, which applies the same condition to every model with the fields it declares, or one that does what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant. A class method `withTitle(term) { return this.where(...) }` has the type `Filtered<this>`; the same query as a fragment is `(posts: PostCollection) => Filtered<PostCollection>`, and `db.Post.with((posts) => posts.where(...))` has the same type as `db.Post.withTitle(term)`. A class method is a named fragment, and one that only filters, such as `withTitle`, is a named scope. `with` accepts any function, including one that ends in a terminal such as `first()`; when the function returns a collection, it is a fragment.

The facts live in two declared properties on the class, the **type state** and the **row**:

- The type state holds the flags `hasWhere` and `hasOrderBy`. A flag that has not been established is `boolean`, meaning not known; a method that establishes it sets it to `true`. The same object also holds `variantName` and `nsId`, which are not facts: they are fixed by the collection's type argument and select the model accessor.
- The row records the shape of the rows the collection produces, including the relations and values `include` adds.

The methods that depend on a fact read it from the receiver. `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount` require `hasWhere`; `cursor` and `distinctOn` require `hasOrderBy`.

What this decision does not cover is described under "Later decisions".

## Why the facts are added to the receiver's type, not carried in a type argument

A base class method can return "whatever type I was called on" in two ways: the polymorphic `this` type, or a type parameter inferred from a `this` parameter, `where<Self>(this: Self, ...): Filtered<Self>`. Neither can return the receiver's type with one of the class's type arguments changed. So if the type state were a type argument, `where` could return the class or the new state, but not both.

What a method can do is intersect. `Filtered<Self>` is the receiver's type plus one property. That works because a fact only ever goes from not known to known: `{ hasWhere: boolean } & { hasWhere: true }` is `{ hasWhere: true }`. Establishing the same fact twice changes nothing, since `Filtered<Filtered<C>>` is `Filtered<C>`. The same holds for the row when `include` widens it: `HasRow<Row> & HasRow<Row & Included>` has the widened row.

Narrowing the row is not monotonic. `select('id')` removes fields, and an intersection cannot remove anything. That is why `select` returns the base `Collection` type. It is also the right outcome: a method written against the model's row is not safe to call on a collection that produces something else.

`variant` drops the class for a different reason. Its row, the variant's fields plus a narrowed discriminator, is a subtype of the model's row, so an intersection could hold it. But `variant` also changes `variantName` in the type state, and `where`, `orderBy` and the other methods read `variantName` and `nsId` from the class's type argument to build the model accessor their callbacks receive. A changed type argument means a different instantiation of the base class, which the receiver's class cannot express. `variant` therefore returns the base `Collection` type with the new type argument. `variant` adds a filter on the discriminator at run time, so it records `hasWhere: true` in that argument, which is a true fact.

The receiver is captured with a `this` parameter rather than the polymorphic `this` type for one reason: inside an include refinement the collection is an `Omit` of `Collection`, and `Omit` fixes the polymorphic `this` of every method to the base `Collection` type, so a chain inside a refinement would lose what `include` had added. A `this` parameter is inferred from the actual receiver, whatever it is. It also lets `where`, `include` and `select` accept a union of differently flagged collections, since `Self` is inferred as the union.

## Why a filtered collection is a subtype of an unfiltered one

Because the type state is a declared property, it takes part in assignability, in one direction. `true` is assignable to `boolean`; `boolean` is not assignable to `true`. So `Filtered<PostCollection>` is assignable to `PostCollection`, and not the reverse.

Two things follow.

**Conditionals are sound.** TypeScript types `search ? db.Post.withTitle(search) : db.Post` as the union of the two branches, then removes any member that is a subtype of another. The filtered branch is removed and the type is `PostCollection`, with the filter not known. `deleteAll` is refused. The same reduction happens for an `if` with an early return, a `switch`, a loop that may run zero times, and `let posts = db.Post; if (search) posts = posts.withTitle(search)`. A function whose every return path filters yields `Filtered<PostCollection>`, and `deleteAll` is allowed on it, which is correct.

**Functions accept what they should.** A function declared with the parameter `posts: PostCollection` accepts a filtered or ordered `PostCollection`. A function declared with `posts: Filtered<PostCollection>` refuses one that may have no filter.

This is why a flag that has not been established is `boolean` rather than `false`. With `false`, `{ hasWhere: true }` and `{ hasWhere: false }` are unrelated types. Every conditional would then keep a union, reassigning a `let` would fail, and a filtered collection would be refused where the class is expected.

## How it works

The two properties are keyed by unique symbols. They sit on the collection next to its methods, the methods of a custom class and the aggregate reducer members, which all have string names, so a symbol key cannot collide with any of them, and dot completion does not list them. These are the declarations, from `collection-types.ts`:

```ts
export declare const RowType: unique symbol;
export declare const TypeState: unique symbol;

export interface HasRow<Row = unknown> {
  readonly [RowType]: Row;
}

export interface HasTypeState<State = CollectionTypeState> {
  readonly [TypeState]: State;
}

export interface HasWhere extends HasTypeState<{ readonly hasWhere: true }> {}
export interface HasOrderBy extends HasTypeState<{ readonly hasOrderBy: true }> {}

export type CollectionTypeStateOf<C extends HasTypeState> = C[typeof TypeState];

export type CollectionRowOf<C extends HasRow> =
  C[typeof RowType] extends infer Row extends C[typeof RowType]
    ? { [K in keyof Row]: Row[K] }
    : never;
```

The base class declares both properties. This outline of its signatures is abridged: parameter lists and the long relation-value type are cut, every name in it is real.

```ts
class CollectionBase<TContract, ModelName, Row, State> {
  declare readonly [TypeState]: State;
  declare readonly [RowType]: Row;
  declare readonly _row?: CollectionRowOf<this>;

  where<Self>(this: Self, filters: ShorthandWhereFilter<...>): Filtered<Self>;
  orderBy<Self>(this: Self, selection: ...): Ordered<Self>;
  limit<Self>(this: Self, n: number): Self;
  include<RelName extends ..., ..., Self extends HasRow = never>(
    this: Self,
    relationName: RelName,
  ): Including<Self, { [K in RelName]: IncludeRelationValue<...> }>;
  with<Self, Out>(this: Self, fn: (collection: Self) => Out): Out;

  select<Fields extends ..., S extends CollectionTypeState = State, R = Row>(
    this: HasTypeState<S> & HasRow<R>,
    ...fields: Fields
  ): Collection<TContract, ModelName, SimplifyDeep<Pick<...> & IncludedRelationsForRow<TContract, ModelName, R>>, S>;

  first<Self extends this>(this: Self): Promise<CollectionRowOf<Self> | null>;
  first(filter: WhereInput<...>): Promise<CollectionRowOf<this> | null>;
  update<Self extends HasWhere>(this: Self, data: MutationUpdateInput<...>): Promise<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>> | null>;
  deleteAll<Self extends HasWhere>(this: Self): AsyncIterableResult<CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>>;
  cursor<Self extends HasOrderBy>(this: Self, cursorValues: Partial<...>): Self;
}
```

The public `Collection` type is `CollectionBase` intersected with one reducer member per aggregate operation the contract declares. `CollectionBase` is internal to the package. Hovers, declaration output and the headline type of an error message use the alias forms: `Collection<...>`, `Filtered<...>`, `Ordered<...>`, `CollectionRowOf<...>`. An elaboration line under an error message can still name `CollectionBase`, when TypeScript explains a mismatch by comparing the class itself, for example when a plain chain is assigned to an annotation it does not match.

- `HasWhere` and `HasOrderBy` are named interfaces rather than inline object types, so that every `where` produces the same type, duplicates collapse, and error messages print the name.
- `Including` takes the fields it adds, not a relation name, so that it does not have to look up the model behind its receiver. `include` passes `{ [K in RelName]: IncludeRelationValue<...> }`, the included relation's row.
- The `= never` default on `include`'s `Self` is what an explicit type argument meets: with `include<'user'>` the type parameter `Self` is not inferred, so it is `never`. In a call that is an error, because the receiver is not assignable to `never`; in `ReturnType<typeof posts.include<'user'>>` the result is `never`.
- Declaration output must print the row and the state by the alias names. Inside a custom class, `this.all()` has a type that mentions the class's own `this`, and TypeScript writes it into the class's declaration as `CollectionRowOf<this>` or `CollectionTypeStateOf<this>`. If it wrote `this[typeof RowType]` instead, the declaration would name the `RowType` symbol, which a consumer of the published facade cannot reach, and declaration emit would fail with TS2527 ("references an inaccessible 'unique symbol' type"). `CollectionTypeStateOf` is an indexed access, which TypeScript keeps by name. `CollectionRowOf` flattens the row, and it does so with a type of its own: an alias of another flattening helper would be printed as that helper, expanded, and would name the symbol. A test in `examples/prisma-8-demo` emits the declaration of a library of such classes through the facade and typechecks a consumer of it that asserts the exact row and collection types.
- Every method that returns rows reads them from the receiver it is called on. Inside a class method, `this.include('author')` has the type `this & HasRow<...>`, and a signature that names only the polymorphic `this` reads the class's row from it and loses `author`. So `all`, `first`, `create`, `createAll` and `upsert` take `this: Self` with `Self extends this` and return `CollectionRowOf<Self>`, the row the chain built. Each ends with the overloads it had before, returning `CollectionRowOf<this>`; `ReturnType`, `Parameters` and `infer` patterns read those, so `Awaited<ReturnType<typeof posts.first>>` is the row, and the same calls are refused, such as `first(undefined)`. The writes take `this: Self` with `Self extends HasWhere`, for the guard, and return `CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>`. In a call, `Self` is the receiver, with every relation `include` added, and the polymorphic `this` is the receiver or, inside a class body, the class's `this`; either way the intersection is the receiver's row. `ReturnType` replaces `Self` with its constraint, `HasWhere`, and `this` with the type the method is read from, so `Awaited<ReturnType<PostCollection['update']>>` is the Post row or `null`, and on a collection after `include` it has the relation. Each other form breaks something. `CollectionRowOf<Self & HasRow>` gives `ReturnType` an empty object type. `CollectionRowOf<Self & HasRow<Row>>`, with the class's row type argument, makes declaration output write out a custom class's row in full, so a consumer of the declaration gets a different row type when the row has `Temporal` fields, and its `ReturnType` after `include` misses the relation. `CollectionRowOf<this & Self>` made TypeScript stop with TS2589 ("Type instantiation is excessively deep") on a receiver that is an `Omit` of a collection type, and `Self extends this` would refuse such a receiver. Because the signature mentions `this`, TypeScript instantiates it again for every receiver type; the cost below includes this. The `prepared` getter cannot take a `this` parameter: inside a class method, `this.include(...).prepared` describes the class's row. `combine` and include refinements read rows with `CollectionRowOf` too. The row property after two includes is an intersection, `Row & { author } & { comments }`; `CollectionRowOf` turns it into one object when it is read, so rows print and compare as plain objects. The pieces share no keys, so the flatten is shallow and changes no property type. `CollectionRowOf` maps over a type it infers, so a row that is a union of variants is flattened member by member. The inferred type is constrained to the row property, so where the receiver is generic, such as `this` inside a class method or a type parameter, the row's fields can still be read.
- The class also declares `_row`, which predates this decision. `ResultType<P>` in `framework-components` reads `_row` from the plans and collections of every database family, and the framework cannot name a symbol that the SQL client declares, so `[RowType]` cannot replace it. `_row` is defined as `CollectionRowOf<this>`, so the two cannot disagree.
- At run time each chained collection is built with `this.constructor`, so the object is an instance of the receiver's class, as its type says.

**Guards.** All eight guarded methods use one form: a `this` parameter whose type parameter is constrained to the fact. `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll` and `deleteAndCount` take `this: Self` with `Self extends HasWhere`; `cursor` and `distinctOn` take `this: Self` with `Self extends HasOrderBy`. When the fact is missing, the error is on the receiver and names the fact: "The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasWhere'".

**Refusals.** `fragment` (ADR 259) refuses a receiver that has a fact, which a constraint cannot express: an unfiltered collection's state has `hasWhere: boolean`, and `true` is a subtype of `boolean`, so any constraint that accepts the unfiltered state also accepts the filtered one. A refusal therefore uses a second form: the `this` parameter is intersected with a conditional type, `RootCollectionOnly<Self, NsId>`, that resolves to an interface with one property naming the reason, `FragmentNeedsRootCollection`, when the receiver has the fact, and to `unknown` otherwise. The error is on the receiver: "Property 'fragmentNeedsRootCollection' is missing in type 'PostCollection & HasWhere'". A later refusal uses this form. It has two limits. Facts record what is known to be present, so a receiver without a fact in its type, such as a union with an unfiltered collection, is not refused. A receiver typed by a type parameter, such as `this` in a class method, leaves the conditional unresolved, so TypeScript refuses the call with an error that names the conditional type; a negative type test holds that behaviour.

The requirement is about the receiver, so the receiver is where it is checked: no argument type changes with the state, and a cast on an argument cannot bypass it. The constraint keeps `Self` inferred as the whole receiver type, so `cursor` and `distinctOn` return the receiver with every fact it has. The writes return `CollectionRowOf<Self & HasRow<CollectionRowOf<this>>>`, the receiver's row.

**Methods that narrow the row.** A signature that mentions the polymorphic `this` is instantiated again for every receiver type, and `select` and `variant` have large signatures. `select` infers the state and the row from its `this` parameter, which is instantiated once per receiver type, so `select` after `include` keeps the included relations. `variant` infers the state the same way. Each also carries an overload without the `this` parameter, for a receiver whose state is not one type, such as a union of differently flagged collections. That overload returns the root state, which refuses writes and `cursor`, so it is sound. It also uses the model's own row, so on such a receiver the included relations are missing from the type after `select`, although the rows still have them.

**Cost.** Measured as type instantiations, TypeScript 5.9.3, with `pnpm typecheck --extendedDiagnostics` after a fresh build, on `examples/prisma-8-demo`, an application with four custom collection classes, and on the client package. Both are measured on the files that existed before this decision; the test files it adds bring the application to 731,568 and the client package to 1,453,429.

| | Whole application | Per use |
| --- | --- | --- |
| The properties, `this`-typed methods and rows read through `this` | −5.7% on the application (744,614 to 702,050), −10.6% on the client package (1,512,211 to 1,352,255) | a ten-call chain, about 60 to 160; the same on a custom class |
| A conditional between two collections | none | 10,000 to 14,000 once per pair of collection types, then under 10 |

The cost stays low because `include` adds one small property to its receiver instead of building a new collection type from a deep simplification of the whole row, and because no chaining signature is rebuilt per receiver type.

A conditional makes TypeScript compare the two branch types. It caches the comparison per pair of types, so the cost grows with the number of distinct collection types that appear in conditionals, not with the number of conditionals.

## Consequences

- **Class methods chain**, before and after the built-in methods, and after `include`.
- **Inside a class body, a class method called on the result of another call loses that call's facts.** In `latest() { return this.withTitle('orm').newestFirst(); }`, `newestFirst()` returns `Ordered<this>`, and `Filtered` is lost; `this.include('user').withTitle('orm')` loses `user`. TypeScript resolves a method's polymorphic `this` on an intersection that contains the class's own `this` as the class's `this` alone. The `prepared` getter has the same limit: inside a class body, `this.include('user').prepared` describes the class's row without `user`. Built-in methods are not affected, because they infer their receiver. A chain of class methods written outside the class keeps every fact. But a class method whose body chains two class methods loses the first call's facts for every caller: with `latest()` above, `db.Post.latest()` is `Ordered<PostCollection>`, not `Filtered<Ordered<PostCollection>>`. Losing a fact refuses more calls, never fewer. Inside a class body, chain the built-in methods after a class method, or call one class method per expression.
- **A built-in method, a class method and a fragment are one typed thing.** A query shared between places is written once as a fragment and run with `with`, or wrapped in a class method; both give the same type. A package can supply fragments without any knowledge of the application's classes.
- **Conditional queries are sound.** A ternary, an `if`, a loop or a reassigned `let` never unlocks a write or `cursor` on a collection that may lack the filter or order.
- **After `select` or `variant`, class methods are gone.** After `select` the rows are no longer the model's; after `variant` the type argument is a different one.
- **A conditional between two differently flagged collections keeps a union.** `flag ? db.Post.withTitle('orm') : db.Post.newestFirst()` is `Filtered<PostCollection> | Ordered<PostCollection>`. Reads, `select`, `include` and class methods work on it; writes and `cursor` are refused, and `select` on it drops included relations from the type. A write on it fails with "The 'this' context of type 'Ordered<PostCollection> | Filtered<PostCollection>' is not assignable to method's 'this' of type 'HasWhere'", because one branch has no filter; filter both branches, or annotate the result as `PostCollection`, which reduces the union and states that the filter is not known.
- **Chains print with the fact names.** A chain on the base type prints as `Ordered<Filtered<Collection<Contract, "Post", ...>>>`, and one on a custom class as `Ordered<Filtered<PostCollection>>`.
- **These names are part of the public surface**, because fragment authors write them and declaration output needs them for any library that exports a collection class: `QueryFragment`, `Filtered`, `Ordered`, `Including`, `HasWhere`, `HasOrderBy`, `HasRow`, `HasTypeState`, `TypeState`, `RowType`, `CollectionTypeStateOf`, `CollectionRowOf`, `AggregateIncludeReducers`, `AggregateSelector` and `IncludeScalar`.
- **Declarations name the family package.** The declaration of an exported collection class, or of an exported chain, imports these names from `@prisma/orm-family-sql/orm-client`, the package the facade re-exports, not from the facade the application depends on. Under pnpm that package does not resolve from the application, and with `skipLibCheck` the consumer of the declaration silently gets `any`. This predates the decision: the same specifier appears for exported chains without it. It is a separate fix in how the facades publish their types.
- **The state and the row are read with `CollectionTypeStateOf<C>` and `CollectionRowOf<C>`**, not by extracting a type argument of `Collection`. The type arguments hold what the collection started with, and the filter fact that `variant` writes into its new type argument; every other fact is in the intersection.
- **`ReturnType` of a chaining method does not give a collection**, because `ReturnType` of a generic method uses the type parameter's constraint: `ReturnType<C['where']>` is `HasWhere`, and `ReturnType<C['limit']>` is `unknown`. Write `Filtered<C>` or `Ordered<C>`, or `C` for the methods that add nothing.
- **`include`, `distinct` and `distinctOn` take no explicit type arguments.** Each gained the type parameter `Self`, and TypeScript infers no type parameter once any is given explicitly. `posts.include<'user'>('user')` does not compile, and `ReturnType<typeof posts.include<'user'>>` is `never`. `posts.distinct<['title']>('title')` fails with TS2558 ("Expected 2 type arguments, but got 1"). The arguments give every type parameter, so `posts.distinct('title')` needs none.
- **`with` is a member of every collection.** A custom class cannot declare its own `with` with another signature, and an aggregate operation cannot be named `with`.

## Later decisions

**The class of a related model inside an include refinement.** In `db.User.include('posts', (posts) => posts.withTitle('orm'))`, the collection given to the callback is the base `Collection` type, not `PostCollection`. Giving it the class needs the parent's type to know which class is registered for `Post`. That is known once, at `orm({ collections })`, and would have to reach every collection type: as a type argument threaded through `Collection` and the refinement types, or as a declared property the client attaches to each root collection and the `this`-typed methods pass on. It cannot work inside a class body, because a class cannot name a registry that contains itself. It changes the shared collection interface for every family and is a decision of its own.

**The class through `variant`.** Keeping the class after `variant` needs `variantName` and `nsId` to move from the class's type argument into the declared type state, so that `where`, `orderBy` and the other methods read them from the receiver.

**The MongoDB ORM client.** Its collection keeps the type it had. Extracting the ADR 175 shared interface would need it to adopt the `this`-typed chaining, the symbol-keyed state and row, and the `boolean` flags.

**A run-time guard on `deleteAll` and `updateAll`.** The type guard has no run-time counterpart. A JavaScript caller, or a TypeScript caller that casts, can call them on a collection with no filter; the statement then has no `WHERE` and affects every row. Whether to refuse that at run time is a separate decision.

## Alternatives considered

- **The type state as a type argument, with every method returning `Collection<TContract, Model, Row, NewState>`.** A method can return the new state or the receiver's class, not both, so the class is lost after one call. And because the state then appears only in method parameter types, which TypeScript compares in both directions, a filtered and an unfiltered collection are assignable to each other; a conditional between them keeps whichever member TypeScript met first, and `deleteAll` can compile on a collection that may have no filter.
- **A flag that has not been established is `false`.** The filtered and unfiltered types become unrelated. Every conditional keeps a union, reassigning a `let` fails, and a filtered collection is refused where the class is expected.
- **A `when(value, fn)` method** whose result keeps the caller's type, as the way to write a conditional without a union. It moves control flow into the query API, and each construct an application might use would need its own method. Subtyping covers every construct with one rule.
- **`where(undefined)` as a no-op** for conditional filters. It adds an overload to every `where` and `orderBy`, costs about 7.5% more type checking in the client package when unused, and covers only those two methods.
- **Reading the state as `CollectionTypeStateOf<this>` in the row-changing signatures.** Correct, and about four percent more type checking on the demo application, because each such signature is rebuilt per receiver type. Inferring the state from a `this` parameter gives the same result at no cost.
- **`include` returns the base `Collection` type.** The class is lost after every include, although the rows are still the model's. The row property makes widening monotonic, so the class can survive by the same rule as the flags.
- **Exporting the class behind `Collection` under its own name.** Declaration output does not need it: chains print and emit as `Filtered<Collection<...>>`, because the guards and chaining methods use the named aliases. A second public name for the same class would only add a name users have to learn.
