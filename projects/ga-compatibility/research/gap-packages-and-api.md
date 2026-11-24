# Gap check: packages, API and maturity levels

- Rules checked: 81. True today: 15. Partly true: 19. Not true: 26. Nothing to check: 21.
- Not true and no plan task (1 of 3): runtime behaviour and error codes stay stable (section 3); CLI commands, config file and machine-readable output stay compatible (section 3); a later release reads a contract with no re-emit (section 3).
- Not true and no plan task (2 of 3): migration files, snapshots and ref files are read by later releases (section 3); the CLI and the library must share a major, and the CLI stops when they do not (4.3); each exhaustively handled set is declared open or closed, and an open set's type has a catch-all member (5.1).
- Not true and no plan task (3 of 3): a change to specified behaviour waits for a major, which needs reference documentation that does not exist (5.2); a minor adds support for each new version of Node.js, databases and drivers, which CI does not test (5.5); TypeScript is supported up to the newest release and the next release is tested before it ships (5.5).
- Covered only in part by a plan task: exported names that contain "Internal" (task 8 covers import paths only); a release pipeline that can publish a package at its own pre-release version and tag (task 1 decides the scheme, no task builds it); exact pins between our packages that outlive `8.0.0` (no task); ADR 222 saying "we raise floors freely" (task 6 does not revise it).

Checked on 2026-11-23 against this worktree (all packages at `8.0.0-rc.24`). The sibling product clones under `wip/repos/` are older: prisma-cli from 2026-11-16, Composer from 2026-11-20. "Task N" means the numbered task in `plan.md`.

## Facts used in several entries

- **Published packages.** `pnpm list -r` finds 132 workspace packages, of which exactly 21 are not private: the ones under `packages/9-public/@prisma/`. None declares an `engines` field. Together they have 1,036 export paths; `@prisma/orm-postgres` has 164.
- **One version for everything.** `scripts/set-version.ts` writes one version into every workspace `package.json` (lines 54-70) and rewrites every `workspace:` dependency to `workspace:<that version>` (`scripts/set-version-utils.ts:42-52`). `pnpm publish` turns that into an exact version. So every published package depends on its siblings by exact version, and the extension packages declare an exact peer on `@prisma/orm-target-postgres`.
- **Which versions can be published.** `scripts/determine-version-utils.ts:6-13` accepts only `X.Y.Z` or `8.0.0-rc.N` as the root version, and `assertCanonicalBase` (line 154) rejects anything else. `pnpm bump-version` only advances `rc.N` to `rc.N+1` (`computeNextReleaseVersion`, line 49), so `8.0.0` needs a hand edit of the root version. A push that changes the root version publishes all 21 packages under `latest` (`planPushPublish`, line 81). A manual dispatch can choose another tag, but still one tag and one version for every package (`.github/workflows/publish.yml`, inputs at lines 33-44; `scripts/publish-packages.mjs` publishes every non-private package with the same `--tag`).
- **Reference documentation.** Each public package ships only `dist` (and the facades also `skills`): see the `files` field in each `package.json`. No reference documentation ships in any package.

## Section 2: Definitions

**2. "Terms follow `docs/glossary.md`, except Extension, which this policy uses more broadly."**
Status: nothing to check. A definition.

**2. "Major: all releases that share a major version number."**
Status: nothing to check.

**2. "Extension package: a published package that contains an extension, such as `@prisma/orm-extension-pgvector`."**
Status: true today. Six packages named `orm-extension-*` exist, plus `@prisma/orm-postgres-contrib` (citext), which is an extension package without "extension" in its name. Each depends only on `orm-framework`, `orm-family-sql` and sometimes `orm-toolchain`, except `orm-extension-supabase`, which also depends on the facade `orm-postgres` (see 4.3).

**2. "Facade: the package an application installs for its database, such as `@prisma/orm-postgres`."**
Status: true today. Five facades exist: `orm-postgres`, `orm-mysql`, `orm-mariadb`, `orm-sqlite`, `orm-mongo`. Each depends on the framework, toolchain, family and target packages for its database.

**2. "Platform packages: `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-*` and `@prisma/orm-target-*`."**
Status: true today. These are `orm-framework`, `orm-toolchain`, `orm-family-sql`, `orm-family-mongo` and five `orm-target-*` packages, all published.

