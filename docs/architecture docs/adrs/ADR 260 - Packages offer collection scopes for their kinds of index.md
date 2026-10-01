# ADR 260 — Packages offer collection scopes for their kinds of index

**Status:** Proposed
**Date:** 2026-09-29
**Builds on:** [ADR 258 — A collection keeps its class through the chain](ADR%20258%20-%20A%20collection%20keeps%20its%20class%20through%20the%20chain.md), [ADR 259 — Query steps are functions](ADR%20259%20-%20Query%20steps%20are%20functions.md), [ADR 175 — Shared ORM Collection interface](ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md), [ADR 206 — Operations as TypeScript functions](ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md), [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md)

---

## At a glance

A schema author declares a full-text index over the title and the body of a post. A match in the title counts more than a match in the body:

```prisma
model Post {
  id     Int     @id
  userId Int
  title  String
  body   String?

  @@fullTextIndex([title, body], name: "post_search")
}
```

The application gets the scopes for that model from the Postgres package and applies one with `pipe`:

```ts
import { fulltextSearchScopes } from '@prisma/orm-postgres/orm-client';

const postScopes = fulltextSearchScopes<Contract, 'Post'>();

const posts = await db.Post.pipe(postScopes.post_search(websearchToTsquery('postgres index'))).limit(10).all();
```

Or it gives posts a `search` method on its collection class:

```ts
class PostCollection extends Collection<Contract, 'Post'> {
  search(q: TsqueryArgument) {
    return this.pipe(postScopes.post_search(q));
  }
}

const posts = await db.Post.search(websearchToTsquery('postgres index')).limit(10).all();
```

- `fulltextSearchScopes` comes from the Postgres package. Given the contract and a model, it returns one member for each full-text index on that model. `post_search` is the name the author gave the index.
- `post_search(q)` is a step: a function that takes a collection of posts and returns it narrowed to posts that match, ordered best match first. Its type is `Step<Self, Filtered<Self>>`, the same type `where` has (ADR 258). `pipe` applies it, as it applies any step.
- The result has the caller's type, so it chains with every collection method, and the class's `search` returns the class.

The query uses the index, because it is built from the index's own definition in the contract.

## Decision

A **scope** is a named step on a model: a function that takes a collection of the model and returns that collection's own type with a filter applied, `Step<Self, Filtered<Self>>`. Steps, `pipe` and the named facts are defined in ADR 258. `where` chains and the methods of a custom collection class are scopes that the application writes.

1. **A package that introduces a kind of index can export a scope helper.** Given the contract and a model, a scope helper returns one scope for each index of that kind on the model. Each scope is named after its index, and each is a step that `pipe` applies.
2. **A scope is built from the index's definition in the contract.** The query cannot differ from the index.
3. **The ORM client provides a builder for scope helpers.** The package author writes an ordinary function that returns a filter and an order. The builder derives the helper's types from it.
4. **The application decides where a scope appears.** It applies the scope with `pipe` at the call, or wraps it in a method of its custom collection class.
5. **Nothing is added to the schema language's grammar, to the contract's domain plane, or to the `Collection` type.**

The rest of this document states the problem, then follows one search from the schema to the SQL. Each choice has its reason beside it.

## The problem

To search several fields at once, the database builds one search document from all of them. For posts, that is the title and the body joined together, with the title given more weight. In Postgres the document is an expression, and an index over that expression makes the search fast.

An application could write that query itself, naming the fields and their weights:

```ts
db.sql.public.post
  .select('id', 'title')
  .where((f, fns) => fns.fullTextMatches([[f.title], [f.body]], q))
  .orderBy((f, fns) => fns.fullTextRank([[f.title], [f.body]], q), { direction: 'desc' });
```

Written this way, the search has two problems:

- **The fields and weights are repeated in every query.**
- **The query must repeat the index's expression exactly.** Postgres uses an expression index only when the query contains the same expression. If a query lists the fields in another order, or uses another language or another weight, the database reads the whole table and reports no error.

The package that defines the full-text index already knows the index's expression. It is the right place to write the query once. The difficulty is giving the application that query with full types: the package cannot know in advance which models have which indexes, or what they are called.

## How it works

### 1. The author declares the index

```prisma
model Post {
  id       Int     @id
  title    String
  subtitle String?
  body     String?

  @@fullTextIndex([[title, subtitle], body], name: "post_search")
}
```

