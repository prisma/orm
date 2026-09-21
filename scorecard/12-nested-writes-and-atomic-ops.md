# Nested writes & atomic ops

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| Nested `create` on relations | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/nested-mutations.test.ts` (`nested create() on to-many relations`) |
| Nested `connect` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/nested-mutations.test.ts` (`nested connect() on to-one relations`) |
| Nested `disconnect` (with criteria) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/nested-mutations.test.ts` (`disconnect() with criteria`) |
| Deep nested writes (3+ levels) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/nested-mutations.test.ts` (`deep nested create() across three levels`) |
| Many-to-many `connect` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-nested-write.test.ts` (`create(): connect links an existing tag via junction`) |
| Many-to-many `disconnect` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-nested-write.test.ts` (`update(): disconnect removes the junction link`) |
| Many-to-many nested `create` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/mn-nested-write.test.ts` (`create(): nested create inserts the Tag row and the junction link`) |
| Mongo atomic op `inc` | — | — | 🟡 | |
| Mongo atomic op `mul` | — | — | 🟡 | |
| Mongo atomic op `push` | — | — | 🟡 | |
| Mongo atomic op `pull` | — | — | 🟡 | |
| Mongo atomic op `addToSet` | — | — | 🟡 | |
| `connectOrCreate` | ❌ | ❌ | — | |
| Nested `update` during parent write | ❌ | ❌ | — | |
| Nested `updateMany` during parent write | ❌ | ❌ | — | |
| Nested `upsert` | ❌ | ❌ | — | |
| Nested `delete` | ❌ | ❌ | — | |
| Nested `deleteMany` | ❌ | ❌ | — | |
| `set` (replace full relation set) | ❌ | ❌ | — | |
| Atomic `increment` in SQL ORM | ❌ | ❌ | — | |
| Atomic `decrement` in SQL ORM | ❌ | ❌ | — | |
| Atomic `multiply` in SQL ORM | ❌ | ❌ | — | |
| Atomic `divide` in SQL ORM | ❌ | ❌ | — | |
| Scalar-list `push` in update data | ❌ | ❌ | — | |
| Scalar-list `set` in update data | ❌ | ❌ | — | |
