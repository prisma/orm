# MongoDB in Prisma Next — The User Promise

What does Prisma Next offer a MongoDB user, and why would they choose it over the `mongodb` driver or Mongoose? This document articulates the value proposition from the user's perspective — what they get, what they give up, and where PN sits in the spectrum between "raw driver" and "full ORM."

See also: [design-questions.md](../planning/mongo-target/1-design-docs/design-questions.md), [MongoDB primitives reference](mongodb-primitives-reference.md)

**External input**: The MongoDB Node.js Driver team provided a [feature gap analysis](mongodb-feature-support-priorities.md) and a [user journey narrative](mongodb-user-journey.md) that informed this document.

---

## Who is the user?

A TypeScript developer building an application backed by MongoDB. They want to move fast, catch errors at compile time, and not think about low-level database plumbing. They may be:

- **New to MongoDB** — coming from SQL/Prisma ORM, want familiar patterns
- **Experienced with MongoDB** — frustrated by Mongoose's type gaps, want better DX without losing Mongo idioms
- **Using both SQL and Mongo** — want a familiar, symmetric interface across both, without learning two entirely different tools

All three should find something in PN that they can't get elsewhere.

---

## The three promises

### 1. Your domain model is the source of truth

**The problem without PN**: MongoDB is schemaless. The "schema" lives in scattered Mongoose model definitions, ad-hoc TypeScript interfaces, or — worst case — nowhere at all. When the schema drifts, nobody notices until production data is wrong. There's no single artifact that says "this is what a User looks like."

**What PN gives you**: You describe your domain once — your models, their fields, their types, and how they relate to each other. This description becomes a contract: a machine-readable, validated, versioned artifact that the rest of the system derives from. Your TypeScript types, your ORM operations, your query filters, your runtime validation — all flow from the contract. Change the contract, and everything downstream updates.

The contract separates **what your data means** (models, fields, relations) from **how it's stored** (collections, embedded documents, references). You think in domain terms; the storage mapping is a separate, explicit decision.

#### What this looks like

You describe your domain:

```typescript
// Models and their fields
model User {
  id        ObjectId
  name      String
  email     String
  address   Address     // embedded — stored inside the User document
  posts     Post[]      // referenced — stored in a separate collection
}

model Address {
  street    String
  city      String
  state     String
}

model Post {
  id        ObjectId
  title     String
  content   String
  author    User        // the other side of the User.posts relation
  tags      String[]
  comments  Comment[]   // embedded — stored inside the Post document
}

model Comment {
  text      String
  createdAt DateTime
  author    User        // referenced
}
```

The contract captures:
- **Models and fields**: User has `name: String`, `email: String`, etc.
- **Relations and their cardinality**: User → Post is 1:N, User → Address is 1:1
- **Model ownership**: Address is owned by User (lives inside the User document), Post is independent (lives in its own collection). Embedding is a cross-family concern that the contract makes explicit via the `owner` property.
- **Field types**: mapped to BSON types via codecs, with TypeScript types derived automatically

The distinction between embedded and referenced is a **data modeling decision** that the user makes explicitly. PN doesn't hide it — it surfaces it as a first-class choice, because it affects query semantics, atomicity, and performance.

#### What the contract guarantees

- **Type derivation**: The contract produces TypeScript types for every model. The ORM client, query filters, and mutation inputs are all derived from these types. If a field is `String`, the filter for that field accepts `string`. If it's `ObjectId`, the filter accepts `ObjectId`.
- **Schema validation**: PN can optionally push `$jsonSchema` validation rules to MongoDB, giving database-level enforcement of the contract's type expectations. Even without server-side validation, the contract serves as documentation and the basis for runtime validation.
- **Cross-family consistency**: A consumer library (a validator, a GraphQL schema generator, a visualization tool) can accept any PN contract — SQL or document — and traverse its models and relations without family-specific code.

#### Bringing structure to existing databases (introspection)

Many MongoDB users have existing databases with no formal schema. The [user journey](mongodb-user-journey.md) from the MongoDB team describes a developer introspecting an existing database and hitting friction: plural collection names, manually defining every relationship, and polymorphic fields falling back to untyped `Json`.

PN should offer introspection that generates a contract from an existing MongoDB database — sampling documents to infer field types, detecting embedded subdocuments, and normalizing collection names to model names. Relationships can't be fully inferred (MongoDB has no foreign keys), but conventions (fields ending in `Id`, arrays of `ObjectId`) can suggest candidates. The generated contract is a starting point that the user refines, not a finished artifact.