- **The list gives the fields in order of weight.** Fields in a nested list share a weight. Here `title` and `subtitle` count most, and `body` counts less. A single field, as in `@@fullTextIndex([title])`, has no weight.
- **`name:` is the name the application uses.** The index's name in the database adds a suffix to it. `map:` gives the exact name in the database instead, for a database that already has the index.

The TypeScript contract builder takes the same arguments:

```ts
model('Post', { fields: { id, title, subtitle, body } }).sql(({ cols }) => ({
  indexes: [fullTextIndex([[cols.title, cols.subtitle], cols.body], { name: 'post_search' })],
}));
```

The contract records the index as data, not as a SQL string:

```json
{
  "columns": ["title", "subtitle", "body"],
  "name": "post_search_033e8055",
  "options": { "fields": [["title", "subtitle"], ["body"]], "language": "english" },
  "prefix": "post_search",
  "type": "fullText",
  "unique": false
}
```

- **`fullText` is an index type the Postgres package registers**, as an extension package registers its own kinds of index. In the database it is a `gin` index over the rendered search document.
- **`prefix` is the name the author gave; `name` is the name in the database.** The suffix is a hash of the index's content.
- **`columns` lists the covered columns in order**, and must equal the groups in `options.fields` read flat.

One renderer in the Postgres package produces the search document from `options`, for the index in the database and for the query. That is what keeps them the same. In a document of more than one column, every column is wrapped in `coalesce`, so whether a column is nullable does not change the document.

### 2. The application applies the scope

`fulltextSearchScopes` takes the contract and a model as type arguments and returns an object with one scope for each full-text index on that model. Each scope takes the search query and returns a step. `pipe` applies the step to any collection of the model:

```ts
const postScopes = fulltextSearchScopes<Contract, 'Post'>();

// on the root collection
db.Post.pipe(postScopes.post_search(q)).limit(10).all();

// after other methods
db.Post.where({ userId }).pipe(postScopes.post_search(q)).all();

// on the collection of related posts inside an include
db.User.where({ id: userId }).include('posts', (posts) => posts.pipe(postScopes.post_search(q)).limit(3));

// in a method of a custom collection class
class PostCollection extends Collection<Contract, 'Post'> {
  search(q: TsqueryArgument) {
    return this.pipe(postScopes.post_search(q));
  }
}
```

- **The scope returns `Filtered<Self>`: the collection's own type, with the filter recorded.** A row type chosen with `select` before the call is kept, a custom class stays the class, and every collection method still works after it. `update` and `delete` can follow it, as they can follow `where`.
- **Only full-text indexes of that model are offered.** `fulltextSearchScopes<Contract, 'User'>()` has no members. A wrong index name does not compile, and the index names are offered as completions, because the contract and model are known when the name is typed.
- **A scope is a value.** It can be kept in a constant, passed to a function, and applied to more than one collection. It is rejected for a collection of another model.
- **The application names the scope in its own terms** by writing a method on its custom collection class, as in "At a glance". Custom collection classes are where an application already keeps its own scopes (ADR 175).

**Why one member for each index.** A single function that takes the index name, as `fullTextSearch<Contract, 'Post'>('post_search')(q)`, gives the same completions, but a scope helper with one member per index reads as a name and gives the reader every scope of the model in one place.

**Why a step, not a member of every collection.** A package cannot add a typed member to every collection without a type registry that the `Collection` type reads. Every application would pay for that in type checking, whether or not it uses the member, and the member's name could collide with a collection method. A fragment costs nothing until it is applied, and it is applied the way every other fragment is.

### 3. What a scope does to the query

A scope returns a filter and a default order. The ORM client applies both to the collection. The query in "At a glance" becomes:

```sql
SELECT ... FROM "public"."post"
WHERE (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))
      @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank(setweight(...) || setweight(...), websearch_to_tsquery('english', $1)) DESC
LIMIT 10
```

The expression after `WHERE` is the index's expression.

**The order is a default.** A call to `orderBy` anywhere in the chain, before or after the scope, replaces it. The index does not order rows: a Postgres index of this kind finds the matching rows and returns them in no particular order. Ordering by relevance ranks every match and sorts them, so a caller who does not need that order can choose a cheaper one.

