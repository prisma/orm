# MongoDB Primitives Reference

Reference document for the MongoDB / document family PoC. Describes how MongoDB structures data, its type system, query model, and key abstractions — with an emphasis on how these map (or don't) to SQL concepts that the Prisma 8 architecture currently assumes.

---

## Glossary

| Term | Definition |
|---|---|
| **BSON** | Binary JSON — MongoDB's binary serialization format. A superset of JSON with additional types (ObjectId, Date, Decimal128, Binary, etc.). All data stored in MongoDB is BSON. |
| **Document** | The fundamental data unit in MongoDB. An ordered set of key-value pairs (like a JSON object). Every document has a mandatory `_id` field. Maximum size: 16 MB. |
| **Collection** | A grouping of documents. Analogous to a SQL table, but documents within a collection don't need to share the same structure. |
| **Database** | A container for collections. Same concept as a SQL database. |
| **ObjectId** | A 12-byte value used as the default `_id` type. Contains a 4-byte timestamp, 5-byte random value (per process), and 3-byte incrementing counter. Globally unique without coordination. |
| **Embedded document** | A document nested inside another document as a field value. The idiomatic MongoDB approach for "contained" one-to-one and one-to-many relationships. |
| **Reference** | A manual link between documents by storing one document's `_id` in another. The application resolves references with a second query or a `$lookup` aggregation stage. |
| **Aggregation pipeline** | An ordered sequence of stages that process and transform documents. Each stage receives the output of the previous stage. MongoDB's primary mechanism for complex queries, joins, grouping, and analytics. |
| **Stage** | A single transformation step in an aggregation pipeline (e.g. `$match`, `$group`, `$project`, `$lookup`). Most stages can appear multiple times. |
| **Cursor** | A pointer to the result set of a query. `find()` returns a cursor, not an array. Documents are streamed from the server as the cursor is iterated. |
| **Update operator** | An operator that modifies specific fields in a document without replacing the entire document. Examples: `$set`, `$unset`, `$inc`, `$push`, `$pull`. |
| **Replica set** | A group of MongoDB instances that maintain the same data set. Provides redundancy, high availability, and is required for multi-document transactions and change streams. |
| **Sharded cluster** | A MongoDB deployment that distributes data across multiple shards (each a replica set) for horizontal scaling. |
| **Change stream** | A real-time event stream that notifies applications of data changes (inserts, updates, deletes) on a collection, database, or deployment. Resumable via tokens. |
| **Oplog** | The operations log — a capped collection that records all write operations on a replica set. Change streams are built on top of the oplog. |
| **WiredTiger** | MongoDB's default storage engine since 3.2. Supports document-level concurrency control, compression, and encryption at rest. |

---

## 1. Data organization

MongoDB organizes data in a three-level hierarchy: **database → collection → document**.

A **database** is a named container for collections, equivalent to a SQL database.

A **collection** is a named grouping of documents within a database. Collections are roughly analogous to SQL tables, but with a fundamental difference: collections do not enforce a fixed schema. Documents within the same collection can have different fields, and the same field name can hold different types in different documents. This flexibility is by design — MongoDB treats schema enforcement as an application-level or opt-in concern, not a structural requirement.

A **document** is the fundamental unit of data. It's an ordered set of key-value pairs serialized as BSON (Binary JSON). Every document must have an `_id` field, which serves as the primary key. If the application doesn't provide one, MongoDB automatically generates an `ObjectId`. Documents can contain nested documents (subdocuments) and arrays, allowing hierarchical data to be stored in a single record.

The maximum document size is 16 MB. This constraint is relevant for data modeling — deeply nested or very large embedded structures may need to be split into referenced documents.

### Schema enforcement

By default, MongoDB does not enforce any schema on a collection. Any document with any structure can be inserted.

However, MongoDB supports **server-side JSON Schema validation** using the `$jsonSchema` operator. When validation rules are added to a collection, MongoDB can be configured to either reject or warn on documents that don't match the schema. This uses JSON Schema draft 4 with some MongoDB-specific extensions (e.g. `bsonType` instead of `type`).

This is relevant because Prisma 8's contract model assumes a defined schema. For MongoDB, the contract would represent the expected document structure even though MongoDB itself doesn't strictly require it.

---

## 2. BSON type system

MongoDB uses BSON (Binary JSON) as its serialization format. BSON extends JSON with additional types that have no JSON equivalent.

### Commonly used types

| BSON type | Alias | JS/TS equivalent | Notes |
|---|---|---|---|
| String | `"string"` | `string` | UTF-8 |
| Double | `"double"` | `number` | 64-bit IEEE 754 floating point |
| 32-bit integer | `"int"` | `number` | Signed 32-bit integer |
| 64-bit integer | `"long"` | `bigint` or `Long` | Signed 64-bit integer. The Node.js driver returns a `Long` wrapper by default. |
| Decimal128 | `"decimal"` | `Decimal128` | 128-bit decimal floating point. Used for financial/monetary values. |
| Boolean | `"bool"` | `boolean` | |
| Date | `"date"` | `Date` | Milliseconds since Unix epoch (64-bit integer). |
| ObjectId | `"objectId"` | `ObjectId` | 12-byte unique identifier. See glossary. |
| Object | `"object"` | `object` | Embedded document (nested key-value pairs). |
| Array | `"array"` | `Array` | Ordered list of values. Elements can be any BSON type, including mixed types. |
| Binary data | `"binData"` | `Binary` / `Buffer` | Arbitrary binary data with a subtype byte. |
| Null | `"null"` | `null` | Absence of value within a document. Distinct from a missing field. |
| Regular Expression | `"regex"` | `RegExp` | Stored regex pattern and flags. |
| Timestamp | `"timestamp"` | `Timestamp` | Internal MongoDB type for oplog ordering. Not the same as `Date`. Applications should use `Date`. |

### Deprecated types (not relevant for new development)

Undefined, DBPointer, Symbol, JavaScript, JavaScriptWithScope. These exist in the BSON spec but are deprecated and should not be used.

### Key difference from SQL

In SQL, types are declared at the column level and enforced by the database engine. Every value in a column has the same type.

In MongoDB, types are **per-value, per-document**. A field named `age` could be a number in one document and a string in another. Server-side validation via `$jsonSchema` can enforce type consistency, but it's opt-in.

For the Prisma 8 contract, this means the document contract's field type declarations represent the expected/intended types, not database-enforced constraints.

---

## 3. Documents and embedding

A document is a set of field-value pairs:

```json
{
  "_id": ObjectId("507f1f77bcf86cd799439011"),
  "name": "Alice",
  "email": "alice@example.com",
  "age": 30,
  "address": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL"
  },
  "tags": ["admin", "editor"]
}
```

### Embedded documents (denormalized)

The idiomatic MongoDB approach for "contained" or "belongs-to" relationships is to embed related data directly inside the parent document:

```json
{
  "_id": ObjectId("..."),
  "title": "Introduction to MongoDB",
  "author": {
    "name": "Alice",
    "bio": "Database engineer"
  },
  "comments": [
    { "user": "Bob", "text": "Great article!", "createdAt": ISODate("2025-01-15") },
    { "user": "Carol", "text": "Very helpful", "createdAt": ISODate("2025-01-16") }
  ]
}
```

Here, `author` is an embedded one-to-one subdocument, and `comments` is an embedded one-to-many array of subdocuments. No joins are needed to read this data — a single `find()` returns everything.

**When to embed:**
- The related data is always accessed together with the parent
- The relationship is "contains" or "belongs to"
- The embedded data is relatively small and bounded
- You want atomic writes (updates to a document and its embedded data are atomic)

**When not to embed:**
- The embedded array would grow unboundedly (risk hitting the 16 MB document limit)
- The related data is accessed independently of the parent
- Many-to-many relationships where embedding would cause significant duplication

### Nested field access

Embedded fields are accessed using **dot notation**: `"address.city"`, `"comments.0.text"`, `"author.name"`. This works in queries, projections, update operators, and aggregation pipeline stages.

---

## 4. References and relationships

When embedding isn't appropriate, MongoDB uses **references** — storing one document's `_id` in another and resolving the link at query time.

### Manual references

The most common pattern. Store the referenced document's `_id`:

```json
// users collection
{ "_id": ObjectId("aaa"), "name": "Alice", "email": "alice@example.com" }

// posts collection
{
  "_id": ObjectId("bbb"),
  "title": "My Post",
  "authorId": ObjectId("aaa"),
  "tagIds": [ObjectId("ccc"), ObjectId("ddd")]
}
```

The application resolves references with a second query or with `$lookup` in an aggregation pipeline.

### Relationship patterns

**One-to-one (reference):** Store the related document's `_id` in either document. Same pattern as SQL foreign keys, but with no constraint enforcement.

**One-to-many (reference):** Two options:
- Store the parent's `_id` in each child document (like SQL foreign keys): `{ "authorId": ObjectId("aaa") }`
- Store an array of child `_id`s in the parent: `{ "postIds": [ObjectId("bbb"), ObjectId("ccc")] }`

The choice depends on which side is queried more frequently and whether the array would grow unboundedly.

**Many-to-many:** Store arrays of `_id` references on one or both sides. No junction/join table is needed (or possible).

### No foreign key constraints

This is a critical difference from SQL. MongoDB does **not** enforce referential integrity. There is no `FOREIGN KEY` constraint, no `ON DELETE CASCADE`, no database-level guarantee that a referenced document exists. Referential integrity is entirely the application's responsibility.

For Prisma 8, this means the contract can declare relations, but enforcement and cascading behavior must be handled by the runtime or application layer, not the database.

### Resolving references: $lookup

The `$lookup` aggregation stage performs a left outer join with another collection:

```javascript
db.posts.aggregate([
  {
    $lookup: {
      from: "users",
      localField: "authorId",
      foreignField: "_id",
      as: "author"
    }
  }
])
```

This is the closest MongoDB equivalent to a SQL `JOIN`. It's available only within aggregation pipelines, not in regular `find()` queries.

---

## 5. Indexes

MongoDB indexes support efficient query execution. Without an index, MongoDB must scan every document in a collection (collection scan).

### Index types

| Index type | Description | SQL equivalent |
|---|---|---|
| **Single field** | Index on one field, ascending or descending | `CREATE INDEX ... ON t(col)` |
| **Compound** | Index on multiple fields (up to 32). Field order matters — the index supports queries on any prefix of the fields. | `CREATE INDEX ... ON t(col1, col2)` |
| **Multikey** | Automatically created when indexing a field that holds an array. Indexes each element of the array individually. | No direct equivalent |
| **Text** | Full-text search index on string content. Supports `$text` queries with language-aware stemming and stop words. | Full-text index |
| **Geospatial** | `2d` (flat) and `2dsphere` (spherical) indexes for location queries (`$near`, `$geoWithin`, `$geoIntersects`). | Spatial index |
| **Hashed** | Hash-based index, primarily used for shard key support. Doesn't support range queries. | Hash index |
| **Wildcard** | Indexes all fields matching a path pattern. Useful for documents with unpredictable field names. | No direct equivalent |

### Index properties

| Property | Description | SQL equivalent |
|---|---|---|
| **Unique** | Rejects duplicate values for the indexed field(s). The `_id` index is always unique. | `UNIQUE` constraint |
| **TTL** | Automatically deletes documents after a specified time interval. Only works on single-field indexes with `Date` values. | No direct equivalent (application-level) |
| **Partial** | Only indexes documents matching a filter expression. Reduces storage and maintenance cost. | Partial/filtered index |
| **Sparse** | Only indexes documents that have the indexed field (skips documents where the field is missing). Superseded by partial indexes. | No direct equivalent |
| **Hidden** | Index exists but is invisible to the query planner. Useful for evaluating the impact of dropping an index before actually dropping it. | No direct equivalent |

### The `_id` index

Every collection has an immutable, unique index on the `_id` field. This is created automatically and cannot be dropped. It's the only index that MongoDB guarantees exists.

---

## 6. CRUD operations

MongoDB's CRUD operations map loosely to SQL but with different semantics, particularly for updates.

### Read operations

| Operation | Description | SQL equivalent |
|---|---|---|
| `find(filter, options)` | Returns a cursor over matching documents. Supports projection, sort, limit, skip. | `SELECT ... WHERE ... ORDER BY ... LIMIT` |
| `findOne(filter)` | Returns the first matching document (or null). | `SELECT ... WHERE ... LIMIT 1` |
| `countDocuments(filter)` | Counts documents matching the filter. | `SELECT COUNT(*) WHERE ...` |
| `estimatedDocumentCount()` | Fast approximate count using collection metadata. | No exact equivalent |
| `distinct(field, filter)` | Returns distinct values for a field. | `SELECT DISTINCT col FROM ...` |

`find()` returns a **cursor**, not an array. The cursor streams documents from the server as they're consumed. This is important for large result sets — documents aren't all loaded into memory at once.

### Write operations

| Operation | Description | SQL equivalent |
|---|---|---|
| `insertOne(doc)` | Insert a single document. | `INSERT INTO ... VALUES (...)` |
| `insertMany(docs)` | Insert multiple documents. Ordered by default (stops on first error); can be set to unordered (continues past errors). | `INSERT INTO ... VALUES (...), (...), ...` |
| `updateOne(filter, update)` | Update the first matching document using update operators. | `UPDATE ... SET ... WHERE ... LIMIT 1` |
| `updateMany(filter, update)` | Update all matching documents. | `UPDATE ... SET ... WHERE ...` |
| `replaceOne(filter, doc)` | Replace the entire document (except `_id`) with a new document. | `UPDATE ... SET col1=..., col2=... WHERE ...` |
| `deleteOne(filter)` | Delete the first matching document. | `DELETE FROM ... WHERE ... LIMIT 1` |
| `deleteMany(filter)` | Delete all matching documents. | `DELETE FROM ... WHERE ...` |

### Compound operations (atomic read+write)

| Operation | Description |
|---|---|
| `findOneAndUpdate(filter, update, options)` | Atomically find and update a document. Returns the document before or after the update (configurable). |
| `findOneAndReplace(filter, doc, options)` | Atomically find and replace a document. |
| `findOneAndDelete(filter, options)` | Atomically find and delete a document. Returns the deleted document. |

### Update operators

Unlike SQL's `SET col = value`, MongoDB uses **update operators** to modify specific fields without replacing the entire document:

| Operator | Description | Example |
|---|---|---|
| `$set` | Set field value | `{ $set: { "name": "Bob" } }` |
| `$unset` | Remove a field | `{ $unset: { "temporary": "" } }` |
| `$inc` | Increment numeric value | `{ $inc: { "views": 1 } }` |
| `$mul` | Multiply numeric value | `{ $mul: { "price": 1.1 } }` |
| `$min` / `$max` | Update only if new value is less/greater | `{ $min: { "lowScore": 50 } }` |
| `$rename` | Rename a field | `{ $rename: { "old": "new" } }` |
| `$push` | Append to array | `{ $push: { "tags": "new-tag" } }` |
| `$pull` | Remove from array by value/condition | `{ $pull: { "tags": "old-tag" } }` |
| `$addToSet` | Append to array only if not already present | `{ $addToSet: { "tags": "unique-tag" } }` |
| `$pop` | Remove first or last array element | `{ $pop: { "tags": 1 } }` |
| `$currentDate` | Set field to current date | `{ $currentDate: { "updatedAt": true } }` |

This operator model is significantly different from SQL's update semantics. Prisma 8's mutation operations would need to map to these operators rather than generating `SET` clauses.

---

## 7. Query language

MongoDB's query language uses JSON-like filter documents rather than a textual query language like SQL. Queries are expressed as objects describing the conditions documents must match.

### Comparison operators

| Operator | Description | Example |
|---|---|---|
| `$eq` | Equals (implicit when using `field: value`) | `{ age: { $eq: 30 } }` or `{ age: 30 }` |
| `$ne` | Not equals | `{ status: { $ne: "deleted" } }` |
| `$gt` / `$gte` | Greater than / greater than or equal | `{ age: { $gt: 18 } }` |
| `$lt` / `$lte` | Less than / less than or equal | `{ price: { $lte: 100 } }` |
| `$in` | Matches any value in array | `{ status: { $in: ["active", "pending"] } }` |
| `$nin` | Matches none of the values in array | `{ status: { $nin: ["deleted"] } }` |

### Logical operators

| Operator | Description | Example |
|---|---|---|
| `$and` | All conditions must match (implicit when listing multiple fields) | `{ $and: [{ age: { $gt: 18 } }, { status: "active" }] }` |
| `$or` | At least one condition must match | `{ $or: [{ status: "active" }, { role: "admin" }] }` |
| `$not` | Inverts a condition | `{ age: { $not: { $gt: 65 } } }` |
| `$nor` | None of the conditions must match | `{ $nor: [{ status: "deleted" }, { banned: true }] }` |

### Element and evaluation operators

| Operator | Description |
|---|---|
| `$exists` | Field exists (or doesn't) in the document |
| `$type` | Field value is a specific BSON type |
| `$regex` | String matches a regular expression |
| `$expr` | Use aggregation expressions within a query filter |

### Array operators

| Operator | Description |
|---|---|
| `$elemMatch` | Array contains an element matching all specified conditions |
| `$all` | Array contains all specified values |
| `$size` | Array has exactly the specified length |

### Dot notation for nested fields

Queries, projections, and updates can reference nested fields using dot notation:

```javascript
// Query embedded document field
db.users.find({ "address.city": "Springfield" })

// Query array element by index
db.posts.find({ "comments.0.user": "Bob" })

// Update nested field
db.users.updateOne(
  { _id: ObjectId("...") },
  { $set: { "address.city": "Shelbyville" } }
)
```

---

## 8. Aggregation pipeline

The aggregation pipeline is MongoDB's primary mechanism for complex data processing — joins, grouping, reshaping, analytics, and computed fields. It replaces much of what SQL handles with `SELECT`, `JOIN`, `GROUP BY`, `HAVING`, subqueries, and window functions.

A pipeline is an ordered array of stages. Documents flow through the stages in sequence, with each stage transforming the document stream before passing it to the next.

### Core stages

| Stage | Description | SQL equivalent |
|---|---|---|
| `$match` | Filter documents by condition. Should appear early in the pipeline for performance (uses indexes). | `WHERE` / `HAVING` |
| `$project` | Include, exclude, or compute fields. Reshapes each document. | `SELECT col1, col2, col1 + col2 AS total` |
| `$addFields` / `$set` | Add new fields while preserving all existing fields. Less destructive than `$project`. | `SELECT *, col1 + col2 AS total` |
| `$group` | Group documents by a key and compute aggregate values using accumulators (`$sum`, `$avg`, `$min`, `$max`, `$push`, `$first`, `$last`, `$count`). | `GROUP BY ... SELECT SUM(...), AVG(...)` |
| `$sort` | Order documents by one or more fields. | `ORDER BY` |
| `$limit` | Restrict the number of documents passed to the next stage. | `LIMIT` |
| `$skip` | Skip the first N documents. | `OFFSET` |
| `$unwind` | Deconstruct an array field, outputting one document per array element. Necessary before grouping on array contents. | `LATERAL JOIN UNNEST(...)` |
| `$lookup` | Left outer join with another collection. Can be a simple equality join or a correlated subquery pipeline. | `LEFT JOIN` |
| `$count` | Count documents and output a single document with the count. | `SELECT COUNT(*)` |

### Reshaping and transformation stages

| Stage | Description |
|---|---|
| `$replaceRoot` / `$replaceWith` | Promote a subdocument or computed object to be the new root document. |
| `$redact` | Restrict document content based on field-level access control expressions. |
| `$sample` | Randomly select N documents from the input. |

### Multi-pipeline and output stages

| Stage | Description |
|---|---|
| `$facet` | Run multiple sub-pipelines on the same input in parallel. Each sub-pipeline produces its own array of results. Useful for computing multiple aggregations in one pass. |
| `$unionWith` | Combine documents from another collection into the pipeline (like SQL `UNION ALL`). |
| `$merge` | Write pipeline output to a collection, merging with existing documents (upsert, replace, merge, keep existing, or fail on match). |
| `$out` | Write pipeline output to a collection, replacing all existing documents. |

### Graph and recursive stages

| Stage | Description |
|---|---|
| `$graphLookup` | Recursive traversal across documents in a collection. Follows references through a specified field to build a graph/tree. Configurable depth limit. |

### Example pipeline

Find the top 5 authors by post count, including their email:

```javascript
db.posts.aggregate([
  { $match: { published: true } },
  { $group: { _id: "$authorId", postCount: { $sum: 1 } } },
  { $sort: { postCount: -1 } },
  { $limit: 5 },
  { $lookup: {
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "author"
  }},
  { $unwind: "$author" },
  { $project: {
      _id: 0,
      name: "$author.name",
      email: "$author.email",
      postCount: 1
  }}
])
```

### Key architectural difference from SQL

SQL is **declarative** — you describe what you want and the query planner decides how to get it. Aggregation pipelines are **imperative** — the developer specifies the exact sequence of transformations. The order of stages affects both correctness and performance. Placing `$match` early is critical because only the first `$match` can use indexes.

For Prisma 8, this means the "lowering" step for a document adapter is fundamentally different from SQL. Instead of producing a SQL string from an AST, the adapter produces a pipeline (an array of stage objects) from the query plan.

---

## 9. Transactions

MongoDB provides two levels of atomicity.

### Single-document atomicity (default)

All operations on a single document are atomic, including operations that modify embedded documents and arrays within that document. This means that if a document contains an embedded array of comments and you `$push` a new comment, the operation is atomic — no other operation can see a partially-updated document.

This is the most important distinction from SQL: because MongoDB encourages embedding related data in a single document, many operations that would require a multi-row transaction in SQL are naturally atomic in MongoDB without any explicit transaction.

### Multi-document transactions

For operations that span multiple documents or collections, MongoDB supports ACID transactions (since MongoDB 4.0 for replica sets, 4.2 for sharded clusters).

Transactions operate within a **session**. The MongoDB Node.js driver provides two APIs:

**Callback API** (recommended) — handles retry logic automatically:
```javascript
await client.withSession(async (session) => {
  await session.withTransaction(async () => {
    await users.updateOne({ _id: userId }, { $set: { balance: newBalance } }, { session });
    await transactions.insertOne({ userId, amount, type: "debit" }, { session });
  });
});
```

**Core API** — manual start/commit/abort:
```javascript
const session = client.startSession();
session.startTransaction();
try {
  await users.updateOne({ _id: userId }, { $set: { balance: newBalance } }, { session });
  await transactions.insertOne({ userId, amount, type: "debit" }, { session });
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
  throw error;
} finally {
  session.endSession();
}
```

Each operation within a transaction must pass the `session` object. Transaction-level read concern, write concern, and read preference apply to all operations within the transaction.

Multi-document transactions have performance overhead and a default lifetime limit (60 seconds). MongoDB's documentation recommends designing data models to minimize the need for multi-document transactions by using embedding where possible.

---

## 10. Change streams

Change streams provide a real-time event stream of data changes. Applications subscribe to changes on a collection, database, or entire deployment and receive notifications for inserts, updates, replaces, deletes, and DDL events (create, drop, rename).

```javascript
const changeStream = collection.watch();

for await (const change of changeStream) {
  console.log(change.operationType); // "insert", "update", "delete", etc.
  console.log(change.fullDocument);  // the document (for insert/replace/update with fullDocument option)
}
```

Key characteristics:
- **Resumable**: Each change event includes a resume token. If the connection drops, the application can resume from where it left off by passing the token.
- **Ordered**: Changes are globally ordered across sharded clusters.
- **Filterable**: An aggregation pipeline can be passed to `watch()` to filter events by operation type, affected fields, or document content.
- **Durable**: Only majority-committed changes are surfaced — change streams won't deliver changes that are later rolled back.

Change streams require a replica set (or sharded cluster). They are not available on standalone MongoDB instances.

---

## 11. Views

MongoDB supports two kinds of views:

**Standard views** are named aggregation pipelines stored as collection-like objects. Querying a view executes the pipeline on demand. Views are read-only and don't persist data.

```javascript
db.createView("activeUsers", "users", [
  { $match: { status: "active" } },
  { $project: { name: 1, email: 1, lastLogin: 1 } }
])

// Query like a regular collection
db.activeUsers.find({ lastLogin: { $gt: lastWeek } })
```

**On-demand materialized views** use `$merge` or `$out` in an aggregation pipeline to write results to a collection. The materialized data must be explicitly refreshed by re-running the pipeline.

---

## 12. How MongoDB maps to SQL concepts

| SQL concept | MongoDB equivalent | Key differences |
|---|---|---|
| Database | Database | Same concept |
| Table | Collection | No fixed schema; documents can vary in structure |
| Row | Document | Flexible fields, supports nesting and arrays |
| Column | Field | Per-document (not per-collection); types not enforced by default |
| Schema / DDL | JSON Schema validation (opt-in) | No `CREATE TABLE` — collections are created implicitly on first insert |
| Primary key | `_id` field | Mandatory; auto-generated `ObjectId` by default |
| Foreign key | Manual reference (`_id` stored in another document) | **No constraint enforcement** — referential integrity is application-level |
| `JOIN` | `$lookup` in aggregation pipeline, or embedding | Embedding is preferred for "contained" relationships; `$lookup` is more expensive than SQL joins |
| `SELECT ... WHERE` | `find(filter, projection)` | JSON-based filter syntax, not textual SQL |
| `INSERT` | `insertOne()` / `insertMany()` | |
| `UPDATE ... SET` | `updateOne()` / `updateMany()` with update operators | Uses `$set`, `$inc`, `$push` etc. rather than whole-row replacement |
| `DELETE` | `deleteOne()` / `deleteMany()` | |
| `GROUP BY` + aggregates | `$group` stage in aggregation pipeline | |
| `ORDER BY` | `$sort` stage, or `.sort()` on cursor | |
| `LIMIT` / `OFFSET` | `$limit` / `$skip`, or `.limit()` / `.skip()` on cursor | |
| Index | Index | Similar concepts; MongoDB adds multikey, text, geospatial, wildcard, TTL |
| Unique constraint | Unique index | Via `{ unique: true }` on index creation |
| Transaction | Multi-document transaction (via session) | Single-document operations are atomic by default; multi-doc transactions require explicit sessions |
| View | View (named aggregation pipeline) | Read-only; executed on demand |
| Trigger | Change stream + application logic | No server-side triggers; applications subscribe to change streams |
| Stored procedure | None | MongoDB has no stored procedures. All logic is application-side. |
| Auto-increment | `ObjectId` (default) or application-generated | No native auto-increment integer sequence |

---

## 13. Implications for Prisma 8

Key architectural considerations that emerge from these primitives:

1. **Embed vs. reference is a data modeling decision that has no SQL equivalent.** The contract needs to express whether a one-to-many relationship is embedded (subdocument array) or referenced (`_id` link). This affects how the ORM client queries data — embedded data comes back in a single query, referenced data requires `$lookup` or a second query.

2. **No foreign key enforcement.** Relations declared in the contract are application-level constructs. The database won't prevent orphaned references. Cascading deletes, if desired, must be implemented by the runtime.

3. **Update operators replace SQL `SET` clauses.** The mutation lowering layer must produce `$set`, `$inc`, `$push`, etc. instead of `SET col = value`. This is a different operation model — field-level patching rather than row-level replacement.

4. **Aggregation pipelines replace SQL queries.** The adapter's lowering step produces an array of pipeline stages (JavaScript objects), not a SQL string. The plan shape needs to accommodate this.

5. **Types are per-value, not per-column.** The contract declares expected types, but MongoDB doesn't enforce them. Runtime validation may be needed where SQL databases would enforce types at the storage level.

6. **Cursors, not result sets.** `find()` returns a streaming cursor. The driver integration needs to handle cursor iteration, which aligns well with Prisma 8's streaming/async iterable result model.

7. **Single-document atomicity covers many use cases.** Operations on embedded data are atomic without transactions. The runtime should leverage this — many operations that require transactions in SQL may not need them in MongoDB.

8. **No `JOIN` in `find()`.** Joins (`$lookup`) are only available in aggregation pipelines. If a query involves relations (includes), the adapter must use an aggregation pipeline rather than a simple `find()`, or perform application-level joining (multiple queries + stitching, which is what the ORM client already does for SQL includes).

9. **`_id` is mandatory and typically `ObjectId`.** The contract's primary key / ID strategy for document collections needs to account for `ObjectId` as the default, with options for UUID, client-generated, or auto-generated values.
