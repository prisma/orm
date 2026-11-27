# Reduce what the GA packages export: plan

The purpose and the rules are in [spec.md](spec.md). The decision for each import path is in [audit.md](audit.md). The audit was last run on 2026-11-27, against `main` after the capabilities change (prisma/orm#31218).

## What the audit found

- **The facades carry most of the removable paths.** `@prisma/orm-postgres` keeps 32 of 167. The other four facades pass on the same platform paths, so they shrink with it.
- **The platform packages lose few paths.** The framework, the SQL family, the PostgreSQL target and the toolchain have 224 paths between them, and 46 can go. Almost every other path is imported by another package of ours across a package boundary: a target imports the family, a family imports the framework. Each module is published from exactly one package, so such a path cannot be unpublished.
- **The larger question in the platform packages is names, not paths.** The four GA platform packages export about 3,400 names. A first count finds about 1,700 that nothing outside their own package imports. That count is rough (it misses a type a user must be able to name without our code importing it), so each name needs a decision. This is slice 5 below, and it is not started until the operator has agreed its scope.
- **What generators write today is narrower than what stored files import.** A `contract.d.ts` emitted today imports one facade module, `contract-types`, and a migration file imports `migration`. Files written by earlier release candidates, and the type snapshots stored beside migrations, import `contract/types`, `family-contract/types`, `target/codec-types`, `target/operation-types` and `target/migration`. Those stay, so that stored files keep compiling.
- **Outside products.** Composer imports one facade path that goes (`family-contract/canonicalization-hooks`). The control plane imports four (`adapter/control`, `driver/control`, `target/control`, `driver/runtime`). The `prisma` tool imports only `@prisma/orm-toolchain/cli`, which stays. create-prisma writes only `runtime` and `static`, which stay.

## What every slice carries

- **A record for each break.** The API check (prisma/orm#31217) compares each package with the last release and fails on any break not recorded in the package's `api-breaks.json`. A removed import path is one record (`"export": "*"`, `"test": "path"`); a removed or renamed name is one record per test it fails. The reason says what the user's import changes to.
- **An "API changes" section** in the pull request description, naming each package whose `api.txt` or records changed.
- **Upgrade instructions** under `upgrade-instructions/pending/`, saying what each removed import changes to.
- **The status line below**, updated in the same pull request.

## Slices

Each slice is one pull request.

### 1. The Supabase extension builds on names any user can import

- Contract: [slices/1-supabase-supported-names.md](slices/1-supabase-supported-names.md).
- Status: merged in prisma/orm#31241.

### 2. The facades pass on only what an application uses

- The list of platform paths every facade passes on becomes an explicit list, in `packages/0-shared/publish-surface/src/shells.ts`, matching the audit's "keep" rows. `utils` goes entirely.
- The examples, docs and skills change every import of a removed path. Code that is an extension (the extension packages of the monorepo example, the in-application extension of the demo) imports the platform package. Application code that turns out to need a removed path is a finding to bring back, not something to work around.
- Status: not started.

### 3. The platform packages publish only the paths in the audit, and nothing published is named "internal"

- The PostgreSQL target, the toolchain, the SQL family and the framework stop publishing the audit's "remove" rows.
- `utils/internal-error` and `InternalError`, `isInternalError` and `isPrismaInternalError` get names without the word. So do `SqlParamRefMutatorInternal`, `MongoParamRefMutatorInternal`, `PreparedStatementInternals` and `SupabaseInternalDb`.
- The SQL family's `SqlRuntimeBase` and `ConnectionProvider` are GA, but slice 1 left their prepared-statement members keyed by `ea_preparedStatementQuery`, `ea_preparedStatementExecute` and `ea_transactionStart`, and typed with `Ea_TransactionStartTarget`. The API check judges a member like its class, so those Early Access names cannot change without a recorded GA break. Before 8.0, either those members get the same Early Access level (the whole extension seam of `SqlRuntimeBase` is below GA), or the names are promoted to GA. Decide from what an outside SQL target needs to subclass `SqlRuntimeBase`; this sits beside the `PreparedStatementInternals` rename.
- The package `@internal/extension-author-tools` is deleted. Its one tool checks exact versions of `@internal/*` names that no extension lists any more; from release 8.0 version ranges replace exact versions, and the package manager reports a mismatch at install.
- Status: not started.

### 4. Tickets and pull requests outside this repository

- prisma/prisma-cli: a ticket for the GA release of `@prisma/cli-engine` with the compatibility promise for `definePrismaConfig` and the config types.
- The control plane: its four imports change to `@prisma/orm-postgres/control`; a ticket or pull request in step with slice 2.
- Composer: its one import changes; a ticket or pull request in step with slice 2.
- Status: not started.

### 5. Names inside the kept platform paths (scope to agree)

- For each GA platform package, decide for each exported name whether it stays, gets a level prefix or stops being exported. One pull request per package.
- Status: proposed. Not started until the operator agrees the scope.

## Other work nearby

- The capabilities session is renaming `capabilities` to `requiredCapabilities` in `contract.json`, and the own-tables session is renaming the marker to signatures across exported names. Each slice checks with them before it changes an export they change.
- Slices 2 and 3 both edit `shells.ts`, so they go one after the other.