**The result is `Filtered<Self>`, not `Ordered<Self>`.** Methods that require a filter, such as `update` and `delete`, can follow a scope. `cursor` cannot: it needs an order on the model's own fields, and relevance is not one.

### 4. How a package writes a scope helper

The Postgres package writes the full-text scope helper with the ORM client's builder:

```ts
import { defineIndexScopes, type IndexData, type IndexScopeContext } from '@prisma/orm-postgres/orm-client';

type FullTextIndex = IndexData & {
  readonly type: 'fullText';
  readonly options: { readonly fields: readonly (readonly string[])[]; readonly language: string };
};

function isFullTextIndex(index: IndexData): index is FullTextIndex {
  return index.type === 'fullText';
}

function fulltext({ index, tableName }: IndexScopeContext<FullTextIndex>, query: TsqueryArgument) {
  const document = searchDocument(tableName, index.options);
  return {
    filter: fullTextMatches(document, query),
    defaultOrderBy: [fullTextRank(document, query).desc()],
  };
}

export const fulltextSearchScopes = defineIndexScopes({ match: isFullTextIndex, operation: fulltext });
```

- **`match` recognises the package's kind of index.** It is a type guard, so it also tells the builder the index's type.
- **`fulltext` is the scope operation.** It receives the index and the table's name, then the caller's arguments. It returns a scope refinement, a filter and an optional default order.
- **The builder derives everything else.** It reads the caller's arguments from the operation's parameters, and it types each scope as `Step<Self, Filtered<Self>>` for any `Self` that is a collection of the model.
- **The author writes no type-level code.**
- **The builder checks the operation against the types.** An operation that returns something other than a scope refinement does not compile.
- **The operation uses the same query operations an application can call.** `fullTextMatches` and `fullTextRank` are the SQL builder's operations, which take the fields in weight groups. An application that writes the query itself, as in "The problem", gets the same SQL, and keeping it equal to the index is then its own responsibility.

The type guard must be a named function or have an annotated parameter. With an inline guard and no annotation, the builder still types the helper correctly, but the operation sees a plain index and the author gets type errors.

**Several operations for one index.** A kind of index that offers more than one operation passes `operations` instead of `operation`. Each scope is then an object with one member for each operation, for example `db.Booking.pipe(bookingScopes.booking_during.overlapping(from, to))`.

**When an argument's type depends on the index.** Some operations need an argument whose type comes from the index itself, for example one of its field names. TypeScript cannot work that out inside the builder, because the builder cannot apply a generic function's type to one particular index. The author writes the operation as a generic function and adds a three-line interface that names it:

```ts
function operation<I extends MyIndex>(scope: IndexScopeContext<I>, argument: ArgumentFor<I>) {
  return { filter: ... };
}

interface MyKind extends IndexScopeKind<MyIndex> {
  readonly operation: typeof operation<this['index']>;
}

export const myScopes = defineIndexScopes<MyKind>({ match: isMyIndex, operation });
```

The builder sets `this['index']` to each index of the model in turn, so every scope gets argument types for its own index.

### 5. How the builder finds a model's indexes

The builder reads the model's indexes from the contract type and the model's name, which the application gives as type arguments: `fulltextSearchScopes<Contract, 'Post'>()`. Naming them once, where the scopes are made, is what lets the index names be completed and checked.

The step a scope returns is generic over the collection it receives. It reads the contract, the model's name and its namespace from that collection's type, as three separate type parameters, and refuses a collection of another model. Reading them separately is what makes the step work on `this` inside a custom collection class, whose type TypeScript has not resolved: reading the model's name through `this` gives no members, and reading the three from the class's declared base type works.

**Cost.** An application that does not use a scope pays nothing. `pipe` is part of every collection (ADR 258).

## Responsibilities

| Party | Owns |
| --- | --- |
| Target or extension that introduces a kind of index | The schema attribute, the index as data in the contract, the index's DDL, the query operations over it, and the scope helper |
| ORM client | The builder, the scope refinement, applying a refinement to a collection, and finding a model's indexes from the contract type |
| Application | Making a model's scopes from a helper, applying them with `pipe`, and naming them in its custom collection classes |
| Adapter | Turning the finished query into SQL, as for any other query |

## Generality

