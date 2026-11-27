# Audit: every published import path, who imports it, and what happens to it

This is the working record behind [spec.md](spec.md). It lists each import path of each published package, who imports it today, and the decision: keep, rename or remove. The tests a path must pass to stay are in the spec, under "How a path earns its place".

## How it was made

`audit/census.mjs` reads the `exports` of every package under `packages/9-public/@prisma/` and searches for each path in:

- the example applications, split into hand-written files and generated ones (`contract.d.ts`, migration files);
- the docs, skills and package READMEs;
- the source of our own packages. Package source names another package as `@internal/<package>/<path>`, which the build turns into the published path. An import that crosses from one published package to another counts; an import inside one published package does not, and neither does a test;
- shallow clones of Composer, the `prisma` tool (prisma/prisma-cli), the control plane (prisma/pdp-control-plane) and create-prisma, taken on 2026-11-26.

`audit/dispositions.mjs` holds the decisions as rules, and `audit/build-audit.mjs` joins the two into the tables below. Run both after a change to the exports to see what is left.

"Who imports it today" is evidence, not the decision. A path that an example's test happens to import can still be removed, and the example changed.

<!-- generated:begin -->

## Totals

| Package | Level at release 8.0 | Paths today | Keep | Rename | Remove |
| --- | --- | --- | --- | --- | --- |
| `@prisma/orm-postgres` | GA | 167 | 32 | 0 | 135 |
| `@prisma/orm-framework` | GA | 71 | 68 | 1 | 2 |
| `@prisma/orm-family-sql` | GA | 69 | 58 | 1 | 10 |
| `@prisma/orm-target-postgres` | GA | 52 | 29 | 0 | 23 |
| `@prisma/orm-toolchain` | GA | 32 | 21 | 0 | 11 |
| `@prisma/orm-extension-pgvector` | GA | 6 | 6 | 0 | 0 |
| `@prisma/orm-extension-postgis` | GA | 7 | 7 | 0 | 0 |
| `@prisma/orm-extension-arktype-json` | GA | 6 | 5 | 0 | 1 |
| `@prisma/orm-postgres-contrib` | GA | 5 | 5 | 0 | 0 |
| `@prisma/orm-extension-middleware-cache` | GA | 1 | 1 | 0 | 0 |
| `@prisma/orm-better-auth` | GA | 1 | 1 | 0 | 0 |
| `@prisma/orm-extension-paradedb` | below GA | 5 | not reduced path by path | | |
| `@prisma/orm-extension-supabase` | below GA | 3 | not reduced path by path | | |
| `@prisma/orm-family-mongo` | below GA | 32 | not reduced path by path | | |
| `@prisma/orm-mariadb` | below GA | 122 | 22 | 0 | 100 |
| `@prisma/orm-mongo` | below GA | 95 | 28 | 0 | 67 |
| `@prisma/orm-mysql` | below GA | 139 | 26 | 0 | 113 |
| `@prisma/orm-sqlite` | below GA | 142 | 30 | 0 | 112 |
| `@prisma/orm-target-mariadb` | below GA | 14 | not reduced path by path | | |
| `@prisma/orm-target-mongo` | below GA | 17 | not reduced path by path | | |
| `@prisma/orm-target-mysql` | below GA | 29 | not reduced path by path | | |
| `@prisma/orm-target-sqlite` | below GA | 33 | not reduced path by path | | |

## Every path

