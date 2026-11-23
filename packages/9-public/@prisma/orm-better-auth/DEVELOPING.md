# Developing @prisma/orm-better-auth

Notes for people who change this package. For how to use it, see the [README](README.md). For why it is built as it is, see [ADR 328](../../../../docs/architecture%20docs/adrs/ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md).

## Rules the package keeps

- `src/` imports only `@prisma/orm-framework`, `@prisma/orm-family-sql` and `@better-auth/core`. It imports no private package of the Prisma repository and no database package. `pnpm lint:consumer-internal-imports` and `test/repository-packages.test.ts` check this.
- Errors the package raises are `BetterAuthError`s, because Better Auth and its command-line program recognise that class. Errors from the Prisma client pass through unchanged.
- No classes and no Node-only API in `src/`, which Better Auth's own repository requires of its adapters.

## Choices that look wrong but are deliberate

- **The adapter id is `prisma-8`, not `prisma`.** Better Auth's command-line program treats the id `prisma` as its own Prisma 7 adapter.
- **Pattern filters (`contains`, `starts_with`, `ends_with`) do not use `LIKE`.** Prisma 8's `like` has no escape clause, so `%` and `_` in a value would act as wildcards, and SQLite's `LIKE` ignores ASCII case. The filters compare raw string expressions instead, which is the same SQL on both databases.
- **MySQL and MariaDB are refused.** Those filters would be wrong there: `length()` counts bytes, and the default collation ignores case. Adding the targets to the accepted list is not enough; the filters must be made right and Better Auth's suites run on those databases first.
- **`consumeOne` and `incrementOne` are not implemented.** Better Auth then uses its own fallback, a read followed by a guarded delete or update. The Prisma client cannot delete one row and return it in one statement, or update a column with an expression such as `count = count + 1`.
- **JSON and list fields are stored as text.** The adapter tells Better Auth it supports neither, so Better Auth serialises them.
- **Every call applies a filter, even an empty one.** Without `where`, the Prisma client's `update()` and `delete()` act on one arbitrary row.
- **The peer range for `@better-auth/core` stops below the next minor version.** The contract check is registered through `registerSchemaCheck` from `@better-auth/core/db/internal`, which Better Auth labels internal. The module is imported as a namespace and the function is used only when it exists, so a release that removes it leaves the adapter working without the check. Widen the range only after running the conformance suites against the new minor version.
- **The inside is loosely typed.** No published type says "a client whose contract contains these models". Correctness comes from the contract at run time, the contract check and the tests.

## Tests

- `test/conformance/` runs Better Auth's own adapter suites on Postgres and SQLite. No test in them is disabled, and none may be.
- `test/integration/test/packaging/orm-better-auth-tarball.test.ts`, in the Prisma repository, installs the packed package outside the workspace and runs the real `auth generate` and `auth check` against it. It runs in the merge queue, not on pull requests, so run that file locally when you change the contract check or the manifest.