**2. "Internal: not exported by any published package."**
Status: nothing to check. A definition. Note that the word is also used in published import paths today (see 4.3).

**2. "GA" and "Below GA".**
Status: nothing to check.

**2. "Reference documentation: the precise description of each API, command, file format and error code."**
Status: nothing to check. A definition. No such documentation exists in the repository today (see "Facts used in several entries").

**2. "Contract: `contract.json` plus generated types, emitted from the contract source in PSL or TypeScript."**
Status: true today. Examples carry `contract.json` and `contract.d.ts`, for example `examples/paradedb-demo/src/prisma/contract.d.ts`.

**2. "Contract space: one owner's contract, migrations and marker."**
Status: true today. The marker table's primary key is the `space` column, defaulting to the application's space (`packages/3-targets/postgres/1-target/src/contract-free/control-bootstrap.ts:7`).

**2. "Storage hash: a hash computed from a contract's target, family and `storage` section."**
Status: partly true. `computeStorageHash` hashes target, family and storage, but `hashContract` also passes `schemaVersion: SCHEMA_VERSION` into the canonical form it hashes (`packages/1-framework/0-foundation/contract/src/hashing.ts:66-67`). The profile hash covers capabilities and the execution hash covers execution defaults, as defined (same file, lines 88-106).
Work: remove the format version from the hash input, as spec section 6.3 already requires. No plan task covers it.

**2. "Migration hash: a hash of one migration's recorded content."**
Status: true today. The toolchain exports it as `./migration-tools/hash`.

**2. "Ref file", "Marker", "Ledger", "Signing (`db sign`) writes the marker."**
Status: true today. Ref files are handled in `packages/1-framework/3-tooling/migration/src/refs.ts`; marker and ledger tables are created in `control-bootstrap.ts`; `db sign` is in the toolchain.

**2. "Framework ... `packages/1-framework` is the framework domain. Target. Family."**
Status: true today. The directory layout matches: `packages/1-framework`, `packages/2-sql-family`, `packages/2-mongo-family`, `packages/3-targets`.

**2. "Control plane: the APIs that plan and apply migrations."**
Status: nothing to check.

## Section 3: What an application depends on

**3. "Each row will have its own design document."**
Status: not true. No design document exists yet for any row. `research/` holds research only.
Work: write one per row. Task 4 (marker and ledger tables) and task 5 (API comparison) each call for one. The other rows have no task.

**3. Row "TypeScript API: code that compiles against one release compiles against every later release."**
Status: not true. Nothing compares one release's exported API with the previous one, and 1,036 export paths are published with no indication of which are meant to be covered.
Work: reduce the exports and build the comparison check. Tasks 3 and 5.

**3. Row "Runtime behaviour and error codes: specified behaviour does not change."**
Status: not true. Without reference documentation nothing is specified, so nothing can be held stable. `scripts/list-error-codes.mjs` lists the error codes in the source and can check that a docs page names each one (`--verify`), but nothing detects a removed or renamed code.
Work: write the reference documentation and add a check that fails when an error code disappears. No plan task covers either.

**3. Row "Contract source: a source one release accepts, every later release accepts."**
Status: partly true. PSL resolves user names before built-in names (see 5.1). But the TypeScript builder's `defaultSql` is marked "Removed in 8.0.0" (`packages/2-sql-family/2-authoring/contract-ts/src/contract-dsl.ts:521-522`), which is allowed before `8.0.0`. No test keeps sources from earlier releases and checks they still emit. The upgrade-instruction tests cover individual breaking changes only.
Work: a check that keeps contract sources and confirms each later release still accepts them. No plan task.

**3. Row "CLI commands, machine-readable output, config file: keep working and stay compatible."**
Status: not true. No check compares command output or config handling across releases. The config file every application has imports `definePrismaConfig` from `@prisma/cli-engine`, a separate package at version `0.10.0` (for example `examples/mongo-demo/prisma.config.ts:1`; the init template at `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts:20`). The toolchain declares an exact peer on it (`"@prisma/cli-engine": "0.10.0"` in `packages/9-public/@prisma/orm-toolchain/package.json`). Under Semantic Versioning a `0.x` package promises no compatibility.
Work: a check that keeps CLI output and config samples, and a decision on how the config file's own package is covered. No plan task.

