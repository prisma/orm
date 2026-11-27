# Slice 1: the Supabase extension builds on names any user can import

One pull request. The project's purpose and rules are in [../spec.md](../spec.md).

## Why

The Supabase extension's client is a variant of the PostgreSQL client: it puts together the same parts as `postgres()`, with a database role bound first. To reuse those parts it imports four paths that the PostgreSQL facade publishes only for it, all named "internal":

```ts
import { connectWithBinding, resolveOptionalPostgresBinding, validateTransactionOptions } from '@prisma/orm-postgres/internal/options'
import { buildPostgresStaticContext } from '@prisma/orm-postgres/internal/static-context'
import { buildPostgresQueryMembers } from '@prisma/orm-postgres/internal/transaction-members'
import { validatePostgresContract } from '@prisma/orm-postgres/internal/validate-contract'
import { preparedStatementQuery } from '@prisma/orm-family-sql/runtime/internal/prepared-query'
```

Any user can import these today, and nothing tells them the names may change. After this slice the same parts have names that carry the Early Access level, on paths that already exist:

```ts
import { ea_connectWithBinding, ea_resolveOptionalPostgresBinding, ea_validateTransactionOptions, ea_buildPostgresQueryMembers } from '@prisma/orm-postgres/runtime'
import { ea_buildPostgresStaticContext } from '@prisma/orm-postgres/static'
import { Ea_PostgresRuntimeImpl, ea_validatePostgresContract } from '@prisma/orm-target-postgres/target/runtime'
import { ea_preparedStatementQuery } from '@prisma/orm-family-sql/runtime'
```

These functions are the seams inside `postgres()`, cut out so Supabase could reuse them. Exported at GA they would freeze the client's internal structure until Prisma 9. With the prefix they may change in any release, and they are promoted once a second caller shows which of them hold up.

## What changes

1. **Deleted:** the facade's four `internal/*` paths and the source files behind them.
2. **`@prisma/orm-postgres/runtime` adds**, with the prefix: `ea_resolveOptionalPostgresBinding`, `ea_connectWithBinding`, the type `Ea_PostgresBindingRules`, `ea_buildPostgresQueryMembers` and the type of its options, `ea_validateTransactionOptions`, `ea_validateCursorOptions`, `ea_toDriverCursorOptions`.
3. **`@prisma/orm-postgres/static` adds** `ea_buildPostgresStaticContext`. Its return type, `PostgresStaticContext`, is already exported there at GA and stays.
4. **Moves to the PostgreSQL target's `runtime` entry, with the prefix:** the runtime class Supabase subclasses (`Ea_PostgresRuntimeImpl`, today `PostgresRuntimeImpl` on the facade's `runtime`) and `ea_validatePostgresContract`. The facade's own code imports them from the target. The interface `PostgresRuntime` stays on the facade at GA.
5. **The SQL family's `runtime/internal/prepared-query` path is deleted.** Its exports move to the family's `runtime` entry with the prefix.
6. **Supabase imports only published entries** that any user can import, and `IsolationLevel` and `role` from where they are defined. It keeps naming `@prisma/orm-postgres` as a peer, which the build already writes.
7. **The decision record on the published packages** states the exception: an extension builds on the platform packages, except Supabase, which wraps the PostgreSQL facade's client. The record on packages naming each other as peers already says this.
8. **Records for the API check.** Every removed path and name is a break against the last release, recorded in the package's `api-breaks.json` with a reason. Every changed `api.txt` is named in the pull request's "API changes" section.
9. **Upgrade instructions** for extension authors: an extension that imported any of the removed names changes to the new one. No application imports them.

## Assumptions to check while building

- The PostgreSQL target may import the SQL runtime (`@internal/sql-runtime`) for the runtime class. If the layering check refuses it, that is a finding for the plan, not something to work around.
- `validatePostgresContract` and the facade's `contractFromJson` today share one validation cache key, built from the facade's version. After the move they must still share one key, so a contract validated by one is not validated again by the other.
- Prefix casing: a function or constant starts with `ea_`; a type or class with `Ea_` (`docs/oss/versioning.md`).

## Done when

- No path or name in this slice contains "internal".
- The Supabase extension's tests and the Supabase example pass in CI.
- The API check passes, with each break recorded.
- A drive code review of the final commit is clean.