### `@prisma/orm-postgres`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/capabilities` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/column-types` | example applications (2); docs | keep | a TypeScript contract imports its column types; documented |
| `adapter/control` | docs; the control plane | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `adapter/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/sql-renderer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder/runtime` | example applications (4) | keep | the SQL builder’s types and entry; documented |
| `builder/types` | example applications (1); docs | keep | the SQL builder’s types and entry; documented |
| `components` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/codec` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/control` | example applications (3) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/emission` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/execution` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/ir` | example applications (2) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/psl-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/runtime` | example applications (2); docs | keep | the types an application names when it writes middleware; documented |
| `components/utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `config` | example applications (20); docs; our extensions (extension-paradedb, extension-supabase); Composer, the control plane | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/apply-specifier-default-control-policy` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/contract-validation-error` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/default-namespace` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/enum-accessor` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/is-plain-record` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/resolve-domain-model` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/types` | stored generated files; example applications (3); docs; Composer | keep | files that earlier releases wrote into users’ repositories import it |
| `contract/validate-domain` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-once` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-storage` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract-builder` | example applications (7); docs; our extensions (postgres-contrib, extension-pgvector, extension-postgis, extension-supabase); the framework; Composer | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract-types` | generated files; stored generated files; docs | keep | the facade’s own code: the one module a generated `contract.d.ts` imports |
| `control` | example applications (6); docs; Composer, the control plane | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `driver` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/capabilities` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/control` | docs; the control plane | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `driver/runtime` | the control plane | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family` | docs | keep | the facade’s own code: the pack a TypeScript contract names |
| `family/control` | generated files; example applications (3); Composer, the control plane | keep | a generated migration file of a contract space imports it |
| `family/control-adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/diff` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-build` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-infer` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/verify` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/authored-check-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/canonicalization-hooks` | Composer | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/capability-messages` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/check-expressions` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/codec-json-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/contract-view` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type-support` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-handle-lowering-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-kinds` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/factories` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/foreign-key-materialization` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/generated-id-column-aliases` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-type-validation` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/referential-action-sql` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/resolve-storage-table` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/sql-expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/types` | stored generated files; example applications (5); docs; Composer | keep | files that earlier releases wrote into users’ repositories import it |
| `family-contract/validators` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/value-set-derivation-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-runtime` | example applications (25); docs | keep | middleware, transactions and execution types an application names; documented |
| `family-runtime/internal/prepared-query` | docs | remove | named "internal"; no application imports it |
| `init` | docs | keep | the facade’s own code: `prisma orm init` loads it by name |
| `internal/options` | our extensions (extension-supabase) | remove | named "internal"; the parts the Supabase extension uses get Early Access names on `runtime` and `static` |
| `internal/static-context` | our extensions (extension-supabase) | remove | named "internal"; the parts the Supabase extension uses get Early Access names on `runtime` and `static` |
| `internal/transaction-members` | our extensions (extension-supabase) | remove | named "internal"; the parts the Supabase extension uses get Early Access names on `runtime` and `static` |
| `internal/validate-contract` | our extensions (extension-supabase) | remove | named "internal"; the parts the Supabase extension uses get Early Access names on `runtime` and `static` |
| `migration` | generated files; stored generated files; docs; our targets (target-postgres); the control plane | keep | the facade’s own code: the module a generated migration file imports |
| `migration-tools/aggregate` | example applications (1) | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/contract-snapshot-store` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `migration-tools/hash` | example applications (1) | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/io` | example applications (2) | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/spaces` | example applications (3) | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `orm-client` | example applications (33); docs | keep | the types an application names for collections and query results; documented |
| `relational-core` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/aggregate-descriptor-registry` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/ast` | example applications (3) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/codec-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/collection-methods` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/functions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/index-reference` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/middleware` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/plan` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/query-lane-context` | example applications (1); docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `runtime` | stored generated files; example applications (24); docs; our extensions (extension-supabase); named in package source; Composer, the control plane, create-prisma | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `schema-ir/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `serverless` | example applications (3); docs; the control plane | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `static` | stored generated files; example applications (10); docs; named in package source; Composer, the control plane, create-prisma | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `target` | docs | keep | the facade’s own code: the pack a TypeScript contract names |
| `target/aggregates` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-descriptor` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-ids` | docs; the control plane | keep | an application names a codec id when it passes a typed raw parameter; documented |
| `target/codec-types` | stored generated files; example applications (2); docs; the control plane | keep | files that earlier releases wrote into users’ repositories import it |
| `target/codecs` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/control` | the control plane | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `target/data-transform` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/data-types` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/ddl` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/default-normalizer` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/diff-database-schema` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/errors` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/full-text` | example applications (7); docs | keep | full-text search in queries; documented |
| `target/full-text-index-authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/issue-planner` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/marker-lock` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/migration` | generated files; stored generated files | keep | files that earlier releases wrote into users’ repositories import it |
| `target/native-type-normalizer` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/op-factory-call` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/operation-types` | stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `target/pack` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-ddl-builders` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-identity-values` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-produced-postgres-migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-schema-lookup` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-sql-checks` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-target-details` | generated files | keep | a generated migration file of a contract space imports it |
| `target/render-ops` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/render-typescript` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/rls-canonicalize` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/runtime` | example applications (4) | keep | an application that loads its contract in the browser or a worker uses the contract serializer |
| `target/schema-ir-annotations` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/server-version` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/server-version-range` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/sql-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/types` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `utils` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/abortable` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/array-equal` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/assertions` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/canonical-stringify` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/casts` | example applications (10) | remove | general helpers; no application needs Prisma for them |
| `utils/defined` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/guards` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/hash-content` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/internal-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/json` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/promise` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/redact-db-url` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/result` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/simplify-deep` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/structured-error` | example applications (1) | remove | general helpers; no application needs Prisma for them |
| `utils/suppress-idle-connection-errors` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/text` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/types` | nobody | remove | general helpers; no application needs Prisma for them |
| `vite-plugin-contract-emit` | example applications (2); docs | keep | the Vite plugin; documented |