**3. Row "Contract: read by every later release, with no re-emit required."**
Status: not true. Contract readers reject unknown keys (`'+': 'reject'` throughout `packages/1-framework/0-foundation/contract/src/contract-value-object-schema.ts`). No reader checks `schemaVersion`. The format version is a hash input (see section 2).
Work: the changes listed in spec section 6.2 and 6.3. No plan task covers them.

**3. Row "Migrations on disk: read and applied by every later release."**
Status: not true. Migration files and ref files carry no format version, and an unknown field in `migration.json` fails the load (see `analysis.md`, "Stored data").
Work: add format versions and readers that check them (spec 6.2). No plan task.

**3. Row "Database records: marker and ledger read by every later release."**
Status: not true. The PostgreSQL bootstrap creates the tables only if they are absent (`control-bootstrap.ts`), so a ledger from before June 2026 lacks columns the current release writes.
Work: task 4.

**3. Row "Platform: a minimum rises only in a new major, or in a minor when its maker ends support."**
Status: partly true. See 5.5.

**3. Row "The platform packages' APIs: a release does not break an extension."**
Status: not true. Same position as the TypeScript API row. In addition, the Supabase extension imports four of the facade's `internal` entrypoints (see 4.3).
Work: tasks 3, 5, 7 and 8.

## Section 4: Maturity and what is covered

**4.1 "A user tells what is covered from the package's version number and the API's name."**
Status: not true. All 21 packages publish the same version, and the release scripts cannot produce a version that carries a level (see "Facts used in several entries"). No exported name carries a level.
Work: decide the version scheme (task 1) and change the release scripts and workflow to publish it. No task covers the script and workflow change.

**4.2 "One scale, for packages and for single APIs: Early Access, Preview and Generally Available."**
Status: not true. No package or API states a level. The MySQL, MariaDB, `target-mysql` and `target-mariadb` READMEs say support is "early"; SQLite, MongoDB and ParadeDB say nothing.
Work: task 1.

**4.3 "An application depends on one facade, on the extension packages it installs, and on the `prisma` command-line tool. It depends on nothing else from us."**
Status: partly true. The examples import only from facades and extension packages; none imports a platform package directly, and `scripts/lint-consumer-internal-imports.mjs` fails if a consumer names an `@internal/*` package. But every application also depends on `@prisma/cli-engine` for `definePrismaConfig`: 26 example imports, an exact `0.10.0` pin in each example's `package.json`, and `prisma orm init` installs it as a dev dependency (`packages/1-framework/3-tooling/cli/src/orm/init-packages.ts:6-35`).
Work: either the facade or `prisma` provides `definePrismaConfig`, or the list of what an application depends on names `@prisma/cli-engine`. No plan task.

**4.3 "The facade re-exports everything an application reaches."**
Status: partly true. The facade re-exports its family, target, toolchain and framework entrypoints (for example `./migration-tools/*`, `./family/*`, `./target/*`, `./config`), and examples reach everything through it, except `definePrismaConfig` (above).
Work: as above. No plan task.

**4.3 "Extension authors build against the platform packages. An application reaches them through its facade."**
Status: partly true. Every first-party extension package depends only on platform packages, except `@prisma/orm-extension-supabase`, which depends on `@prisma/orm-postgres` and imports its `internal/options`, `internal/static-context`, `internal/transaction-members` and `internal/validate-contract` entrypoints (`packages/3-extensions/supabase/src/runtime/supabase.ts`).
Work: task 7.

**4.3 "Both audiences are covered under identical rules. A package's audience is information for the reader."**
Status: nothing to check.

**4.3 "Every published package exports as little as possible. Before `8.0.0` we remove each export we do not intend to cover."**
Status: not true. 1,036 export paths. `@prisma/orm-postgres` alone exports 164, including general helpers such as `./utils/array-equal`, `./utils/canonical-stringify`, `./utils/casts` and `./utils/simplify-deep`, and planner internals such as `./target/planner-ddl-builders`.
Work: task 3.

**4.3 "File formats and machine-readable command output are covered."**
Status: nothing to check. A statement of scope; the gaps are in the section 3 rows.

