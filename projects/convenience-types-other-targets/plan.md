# Plan: convenience date and time types on SQLite, MySQL and MongoDB

Spec: [spec.md](./spec.md).

## Slices

Each slice is one PR, extends its target's example app, and runs the integration journeys locally before queueing (PR CI skips them).

1. **The shared package, and SQLite.** Create `@internal/type-implementations` and move PostgreSQL's database-agnostic date and time logic into it, with PostgreSQL rewired and its tests unchanged in behaviour. Then SQLite's explicit types, data types, codecs, `now()` generators and type choices; `temporal.*` on `DateTime`; the no-`Temporal` journeys; `prisma-8-demo-sqlite`. Amends ADR 278 and ADR 279; updates the scalar types reference and the layering doc.
2. **MySQL.** Data types `mysql/timestamp`, `mysql/date`, `mysql/time`; DDL, defaults and introspection for them; codecs, generators, type choices; `temporal.*` aliases; live tests against MySQL 8.4; `prisma-8-demo-mysql`.
3. **MongoDB's TypeScript builder takes contributed type constructors.** Its helpers come from the adapter's and packs' type constructors, as the SQL builder's do, instead of being hard-coded with the target's codec ids. Own design, raised to Will before implementation. Corrects ADR 257's `field.<token>()` sentence.
4. **MongoDB convenience types.** Explicit types and codecs, including the calendar codecs that refuse a BSON date not at midnight UTC; `Date` and `DateTime` become type choices; the removed-preset row for `temporal.timestamp`; schemas, fixtures and examples rewritten from `Date` to `DateTime`; the upgrade instruction; Prisma 6 `@db.Date` mapped to the calendar codec.
5. **Close-out.** Final retro, docs migrated, this folder deleted, follow-up tickets filed, TML-3714 set to Done.

Slices 1, 2 and 3 can run in parallel once slice 1's package exists; slice 4 needs slice 3.

## Follow-up tickets to file

- Move the safe-integer checks into `@internal/type-implementations`.
- Move decimal text normalization into it.
- Share the plain-JSON check through it, and correct ADR 257's note that names the framework.
- Move the framework's ISO date text reader (`date-time-stored-form.ts`) into it.