The design is meant for any database and for more than text search. Two appendices test that. [Appendix A](#appendix-a-text-search-on-other-databases) shows text search on MySQL, SQLite and MongoDB. [Appendix B](#appendix-b-scopes-that-are-not-searches) shows three scopes that are not text searches.

| Case | What serves the search | The builder can find it | The scope returns |
| --- | --- | --- | --- |
| Postgres full-text search | An index on the model's table | Yes | A filter and a default order |
| MySQL full-text search | An index on the model's table | Yes | A filter and a default order |
| SQLite full-text search | A separate search table | No | A filter and a default order |
| MongoDB text index | An index on the model's collection | Yes | A filter and a default order |
| MongoDB Atlas Search | A separate search index | No | A first pipeline stage |
| Postgres bookings by period | An index on the model's table | Yes | A filter |
| MySQL posts by tag | An index on the model's table | Yes | A filter |
| MongoDB places near a point | An index on the model's collection | Yes | A first pipeline stage |

**What holds in every case**

- **A scope takes a collection and returns a collection.** That holds whether the database runs it as a filter, as a filter with an order, or as a step of the query.
- **The scope is built from storage that the contract describes.**

**What differs**

- **The scope refinement belongs to the ORM client of each database family.** In MongoDB some searches are a pipeline stage, not a filter, so the MongoDB ORM client's builder lets an operation return a first stage.
- **The builder in this decision finds indexes on the model's own table or collection.** SQLite keeps full-text search in a separate table, and Atlas Search in a separate search index. A builder for those would find a storage entity that refers to the model's table.
- **Operations are written for one database.** `fulltext(q)` takes a Postgres search query, and a MySQL operation takes a string. Application code that uses a scope is written for one database, as code that uses a column operation is.

## Consequences

**For authoring and the contract**

- **`@@fullTextIndex` takes fields in weight groups**, and the contract records the fields, weights and language as data.
- **The schema says that an index exists, not that posts can be searched.** A tool that reads the contract sees an index.

**For applications**

- **An application writes one line to get a model's scopes**, and applies one with `pipe` at the call or in a method of its custom collection class.
- **A scope composes with other steps.** A conditional search, `posts.pipe((c) => (q ? c.pipe(postScopes.post_search(q)) : c))`, is sound for the reason ADR 258 gives: `Filtered<Self>` is a subtype of `Self`, so the conditional's type is the unfiltered collection.

**For queries**

- **The collection must know that an order is a default,** so that `orderBy` can replace it.
- **A scope gives the caller no value for each row.** The relevance score of a search and the distance of a geographic search are such values. The caller cannot select them, and cannot combine them with another sort key in `orderBy`.
- **An operation on one column can share an index with a scope.** An index over one field has the expression `to_tsvector(language, column)`, which is also the expression of `fullTextMatches` on that column.

**For packages**

- **A package's scope helper depends on the ORM client package**, because it uses the builder.
- **The scope's step reads collection members that are marked internal today**: the collection's context, model name, namespace and table name. They become part of what the ORM client promises to package authors.
- **MongoDB indexes have no name in the contract.** A MongoDB builder must name its scopes some other way, or the contract must record index names.

## Possible later step: scopes declared in the schema

A later design could let the schema declare a scope, and have the ORM client offer it on every collection, so the application writes no method. Such a scope would be built from the same steps. It needs a way to declare scopes in the schema, a place for them in the contract's domain plane, and a type registry that the `Collection` type reads. Those costs are why this decision stops at helpers.

## Alternatives considered

### Where a scope comes from

- **Declared in the schema, recorded in the contract's domain plane, and offered on every collection through a type registry.** It needs a new block in the schema language, a new member in the domain plane, and a registry that every collection's type reads. See "Possible later step".
- **A member that a package adds to every collection, as `db.Post.search`.** It needs the same registry. A member of the same name as a collection method or a custom class's method collides with it.
- **A function that combines a package's additions into a collection class, as `fulltextSearchScopes.mixin(PostCollection)`.** A step already applies to any collection, including `this` in a class. Combining classes adds nothing more.
- **Only the query operations, with the fields and weights written in each query.** Any difference from the index disables it without an error. The operations remain, as what a scope is built from.

### The form of a scope helper

- **A helper that takes the collection and returns scopes bound to it, as `fulltextSearchScopes(this).post_search(q)`.** It needs no `pipe` and no type arguments, because it reads the contract and model from the collection. But each scope is then bound to one collection: it is not a value that can be kept, passed around, or composed with other steps, and an application that keeps the helper's result in a field of its collection class makes it again for every chained call.
- **One function that takes the index's name, as `searchFullText(collection, 'post_search', q)`.** It gives the clearest error for a wrong name, because the error lists the valid names. It takes four positional arguments, and its result cannot be kept and reused.
- **A curried function that reads the index name before the model is known, as `fullTextSearch('post_search', q)(collection)`.** The index name cannot be offered as a completion, because the model is not known when it is typed.

### How a package types its scope helper

- **The package author writes the helper's types by hand.** It takes about 17 lines of type-level code, and nothing checks that the types match what the function does.
- **The operation returns a collection instead of a scope refinement.** The builder cannot check what it returns: an operation that returns fewer columns compiles, and the caller's type still promises every column. Naming a collection of any model also costs about 16,000 more type instantiations.
- **An interface in which the ORM client fills slots for the index and the collection.** It works inside one package, but TypeScript cannot write the type of a helper's result built this way to a published package's declaration files.

### How the application reaches a scope

- **As a member of the row, `p.search`, used inside `where`.** It puts something that is not a field among the fields, where a field of the same name collides with it. A filter inside `where` also cannot set an order. In MongoDB Atlas Search a search is not a filter at all, and cannot be combined with `or` and `not` as `where` allows.
- **Relevance as an ordinary sort key, applied where the scope is called.** The same calls in a different order would then mean different queries, which is true of no other collection method.

## Appendix A: text search on other databases

Each case shows the database's own syntax, the scope helper call, what the scope returns, and what the case shows about the design. The scope helpers are illustrations. This decision introduces none of them.

**Sources.** The behaviour of the MongoDB text index is confirmed by running queries against MongoDB. The behaviour of MySQL, SQLite and MongoDB Atlas Search is taken from their documentation.

### MySQL full-text index

```sql
CREATE FULLTEXT INDEX post_search ON post (title, body);

SELECT ... FROM post
WHERE MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY MATCH(title, body) AGAINST (? IN NATURAL LANGUAGE MODE) DESC;
```

```ts
const postScopes = mysqlFullTextScopes<Contract, 'Post'>();
db.Post.pipe(postScopes.post_search.natural('postgres index'));
db.Post.pipe(postScopes.post_search.boolean('+postgres -mysql'));
```

**What the database requires**

- The column list in `MATCH(...)` must be the column list of one full-text index. A query with another list fails.
- An index has no weight for each column and no language.
- A query has a mode: natural language, boolean, or natural language with query expansion. Boolean mode has its own operators in the search text.
- A table may have several full-text indexes.

**What the scope returns.** A filter, `MATCH(...) AGAINST (...)`, and a default order by the same expression. The operation writes the column list from the index.

**What it shows**

- Building the query from the index matters here even more than in Postgres, because a different column list is an error.
- A kind of index with several operations gives each scope one member for each operation.
- The form of the schema attribute belongs to the package. The MySQL attribute would take a flat list of fields.

### SQLite full-text search

```sql
CREATE VIRTUAL TABLE post_search USING fts5(title, body, content='post', content_rowid='id');

SELECT ... FROM post
WHERE post.id IN (SELECT rowid FROM post_search WHERE post_search MATCH ?)
ORDER BY (SELECT bm25(post_search, 10.0, 1.0) FROM post_search WHERE rowid = post.id AND post_search MATCH ?);
```

**What the database requires**

- The search text is held in a separate table of a special kind, not in an index on the model's table.
- That table must be kept in step with the model's table, usually by triggers.
- The query searches the search table and matches the result to the model's table by row id.
- Weights are arguments of the ranking function in the query. The database does not store them.

**What the scope returns.** A filter that selects from the search table, and a default order by rank.

**What it shows**

- The storage that serves a scope need not be an index on the model's table. The builder in this decision cannot find it. A SQLite builder would find the search table, which the contract would record as a storage entity that refers to the model's table.
- Where weights live depends on the database. SQLite does not store them, so they would be arguments of the schema attribute that the package keeps for the query.

### MongoDB text index

```js
db.post.createIndex({ title: "text", body: "text" }, { weights: { title: 10, body: 1 } })

db.post.aggregate([
  { $match: { $text: { $search: "postgres index" }, userId: 7 } },
  { $sort: { score: { $meta: "textScore" } } },
])
```

**What the database requires**

- A collection has at most one text index.
- `$text` must be in the first stage of the pipeline. That stage may hold other filters too.
- `$text` is accepted inside a `$lookup` sub-pipeline.
- Matches come back in no particular order unless the query sorts by the text score.
- A weight is a number from 1 to 99999 for each field.

**What the scope returns.** A `$text` filter and a default sort by the text score.

**What it shows**

- The MongoDB ORM client, not the caller, places the search in the first stage. It can, because a collection builds its query when a terminal method runs.
- A scope works inside an include.
- MongoDB indexes have no name in the contract. Because a collection has one text index, a MongoDB text helper can offer one scope with a fixed name.

### MongoDB Atlas Search and vector search

```js
db.post.aggregate([
  { $search: { index: "post_search", text: { query: "postgres index", path: ["title", "body"] } } },
  { $match: { userId: 7 } },
])

db.post.aggregate([
  { $vectorSearch: { index: "post_embedding", path: "embedding", queryVector: [...], numCandidates: 200, limit: 10 } },
])
```

**What the database requires**

- `$search` and `$vectorSearch` are pipeline stages. They cannot be written inside `$match`.
- The stage must be the first in the pipeline, and it names its index.
- Results come back ordered by score.
- `$vectorSearch` takes its own limit, and its own filter over fields that the index lists.
- A search index is a separate object from the collection's ordinary indexes. A collection may have several.

**What the scope returns.** A first stage, with no filter and no order.

**What it shows**

- A search is not always a filter. `where` cannot express it, because `where` lets the caller combine filters with `or` and `not`, and a stage cannot be combined that way.
- The scope refinement must belong to the ORM client of the database family.
- Filters the caller adds with `where` run after the stage. For vector search that can return fewer rows than the limit asked for. The MongoDB builder should give the operation the filters the collection has gathered, so that it can place them inside the stage.

## Appendix B: scopes that are not searches

Each case is a scope that is not a text search, on a different database. The scope helpers are illustrations. This decision introduces none of them. The database syntax is taken from each database's documentation.

### Postgres: bookings by period

```sql
CREATE INDEX booking_during ON booking USING gist (tstzrange(starts_at, ends_at));

SELECT ... FROM booking
WHERE room_id = $1 AND tstzrange(starts_at, ends_at) && tstzrange($2, $3);
```

```ts
const bookingScopes = periodScopes<Contract, 'Booking'>();
db.Booking.where({ roomId }).pipe(bookingScopes.booking_during.overlapping(from, to)).all();
db.Booking.pipe(bookingScopes.booking_during.containing(instant)).all();
```

**What it shows**

- A scope can be a plain filter, with no default order.
- The query must repeat the index's expression, which spans two fields. Building it from the index is the same benefit as for text search.

### MySQL: posts by tag

```sql
CREATE INDEX post_tagged ON post ((CAST(tags->'$[*]' AS CHAR(40) ARRAY)));

SELECT ... FROM post WHERE 'postgres' MEMBER OF (tags->'$[*]');
SELECT ... FROM post WHERE JSON_OVERLAPS(tags->'$[*]', CAST('["postgres","mysql"]' AS JSON));
```

```ts
const postScopes = tagScopes<Contract, 'Post'>();
db.Post.pipe(postScopes.post_tagged.with('postgres')).all();
db.Post.pipe(postScopes.post_tagged.withAny(['postgres', 'mysql'])).all();
```

**What it shows**

- MySQL uses this index only through three functions, and only with the same JSON path and the same cast type as the index. The package knows them, and the application does not have to.
- A scope can cover one field and set no order.

### MongoDB: places near a point

```js
db.place.createIndex({ location: "2dsphere" })

db.place.aggregate([
  { $geoNear: {
      near: { type: "Point", coordinates: [lng, lat] },
      key: "location", maxDistance: 2000,
      distanceField: "distance", query: { open: true } } },
])
```

```ts
const placeScopes = geoScopes<Contract, 'Place'>();
db.Place.where({ open: true }).pipe(placeScopes.location.near({ lng, lat }, { maxMetres: 2000 })).all();
```

**What it shows**

- The search is a first pipeline stage, and it takes the caller's filters inside itself, in `query`. The operation must receive the filters the collection has gathered.
- The scope is named after the indexed field, because a MongoDB index has no name in the contract.
- The database computes a value for each row, the distance. A scope cannot give it to the caller.