**4.3 "Nothing we publish is named 'internal'. No published import path contains the word."**
Status: not true. 15 published import paths in 7 packages contain it: `orm-postgres` has `./internal/options`, `./internal/static-context`, `./internal/transaction-members`, `./internal/validate-contract`, `./family-runtime/internal/prepared-query` and `./utils/internal-error`; `orm-mysql`, `orm-mariadb` and `orm-sqlite` each have `./family-runtime/internal/prepared-query` and `./utils/internal-error`; `orm-mongo` and `orm-framework` have `./utils/internal-error`; `orm-family-sql` has `./runtime/internal/prepared-query`. Exported names also contain the word: `InternalError` and `isInternalError` (`orm-framework` `./utils` and `./utils/internal-error`), `SqlParamRefMutatorInternal` (`orm-family-sql` `./relational-core`), `PreparedStatementInternals` (`orm-family-sql` `./runtime`), `MongoParamRefMutatorInternal` (`orm-family-mongo` `./runtime`) and `SupabaseInternalDb` (`orm-extension-supabase` `./runtime`).
Work: rename or remove the paths (task 8) and the names. No task names the exported names; task 3 may remove some of them.

**4.3 "Our own products that build on the ORM follow the same rules as any user. They use only what is covered and get no special access."**
Status: partly true. The `prisma` CLI imports only `@prisma/orm-toolchain/cli` (`wip/repos/prisma-cli/packages/cli/src/cli.ts:11`). Composer imports only exported, non-internal entrypoints, but many of them: the toolchain's `./migration-tools/spaces`, `/io`, `/refs`, `/hash`, `./config-loader` and `./cli`, and the facade's `./control`, `./family/control` and `./family-contract/canonicalization-hooks`. Which of these stay covered depends on task 3. The Supabase extension uses the facade's internal entrypoints.
Work: task 7 for Supabase. Task 3 must keep or replace each entrypoint the sibling products use; the task does not say so today.

**4.3 "The command-line tool and the library in one project have the same major version. When they do not, the tool stops and says so."**
Status: not true. The `prisma` CLI bundles its own toolchain at an exact version (`wip/repos/prisma-cli/packages/cli/package.json:56`, `"@prisma/orm-toolchain": "8.0.0-rc.24"`). Neither the CLI nor the toolchain reads the version of the facade installed in the project or compares majors. The only version comparisons in the toolchain are of database server versions (`packages/1-framework/3-tooling/cli/src/commands/init/probe-db.ts`) and telemetry.
Work: the CLI or toolchain reads the installed facade's version and stops on a different major. No plan task.

**4.3 "The release candidates force anything that depends on the ORM to pin an exact version. That requirement ends at `8.0.0`."**
Status: partly true. The first half is true: published packages pin each other exactly, and extension packages declare exact peers on `@prisma/orm-target-postgres`, so a consumer that mixes versions gets peer conflicts. The second half is not: nothing in `set-version.ts` or the publish workflow changes the pins at `8.0.0`. After `8.0.0`, an extension at `8.1.0` would still require `@prisma/orm-target-postgres` at exactly `8.1.0`, so an application that upgrades its facade to `8.2.0` without the extension gets a peer conflict. Separately, the two pin checks (`scripts/check-publish-deps.mjs`, `findPnPinViolations`; and `packages/0-shared/extension-author-tools/bin/prisma-8-check-pins.mjs`) only look at `@internal/*` names, which no published manifest contains any more, so they check nothing.
Work: decide the dependency and peer ranges between our packages from `8.0.0` and change `rewriteWorkspaceDeps` to write them. No plan task.

**4.4 "Prisma 8 has no feature flags."**
Status: true today. No config option or environment variable switches functionality on. Package source reads only `DATABASE_URL`, `MONGODB_URL`, `PRISMA_DEBUG`, `PGOPTIONS`, `CI` and a few path variables. The only `previewFeatures` handling reads a Prisma 7 schema (`packages/2-sql-family/2-authoring/contract-prisma7/src/extensions.ts:64-96`).

**4.4 "Functionality that is not ready for GA ships in its own package below GA, or as an API whose name carries its level."**
Status: partly true. MySQL, MariaDB, SQLite, MongoDB and ParadeDB are in their own packages, but those packages carry no level (same version as the rest). No exported name uses a level prefix.
Work: task 1, plus the release pipeline change in 4.1.

