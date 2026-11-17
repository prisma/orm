# MongoDB in Prisma 8 — The User Promise

What does Prisma 8 offer a MongoDB user, and why would they choose it over the `mongodb` driver or Mongoose? This document states the value proposition from the user's perspective: what they get, what they give up, and where Prisma 8 sits between "raw driver" and "full ORM". Every example uses the API as it ships; `examples/mongo-demo` is the worked application.

See also: [MongoDB primitives reference](mongodb-primitives-reference.md), [MongoDB Family subsystem](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md).

**External input**: The MongoDB Node.js Driver team provided a [feature gap analysis](mongodb-feature-support-priorities.md) of Prisma 7 and a [user journey narrative](mongodb-user-journey.md) that informed this document.

---

## Who is the user?

A TypeScript developer building an application backed by MongoDB. They want to move fast, catch errors at compile time, and not think about low-level database plumbing. They may be:

- **New to MongoDB** — coming from SQL/Prisma ORM, want familiar patterns
- **Experienced with MongoDB** — frustrated by Mongoose's type gaps, want better DX without losing Mongo idioms
- **Using both SQL and Mongo** — want one contract model and one toolchain across both

---

## The three promises

### 1. Your domain model is the source of truth

**The problem without Prisma 8**: MongoDB is schemaless. The "schema" lives in scattered Mongoose model definitions, ad-hoc TypeScript interfaces, or nowhere at all. When the schema drifts, nobody notices until production data is wrong.

**What Prisma 8 gives you**: You describe your domain once, in a data contract. The contract is a machine-readable, validated, versioned artifact: your TypeScript types, ORM operations, migrations and the collections' validators all derive from it.

#### What this looks like

From `examples/mongo-demo/src/contract.prisma`:

```prisma
type Address {
  street  String
  city    String
  zip     String?
  country String
}

model User {
  id      ObjectId @id @map("_id")
  name    String
  email   String
  address Address?   // embedded: stored inside the user document
  posts   Post[]     // referenced: stored in the posts collection
  @@map("users")
}

model Post {
  id        ObjectId @id @map("_id")
  title     String
  kind      String
  authorId  ObjectId
  author    User @relation(fields: [authorId], references: [id])
  @@discriminator(kind)
  @@map("posts")
}

model Article {
  summary String
  @@base(Post, "article")
}
```

The contract captures:

- **Models and fields**, with types mapped to BSON through codecs and TypeScript types derived from them.
- **Embedded documents** as value objects (`type Address`), stored inside the parent document.
- **References** between collections (`@relation`), which the ORM can load with `include`.
- **Polymorphism**: `@@discriminator` on a base model and `@@base` on each variant, stored in one collection.

#### What the contract guarantees

- **Type derivation**: every model has TypeScript types, and ORM inputs and results are derived from them.
- **Server-side validation**: migrations give each collection a `$jsonSchema` validator built from the contract, so writes that bypass Prisma 8 are checked too.
- **Cross-family consistency**: a SQL contract and a MongoDB contract share one model, so a tool can traverse the models and relations of either.

#### Existing databases

A Prisma 6 MongoDB schema can be the contract source as it is (`prisma6Schema`), which lets an existing Prisma 6 application adopt Prisma 8 without rewriting its schema first.

---

### 2. Querying is type-safe and stays Mongo-native

**The problem without Prisma 8**: The `mongodb` driver's TypeScript support is shallow: dot-notation for nested fields is untyped, aggregation pipelines are `Document[]`, and update operators are not checked against your schema. Mongoose relaxes `FilterQuery` to `any` for generic functions to compile.

**What Prisma 8 gives you**: two query surfaces on one `db` value. The ORM (`db.orm.<collection>`) covers CRUD and references. The pipeline builder (`db.query.from('<collection>')`) covers aggregation.

#### Reading data

```typescript
// ORM roots are the collections' storage names (`@@map`).
const users = await db.orm.users.limit(10).all();

// Equality filters are a plain object; values are encoded through the field's codec.
const alice = await db.orm.users.where({ email: 'alice@example.com' }).first();

// Sorting uses Mongo's directions.
const recent = await db.orm.posts.orderBy({ createdAt: -1 }).limit(10).all();

// A reference is loaded with include, which lowers to $lookup.
const posts = await db.orm.posts.include('author').all();

// A variant narrows the collection and adds the discriminator filter.
const articles = await db.orm.posts.variant('article').all();

// Embedded data is part of the document; no include is needed.
const user = await db.orm.users.where({ id: userId }).first();
console.log(user?.address?.city);
```

The key behaviors:

- **Embedded documents are always loaded**, because they are part of the parent document.
- **References are loaded only when included.** `include` takes the relation name and loads one level; there is no refinement callback, so the included documents cannot be filtered, ordered or limited.
- **The ORM's `where` takes an object of equalities or a filter expression.** For comparisons, `$in` and boolean composition, pass a filter built with `MongoFieldFilter` (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `isNull`, `isNotNull`) and combine filters with `.and(...)`, `.not()` and `MongoOrExpr.of([...])`. These name fields as strings, so the field names are not checked at compile time. There is no callback form of `where` and no `ilike`, `contains` or list operators such as `has`.

#### Aggregation

```typescript
import { acc } from '@prisma/orm-mongo/query-builder';

const plan = db.query
  .from('posts')
  .match((f) => f.authorId.eq(authorId))
  .group((f) => ({ _id: f.kind, postCount: acc.count() }))
  .sort({ postCount: -1 })
  .build();
const byKind = await (await db.runtime()).query(plan);
```

