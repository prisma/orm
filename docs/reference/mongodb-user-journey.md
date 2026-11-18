# MongoDB User Journey

A narrative walkthrough of a typical developer's experience using an ORM with MongoDB, highlighting the friction points that Prisma 8 aims to solve. Based on input from MongoDB's Node.js Driver team.

---

Lucas, a full-stack JavaScript developer comfortable with MongoDB, decided to try an ORM that was getting attention in the JS/TS community. He started a movie recommendation web app and followed the getting-started guide for MongoDB, expecting his existing database knowledge to make setup easy.

**Initial setup was smooth.** He scaffolded a Next.js project, installed dependencies, and had a working project within minutes. Great first impression.

**Schema introspection hit friction immediately.** He ran `db pull` to introspect his existing MongoDB schema (similar to the [mflix sample dataset](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/)). Problems:

- **Plural collection names weren't normalized.** His collections were `movies`, `users` — the tool generated models with the same plural names. He had to manually rename them to singular and add mapping attributes to keep his API clean.
- **Polymorphic fields fell back to `Json`.** His `ratings` field contained documents with different structures depending on the rating engine. The ORM couldn't express this, so he lost all type safety.
- **Relationships had to be defined manually.** MongoDB has no foreign keys to introspect, so every relationship had to be hand-written in the schema.

**CRUD development was productive.** Once the schema was configured, building with the ORM client was smooth. Standard CRUD operations worked well, and the generated TypeScript types were a major benefit.

**Simple schema evolution worked seamlessly.** Adding a new optional field (upvote/downvote count) to an existing model was painless — `db push` succeeded, and MongoDB's schema flexibility meant the field simply appeared when written. The ORM client recognized it immediately with updated type checking and IntelliSense.

**Data migration was painful.** His recommendation engine needed a schema change: moving user reaction data from an embedded field to a separate referenced collection. This embed-to-reference transition is a common MongoDB evolution pattern, but the ORM had no automated data migration support. He had to manually write a migration script. The MongoDB engineering team's assessment: "The lack of an automated data migration feature for this common MongoDB evolution made him feel disappointed."

**Advanced features required dropping to raw queries.** Adding vector search for movie recommendations meant:

- Writing custom scripts for embeddings and index setup
- Using `Byte` type as a workaround for the embedding field
- Bypassing the ORM entirely with raw queries for `$vectorSearch` operations

The type-safe ORM client — the best part of the experience — couldn't help with MongoDB's advanced features.

**Verdict: guarded optimism.** The ORM client delivered an exceptional DX through type safety and IntelliSense, but schema management required manual intervention that felt at odds with MongoDB's flexible-schema promise. The ORM was a powerful ally for standard operations but struggled to bridge the gap for NoSQL-specific patterns: data migrations, polymorphic fields, and advanced MongoDB features.

---

## What this means for Prisma 8

The friction points map directly to PN's design priorities:

| Friction point | PN's response |
|---|---|
| Polymorphic fields typed as `Json` | `discriminator` + `variants` in the contract ([ADR 173](../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)) |
| Manual relationship definition | Contract declares relations and model ownership (`owner` for embedded, `on` for referenced). See [ADR 177](../architecture%20docs/adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md) |
| No data migration support | Data invariant model for schema evolution ([ADR 176](../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)) |
| Advanced features require raw queries | Aggregation pipeline DSL as a typed escape hatch (planned) |
| Schema introspection friction | Improved introspection with convention-based normalization (planned) |