### `@prisma/orm-framework`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `components` | docs; our families (family-sql); the control plane | keep | the control plane imports it |
| `components/authoring` | docs; our extensions (postgres-contrib, extension-pgvector, extension-postgis); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `components/codec` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-pgvector, extension-postgis); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `components/components` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `components/control` | docs; our extensions (extension-paradedb, extension-pgvector, extension-supabase); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | keep | applications reach it through their facade |
| `components/emission` | docs; our families (family-sql); the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `components/execution` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mysql) | keep | extension and target authors: our own extensions or targets build on it |
| `components/ir` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `components/psl-ast` | docs; our extensions (extension-supabase); our targets (target-postgres); our families (family-sql); our facades (postgres); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `components/runtime` | example applications (1); docs; our extensions (extension-arktype-json, extension-middleware-cache, extension-supabase); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo); named in package source | keep | applications reach it through their facade |
| `components/utils` | our targets (target-postgres, target-sqlite); our families (family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `config` | docs; the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `config/config-types` | docs; our families (family-mongo, family-sql); our facades (mongo, mysql, mariadb, postgres, sqlite); the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract` | docs; named in package source; the control plane | keep | the control plane imports it |
| `contract/apply-specifier-default-control-policy` | our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract/contract-validation-error` | our families (family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract/default-namespace` | our extensions (better-auth); our families (family-mongo) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/enum-accessor` | docs; our extensions (extension-supabase); our families (family-mongo); our facades (mongo, mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/hashing` | docs; our targets (target-postgres); our families (family-mongo, family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `contract/hashing-utils` | docs; our targets (target-postgres); our families (family-mongo, family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `contract/is-plain-record` | our targets (target-postgres); our families (family-mongo, family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/resolve-domain-model` | nobody | remove | nothing outside its own package imports it |
| `contract/types` | stored generated files; docs; our extensions (extension-arktype-json, postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase, better-auth); our targets (target-mongo, target-mysql, target-mariadb, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, mariadb, postgres, sqlite); the toolchain | keep | applications reach it through their facade |
| `contract/validate-domain` | our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract/validate-once` | our facades (mongo, mysql, postgres, sqlite) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract/validate-storage` | our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract-authoring` | docs; our families (family-mongo, family-sql); our facades (mongo) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `errors` | docs; our targets (target-mongo, target-postgres, target-sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `errors/control` | docs; our targets (target-mongo, target-postgres, target-sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `errors/execution` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `errors/migration` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `ids` | docs; our targets (target-postgres, target-sqlite); our families (family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `ids/runtime` | docs; our targets (target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `operations` | docs; our targets (target-mongo); our families (family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `psl-parser` | docs; our extensions (better-auth); our targets (target-postgres); our families (family-mongo, family-sql); the toolchain; the control plane | keep | extension and target authors: our own extensions or targets build on it |
| `psl-parser/format` | docs; the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `psl-parser/interpret` | docs; our families (family-mongo, family-sql); our facades (postgres); the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `psl-parser/syntax` | docs; our extensions (better-auth); our families (family-mongo, family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `psl-parser/tokenizer` | docs | remove | only documents name it; they change to a kept path |
| `psl-printer` | docs; our extensions (extension-supabase); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `target-package-config` | docs | keep | the name for the whole module, which the docs use |
| `target-package-config/type-declarations` | docs; our facades (mongo, mysql, mariadb, postgres, sqlite) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `ts-render` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-sql); our facades (postgres); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations` | docs | keep | the name for the whole module, which the docs use |
| `type-implementations/boolean` | our targets (target-mysql, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/date` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/decimal` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/duration` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/json` | docs; our targets (target-mongo, target-mysql) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/now` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/temporal` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `type-implementations/temporal-text` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `utils` | docs | keep | the name for the whole module, which the docs use |
| `utils/abortable` | the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `utils/array-equal` | our targets (target-postgres, target-sqlite); our families (family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/assertions` | our targets (target-mysql, target-postgres); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/canonical-stringify` | our families (family-mongo, family-sql); the toolchain | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `utils/casts` | docs; our extensions (extension-middleware-cache, extension-pgvector, extension-supabase, better-auth); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `utils/defined` | docs; our extensions (extension-pgvector, extension-supabase); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, mariadb, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `utils/guards` | docs; our families (family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `utils/hash-content` | our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `utils/internal-error` | docs; our extensions (extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | rename | named "internal"; the path and its `InternalError` class get a name without the word |
| `utils/json` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `utils/promise` | our targets (target-mysql, target-postgres, target-sqlite); our families (family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/redact-db-url` | our targets (target-mongo, target-mysql, target-postgres); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/result` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `utils/simplify-deep` | our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `utils/structured-error` | docs; our extensions (extension-middleware-cache, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql); our facades (mongo, mysql, postgres, sqlite); the toolchain | keep | extension and target authors: our own extensions or targets build on it |
| `utils/suppress-idle-connection-errors` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/text` | docs; our extensions (extension-pgvector); our targets (target-mongo, target-postgres); our families (family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `utils/types` | our families (family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |

### `@prisma/orm-family-sql`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `builder` | docs | keep | the name for the whole module, which the docs use |
| `builder/runtime` | docs; our facades (mysql, postgres, sqlite) | keep | applications reach it through their facade |
| `builder/types` | docs; our extensions (extension-supabase); our facades (mysql, postgres, sqlite); the control plane | keep | applications reach it through their facade |
| `contract` | docs; the control plane | keep | the control plane imports it |
| `contract/authored-check-naming` | nobody | remove | nothing outside its own package imports it |
| `contract/canonicalization-hooks` | our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/capability-messages` | our extensions (better-auth); our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/check-expressions` | our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/codec-json-type` | our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/contract-view` | our targets (target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/data-type` | docs; our extensions (postgres-contrib, extension-pgvector, extension-postgis); our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/data-type-support` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/entity-handle-lowering-hook` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/entity-kinds` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/factories` | docs | remove | only documents name it; they change to a kept path |
| `contract/foreign-key-materialization` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/generated-id-column-aliases` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/index-naming` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/index-type-validation` | nobody | remove | nothing outside its own package imports it |
| `contract/index-types` | docs; our extensions (extension-paradedb); our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/referential-action-sql` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/resolve-storage-table` | our extensions (better-auth) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/sql-expression` | docs; our targets (target-mysql, target-postgres, target-sqlite); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract/types` | stored generated files; docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase, better-auth); our targets (target-mysql, target-mariadb, target-postgres, target-sqlite); our facades (mysql, mariadb, postgres, sqlite) | keep | applications reach it through their facade |
| `contract/validators` | docs | remove | only documents name it; they change to a kept path |
| `contract/value-set-derivation-hook` | our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract-emitter` | docs | remove | only documents name it; they change to a kept path |
| `contract-prisma7/provider` | our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `contract-psl` | docs | keep | the name for the whole module, which the docs use |
| `contract-psl/attribute-specs` | docs | remove | only documents name it; they change to a kept path |
| `contract-psl/default-table-name` | nobody | remove | nothing outside its own package imports it |
| `contract-psl/diagnostics` | nobody | remove | nothing outside its own package imports it |
| `contract-psl/map-names` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `contract-psl/provider` | docs; our extensions (extension-paradedb, extension-supabase); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract-ts` | docs | keep | the name for the whole module, which the docs use |
| `contract-ts/config-types` | docs; our extensions (postgres-contrib, extension-pgvector, extension-postgis); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `contract-ts/contract-builder` | docs; our extensions (extension-supabase); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `errors` | docs; our targets (target-mysql, target-postgres, target-sqlite); the control plane | keep | extension and target authors: our own extensions or targets build on it |
| `family` | docs | keep | the name for the whole module, which the docs use |
| `family/control` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our targets (target-mysql, target-mariadb, target-postgres, target-sqlite); our facades (mysql, mariadb, postgres, sqlite); the framework | keep | applications reach it through their facade |
| `family/control-adapter` | docs; our targets (target-mysql, target-mariadb, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/diff` | docs; our targets (target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/ir` | docs; our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/migration` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/pack` | docs; our targets (target-mysql, target-postgres, target-sqlite); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/psl-build` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `family/psl-infer` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `family/runtime` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `family/verify` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `operations` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `orm-client` | example applications (1); docs; our extensions (extension-supabase, better-auth); our facades (mysql, mariadb, postgres, sqlite); the control plane | keep | applications reach it through their facade |
| `relational-core` | docs; the framework; the control plane | keep | the control plane imports it |
| `relational-core/aggregate-descriptor-registry` | docs; our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/ast` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our targets (target-mysql, target-postgres, target-sqlite); the framework | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/codec-descriptor-registry` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-pgvector, extension-postgis); our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/collection-methods` | docs; our extensions (extension-pgvector); our targets (target-postgres); named in package source | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/contract-free` | our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/expression` | docs; our extensions (extension-paradedb, extension-pgvector, extension-postgis); our targets (target-mysql, target-postgres, target-sqlite); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/functions` | docs | remove | only documents name it; they change to a kept path |
| `relational-core/index-reference` | docs; our targets (target-postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/middleware` | nobody | remove | nothing outside its own package imports it |
| `relational-core/plan` | docs; our extensions (extension-supabase); our targets (target-postgres); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/query-lane-context` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-pgvector, extension-postgis); our targets (target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `relational-core/types` | docs; our extensions (extension-supabase); our facades (mysql, postgres, sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `runtime` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase, better-auth); our targets (target-mysql, target-postgres, target-sqlite); our facades (mysql, postgres, sqlite); the control plane | keep | applications reach it through their facade |
| `runtime/internal/prepared-query` | docs; our extensions (extension-supabase) | rename | named "internal"; the Supabase extension needs it, so its exports move to `runtime` with the Early Access prefix |
| `schema-ir` | docs | keep | the name for the whole module, which the docs use |
| `schema-ir/naming` | docs; our targets (target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `schema-ir/types` | docs; our targets (target-mysql, target-postgres, target-sqlite) | keep | applications reach it through their facade |

### `@prisma/orm-target-postgres`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | docs; named in package source | keep | the name for the whole module, which the docs use |
| `adapter/adapter` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `adapter/capabilities` | docs | remove | only documents name it; they change to a kept path |
| `adapter/column-types` | docs | keep | applications reach it through their facade |
| `adapter/control` | docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our facades (postgres); the framework | keep | extension and target authors: our own extensions or targets build on it |
| `adapter/runtime` | docs; our extensions (extension-supabase); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `adapter/sql-renderer` | docs | remove | only documents name it; they change to a kept path |
| `adapter/types` | nobody | remove | nothing outside its own package imports it |
| `driver` | docs; the control plane | keep | the control plane imports it |
| `driver/capabilities` | our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `driver/control` | docs; our extensions (extension-supabase); our facades (postgres); the framework | keep | extension and target authors: our own extensions or targets build on it |
| `driver/runtime` | docs; our extensions (extension-supabase); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `target` | docs | keep | the name for the whole module, which the docs use |
| `target/aggregates` | nobody | remove | nothing outside its own package imports it |
| `target/codec-descriptor` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-pgvector, extension-postgis) | keep | extension and target authors: our own extensions or targets build on it |
| `target/codec-ids` | our facades (postgres) | keep | applications reach it through their facade |
| `target/codec-types` | generated files; stored generated files; docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our facades (postgres) | keep | a generated file imports it |
| `target/codecs` | docs; our extensions (postgres-contrib, extension-pgvector, extension-postgis); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |
| `target/contract-free` | nobody | remove | nothing outside its own package imports it |
| `target/control` | docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our facades (postgres); the framework | keep | extension and target authors: our own extensions or targets build on it |
| `target/data-transform` | nobody | remove | nothing outside its own package imports it |
| `target/data-types` | docs; our extensions (extension-arktype-json, postgres-contrib, extension-pgvector, extension-postgis) | keep | extension and target authors: our own extensions or targets build on it |
| `target/ddl` | docs | remove | only documents name it; they change to a kept path |
| `target/default-normalizer` | nobody | remove | nothing outside its own package imports it |
| `target/diff-database-schema` | docs | remove | only documents name it; they change to a kept path |
| `target/errors` | nobody | remove | nothing outside its own package imports it |
| `target/full-text` | docs; our facades (postgres) | keep | applications reach it through their facade |
| `target/full-text-index-authoring` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/issue-planner` | nobody | remove | nothing outside its own package imports it |
| `target/marker-lock` | nobody | remove | nothing outside its own package imports it |
| `target/migration` | docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our facades (postgres); the control plane | keep | applications reach it through their facade |
| `target/native-type-normalizer` | nobody | remove | nothing outside its own package imports it |
| `target/op-factory-call` | docs | remove | only documents name it; they change to a kept path |
| `target/operation-types` | generated files; stored generated files; docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase); our facades (postgres) | keep | a generated file imports it |
| `target/pack` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/planner` | docs | remove | only documents name it; they change to a kept path |
| `target/planner-ddl-builders` | nobody | remove | nothing outside its own package imports it |
| `target/planner-identity-values` | nobody | remove | nothing outside its own package imports it |
| `target/planner-produced-postgres-migration` | nobody | remove | nothing outside its own package imports it |
| `target/planner-schema-lookup` | nobody | remove | nothing outside its own package imports it |
| `target/planner-sql-checks` | nobody | remove | nothing outside its own package imports it |
| `target/planner-target-details` | nobody | keep | applications reach it through their facade |
| `target/prisma7-binding` | docs; our facades (postgres) | keep | the PostgreSQL facade’s Prisma 7 config imports it across the package boundary |
| `target/render-ops` | nobody | remove | nothing outside its own package imports it |
| `target/render-typescript` | nobody | remove | nothing outside its own package imports it |
| `target/rls-canonicalize` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/runtime` | docs; our extensions (extension-supabase); our facades (postgres) | keep | applications reach it through their facade |
| `target/schema-ir-annotations` | nobody | remove | nothing outside its own package imports it |
| `target/server-version` | our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/server-version-range` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/sql-utils` | docs; our facades (postgres) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `target/types` | docs; our extensions (extension-paradedb, extension-supabase); our facades (postgres) | keep | extension and target authors: our own extensions or targets build on it |

### `@prisma/orm-toolchain`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `cli` | docs; named in package source; Composer, the `prisma` tool | keep | Composer and the `prisma` tool imports it |
| `cli/config-types` | docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis, extension-supabase) | keep | extension and target authors: our own extensions or targets build on it |
| `cli/control-api` | docs; our facades (mongo, mysql, mariadb, postgres, sqlite); the control plane | keep | the control plane imports it |
| `cli/control-api/testing` | docs | remove | only documents name it; they change to a kept path |
| `cli/init-contribution` | docs; our facades (mongo, mysql, postgres, sqlite) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `cli/init-output` | docs | remove | only documents name it; they change to a kept path |
| `cli/migration-cli` | docs; our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `cli-telemetry` | docs | keep | the name for the whole module, which the docs use |
| `cli-telemetry/sender` | nobody | remove | nothing outside its own package imports it |
| `config-loader` | docs; our extensions (better-auth); Composer | keep | extension and target authors: our own extensions or targets build on it |
| `emitter` | docs | keep | the name for the whole module, which the docs use |
| `emitter/domain-type-generation` | docs; our families (family-mongo, family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `emitter/type-expression-safety` | nobody | remove | nothing outside its own package imports it |
| `migration-tools` | docs; our extensions (extension-paradedb, extension-pgvector); the framework; the control plane | keep | extension and target authors: our own extensions or targets build on it |
| `migration-tools/aggregate` | docs; our targets (target-mongo); our families (family-sql); the framework | keep | applications reach it through their facade |
| `migration-tools/constants` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/contract-snapshot-store` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/errors` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/graph` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/hash` | Composer | keep | applications reach it through their facade |
| `migration-tools/invariants` | our families (family-sql) | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `migration-tools/io` | docs; the framework; Composer | keep | applications reach it through their facade |
| `migration-tools/ledger-origin` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `migration-tools/metadata` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/migration` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite); our families (family-mongo, family-sql) | keep | extension and target authors: our own extensions or targets build on it |
| `migration-tools/migration-graph` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/migration-ts` | our targets (target-mongo, target-mysql, target-postgres, target-sqlite) | keep | extension and target authors: our own extensions or targets build on it |
| `migration-tools/package` | the framework | keep | wiring: another package of ours imports it across the package boundary, so it cannot be unpublished |
| `migration-tools/ref-resolution` | nobody | remove | nothing outside its own package imports it |
| `migration-tools/refs` | docs; Composer | keep | Composer imports it |
| `migration-tools/spaces` | docs; our extensions (postgres-contrib, extension-paradedb, extension-pgvector, extension-postgis); our families (family-mongo, family-sql); Composer | keep | applications reach it through their facade |
| `vite-plugin-contract-emit` | docs | keep | applications reach it through their facade |

### `@prisma/orm-extension-pgvector`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `codec-types` | generated files; stored generated files; example applications (1); docs | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `column-types` | docs | keep | standard entry of an extension pack: a TypeScript contract imports its column types |
| `control` | example applications (4); docs; the framework; named in package source | keep | standard entry of an extension pack: the config lists it |
| `operation-types` | generated files; stored generated files; docs | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `pack` | example applications (1); docs | keep | standard entry of an extension pack: a TypeScript contract names it |
| `runtime` | example applications (6); docs; the control plane | keep | standard entry of an extension pack: the application passes it to its client |

### `@prisma/orm-extension-postgis`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `codec-types` | generated files; stored generated files; example applications (5); docs | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `column-types` | docs | keep | standard entry of an extension pack: a TypeScript contract imports its column types |
| `control` | example applications (2); docs; named in package source | keep | standard entry of an extension pack: the config lists it |
| `geojson` | example applications (4); docs | keep | an example application imports it |
| `operation-types` | generated files; stored generated files; docs | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `pack` | docs | keep | standard entry of an extension pack: a TypeScript contract names it |
| `runtime` | example applications (1); docs | keep | standard entry of an extension pack: the application passes it to its client |

### `@prisma/orm-extension-arktype-json`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `codec-types` | generated files | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `codecs` | nobody | remove | nothing outside its own package imports it |
| `column-types` | docs | keep | standard entry of an extension pack: a TypeScript contract imports its column types |
| `control` | nobody | keep | standard entry of an extension pack: the config lists it |
| `pack` | docs | keep | standard entry of an extension pack: a TypeScript contract names it |
| `runtime` | docs | keep | standard entry of an extension pack: the application passes it to its client |

### `@prisma/orm-postgres-contrib`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `citext/codec-types` | generated files; stored generated files | keep | standard entry of an extension pack: a generated `contract.d.ts` imports it |
| `citext/column-types` | nobody | keep | standard entry of an extension pack: a TypeScript contract imports its column types |
| `citext/control` | example applications (1); docs; named in package source | keep | standard entry of an extension pack: the config lists it |
| `citext/pack` | nobody | keep | standard entry of an extension pack: a TypeScript contract names it |
| `citext/runtime` | example applications (1); docs | keep | standard entry of an extension pack: the application passes it to its client |

### `@prisma/orm-extension-middleware-cache`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `.` | example applications (11); docs; named in package source | keep | an example application imports it |

### `@prisma/orm-better-auth`

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `.` | example applications (1); docs; named in package source | keep | an example application imports it |

### `@prisma/orm-mariadb` (below GA; it follows the PostgreSQL facade’s list)

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/codec-types` | stored generated files | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/control` | nobody | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `adapter/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder/runtime` | nobody | keep | the SQL builder’s types and entry; documented |
| `builder/types` | nobody | keep | the SQL builder’s types and entry; documented |
| `components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/codec` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/control` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/emission` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/execution` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/psl-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/runtime` | nobody | keep | the types an application names when it writes middleware; documented |
| `components/utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `config` | example applications (1) | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/apply-specifier-default-control-policy` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/contract-validation-error` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/default-namespace` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/enum-accessor` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/is-plain-record` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/resolve-domain-model` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/types` | stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `contract/validate-domain` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-once` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-storage` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract-builder` | docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract-types` | generated files; stored generated files | keep | the facade’s own code: the one module a generated `contract.d.ts` imports |
| `control` | nobody | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `driver` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/control` | example applications (1) | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `driver/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/control` | nobody | keep | a generated migration file of a contract space imports it |
| `family/control-adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/diff` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-build` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-infer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/verify` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/authored-check-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/canonicalization-hooks` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/capability-messages` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/check-expressions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/codec-json-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/contract-view` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type-support` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-handle-lowering-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-kinds` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/factories` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/foreign-key-materialization` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/generated-id-column-aliases` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-type-validation` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/referential-action-sql` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/resolve-storage-table` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/sql-expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/types` | stored generated files | keep | files that earlier releases wrote into users’ repositories import it |
| `family-contract/validators` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/value-set-derivation-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-runtime` | nobody | keep | middleware, transactions and execution types an application names; documented |
| `family-runtime/internal/prepared-query` | nobody | remove | named "internal"; no application imports it |
| `migration` | generated files; docs | keep | the facade’s own code: the module a generated migration file imports |
| `migration-tools/aggregate` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/contract-snapshot-store` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `migration-tools/hash` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/io` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/spaces` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `orm-client` | nobody | keep | the types an application names for collections and query results; documented |
| `relational-core` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/aggregate-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/codec-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/collection-methods` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/expression` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/functions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/index-reference` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/middleware` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/plan` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/query-lane-context` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `runtime` | example applications (1); docs; named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `schema-ir/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `static` | example applications (1); docs; named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `target/control` | nobody | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `target/descriptor-meta-runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/migration` | nobody | keep | files that earlier releases wrote into users’ repositories import it |
| `target/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/runtime` | nobody | keep | an application that loads its contract in the browser or a worker uses the contract serializer |
| `utils` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/abortable` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/array-equal` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/assertions` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/canonical-stringify` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/casts` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/defined` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/guards` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/hash-content` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/internal-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/json` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/promise` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/redact-db-url` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/result` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/simplify-deep` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/structured-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/suppress-idle-connection-errors` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/text` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/types` | nobody | remove | general helpers; no application needs Prisma for them |
| `vite-plugin-contract-emit` | nobody | keep | the Vite plugin; documented |

### `@prisma/orm-mongo` (below GA; it follows the PostgreSQL facade’s list)

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/control` | example applications (3); docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `adapter/runtime` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `bson` | docs | keep | the facade’s own code |
| `components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/codec` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/control` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/emission` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/execution` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/psl-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/runtime` | docs | keep | the types an application names when it writes middleware; documented |
| `components/utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `config` | example applications (4); docs; named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/apply-specifier-default-control-policy` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/contract-validation-error` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/default-namespace` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/enum-accessor` | example applications (2) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/is-plain-record` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/resolve-domain-model` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/types` | stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `contract/validate-domain` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-once` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-storage` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract-builder` | example applications (1); docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract-types` | generated files; stored generated files; docs | keep | the facade’s own code: the one module a generated `contract.d.ts` imports |
| `control` | docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `driver` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/control` | example applications (3); docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `driver/runtime` | example applications (1); docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family` | docs | keep | the facade’s own code: the pack a TypeScript contract names |
| `family/control` | docs | keep | a generated migration file of a contract space imports it |
| `family/control-adapter` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/ir` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/schema-verify` | example applications (1) | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract` | stored generated files; example applications (3); docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/canonicalization-hooks` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-kinds` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-runtime` | example applications (2); docs | keep | middleware, transactions and execution types an application names; documented |
| `init` | docs | keep | the facade’s own code: `prisma orm init` loads it by name |
| `migration` | docs | keep | the facade’s own code: the module a generated migration file imports |
| `migration-tools/aggregate` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/contract-snapshot-store` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `migration-tools/hash` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/io` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/spaces` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `orm` | example applications (2); docs | keep | the query types an application names; documented |
| `query-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `query-ast/control` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `query-ast/execution` | generated files; example applications (6); docs | keep | a generated file imports it |
| `query-builder` | example applications (4); docs | keep | the query types an application names; documented |
| `query-builder/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `runtime` | example applications (8); docs; named in package source; create-prisma | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `static` | example applications (5); docs; named in package source; create-prisma | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `target` | docs | keep | the facade’s own code: the pack a TypeScript contract names |
| `target/codec-ids` | docs | keep | an application names a codec id when it passes a typed raw parameter; documented |
| `target/codec-types` | stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `target/codecs` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/control` | example applications (3); docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `target/data-types` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/migration` | generated files; stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `target/pack` | docs; named in package source | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/runtime` | example applications (1); docs | keep | an application that loads its contract in the browser or a worker uses the contract serializer |
| `target/server-version` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `utils` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/abortable` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/array-equal` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/assertions` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/canonical-stringify` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/casts` | example applications (1) | remove | general helpers; no application needs Prisma for them |
| `utils/defined` | example applications (1) | remove | general helpers; no application needs Prisma for them |
| `utils/guards` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/hash-content` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/internal-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/json` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/promise` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/redact-db-url` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/result` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/simplify-deep` | example applications (1) | remove | general helpers; no application needs Prisma for them |
| `utils/structured-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/suppress-idle-connection-errors` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/text` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/types` | nobody | remove | general helpers; no application needs Prisma for them |
| `value` | example applications (1); docs | keep | the query types an application names; documented |
| `value/mongodb-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `vite-plugin-contract-emit` | docs | keep | the Vite plugin; documented |

### `@prisma/orm-mysql` (below GA; it follows the PostgreSQL facade’s list)

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/codec-types` | stored generated files | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/control` | nobody | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `adapter/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/sql-renderer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder/runtime` | nobody | keep | the SQL builder’s types and entry; documented |
| `builder/types` | nobody | keep | the SQL builder’s types and entry; documented |
| `components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/codec` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/control` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/emission` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/execution` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/psl-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/runtime` | nobody | keep | the types an application names when it writes middleware; documented |
| `components/utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `config` | example applications (1); docs; our facades (mariadb) | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/apply-specifier-default-control-policy` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/contract-validation-error` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/default-namespace` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/enum-accessor` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/is-plain-record` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/resolve-domain-model` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/types` | stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `contract/validate-domain` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-once` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-storage` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract-builder` | docs; our facades (mariadb) | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract-types` | generated files; stored generated files | keep | the facade’s own code: the one module a generated `contract.d.ts` imports |
| `control` | nobody | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `define-contract` | our facades (mariadb) | keep | the facade’s own code |
| `driver` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/control` | example applications (1) | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `driver/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/control` | nobody | keep | a generated migration file of a contract space imports it |
| `family/control-adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/diff` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-build` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-infer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/verify` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/authored-check-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/canonicalization-hooks` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/capability-messages` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/check-expressions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/codec-json-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/contract-view` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type-support` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-handle-lowering-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-kinds` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/factories` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/foreign-key-materialization` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/generated-id-column-aliases` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-type-validation` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/referential-action-sql` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/resolve-storage-table` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/sql-expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/types` | stored generated files | keep | files that earlier releases wrote into users’ repositories import it |
| `family-contract/validators` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/value-set-derivation-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-runtime` | nobody | keep | middleware, transactions and execution types an application names; documented |
| `family-runtime/internal/prepared-query` | nobody | remove | named "internal"; no application imports it |
| `init` | docs | keep | the facade’s own code: `prisma orm init` loads it by name |
| `migration` | generated files | keep | the facade’s own code: the module a generated migration file imports |
| `migration-tools/aggregate` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/contract-snapshot-store` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `migration-tools/hash` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/io` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/spaces` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `orm-client` | nobody | keep | the types an application names for collections and query results; documented |
| `relational-core` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/aggregate-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/codec-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/collection-methods` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/expression` | example applications (1); docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/functions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/index-reference` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/middleware` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/plan` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/query-lane-context` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `runtime` | example applications (1); docs; our facades (mariadb); named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `schema-ir/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `static` | example applications (1); docs; our facades (mariadb); named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `target/aggregates` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-descriptor` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-ids` | nobody | keep | an application names a codec id when it passes a typed raw parameter; documented |
| `target/codec-types` | nobody | keep | files that earlier releases wrote into users’ repositories import it |
| `target/codecs` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/control` | docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `target/control-tables` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/data-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/ddl` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/default-normalizer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/descriptor-meta-runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/errors` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/marker-lock` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/migration` | nobody | keep | files that earlier releases wrote into users’ repositories import it |
| `target/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/runtime` | nobody | keep | an application that loads its contract in the browser or a worker uses the contract serializer |
| `target/sql-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/types` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `utils` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/abortable` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/array-equal` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/assertions` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/canonical-stringify` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/casts` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/defined` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/guards` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/hash-content` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/internal-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/json` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/promise` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/redact-db-url` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/result` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/simplify-deep` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/structured-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/suppress-idle-connection-errors` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/text` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/types` | nobody | remove | general helpers; no application needs Prisma for them |
| `vite-plugin-contract-emit` | nobody | keep | the Vite plugin; documented |

### `@prisma/orm-sqlite` (below GA; it follows the PostgreSQL facade’s list)

| Path | Who imports it today | Decision | Why |
| --- | --- | --- | --- |
| `adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/codec-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/column-types` | generated files; example applications (1); docs | keep | a TypeScript contract imports its column types; documented |
| `adapter/control` | generated files; docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `adapter/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/sql-renderer` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `adapter/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `builder/runtime` | nobody | keep | the SQL builder’s types and entry; documented |
| `builder/types` | nobody | keep | the SQL builder’s types and entry; documented |
| `components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/authoring` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/codec` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/components` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/control` | generated files | keep | a generated file imports it |
| `components/emission` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/execution` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/psl-ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `components/runtime` | nobody | keep | the types an application names when it writes middleware; documented |
| `components/utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `config` | example applications (1); docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/apply-specifier-default-control-policy` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/contract-validation-error` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/default-namespace` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/enum-accessor` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/hashing-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/is-plain-record` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/resolve-domain-model` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/types` | generated files; stored generated files; docs | keep | files that earlier releases wrote into users’ repositories import it |
| `contract/validate-domain` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-once` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract/validate-storage` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `contract-builder` | generated files; example applications (1); docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `contract-types` | generated files; docs | keep | the facade’s own code: the one module a generated `contract.d.ts` imports |
| `control` | docs | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `driver` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `driver/control` | generated files | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `driver/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/control` | generated files | keep | a generated migration file of a contract space imports it |
| `family/control-adapter` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/diff` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/ir` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-build` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/psl-infer` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/runtime` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family/verify` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/authored-check-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/canonicalization-hooks` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/capability-messages` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/check-expressions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/codec-json-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/contract-view` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/data-type-support` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-handle-lowering-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/entity-kinds` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/factories` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/foreign-key-materialization` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/generated-id-column-aliases` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-naming` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-type-validation` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/index-types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/referential-action-sql` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/resolve-storage-table` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/sql-expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/types` | generated files | keep | files that earlier releases wrote into users’ repositories import it |
| `family-contract/validators` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-contract/value-set-derivation-hook` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `family-runtime` | docs | keep | middleware, transactions and execution types an application names; documented |
| `family-runtime/internal/prepared-query` | nobody | remove | named "internal"; no application imports it |
| `init` | docs | keep | the facade’s own code: `prisma orm init` loads it by name |
| `migration` | docs; our targets (target-sqlite); the control plane | keep | the facade’s own code: the module a generated migration file imports |
| `migration-tools/aggregate` | generated files | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/contract-snapshot-store` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `migration-tools/hash` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/io` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `migration-tools/spaces` | nobody | keep | an application that checks its own migrations or stages an extension’s migrations reads the on-disk format (the decision record on the published packages) |
| `orm-client` | example applications (9); docs | keep | the types an application names for collections and query results; documented |
| `relational-core` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/aggregate-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/ast` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/codec-descriptor-registry` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/collection-methods` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/expression` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/functions` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/index-reference` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/middleware` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/plan` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/query-lane-context` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `relational-core/types` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `runtime` | example applications (1); docs; named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `schema-ir/types` | generated files | keep | a generated file imports it |
| `static` | example applications (1); docs; named in package source | keep | the facade’s own code: what an application imports to configure, define a contract, connect and query |
| `target/aggregates` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-descriptor` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/codec-ids` | nobody | keep | an application names a codec id when it passes a typed raw parameter; documented |
| `target/codec-types` | stored generated files | keep | files that earlier releases wrote into users’ repositories import it |
| `target/codecs` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/contract-free` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/control` | generated files; docs | remove | parts of a control stack built by hand; `control` gives the assembled client |
| `target/control-tables` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/data-types` | generated files; docs | keep | a generated file imports it |
| `target/ddl` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/default-normalizer` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/migration` | nobody | keep | files that earlier releases wrote into users’ repositories import it |
| `target/op-factory-call` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/pack` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-produced-sqlite-migration` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/planner-target-details` | nobody | keep | a generated migration file of a contract space imports it |
| `target/render-ops` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/runtime` | nobody | keep | an application that loads its contract in the browser or a worker uses the contract serializer |
| `target/sql-utils` | nobody | remove | no application, generator or document uses it; an extension author imports the platform package |
| `target/types` | docs | remove | no application, generator or document uses it; an extension author imports the platform package |
| `utils` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/abortable` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/array-equal` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/assertions` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/canonical-stringify` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/casts` | example applications (7) | remove | general helpers; no application needs Prisma for them |
| `utils/defined` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/guards` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/hash-content` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/internal-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/json` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/promise` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/redact-db-url` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/result` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/simplify-deep` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/structured-error` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/suppress-idle-connection-errors` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/text` | nobody | remove | general helpers; no application needs Prisma for them |
| `utils/types` | nobody | remove | general helpers; no application needs Prisma for them |
| `vite-plugin-contract-emit` | docs | keep | the Vite plugin; documented |

<!-- generated:end -->
