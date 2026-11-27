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
import { Ea_PostgresRuntimeImpl } from '@prisma/orm-postgres/runtime'
import { ea_buildPostgresStaticContext, ea_validatePostgresContract } from '@prisma/orm-postgres/static'
import { ea_preparedStatementQuery } from '@prisma/orm-family-sql/runtime'
```

These functions are the seams inside `postgres()`, cut out so Supabase could reuse them. Exported at GA they would freeze the client's internal structure until Prisma 9. With the prefix they may change in any release, and they are promoted once a second caller shows which of them hold up. One exception: the prepared-query names also key members of the SQL family's GA class `SqlRuntimeBase`, so changing them is still a GA break until slice 3 settles that class's level.

## What changes

1. **Deleted:** the facade's four `internal/*` paths and the source files behind them.
2. **`@prisma/orm-postgres/runtime` adds**, with the prefix: `ea_resolveOptionalPostgresBinding`, `ea_connectWithBinding`, the type `Ea_PostgresBindingRules`, `ea_buildPostgresQueryMembers` and the type of its options, `ea_validateTransactionOptions`, `ea_validateCursorOptions`, `ea_toDriverCursorOptions`.
3. **`@prisma/orm-postgres/static` adds** `ea_buildPostgresStaticContext`. Its return type, `PostgresStaticContext`, is already exported there at GA and stays.
4. **The runtime class and the contract check stay in the facade, with the prefix.** `PostgresRuntimeImpl`, which Supabase subclasses, becomes `Ea_PostgresRuntimeImpl` on `@prisma/orm-postgres/runtime`. `validatePostgresContract` becomes `ea_validatePostgresContract` on `@prisma/orm-postgres/static`, beside `contractFromJson`, with which it shares one validation cache key. The interface `PostgresRuntime` stays on `runtime` at GA. The design said both move to the PostgreSQL target; see "Decided when building resumed" for why they do not.
5. **The SQL family's `runtime/internal/prepared-query` path is deleted.** The seven names Supabase uses move to the family's `runtime` entry with the prefix: `ea_preparedStatementQuery`, `ea_preparedStatementExecute`, `ea_transactionStart`, `ea_createTransactionStart` and the types `Ea_PreparedStatementQueryTarget`, `Ea_PreparedStatementExecuteTarget`, `Ea_TransactionStartTarget`. The path's other names, which nothing outside the package uses, are not exported.
6. **Supabase imports only published entries** that any user can import. `IsolationLevel` and `role` already come from the facade's public `runtime` and `contract-builder` entries and stay there. It keeps naming `@prisma/orm-postgres` as a peer, which the build already writes.
7. **The decision record on the published packages** states the exception: an extension builds on the platform packages, except Supabase, which wraps the PostgreSQL facade's client. The record on packages naming each other as peers already says this.
8. **Records for the API check.** Every removed path and name is a break against the last release, recorded in the package's `api-breaks.json` with a reason. Every changed `api.txt` is named in the pull request's "API changes" section.
9. **Upgrade instructions** for extension authors: an extension that imported any of the removed names changes to the new one. No application imports them.

## Assumptions to check while building

- The PostgreSQL target may import the SQL runtime (`@internal/sql-runtime`) for the runtime class. If the layering check refuses it, that is a finding for the plan, not something to work around.
- `validatePostgresContract` and the facade's `contractFromJson` today share one validation cache key, built from the facade's version. After the move they must still share one key, so a contract validated by one is not validated again by the other.
- Prefix casing: a function or constant starts with `ea_`; a type or class with `Ea_` (`docs/oss/versioning.md`).

## Decided when building resumed (2026-11-28)

- **The runtime class stays in the facade.** The PostgreSQL target's runtime entry says it does not import `@internal/sql-runtime` on purpose: the target is also loaded by the control plane (migrations, `prisma orm` commands), and it keeps the SQL execution code out of that dependency closure. `PostgresRuntimeImpl` extends `SqlRuntimeBase` from `@internal/sql-runtime`, so moving it would put the execution package into everything that depends on the target. The design moved it because the target is where a second facade would build; but Supabase already depends on the facade, which holds the class today, so the move buys nothing and costs the target its boundary. The operator's agreement was conditional ("if it is [appropriate] I'm happy to pull it up to the target"), and this is the evidence that it is not.
- **`validatePostgresContract` stays beside `contractFromJson`.** It needs nothing from the SQL runtime, so it could move. But it shares a validation cache key with `contractFromJson`, built from the facade's version, so that a contract validated by one is not validated again by the other. Keeping both in one module keeps that one key without exporting it. With the runtime class staying in the facade, nothing is gained by splitting them.
- **Only the prepared-query names Supabase uses are exported.** Every exported name is promised in some form; names nobody outside the package uses are not.

## Found when building started (2026-11-27)

- **The target and the SQL runtime** (settled above). The layering rules allow the PostgreSQL target to import `@internal/sql-runtime`, and the SQLite target already does. But a comment in `packages/3-targets/postgres/1-target/src/exports/runtime.ts` says the PostgreSQL target does not import it on purpose, so the target stays control-plane only. Moving the runtime class there contradicts that comment. Before building, find out what the comment protects; if it still holds, the class stays in the facade with the prefix (`Ea_PostgresRuntimeImpl` on `@prisma/orm-postgres/runtime`) instead.
- **One validation key** (settled above). `contractFromJson` and `validatePostgresContract` share a cache entry keyed `postgres@<facade version>` (`static/contract-from-json.ts`).
- **Four facades, not one.** Deleting the family's `runtime/internal/prepared-query` also removes `family-runtime/internal/prepared-query` from `@prisma/orm-postgres`, `-mysql`, `-mariadb` and `-sqlite`. Each records the break, and the API check runs on each.
- **Other files:** `architecture.config.json` lists the four `internal-*.ts` files; `test/integration/test/sql-orm-client/runtime-helpers.ts` and `packages/9-public/@prisma/orm-target-postgres/test/cross-shell-tarball.test.ts` import the prepared-query path; the facade tests `test/internal-options.test.ts` and `test/internal-validate-contract.test.ts` are the existing pattern for checking what an entry exports; the facade README and the runtime subsystem doc name `PostgresRuntimeImpl`.
- **Names with "internal" that stay after this slice**, for slice 3: Supabase imports `InternalError` and exports `SupabaseInternalDb`; the family's root entry exports `PreparedStatementInternals`.
- **Stopgaps to keep until 8.0.** Declarations marked "Prisma 8.0 removes" in their doc comments (for example `retiredCapabilities`, `POSTGRES_MIN_SERVER_VERSION` on `./target/server-version`, `postgresAdapterCapabilities` on `./adapter/adapter`) stay; `test/e2e/framework/test/release-candidate-project.test.ts` proves a release-candidate project still works. This also applies to slices 2 and 3.

## Done when

- No path or name in this slice contains "internal".
- The Supabase extension's tests and the Supabase example pass in CI.
- The API check passes, with each break recorded.
- A drive code review of the final commit is clean.
