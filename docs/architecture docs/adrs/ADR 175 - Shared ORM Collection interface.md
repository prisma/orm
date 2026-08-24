# ADR 175 — Shared ORM Collection interface

> **Note (later supersession):** this ADR was written before [ADR 183 — Aggregation pipeline only, never find API](ADR%20183%20-%20Aggregation%20pipeline%20only,%20never%20find%20API.md). On the Mongo family, ORM reads compile to aggregation pipelines (`AggregateCommand`) only — `FindCommand` is not a peer compilation target. Wherever this ADR pairs `FindCommand / AggregateCommand`, read `AggregateCommand` only.

## At a glance

The same chaining API works for both families. The consumer doesn't know (or care) whether the data lives in Postgres or MongoDB:

**SQL ORM (existing):**

```typescript
const db = orm({ contract, runtime });

// Custom collection with domain methods
class UserCollection extends Collection<Contract, 'User'> {
  admins() { return this.where({ kind: 'admin' }); }
  byEmail(email: string) { return this.where({ email }); }
}

// Chaining API — accumulates state, compiles at terminal method
const feed = await db.Post
  .where((post) => post.title.ilike('%launch%'))
  .select('id', 'title', 'userId', 'createdAt')
  .include('user', (user) => user.select('id', 'email', 'kind'))
  .orderBy([(post) => post.createdAt.desc()])
  .limit(10)
  .all();

const user = await db.User.byEmail('alice@example.com').first();
```

**Mongo ORM (target — not yet implemented):**

```typescript
const db = mongoOrm({ contract, runtime });

// Same custom collection pattern
class UserCollection extends Collection<Contract, 'User'> {
  admins() { return this.where({ kind: 'admin' }); }
  byEmail(email: string) { return this.where({ email }); }
}

// Identical chaining API — compiles to MongoQueryPlan instead of SqlQueryPlan
const tasks = await db.tasks
  .where((task) => task.assigneeId.eq('u1'))
  .include('assignee')
  .orderBy([(task) => task.createdAt.desc()])
  .limit(10)
  .all();

const user = await db.users.byEmail('alice@example.com').first();
```

The internal plumbing differs (SQL compiles to SQL AST; Mongo compiles to `FindCommand` / `AggregateCommand`), but the consumer sees the same interface.

## Context

Phase 3 of the Mongo PoC built a minimal ORM client with an options-bag API:

```typescript
const results = await orm.users.findMany({
  where: { email: 'alice@example.com' },
  include: { assignee: true },
});
```

This proved that the contract carries enough information for the ORM to do its job (type inference, polymorphism, embedded documents, referenced relations). But the API shape diverges from the existing SQL ORM, which uses a fluent chaining pattern.

A comparative analysis of both ORM implementations revealed that the consumer-facing surface is fundamentally the same pattern: a `Collection` class parameterized by `<Contract, ModelName>`, accumulating query state through immutable method chaining, and compiling at terminal methods.

## Problem

Two ORM clients with divergent APIs for the same conceptual operations:

- Users who work with both SQL and Mongo databases must learn two different patterns for the same operations.
- Custom collection subclasses (a key feature of the SQL ORM) don't work with the options-bag approach.
- Code that operates on "any collection" (framework utilities, testing helpers, middleware) can't be written against a common interface.

## Alternatives considered

### Options-bag API for both families

Rewrite both ORM clients to use `findMany({ where, include, select, orderBy, limit })`.

**Rejected.** This loses the composability that makes the chaining API valuable. Custom collection subclasses can't add domain methods that participate in the chain. The options bag grows unwieldy as more operations are added (cursor, distinct, groupBy). The SQL ORM already proved the chaining pattern works well — switching to options-bag would be a regression.

### Separate APIs per family

Keep the SQL ORM's chaining API and the Mongo ORM's options-bag API. Let each family optimize for its native idioms.

**Rejected.** The operations are the same — `where`, `select`, `include`, `orderBy`, `limit`, `all`, `first`. Having different API shapes for identical operations forces users to context-switch between families. The value of a shared data layer is that the interface is consistent; family-specific details should be encapsulated, not exposed through API shape differences.

## Decision

The `Collection` class with fluent chaining is the shared ORM interface for all families. Each family provides its own implementation with family-specific compilation at terminal methods.

### What's shared (framework-level)

