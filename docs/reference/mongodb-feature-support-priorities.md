# MongoDB Feature Support Priorities

A prioritized inventory of MongoDB features and their support in Prisma ORM 6, based on input from MongoDB's Node.js Driver team. The *Prisma ORM status* columns describe Prisma ORM 6, the last release before Prisma 8 that supported MongoDB, not Prisma 8, so this is not a list of Prisma 8's gaps: it was design input, and features marked "Unsupported" or "Partial" were opportunities for Prisma 8 to deliver a Mongo-native experience. For what Prisma 8 does on MongoDB, see [the MongoDB user promise](mongodb-user-promise.md) and the [MongoDB Family subsystem](../architecture%20docs/subsystems/10.%20MongoDB%20Family.md).

## High priority


| Feature                          | Details                                                                               | Prisma ORM status | Notes                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inheritance and Polymorphism** | Polymorphic documents in a single collection, base models with specialized sub-models | Unsupported       | PN addresses this with `discriminator`/`variants`/`base` in the contract ([ADR 173](../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md))                                                        |
| **Performance Standards**        | Query caching, connection pooling, benchmarking                                       | Unknown           | Prisma ORM has built-in connection pooling and Prisma Accelerate integration                                                                                                                                                                    |
| **Representing Relationships**   | 1:1, 1:N, N:1, N:M with embedding and referencing                                     | Partial           | `@relation` with reference IDs supported, but not created during introspection. PN addresses embedding via `owner` on owned models and `storage.relations` on parents ([ADR 177](../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)) |


## Medium priority


| Feature                          | Details                                                                                             | Prisma ORM status | Notes                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Change Streams**               | Real-time change notifications for reactive systems, event-driven architectures, cross-service sync | Unsupported       | Workaround: instantiate a second client via the Node.js driver directly. PN's async iterable model is a natural fit. |
| **Vector Search**                | `$vectorSearch` for AI/embedding applications                                                       | Unsupported       | No native type-safe API; must use raw query escape hatch                                                             |
| **Security Features (CSFLE/QE)** | Client-Side Field Level Encryption, Queryable Encryption                                            | Unsupported       | No native configuration support                                                                                      |
| **Geospatial Features**          | GeoJSON fields, geospatial queries, spatial indexing                                                | Unsupported       | Complex workaround: store GeoJSON as `Json` field, query via `aggregateRaw`                                          |
| **Atlas Search**                 | Full-text search via `$search`                                                                      | Unsupported       | No native type-safe API; must use raw query escape hatch                                                             |
| **Time Series**                  | Time series collections for metrics, logs, IoT data                                                 | Unsupported       | Complex workaround via `Json` field and raw queries                                                                  |


## Low priority


| Feature                               | Details                                                                                                                                                            | Prisma ORM status | Notes                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **GridFS**                            | Large file storage exceeding 16MB document limit                                                                                                                   | Unsupported       | Not an ORM concern — use MongoDB driver directly                                                                                   |
| **BSON Data Type Support**            | Accept and represent all non-deprecated BSON types                                                                                                                 | Partial           | Maps most types (ObjectId, Decimal128), but gaps exist                                                                             |
| **Polymorphic Array/Embedded Fields** | Mixed-type arrays and embedded documents                                                                                                                           | Partial           | Workaround: untyped `Json` field or multiple optional fields. PN's embedded document support with typed composites addresses this. |
| **Index Creation (all types)**        | Single, compound, multikey, text, hashed, geospatial, clustered, wildcard + properties (TTL, unique, sparse, partial, hidden) + Atlas Search/Vector Search indexes | Partial           | `@unique` and `@@index` supported; advanced types and Atlas Search/Vector indexes are not                                          |


## Fully supported


| Feature               | Prisma ORM status                                                                                                                  | Notes |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Escape hatch          | `findRaw`, `aggregateRaw`, `runCommandRaw` for raw MongoDB commands                                                                |       |
| Aggregation           | Native `_sum`, `_avg`, `_count`, `_min`, `_max` and `groupBy`. Complex pipelines (`$unwind`, `$project`) require raw escape hatch. |       |
| Bulk Operations       | `createMany`, `updateMany`, `deleteMany`. Limitation: `createMany` returns count only, not records.                                |       |
| `$lookup` (joins)     | Native relation queries via `include` execute joins similar to `$lookup`                                                           |       |
| API Docs              | Fully type-safe, auto-generated reference                                                                                          |       |
| Compatibility         | MongoDB 4.2+ including Atlas                                                                                                       |       |
| Getting Started Guide | Comprehensive guides available                                                                                                     |       |
| Logging               | Configurable levels (query, info) and event-based logging                                                                          |       |
| Query Builder         | Fluent, type-safe CRUD (`findMany`, `findFirst`, etc.)                                                                             |       |
| Array Fields          | Scalar arrays, composite type arrays, atomic updates (`$push`, `$pull`)                                                            |       |
| Embedded Fields       | Via "Composite Types" in the schema                                                                                                |       |
| Document Model        | Nested documents and arrays via Composite Types                                                                                    |       |
| Transactions          | Interactive transactions (`$transaction`), requires replica set                                                                    |       |
| Sync/Async Connection | Uses underlying driver capabilities                                                                                                |       |
| Data Validation       | Static typing; runtime validation via Zod or server-side schema validation                                                         |       |
| Query Caching         | Via Prisma Accelerate                                                                                                              |       |


