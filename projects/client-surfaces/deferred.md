# Deferred

Items found while shaping this project that it does not do. Each is filed as a ticket at close-out unless a slice picks it up.

- **Pool options on the serverless `connect()`.** It has a fixed 20-second connect timeout and no pool settings (`packages/3-extensions/postgres/src/runtime/postgres-serverless.ts`). ADR 263 chose this deliberately; revisit only if a user asks.
- **`cursor` on SQLite and Supabase.** Postgres and the serverless client take `cursor`; SQLite and Supabase do not.
- **MongoDB `prepare` and `extensions`.** The MongoDB client has neither. MongoDB transactions belong to the "SQLite & MongoDB transactions" project (TML-2875).
- **Custom collection classes for MongoDB.** The MongoDB ORM has none. A new feature with its own design.
- **Plans for writes.** `create`, `update` and `delete` run immediately and have no plan form, so tools cannot inspect them.
- **Supabase's `pg` option ignores a `pg.Client`.** Found by the facade audit.
- **`mongoQuery({ contract })` does not validate.** It sits in the Mongo query-builder package, below the facade, and casts the value to its type without validating it. Every other entry that takes `{ contract }` validates once. Found in the slice 1 design review.