**4.4 "A change that cannot be an extension ships as a new API beside the old one or waits for the next major."**
Status: nothing to check. A rule for future changes.

## Section 5: API and behaviour compatibility

**5.1 "A release may add features at any time. An addition must not affect an application that does not use it."**
Status: partly true. Nothing checks it. One existing case breaks it: a contributed aggregate operation whose name matches a collection builder member is refused with `ORM.AGGREGATE_OPERATION_RESERVED` (`packages/3-extensions/sql-orm-client/src/orm.ts`, `assertAggregateOperationsNotReserved`), so adding a builder member can make an existing extension throw.
Work: task 5 reports every addition for review. Nothing covers the aggregate-name collision.

**5.1 "A new member on an interface users implement is optional, and our code behaves as before where it is missing."**
Status: partly true. The middleware interfaces follow it today: every member of `RuntimeMiddleware` and `SqlMiddleware` except `name` is optional (`packages/1-framework/1-core/framework-components/src/execution/runtime-middleware.ts:160-203`, `packages/2-sql-family/5-runtime/src/middleware/sql-middleware.ts:31`). Extension descriptors (`ComponentDescriptor`, `RuntimeExtensionDescriptor`, `ControlExtensionDescriptor`, `SqlRuntimeExtensionDescriptor`) are plain interfaces any object can implement. Nothing records which exported interfaces users implement, so neither a reviewer nor a check can tell when an added required member breaks implementers.
Work: record which interfaces users implement and have the task 5 check treat a new required member on them as a break. Task 5 covers the check in part.

**5.1 "Exception: an interface whose type has a member user code cannot write, such as a `#private` field, may gain a required member if our base class or factory implements it."**
Status: nothing to check. A permission. Some exported base classes already have `#private` fields, for example `Migration` (`packages/1-framework/3-tooling/migration/src/migration-base.ts:176-177`).

**5.1 "Each set that user code handles exhaustively is declared open or closed in `8.0.0`. An open set's type carries a catch-all member."**
Status: not true. No set is declared either way. The main error type is open by its type: `StructuredError.code` is `${string}.${string}` (`packages/1-framework/0-foundation/utils/src/structured-error.ts:28`). But published closed unions without a catch-all exist, for example `SqlMigrationRunnerErrorCode` (`packages/2-sql-family/9-family/src/core/migrations/types.ts:424`, exported from `orm-family-sql` `./family` and `./family/control`) and `EmitFailureCode` (`packages/1-framework/3-tooling/cli/src/control-api/types.ts:617`, in the toolchain). The `kind` discriminants of query-tree nodes are another such set, which the Supabase extension branches on.
Work: list every exported set a user may switch on, declare each open or closed, and add a catch-all member to the open ones. No plan task.

**5.1 "Error codes are an open set; existing codes remain stable; the generated reference documentation lists them."**
Status: partly true. Codes are open by type (above). `scripts/list-error-codes.mjs` generates the list for the docs page in prisma/web and verifies the page names every code. Nothing detects a removed or renamed code, and the list does not ship in any package.
Work: a check that fails when a code disappears. No plan task.

**5.1 "Adding a built-in name never changes the meaning of what a user has written. The user's own name takes precedence, and there is a way to refer to each."**
Status: partly true. PSL meets it: `DocumentScope` and `NamespaceScope` resolve user declarations before `ContributedScope`, and contributed types can be written with a qualified name (`packages/1-framework/2-authoring/psl-parser/src/scope.ts:79-138`). The ORM client does not fully meet it: a user namespace named `fragment` replaces the built-in `db.orm.fragment`, which then cannot be reached (`packages/3-extensions/sql-orm-client/src/orm.ts`, type `OrmClient`). And for contributed aggregate operations the built-in name wins and the extension is refused (see the first 5.1 entry).
Work: give each built-in on the ORM client a way to be reached when a user name hides it, and make the aggregate-name collision follow the rule. No plan task.

**5.2 "A fix to behaviour that was wrong is permitted in a minor or patch."**
Status: nothing to check.

