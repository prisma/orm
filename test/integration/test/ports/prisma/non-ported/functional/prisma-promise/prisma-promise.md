# Non-ported — prisma-promise

The suite tests that every Prisma Client query method returns a `PrismaPromise` — a lazy thenable exposing idempotent `.then()`, `.catch()`, AND `.finally()`. Prisma 8's ORM methods return `AsyncIterableResult<Row>` (`packages/1-framework/1-core/framework-components/src/execution/async-iterable-result.ts`), which `implements AsyncIterable<Row>, PromiseLike<Row[]>` and exposes ONLY `.then()` — there is no `.catch()` and no `.finally()`. The `%s > fluent promises should have promise properties` cases assert `'catch' in promise` and `'finally' in promise` are true, which is false for `AsyncIterableResult`. The `.catch`/`.finally` cases call methods that do not exist. The subject (a `PrismaPromise` with the full thenable surface) has no Prisma 8 equivalent. Additionally the `$queryRaw`/`$queryRawUnsafe`/`$executeRaw`/`$executeRawUnsafe` operation rows have no Prisma 8 surface at all (no raw-SQL-string executor).

The upstream matrix iterates 17 operations × 5 case-templates (`repeated calls to .then` / `.catch` / `.finally` / `repeated mixed calls` / `fluent promises should have promise properties`). All are non-ported for the reasons above.

- `packages/client/tests/functional/prisma-promise/tests.ts` › `%s > repeated calls to .then` (all operations) — `AsyncIterableResult` has `.then` only; the PrismaPromise idempotent-thenable subject is not reproducible, and the raw-* operations have no executor
- `packages/client/tests/functional/prisma-promise/tests.ts` › `%s > repeated calls to .catch` (all operations) — `AsyncIterableResult` has no `.catch()`
- `packages/client/tests/functional/prisma-promise/tests.ts` › `%s > repeated calls to .finally` (all operations) — `AsyncIterableResult` has no `.finally()`
- `packages/client/tests/functional/prisma-promise/tests.ts` › `%s > repeated mixed calls to .then, .catch, .finally` (all operations) — `AsyncIterableResult` has no `.catch()`/`.finally()`
- `packages/client/tests/functional/prisma-promise/tests.ts` › `%s > fluent promises should have promise properties` (all operations) — asserts `'catch' in promise` / `'finally' in promise`; false on `AsyncIterableResult`

Operations covered by the `%s` axis: create, createMany, findMany, findFirst, findUnique, findUniqueOrThrow, findFirstOrThrow, update, updateMany, delete, deleteMany, aggregate, count, `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe` (the four raw ops additionally have no Prisma 8 surface).
