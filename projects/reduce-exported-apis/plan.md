# Reduce what the GA packages export: plan

The purpose and the rules are in [spec.md](spec.md). The decision for each import path is in [audit.md](audit.md).

## What the audit found

- **The facades carry most of the removable paths.** `@prisma/orm-postgres` keeps 32 of 163. The other four facades pass on the same platform paths, so they shrink with it.
- **The platform packages lose few paths.** The framework, the SQL family, the PostgreSQL target and the toolchain have 220 paths between them, and 45 can go. Almost every other path is imported by another package of ours across a package boundary: a target imports the family, a family imports the framework. Each module is published from exactly one package, so such a path cannot be unpublished.
- **The larger question in the platform packages is names, not paths.** The four GA platform packages export about 3,400 names. A first count finds about 1,700 that nothing outside their own package imports. That count is rough (it misses a type a user must be able to name without our code importing it), so each name needs a decision. This is the part the stream's plan expected might make this project two. It is slice 4 below, and it is not started until the operator has agreed its scope.
- **What generators write today is narrower than what stored files import.** A `contract.d.ts` emitted today imports one facade module, `contract-types`. Files written by earlier release candidates, and the type snapshots stored beside migrations, import `contract/types`, `family-contract/types`, `target/codec-types` and `target/operation-types`. Those four stay, so that stored files keep compiling.
- **Outside products.** Composer imports one facade path that goes (`family-contract/canonicalization-hooks`). The control plane imports four (`adapter/control`, `driver/control`, `target/control`, `driver/runtime`) and names the package root, which has no export. The `prisma` tool imports only `@prisma/orm-toolchain/cli`, which stays. create-prisma writes only `runtime` and `static`, which stay.

## Slices

Each slice is one pull request. Each carries its own upgrade instructions, its `api.txt` changes with the explanation the API check requires, and the status update to this file.

### 1. The facades pass on only what an application uses

- The list of platform paths every facade passes on becomes an explicit list of paths, in `packages/0-shared/publish-surface/src/shells.ts`, matching the audit's "keep" rows. `utils` goes entirely.
- The examples and the docs and skills change every import of a removed path. Code that is an extension (the extension packages of the monorepo example, the in-application extension of the demo) imports the platform package. Application code that turns out to need a removed path is a finding to bring back, not something to work around.
- Upgrade instructions say what each removed path changes to, with a script where the change is mechanical.
- Status: not started.

### 2. The platform packages publish only the paths in the audit, and nothing is named "internal"

- The PostgreSQL target, the toolchain, the SQL family and the framework list the paths they publish, without the audit's "remove" rows.
- `utils/internal-error` and `InternalError`, `isInternalError` and `isPrismaInternalError` get names without the word. So do `SqlParamRefMutatorInternal`, `MongoParamRefMutatorInternal` and `PreparedStatementInternals`.
- Depends on nothing. It touches `shells.ts`, as slice 1 does, so it follows slice 1.
- Status: not started.

### 3. The Supabase extension builds on supported names

- As the spec records under "Decisions already made": the facade's four `internal` paths are deleted; the parts Supabase uses are exported with the Early Access prefix from `runtime` and `static`; the runtime class and `validatePostgresContract` move to the PostgreSQL target with the prefix; the SQL family's `internal/prepared-query` exports get Early Access names; Supabase names the facade as a peer.
- The decision record on the published packages and the one on packages naming each other as peers each gain the sentence that states the exception.
- `SupabaseInternalDb` is renamed.
- Waits for prisma/orm#31218 (capabilities by database version), which changes the same facade and Supabase files.
- Status: not started.

### 4. Names inside the kept platform paths (scope to agree)

- For each GA platform package, decide for each exported name whether it stays, gets a level prefix or stops being exported. One pull request per package.
- Status: proposed. Not started until the operator agrees the scope.

### 5. Tickets and pull requests outside this repository

- prisma/prisma-cli: a ticket for the GA release of `@prisma/cli-engine` with the compatibility promise for `definePrismaConfig` and the config types.
- The control plane: its five imports change; a ticket or pull request in step with slice 1.
- Composer: its one import changes; a ticket or pull request in step with slice 1.
- Status: not started.

## Order with the other work in flight

- prisma/orm#31218 (capabilities) changes the PostgreSQL facade's runtime and the Supabase runtime. Slice 3 waits for it.
- prisma/orm#31212 (levels and versions) changes `shells.ts` and the build of the published packages. Slices 1 and 2 edit other parts of `shells.ts`; whichever merges second merges `main` in.
- prisma/orm#31217 (API break detection) adds the check that a pull request explains its `api.txt` changes. Every slice here writes that explanation whether or not the check has merged.