**5.2 "A change to specified behaviour is not permitted in a minor or patch."**
Status: not true. Specified behaviour is what the reference documentation states, and none exists (see "Facts used in several entries"), so no change can be classified against it.
Work: produce the reference documentation (spec section 8). No plan task covers section 8.

**5.2 "A change to unspecified detail is permitted."**
Status: nothing to check.

**5.2 "A security fix is permitted, with a published notice."**
Status: true today. `SECURITY.md:66-68` publishes an advisory through GitHub Security Advisories when a fix lands.

**5.2 "These are the only exceptions to the goal in section 1."**
Status: nothing to check.

**5.3 "Rejecting previously accepted input: warn in an earlier release first where possible; fail at compile or emit time in preference to run time; list it in the release notes."**
Status: partly true. The means exist: diagnostics carry a `severity` that can be `warn` (`structured-error.ts:33`), and PSL and the emitter validate before run time. Release notes are required for every release (`scripts/check-release-notes.mjs`). Nothing requires a rejection to be warned first or listed.
Work: a review requirement, or a release-notes section, for rejections. No plan task.

**5.3 "Rejecting input the reference specifies as accepted is a change to specified behaviour."**
Status: nothing to check.

**5.4 "A replaced GA API is deprecated: marked so an editor shows it, naming its replacement, working until the next major."**
Status: partly true. Three `@deprecated` tags exist and each names its replacement: `defaultSql` (`contract-dsl.ts:521-522`) and the Postgres target descriptor's `createPlanner` and `createRunner` (`packages/3-targets/postgres/1-target/src/exports/control.ts:69-82`). `defaultSql` states "Removed in 8.0.0", which is allowed before GA. Nothing stops a deprecated API being removed later.
Work: task 5.

**5.4 "Nothing that is GA is removed within a major."**
Status: not true. No check exists.
Work: task 5.

**5.4 "None of this applies to an API below GA."**
Status: nothing to check.

**5.4 "A change to a type that stops a user's code compiling is not made to a GA API. Helper types are covered."**
Status: not true. No check exists. A comparison of exported declarations alone would not see a change to a query's result type, which is computed from the user's input.
Work: task 5 covers exported declarations; type tests against the published packages would cover computed types. Task 5 covers it in part.

**5.5 "Our support for a version follows the lifetime its own maker gives it. We do not stop supporting a version by our own choice within a major."**
Status: not true. ADR 222 says "We raise floors freely and only lower them when a concrete user need justifies it" (`docs/architecture docs/adrs/ADR 222 - Version support policy.md:11`), and `scripts/validate-typescript-peer.mjs` repeats it in its header.
Work: revise ADR 222 and the script's header. Task 6 states the end-of-support events but does not mention ADR 222.

**5.5 "A minimum version rises only in a new major, or in a minor when its maker ends support."**
Status: partly true. Today's minimums are stated in `docs/Supported Versions.md`: Node.js 24, Bun 1.2, Deno 2.0, PostgreSQL 15, MongoDB 8.0, TypeScript 5.9. Only TypeScript's is in the published manifests (`"typescript": ">=5.9"`, checked by `scripts/validate-typescript-peer.mjs`). No published package has an `engines` field; the Node.js minimum appears only in the private root `package.json` (`"node": ">=24"`). Driver peers use ranges: `pg ^8.22.0`, `mongodb ^7.0.0`. Nothing prevents a floor being raised in a minor.
Work: publish the Node.js minimum in each package and add a check that the declared minimums do not rise. No plan task; task 6 covers the end-of-support list only.

**5.5 "A minor release adds support for a new version when its maker releases one."**
Status: not true. CI tests one version of each: Node.js 24.22.0 (`.tool-versions`), TypeScript 5.9.3 (`pnpm-workspace.yaml:37`), `postgres:15`, `mysql:8.4`, `mariadb:10.11` (`.github/workflows/ci.yml`), and the MongoDB that `mongodb-memory-server` 11.2.0 downloads. No job runs Bun or Deno, or any newer database version.
Work: test each supported version, including new ones as they are released. No plan task.

**5.5 "For each maker we state which event counts as end of support."**
Status: not true. No such list exists.
Work: task 6.

**5.5 "TypeScript: we support from the stated minimum to the newest release, test the next release before it ships, and fix breaks in a patch."**
Status: not true. CI pins TypeScript 5.9.3 only; no job runs a newer or upcoming TypeScript.
Work: a CI job for the newest and the next TypeScript release. No plan task.

