# ADR 272 — Packages contribute collection methods computed from a model

**Status:** Accepted
**Date:** 2026-10-13
**Builds on:** [ADR 270 — ORM queries use the query builder's functions and a model's indexes](ADR%20270%20-%20ORM%20queries%20use%20the%20query%20builder's%20functions%20and%20a%20model's%20indexes.md), [ADR 265 — A collection keeps its class through the chain](ADR%20265%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 259 — Query fragments are functions](ADR%20259%20-%20Query%20fragments%20are%20functions.md), [ADR 210 — Index-type registry](ADR%20210%20-%20Index-type%20registry.md)

---

## At a glance

A schema declares a full-text index over a post's title and body, and a vector field:

```prisma
types {
  Embedding1536 = pgvector.Vector(1536)
}

model Post {
  id        Int            @id
  userId    Int
  title     String
  body      String?
  pinned    Boolean        @default(false)
  embedding Embedding1536?

  @@fullTextIndex([title, body], name: "post_search")
}
```

With no code of its own, the application can search posts by text or by similarity:

```ts
await db.orm.public.Post.using.post_search(websearchToTsquery('zebra crossing')).limit(10).all();
await db.orm.public.Post.where({ userId }).using.embedding_nearest(queryVector).limit(5).all();
```

The first call runs:

```sql
SELECT … FROM "post"
WHERE <search document> @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank(<search document>, websearch_to_tsquery('english', $1)) DESC
LIMIT 10
```

`<search document>` is the expression the index was built over, the title weighted A and the body weighted B, so Postgres uses the index.

Neither method is written by the application or declared in the schema. The Postgres package supplies `post_search`, because it knows how to search a full-text index. The pgvector package supplies `embedding_nearest`, because it knows how to search a vector field. Each package reads the model and decides which methods it offers and what to call them.

## Decision

A package can contribute collection methods to the SQL ORM client. For each model, the package reads the model's definition in the contract and returns a set of named methods. The ORM client offers them on every collection of that model, under the member `using`. The application writes no code and no type arguments to get them.

## Why packages contribute methods

A **collection** is what the ORM client gives the application for each model: `db.orm.public.Post` is the collection of posts. Collection methods such as `where`, `orderBy` and `limit` each return a collection, so they chain. An application can add its own methods by writing a custom collection class.

ADR 270 lets a query name one of the model's indexes, so a search matches the index exactly:

```ts
db.orm.public.Post
  .where((post, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
  .orderBy((post, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc());
```

Without contributed methods, every application that searches writes these two lines, usually as a method of its custom collection class. Nothing in them belongs to the application: given a full-text index, the query is always "match, then rank by relevance". The package that defines full-text indexes knows that query, so it should write it once, for every model that has such an index.

## A contribution

A package supplies its methods as a **contribution**, which has a run-time half and a type half. The pgvector one, as shipped:

```ts
export const pgvectorNearestMethods: CollectionMethodContribution = {
  id: 'pgvector/nearest' satisfies CollectionMethodContributionId,
  methodsFor: (model) =>
    Object.fromEntries(
      Object.entries(model.fields).flatMap(([name, field]) =>
        !field.many && field.type.kind === 'scalar' && field.type.codecId === VECTOR_CODEC_ID
          ? [[`${name}_nearest`, nearestMethod(name)]]
          : [],
      ),
    ),
};

function nearestMethod(field: string): CollectionMethodBody {
  return (collection, ...args) => {
    const [vector, maxDistance] = blindCast<readonly [readonly number[], number | undefined], '…'>(args);
    let shared: Distance | undefined;
    const distance = (model: unknown): Distance => {
      shared ??= distanceTo(model, field, vector);
      return shared;
    };
    const ordered = collection.orderBy((model) => distance(model).asc());
    return maxDistance === undefined
      ? ordered
      : ordered.where((model) => distance(model).lt(maxDistance));
  };
}
```

```ts
type NearestMethodTable<Model extends CollectionMethodModelType> = {
  readonly [Name in VectorFieldNames<Model['fields']> & string as `${Name}_nearest`]: {
    readonly parameters: readonly [
      vector: Vector<VectorLength<Model['fields'][Name & keyof Model['fields']]>>,
      maxDistance?: number,
    ];
    readonly filters: false;
    readonly orders: true;
  };
};

export interface PgvectorNearestMethods extends CollectionMethodContributionType {
  readonly methods: NearestMethodTable<this['model']>;
}
```