| Concept | Description |
| --- | --- |
| **Collection chaining API** | `.where().select().include().orderBy().limit().offset().all().first()` — immutable method chaining, each call returns a new collection with accumulated state |
| **CollectionState** | The family-agnostic state bag: filters, includes, orderBy, selectedFields, limit, offset. Chaining methods accumulate state; terminal methods compile it |
| **Row type inference** | `model.fields[f].codecId` → `CodecTypes[codecId]['output']` with nullable handling. A framework-level utility type, not per-family |
| **Custom collection subclasses** | `class UserCollection extends Collection<C, 'User'>` with domain methods. The class extends a shared base; domain methods just call `this.where()` etc. |
| **Include interface** | `include('relation', refineFn?)` with cardinality-aware coercion (to-one → `T \| null`, to-many → `T[]`) |
| **Client shape** | Map of root names → Collection instances, derived from the contract's `roots` section |

### What stays family-specific (internal plumbing)

| Concern | SQL | Mongo |
| --- | --- | --- |
| **Terminal compilation** | `CollectionState` → `SqlQueryPlan` (SQL AST) | `CollectionState` → `MongoQueryPlan` (FindCommand / AggregateCommand) |
| **Include resolution** | Lateral joins, correlated subqueries, multi-query stitching | `$lookup` pipeline stages; embedded relations auto-projected |
| **Where expression output** | SQL AST nodes (`AnyWhereExpr`) | Mongo filter documents (`MongoExpr`) |
| **Field mapping** | Column remapping via `model.storage.fields` | Identity mapping (domain fields = document fields) |
| **Mutation compilation** | `INSERT...RETURNING`, `ON CONFLICT`, FK cascades | `insertOne`, `updateOne` with update operators (`$set`, `$inc`, `$push`) |

### Approach: spike then extract

Build the Mongo `Collection` independently, mirroring the SQL ORM's chaining API shape. Once both families have working implementations, extract the shared interface from two concrete implementations. The abstraction is discovered from the overlap between two implementations, not predicted from one.

This follows the established "spike then extract" principle from the broader Mongo workstream.

## Costs

- **Mongo must implement the full chaining state machine.** The Phase 3 options-bag API is thrown away. The Mongo Collection needs the same immutable-clone pattern, state accumulation, and terminal compilation that the SQL Collection has.
- **Where DSL may not fully generalize.** SQL's comparison methods (`.ilike()`, `.in()`) don't all apply to Mongo. The shared callback signature (`(model) => model.field.eq(value)`) works for common operators, but family-specific operators (SQL: `ilike`, `between`; Mongo: `$regex`, `$elemMatch`) will need extensions.
- **Extraction is non-trivial.** The SQL `Collection` class is ~1000 lines with deep coupling to SQL-specific internals (column mapping, `AnyWhereExpr`, SQL query plan compilation). Extracting the shared interface requires careful separation of the chaining machinery from the compilation backend.

## Benefits

- **Symmetric user experience.** Users learn one API pattern that works across families. Switching between SQL and Mongo databases requires changing the contract and runtime, not rewriting query code.
- **Custom collections work everywhere.** Domain methods like `.admins()` and `.byEmail(email)` are just `this.where(...)` calls — they don't touch family-specific internals and work identically for SQL and Mongo.
- **Shared row type inference.** With `codecId` on `model.fields` (ADR 172), the path from contract to TypeScript type is identical. A single `InferModelRow` utility type can serve both families.
- **Framework-level testing and utilities.** Code that operates on "any collection" (test helpers, middleware, debugging tools) can be written against the shared interface.
- **Incremental adoption.** The spike-then-extract approach means both families can evolve independently. The shared interface is extracted when the overlap is clear, not forced upfront.

## Open questions

### Where DSL generalization

The SQL ORM's `ModelAccessor` provides typed comparison methods (`.eq()`, `.neq()`, `.gt()`, `.lt()`, `.ilike()`, `.in()`, `.isNull()`). Some are universal (eq, neq, gt, lt), some are SQL-specific (ilike, between). Mongo has its own operators (`$regex`, `$elemMatch`, `$exists`). The shared interface needs a common set of comparison methods with family-specific extensions. The exact boundary hasn't been designed.

### Aggregation/groupBy

The SQL ORM has `.groupBy()` and `.aggregate()`. Mongo has aggregation pipelines. Whether these belong on the shared `Collection` interface or are family-specific extensions is an open question. The pipeline DSL is architecturally the Mongo equivalent of the SQL query builder — a lower-level escape hatch, not part of the ORM Collection.

### Include refinement depth

The SQL ORM supports nested includes (include → include → include) and complex refinements (scalar selectors, `combine()`). The Mongo ORM currently supports single-level includes via `$lookup`. How deep the shared interface goes is a design question for extraction time.