## Maturity levels

**Maturity 1. "A level tells a user how far they can rely on it, and whether the policy covers it."**
Status: nothing to check.

**Maturity 2. "There is one scale. It applies to a package and to a single API."**
Status: not true. Nothing carries a level today (see 4.2).
Work: task 1.

**Maturity 2. "Three levels, with the names Prisma already uses: Early Access, Preview and GA."**
Status: partly true. The names come from the Prisma 7 docs. The Prisma 8 packages use none of them; four READMEs say support is "early".
Work: task 1.

**Maturity 2. The table defining each level by what we test and whether a failure blocks a release.**
Status: nothing to check. A working definition. For reference: every package's tests run in CI on every pull request and a failure blocks the merge, so today no package is treated as Early Access, and no package lists what it does not yet support.

**Maturity 3. "Every published package has a level. The framework and each target have their own."**
Status: not true. No package has a level, and all share one version.
Work: task 1 defines the levels. No task assigns a level to each of the 21 packages.

**Maturity 3. "An API has the level of its package unless its name starts with the word for a lower level."**
Status: true today. No exported name starts with a level word, so every API has its package's level.

**Maturity 3. "A member of an API below GA has at least that level. A name can only lower a level. A GA API cannot exist in a package below GA."**
Status: nothing to check.

**Maturity 3. "An entrypoint has no level."**
Status: true today. No export path in the 21 packages contains a level word (checked for preview, experimental, beta, alpha, unstable, early, next and `ea`).

**Maturity 3. "Functionality not ready for GA ships in its own package below GA, or under a name that carries its level."**
Status: partly true. Same as 4.4.

**Maturity 4. "A level is written in the package's version: `8.1.0`, `8.1.0-preview.3`, `8.1.0-ea.1`."**
Status: not true. `assertCanonicalBase` rejects such a version, and `set-version.ts` gives every package the same version (see "Facts used in several entries").
Work: task 1 decides the version numbers. No task changes the release scripts and workflow.

**Maturity 4. "A level is written at the start of an API's name: `preview_foo`, `ea_foo`."**
Status: true today. No exported name uses a level word of any kind (`unstable_`, `experimental_`, `preview_`, `ea_`), so nothing contradicts the convention.

**Maturity 4. "A range such as `^8.0.0` never selects a pre-release."**
Status: true today. This is how package managers apply Semantic Versioning; `docs/oss/versioning.md` relies on the same behaviour for the `0.x` ranges. Note that our packages depend on each other by exact version, so a range a user writes applies to the package they install, not to its siblings.

**Maturity 4. "A GA release is published under `latest` and a release below GA under another tag."**
Status: not true. Every release candidate publishes to `latest` (`publish.yml` header; `planPushPublish` in `determine-version-utils.ts:81`), and one run publishes every package under one tag.
Work: task 1 decides the tag for a package that has never had a GA release. No task changes the workflow.

**Maturity 4. "The words sort in the right order: `ea`, then `preview`, then the plain version."**
Status: true today. Semantic Versioning compares these identifiers as text, so `ea` sorts before `preview`, and any pre-release sorts before the plain version. Note that `rc` sorts after `preview`, so `8.0.0-rc.24` is higher than any `8.0.0-preview.N`.

**Maturity 4. "An extension author tells what they can depend on in the same two ways."**
Status: not true. Same as 4.1.
Work: task 1 and the pipeline change in 4.1.

**Maturity 5. "The policy covers every API of a GA package whose name carries no lower level."**
Status: nothing to check.

**Maturity 5. "A package or API below GA may change in any release."**
Status: nothing to check.

**Maturity 5. "Such a change never affects an application that does not use it."**
Status: partly true. Each database has its own facade and target package. But MySQL, MariaDB and SQLite share `orm-family-sql` and `orm-framework` with PostgreSQL, so a change made for a below-GA target can land in code a GA target runs. And since every package is released together, a change to any package reaches every application in the same release.
Work: keep below-GA changes out of shared packages, or test that they do not affect the GA targets. No plan task.

**Maturity 5. "Which levels the reference documentation covers is in the spec, section 8."**
Status: nothing to check.