- **The run-time half**, a `CollectionMethodContribution`, has an id and a function, `methodsFor`, that receives one model (a `CollectionMethodModel`) and returns its methods by name. Each method receives the collection and the caller's arguments, and returns the collection with a `where`, an `orderBy` or both added. Their callbacks receive the ORM's model accessor, whose fields have their query operations (pgvector's method calls `cosineDistance` on the vector field), and ADR 270's `fns` and `indexes`.
- **The type half**, a `CollectionMethodContributionType`, computes the same table for the type checker from the model's type (a `CollectionMethodModelType`): for each method name, its parameter list and whether it adds a filter and an order. Here the vector parameter's type carries the field's vector length: a `Vector<N>` branded with another length is a compile error, and a plain `number[]`, whose length the type checker cannot know, is checked at run time, when the value is encoded.

A method's result has `Filtered` and `Ordered` (ADR 265) only as its type half declares. A nearest-neighbour search filters only when `maxDistance` is given, so it declares no filter, and `db.orm.public.Post.using.embedding_nearest(v).deleteAll()` does not compile: without a filter it would delete every post. A full-text search always filters and orders, so it declares both.

A method returns the collection it was called on, not a new kind of object. So it chains before and after other methods, works inside an `include`, inside a query fragment (ADR 259), and on `this` in a custom collection class, and a custom class stays that class (ADR 265).

## What a contribution reads

A contribution reads one model at a time: the contract's database target, the model's name, its fields with their types, its relations, and the table it is stored in, with that table's columns and indexes. It does not read other models.

The cases a package serves need different parts of a model:

| Case | Reads |
| --- | --- |
| Postgres full-text search | The table's full-text indexes, with their fields, weights and language |
| pgvector nearest neighbour | A field whose type is a vector, and the vector's length |
| A feature of the whole table, such as reading a system-versioned table as of a past time | A table option the package introduces |

One model is enough for all of them, and it keeps the type checker's work proportional to each model on its own. The target is there because the type registry is global to a program (see below): a contribution whose methods only make sense on one database target checks the target in its type half, as the Postgres full-text one does, so a SQLite contract in the same program gets no Postgres methods.

A field already has its own query operations, such as `cosineDistance` on a vector. A contributed method adds what a field operation cannot: a filter and an order together, built from settings the contract holds, such as an index's weights, so the query matches the index.

## The package names its methods

The ORM imposes no naming rule. Only the package knows what a method does, so it chooses the name. The packages in this repository name a method after the schema element it serves: the full-text method after its index (`post_search`), the vector method after its field (`embedding_nearest`). Readers can then predict the name from the schema, and the schema author controls it: naming an index names its method.

A method for a feature of the whole table has no element to name it after. The package simply picks a name, such as `as_of`.

The schema declares no methods. A package works its methods out from what the contract already holds.

## Methods appear under `using`

Contributed methods sit under one member, `using`, on every collection: `db.orm.public.Post.using.post_search(q)`. The name reads as plain English ("posts, using `post_search`") and echoes SQL's `USING` for an index's access method. `using` is also a TypeScript keyword since 5.2, for declarations that dispose of a resource (`using conn = …`). That keyword only starts a declaration; as a property name after a dot it is an ordinary identifier, so `db.orm.public.Post.using` neither conflicts with it nor changes its meaning.

Keeping them under `using` means a contributed name can never collide with a collection method or with a method of a custom collection class, whatever either side adds later. It also keeps the cost to the type checker low, because the methods are computed in one place instead of being merged into every collection type.

## How the types reach the application

The application creates its client as usual and passes the packages it uses:

```ts
import pgvector from '@prisma/orm-extension-pgvector/runtime';

const db = postgres({ contract, extensions: [pgvector] });
```

The type half reaches the type checker through that import. Relational core (`@internal/sql-relational-core/collection-methods`, published as `@prisma/orm-family-sql/relational-core/collection-methods`) defines an interface, `CollectionMethodRegistry`, and each package adds its type half to it with TypeScript's declaration merging:

```ts
declare module '@internal/sql-relational-core/collection-methods' {
  interface CollectionMethodRegistry {
    readonly 'pgvector/nearest': PgvectorNearestMethods;
  }
}
```

A package outside this repository augments the published name, `@prisma/orm-family-sql/relational-core/collection-methods`. The shell build rewrites the internal name to the published one in this repository's own packages.

For each model, the ORM's types read every registered type half, compute its method table for that model, and merge the tables into `using`.

An entry point loads a registration only if its declaration file refers to the type half. So each entry point that should load one type-exports the type half (`export type { PgvectorNearestMethods } from …`). A value import of the run-time half is not enough: declaration output drops it.

The emitted `contract.d.ts` never loads a registration. The contract's types describe the contract's data; they must not carry the types of one query interface, because the ORM client is interchangeable. These published entry points load one:

| Registration | Entry points |
| --- | --- |
| Postgres full-text | `@prisma/orm-postgres/runtime`, `/serverless`, `/target/full-text`, `/target/runtime`; `@prisma/orm-target-postgres/target`, `/target/full-text`, `/target/runtime` |
| pgvector nearest neighbour | `@prisma/orm-extension-pgvector/runtime` |

The registry is global to a program. If anything in a program imports pgvector, every client in it shows pgvector's methods, even one created without pgvector. ADR 210 rejected a global `declare module` registry for index types for this reason: every contract would see every loaded pack's entries. Here the objection is answered by a rule every contribution follows: **a contribution produces methods only from contract data its own pack introduces, such as its codecs and index types, or that every contract of its target has.** pgvector's methods come from fields of its own codec, and the Postgres full-text methods from indexes of the target's own index type, on the Postgres target only. So a method appears only on a model whose contract already needs the package, and a client created without a package the contract lists fails at creation: "Contract requires extension pack(s) …". A contribution that keyed on data any contract can hold, such as any `jsonb` column, would show methods in clients that do not have it.

## Two packages, one name

If two contributions give one model a method with the same name, it is an error in both halves:

- **In the types,** the method's type is `CollectionMethodNameClash`, which cannot be called. The error names the method, the model and both contributions:
  ```
  This expression is not callable.
    Type 'CollectionMethodNameClash<"post_search", "Post", "postgres/fullText" | "acme/search">' has no call signatures.
  ```
- **At run time,** the ORM client refuses to be created, with `ORM.ARGUMENT_INVALID`. It also refuses two contributions with the same id.

A misspelled method is an ordinary compile error, `Property 'post_serach' does not exist on type 'ContributedCollectionMethods<Contract, "Post", …>'`. A model that no contribution serves has a `using` with no members.

## A contributed method's order

A contributed method's order is an ordinary order, added where the method is called, as `orderBy` is:

```ts
db.orm.public.Post.orderBy((p) => p.pinned.desc()).using.post_search(q); // pinned posts first, then by relevance
db.orm.public.Post.using.post_search(q).orderBy((p) => p.id.asc());       // by relevance, then by id among equal matches
```

## Cost

With the Postgres full-text and pgvector contributions registered and no method in use, type checking `examples/prisma-8-demo` takes 1.2% more type instantiations than the main branch this builds on (906,529 against 896,074). The ORM client package takes 0.7% more (2,445,578 against 2,427,715) with its test-only contributions removed; its tests register four test-only type halves, which serve only the models of their own fixture contract, and with them it takes 1.2% more (2,457,184). Ten uses add 0.2 points in the demo and 0.1 points in the client package. Requiring each method's signature in the type half's table costs 41 instantiations in the package and none in the demo. Measured with `pnpm typecheck --extendedDiagnostics` on TypeScript 5.9.3; each count was the same in two runs.

## Consequences

- **An application searches a model with no code.** The Postgres clients register the full-text contribution for every application, and pgvector registers its own.
- **Any package can add methods computed from the contract data it introduces,** such as fields of its codecs or indexes of its index types, with no change to the ORM client.
- **`using` is a member of every collection.** A custom collection class cannot declare its own `using`, and an aggregate cannot be named `using`.
- **A library's declaration file may not load a package's types.** A library that uses contributed methods only inside function bodies emits a `.d.ts` without the import that registers them. A program that sees only that file and the contract types has no methods until it imports the package itself. An application always imports its client, so this only affects such a program.
- **Two cases the types accept that they should not.** A method infers its receiver from an expected type, so `const x: PostCollection = plainPosts.using.post_search(q)` compiles when `PostCollection` is a subtype of the receiver. Inside an `include` refinement the result has the terminal methods back, so `.all()` compiles there; the ORM refuses a terminal inside a refinement at run time.
- **The word "scope" keeps its meaning** (ADR 259): a query fragment that only imposes conditions. A contributed method may also order, so it is a collection method, not a scope.
- **A contribution declares which facts its methods add.** The ORM cannot see what a method body does, so it trusts the type half's `filters` and `orders`. A type half that declares a filter its method does not always add would let a bulk write through, so a method that filters only sometimes declares no filter.
- **This covers the SQL ORM client only.** A MongoDB method would add pipeline stages rather than a `where` and an `orderBy`, so the MongoDB ORM client needs its own contribution interface. MongoDB indexes also need names in the contract before a package can name methods after them.

## Alternatives considered

- **A contribution matches one index type, and its method is named after the index.** It cannot serve a method computed from a field or from the table, and the ORM decides the names.
- **The package declares rules (one method per index, per field or per model) and the ORM builds the names from a prefix and a suffix.** About 0.5 points cheaper in the ORM client package, but the ORM decides the names, and no rule can express "every model whose table has a column of type X".
- **Methods declared in the schema,** for example in a `scopes {}` block. Every case can be worked out from the model, and declarations would put the ORM's surface into the contract.
- **Methods placed directly on the collection, `db.orm.public.Post.post_search(q)`.** About 4% more type checking on the demo for every application, used or not. It also breaks a generic collection subclass (TS2509) and a custom class method that shares a contributed name (TS2416).
- **A method name in two parts, element then operation, `db.orm.public.Post.using.embedding.nearest(v)`.** A package that names its own methods can choose such names; the ORM need not require them.
- **The method types loaded through the emitted `contract.d.ts`.** It ties the contract's types to one query interface.
- **The contributions passed as a type argument of the client.** TypeScript infers no further type argument once the application writes `<Contract>`, so the application would have to write the contributions' types.