This is out of scope for the PoC but is table-stakes for real Mongo adoption. See [design question #11](../planning/mongo-target/1-design-docs/design-questions.md#11-introspection-generating-a-contract-from-an-existing-database).

---

### 2. Querying feels natural and is type-safe

**The problem without PN**: The `mongodb` driver's TypeScript support is shallow — top-level field names are checked, but dot-notation for nested fields is untyped, aggregation pipelines are `Document[]` (effectively `any`), and update operators have no compile-time validation against your schema. Mongoose has to relax `FilterQuery` to `any` for generic functions to compile. Prisma ORM's MongoDB support doesn't handle embedded documents at all.

**What PN gives you**: A type-safe query surface where operations are checked against your contract at compile time. Available operations depend on the field type — you can `ilike` a string field but not a number. Relations are traversable in queries. The experience is consistent with SQL-PN, but Mongo-native where it matters.

#### Reading data

```typescript
const db = mongo.orm({ contract, runtime });

// Simple query — returns typed User objects
const users = await db.User.limit(10).all();

// Filter with type-safe operators
const admins = await db.User
  .where((user) => user.email.ilike('%@company.com'))
  .orderBy((user) => user.name.asc())
  .all();

// Include referenced relations — PN resolves the reference automatically
const usersWithPosts = await db.User
  .include('posts', (posts) =>
    posts
      .where((post) => post.title.ilike('%mongo%'))
      .orderBy((post) => post.createdAt.desc())
      .limit(5)
  )
  .limit(10)
  .all();

// Embedded data comes for free — Address is part of the User document
// No include needed, it's always there
const user = await db.User.where({ id: userId }).first();
console.log(user.address.city); // typed as string
```

The key behaviors:
- **Embedded relations are always loaded** — they're part of the parent document, so there's no cost to including them and no way to exclude them (short of projection).
- **Referenced relations require explicit include** — just like SQL includes. PN resolves them via a second query (application-level join) or, when beneficial, via `$lookup`.
- **Filter operators are type-gated** — string fields get `eq`, `ne`, `ilike`, `contains`; number fields get `eq`, `ne`, `gt`, `lt`, `gte`, `lte`; arrays get `has`, `hasEvery`, `hasSome`. This is the same trait-based operator system SQL-PN uses.
- **Dot-notation for embedded fields** — querying nested fields in embedded documents is type-safe: `user.address.city.eq("Springfield")` checks that `address` exists on `User`, `city` exists on `Address`, and `city` is a `string`.

#### Writing data

```typescript
// Create — type-safe input derived from the contract
const newUser = await db.User.create({
  name: 'Alice',
  email: 'alice@example.com',
  address: {
    street: '123 Main St',
    city: 'Springfield',
    state: 'IL',
  },
});

// Update — basic field-level updates
const updated = await db.User
  .where({ id: userId })
  .update({ name: 'Bob' });

// Delete with cascading — PN handles referenced relations
await db.User.where({ id: userId }).delete();
// If User.posts has onDelete: cascade, PN deletes the user's posts too
```

Mutations on embedded data are part of the parent mutation — updating a User's address is a single atomic operation (no transaction needed). Mutations involving referenced relations may span multiple collections and are orchestrated by PN.

#### Mongo-native operations (beyond the shared ORM surface)

Some Mongo operations don't exist in SQL and deserve first-class support:

```typescript
// Atomic increment — no read-modify-write cycle
await db.Post.where({ id: postId }).update({
  views: { $inc: 1 },
});

// Array operations — atomic, server-side
await db.Post.where({ id: postId }).update({
  tags: { $push: 'mongodb' },
});
await db.Post.where({ id: postId }).update({
  tags: { $pull: 'deprecated' },
});

// Atomic add-to-set (append only if not already present)
await db.Post.where({ id: postId }).update({
  tags: { $addToSet: 'unique-tag' },
});
```

These extend the shared ORM `update` surface with Mongo-specific operator syntax. The shared interface (plain data objects) still works — `{ name: 'Bob' }` compiles to `{ $set: { name: 'Bob' } }`. The operators are additive.

#### The escape hatch

When the ORM isn't enough, users can drop to raw MongoDB commands through the runtime:

```typescript
// Raw aggregation pipeline — untyped, full MongoDB power
const results = await runtime.execute({
  collection: 'posts',
  pipeline: [
    { $match: { published: true } },
    { $group: { _id: '$authorId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ],
});
```

A type-safe aggregation pipeline builder (the Mongo equivalent of the SQL DSL) is a future goal, not a PoC deliverable. The raw escape hatch validates that the runtime can handle non-SQL query shapes.

#### MongoDB-specific capabilities via extension packs

PN's extension pack architecture (the same system that delivers pgvector for Postgres) enables MongoDB-specific capabilities without bloating the core ORM. The [MongoDB feature support priorities](mongodb-feature-support-priorities.md) identifies several candidates:

- **Vector Search** (`$vectorSearch`) — contributes a vector field type, similarity search operators, and vector search index definitions. Analogous to pgvector for Postgres.
- **Atlas Search** (`$search`) — full-text search via MongoDB Atlas. Contributes search index definitions and search query operators.
- **Geospatial** (`$near`, `$geoWithin`, `2dsphere` indexes) — contributes GeoJSON field types, geospatial query operators, and geospatial index types.

These are delivered as extension packs that the user adds to their configuration, just as a Postgres user adds pgvector. The ORM and query surfaces then expose the contributed types and operations with full type safety.

This is out of scope for the PoC but is a key part of the longer-term Mongo-native story. See [design question #12](../planning/mongo-target/1-design-docs/design-questions.md#12-mongodb-specific-extension-packs).

---

### 3. PN provides guardrails that MongoDB doesn't

**The problem without PN**: MongoDB provides no foreign key constraints, no cascading deletes, no schema enforcement by default, and no type checking on stored data. Application developers must build all of these by hand — and they frequently don't, leading to orphaned references, inconsistent data, and silent type mismatches.

**What PN gives you**: Configurable guardrails that bring structure to MongoDB's flexibility without eliminating that flexibility.

#### Referential integrity

The contract declares relations and their semantics. PN enforces them:

- **Cascade delete**: Delete a User → PN automatically deletes their Posts (if the relation declares `onDelete: cascade`). For embedded data this is automatic (deleting the parent deletes embedded children). For referenced data, PN orchestrates cross-collection deletes within a multi-document transaction.
- **Restrict delete**: PN rejects a delete if it would orphan required references (`onDelete: restrict`).
- **Set null**: PN nullifies the reference field on related documents (`onDelete: setNull`).
- **No action**: PN does nothing — the user manages integrity themselves. This is the MongoDB default and should be the PN default too, so users opt *in* to enforcement rather than being surprised by it.

This is one of PN's strongest differentiators for Mongo. Raw MongoDB and Mongoose both leave referential integrity entirely to the developer.

#### Schema validation

PN validates data at the application layer:

- **On writes**: PN always validates that data being written matches the contract. A mutation that would write a string to a number field is rejected before it reaches MongoDB.
- **On reads (configurable)**: In strict mode, PN validates that data returned from MongoDB matches the contract. Documents that don't match produce an error. In permissive mode, mismatches produce a warning through the runtime's diagnostic channel. This is important for users migrating from untyped Mongo usage — their existing data may not match the contract.
- **Server-side validation (optional)**: PN can push `$jsonSchema` rules to MongoDB collections, adding database-level enforcement that applies even to writes that bypass PN.

#### Schema evolution via data invariants

In SQL, schema evolution is split cleanly: structural migrations change the DDL (add a column, change a type), and data migrations transform content (populate the new column). In MongoDB, **that distinction collapses**. There's no DDL — collections don't have enforced schemas. "Adding a field" means updating documents to include it. "Splitting `name` into `firstName` + `lastName`" is a data migration. "Moving data from embedded to referenced" is a data migration. In Mongo, schema evolution IS data migration.

The [user journey](mongodb-user-journey.md) from the MongoDB team confirms this is a pain point: "The lack of an automated data migration feature for this common MongoDB evolution made him feel disappointed."

PN's data invariant model — being built for the SQL migration workstream (see [ADR 176 — Data migrations as invariant-guarded transitions](../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)) — is a natural foundation for Mongo schema evolution. The model treats data migrations as guarded transitions with machine-checkable postconditions:

- **"Done"** = the contract describes v2 + the invariant "all documents migrated to v2" holds
- **Postcondition check** = a Mongo query: `db.users.countDocuments({ schemaVersion: { $ne: 2 } }) === 0`
- **Transformation** = a Mongo update: `db.users.updateMany({ schemaVersion: 1 }, [{ $set: { firstName: ... } }])`
- **Idempotent** by construction — only touches documents that still need it

This gives Mongo users something no other ODM provides: managed, verifiable schema evolution with the same invariant-based model PN uses for SQL, but expressed entirely as data transforms rather than DDL + data transforms.

This is out of scope for the PoC but is a cross-workstream connection worth tracking. See [design question #14](../planning/mongo-target/1-design-docs/design-questions.md#14-schema-evolution-as-data-migration-cross-workstream).

#### Runtime guardrails

The aspiration is that the same plugin pipeline that works for SQL also works for Mongo — plugins written for one family should work for both without modification. This is unvalidated and depends on the plugin interface being truly family-agnostic, which the PoC will test:

- **Budget enforcement**: Limit the number of rows returned, query execution time, etc.
- **Query linting**: Reject dangerous operations (e.g. unbounded queries).
- **Telemetry**: Automatic logging of query operations, latency, row counts.
- **Middleware**: Caching, rate limiting, access control — all family-agnostic.

---

## What PN does NOT promise (for Mongo)

Clarity about what's out of scope is as important as the promises:

- **Portability between SQL and Mongo.** The shared ORM interface means the *patterns* are consistent, but a SQL contract and a Mongo contract are not interchangeable. You can't swap your Postgres database for MongoDB by changing a config line. The domain model transfers; the storage details and query capabilities do not.
- **Full MongoDB feature coverage.** PN covers the common CRUD and relation patterns. Advanced features (sharding configuration, capped collections, GridFS, time-series collections) are out of scope for the ORM client. Users who need these use the raw driver through PN's escape hatch.
- **Hiding that it's MongoDB.** PN is mongo-native, not mongo-agnostic. Embedded documents, `ObjectId`, array operations, and aggregation pipelines are all concepts the user will encounter. PN makes them type-safe and ergonomic, not invisible.
- **Field-level encryption management.** MongoDB's CSFLE and Queryable Encryption are driver-level concerns. PN can pass encryption configuration through to the MongoDB driver, but it doesn't implement encryption itself. This is a future adapter-level capability, not an ORM concern. See [design question #13](../planning/mongo-target/1-design-docs/design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption).

---

## Where PN sits in the ecosystem

| Concern | Raw `mongodb` driver | Mongoose | Prisma ORM (Mongo) | **Prisma Next** |
|---|---|---|---|---|
| Schema definition | ❌ None | 🟡 JS schemas, partial TS | 🟡 PSL (no embedded docs) | ✅ Contract (TS or PSL, full embedding) |
| Type safety (queries) | 🟡 Top-level only | ❌ FilterQuery → any | 🟡 Generated (no embedding) | ✅ Full (filters, operators, nested) |
| Type safety (mutations) | ❌ None | 🟡 Partial | 🟡 Generated types | ✅ Full (including Mongo operators) |
| Referential integrity | ❌ None | 🟡 Manual (middleware) | ❌ None | ✅ Configurable (cascade, restrict, setNull) |
| Embedded documents | ✅ Native | ✅ Native | ❌ Not supported | ✅ First-class in contract |
| Polymorphism / unions | 🟡 Native (untyped) | 🟡 Discriminator plugin | ❌ Json fallback | 🟡 Discriminated unions (April) |
| Schema validation | 🟡 Manual $jsonSchema | 🟡 Plugin-based | ❌ None | ✅ Built-in (write + configurable read) |
| Aggregation pipelines | 🟡 Untyped arrays | 🟡 Untyped arrays | ❌ Not exposed | 🟡 Raw escape hatch (typed DSL later) |
| Vector / Atlas Search | 🟡 Raw pipeline stages | 🟡 Raw pipeline stages | 🟡 Raw queries | 🔲 Extension packs (planned) |
| Change streams | ✅ Native | ✅ Native | ❌ Not supported | 🔲 Planned (async iterable) |
| Schema evolution | ❌ Manual scripts | 🟡 Manual (middleware) | ❌ No Mongo migrations | 🔲 Data invariant model (planned) |
| Introspection | ➖ N/A | ➖ N/A | 🟡 db pull (limited) | 🔲 Planned (type inference) |
| Cross-family support | ➖ N/A | ➖ N/A | 🟡 SQL + Mongo (separate) | ✅ SQL + Mongo (shared interface) |
| Plugin/middleware | ❌ None | 🟡 Mongoose plugins | 🟡 Limited | ✅ Full (shared with SQL) |

Legend: ✅ strong / native — 🟡 partial / manual — ❌ missing / none — 🔲 planned — ➖ not applicable