The pipeline builder is typed against the contract: stage by stage, it knows the shape of the documents flowing through it. It also has `lookup`, `geoNear`, `search` and `vectorSearch` stages.

#### Writing data

```typescript
const user = await db.orm.users.create({
  name: 'Alice',
  email: 'alice@example.com',
  role: 'reader',
  address: { street: '123 Main St', city: 'Springfield', country: 'US' },
});

// Plain-object update: replaces the named top-level fields with $set.
await db.orm.users.where({ id: user.id }).update({ name: 'Bob' });

// Field operations: atomic, server-side, checked against the field's type.
await db.orm.posts
  .where({ id: postId })
  .update((p) => [p.views.inc(1), p.tags.push('mongodb'), p.tags.addToSet('unique-tag')]);

await db.orm.users.where({ id: user.id }).delete();
```

Writes other than `create` and `createAll` require a `where`. Updating an embedded document is part of the parent's update, so it is atomic without a transaction.

#### The escape hatch

`db.raw` sends MongoDB commands as written, for anything the ORM and the pipeline builder do not express.

---

### 3. Prisma 8 manages schema evolution

**The problem without Prisma 8**: MongoDB enforces no schema by default, so schema changes are ad-hoc scripts, and nobody can say which documents have been migrated.

**What Prisma 8 gives you**: the same migration workflow as on SQL. `migration plan` compares two contracts and writes a migration that creates collections and indexes, updates validators, renames fields, and rewrites documents. Changes the planner cannot write itself are data transforms: a `check` that finds the documents still needing the change and a `run` that changes them. The runner skips a transform whose work is done and fails the migration if `check` still finds documents afterwards, so a migration is safe to run on any database at its starting point. See `skills/prisma-8/references/migrations.md`.

#### Runtime middleware

`mongo({ middleware: [...] })` takes a middleware chain that sees every execution, for logging, telemetry and caching.

---

## What Prisma 8 does NOT promise (for Mongo)

- **Portability between SQL and Mongo.** The contract model is shared, but a SQL contract and a Mongo contract are not interchangeable, and the ORM surfaces differ: the SQL ORM's `where` takes a callback with typed operators, Mongo's takes an object or a filter expression.
- **Referential integrity.** Prisma 8 does not enforce referential actions on MongoDB: deleting a document does not cascade to, restrict on, or null out the documents that reference it.
- **Transactions.** The Mongo client has no `db.transaction(...)`.
- **Change streams.** There is no change-stream surface.
- **Hiding that it's MongoDB.** Embedded documents, `ObjectId`, array operations and aggregation pipelines are all concepts the user will meet. Prisma 8 makes them type-safe, not invisible.
- **Field-level encryption.** MongoDB's CSFLE and Queryable Encryption are driver-level concerns that Prisma 8 does not manage.

---

## Where Prisma 8 sits in the ecosystem

| Concern | Raw `mongodb` driver | Mongoose | Prisma ORM 7 (Mongo) | **Prisma 8** |
|---|---|---|---|---|
| Schema definition | ❌ None | 🟡 JS schemas, partial TS | 🟡 PSL (composite types) | ✅ Contract (PSL or TS, value objects for embedded documents) |
| Type safety (queries) | 🟡 Top-level only | ❌ FilterQuery → any | 🟡 Generated | 🟡 Typed roots, fields and equality filters; operator filters name fields as strings; typed pipeline builder |
| Type safety (mutations) | ❌ None | 🟡 Partial | 🟡 Generated types | ✅ Typed inputs and field operations (`inc`, `push`, `pull`, `addToSet`) |
| Referential integrity | ❌ None | 🟡 Manual (middleware) | 🟡 Emulated referential actions | ❌ None |
| Embedded documents | ✅ Native | ✅ Native | 🟡 Composite types | ✅ Value objects |
| Polymorphism / unions | 🟡 Native (untyped) | 🟡 Discriminator plugin | ❌ Json fallback | ✅ Discriminator and variants |
| Schema validation | 🟡 Manual $jsonSchema | 🟡 Plugin-based | ❌ None | ✅ `$jsonSchema` validators kept in step with the contract by migrations |
| Aggregation pipelines | 🟡 Untyped arrays | 🟡 Untyped arrays | 🟡 `aggregateRaw` | ✅ Typed pipeline builder (`db.query`) |
| Vector / Atlas Search | 🟡 Raw pipeline stages | 🟡 Raw pipeline stages | 🟡 Raw queries | 🟡 `vectorSearch` and `search` stages on the pipeline builder |
| Change streams | ✅ Native | ✅ Native | ❌ Not supported | ❌ Not supported |
| Schema evolution | ❌ Manual scripts | 🟡 Manual (middleware) | ❌ No Mongo migrations | ✅ Planned migrations with data transforms |
| Transactions | ✅ Sessions | ✅ Sessions | ✅ `$transaction` (replica set) | ❌ Not supported |
| Cross-family support | ➖ N/A | ➖ N/A | 🟡 SQL + Mongo (separate) | ✅ One contract model and toolchain for SQL and Mongo |
| Plugin/middleware | ❌ None | 🟡 Mongoose plugins | 🟡 Limited | ✅ Middleware chain on `mongo()` |

Legend: ✅ strong / native — 🟡 partial / manual — ❌ missing / none — ➖ not applicable
