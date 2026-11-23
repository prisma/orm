---
from: "8.0.0-rc.24"
to: "8.0.0-rc.25"
changes:
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-target-postgres`, `@prisma/orm-postgres` and `@prisma/orm-extension-supabase`, not dependencies. An extension package whose tests or tooling load the Postgres driver must declare `pg` and `@types/pg` in its own `devDependencies`, because not every package manager and configuration installs a missing peer. An extension pack that peers the target and never loads the driver itself declares neither; the application supplies them.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-(?:postgres|target-postgres|extension-supabase)"\s*:'
  - id: extension-importing-pg-peers-it
    summary: |
      An extension whose own code imports from `pg`, for example to type a `pg.Pool` option, declares `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) as peer dependencies, as the Postgres target does, so that it and the application share one copy of the driver and its types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?:from|import|require)\s*\(?\s*[''"]pg[''"]'
  - id: config-type-renamed-to-prisma-config
    summary: |
      The config type that `defineConfig` returns is renamed from `PrismaNextConfig` to `PrismaConfig`, in `@prisma/orm-framework/config/config-types`, `@prisma/orm-toolchain/cli/config-types` and every package that re-exports it, including the target facades' `defineConfig` return types. The old name is gone. The detection matches TypeScript sources that name the old type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PrismaNextConfig(?![\w$])'
  - id: target-package-names-generated-file-modules
    summary: |
      A package that adds a target must name, in the config its `defineConfig` returns, the module generated contract types import from (`contract.typesModule`) and the module migration files import from (`migrations.module`), and must hand the config target and adapter descriptors whose type declarations state its own types module. Without `contract.typesModule`, every command that writes contract types fails with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`: `prisma contract emit`, `prisma migration plan` and `prisma migration new` always, and `prisma db migrate`, `prisma db init`, `prisma db update` and `prisma db sign` when they advance a ref, which `prisma db migrate` now does by default when it reads its connection from the config outside CI. Without `migrations.module`, `prisma migration plan` and `prisma migration new` fail with `CONFIG.MIGRATION_MODULE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: extension-config-names-generated-file-modules
    summary: |
      An extension that has a contract of its own, emitted with a config it assembles from the framework's `defineConfig`, must name `contract.typesModule` and `migrations.module` in that config. The extension's own commands otherwise fail in the same way as an application's: see `target-package-names-generated-file-modules`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: family-imports-are-import-requirements
    summary: |
      `EmissionSpi.getFamilyImports` takes the types module and returns import requirements, where it took a function that translated module names and returned lines of import text. `ImportSpecifierResolver`, `keepInternalSpecifiers` and `resolveRequirementSpecifiers` are removed from `@prisma/orm-framework/components/emission`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])getFamilyImports\s*\('
        - '(?<![\w$])(ImportSpecifierResolver|keepInternalSpecifiers|resolveRequirementSpecifiers)(?![\w$])'
  - id: migration-renderer-takes-the-migration-module
    summary: |
      A migration plan's `renderTypeScript` takes the module the rendered file imports from, as a string, where it took a function that translated module names. The renderer names no module of its own.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])renderTypeScript\s*\(\s*[^)\s]'
  - id: emitter-takes-the-types-module
    summary: |
      In `@prisma/orm-toolchain/emitter`, `generateContractDts` takes the types module as a required fifth argument, `EmitOptions.typesModule` is required and `EmitOptions.resolveImportSpecifier` is removed, and `generateImportLines` is replaced by `typesImportRequirements`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(generateContractDts|generateImportLines)\s*\('
        - 'resolveImportSpecifier'
  - id: mysql-config-components-carry-family-and-modules
    summary: |
      `MysqlConfigComponents`, the argument of `createMysqlDefineConfig` from `@prisma/orm-mysql/config`, requires `family`, `typesModule` and `migrationModule`, and its `target` and `adapter` are used as given.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])createMysqlDefineConfig\s*\('
  - id: control-api-takes-types-module
    summary: |
      The control client's `emit` requires `contractConfig.typesModule`, and `renderContractDts` requires `typesModule`: the module the generated contract types import from. The `projectDir` option of the control API's contract emit, `migration new` and `migration plan` operations is removed, and `preflightRefAdvancement` takes the config in its place.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'contractConfig\s*:'
        - '(?<![\w$])renderContractDts\s*\('
        - '@prisma/orm-toolchain/cli/control-api'
  - id: component-type-import-module-is-not-a-literal-type
    summary: |
      On every Prisma target and adapter descriptor, the type of a type import's `package` is a template string type such as `` `${string}/codec-types` ``, where it was one string literal. Code that depends on the literal type compares the value instead.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'codecTypes\.import\.package'
  - id: toolchain-publish-surface-entrypoints-removed
    summary: |
      `@prisma/orm-toolchain/publish-surface`, `@prisma/orm-toolchain/publish-surface/import-roots` and `@prisma/orm-toolchain/publish-surface/shells` are removed. Nothing replaces them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-toolchain/publish-surface'
  - id: typescript-contract-from-path-requires-target
    summary: |
      `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types` now takes three arguments: the contract path, the output path (or `undefined`), and an options object that must hold the configured target's pack ref as `target` and that target's `contract-builder` module as `contractBuilderModule`. Calls with one or two arguments, or with only `defaultControlPolicy` and `createNamespace`, no longer compile, and in JavaScript they throw. The detection matches TypeScript and JavaScript files that import it from the SQL family, under any name; the MongoDB family's function of the same name is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-family-sql|internal/sql-contract-ts)/(?:contract-ts/)?config-types)[\s\S]*\btypescriptContractFromPath\b'
  - id: target-package-exports-an-init-contribution
    summary: |
      `prisma orm init` takes everything about a target from the target package: a package that wants `init` to set up a project on it exports an init contribution, typed `InitContribution` from `@prisma/orm-toolchain/cli/init-contribution`, as the default export of its `init` entrypoint. `@prisma/orm-postgres`, `@prisma/orm-mongo`, `@prisma/orm-sqlite` and `@prisma/orm-mysql` export one. A package without it is not affected; `init` cannot set up a project on it, and the application writes `prisma.config.ts` by hand.
  - id: init-reaches-a-target-package-by-name
    summary: |
      `prisma orm init --target <package name>` sets up a project on any target package that exports an init contribution from its `init` entrypoint. The package needs no entry in any list of Prisma's, and must list the `prisma-orm-extension` keyword. A package without an `init` entrypoint is not affected.
  - id: mysql-driver-factories-take-the-target
    summary: |
      `createMysqlRuntimeDriverDescriptor` and `createMysqlControlDriverDescriptor`, which build the MySQL driver for a target that extends MySQL, take an options object whose `target` is the target's runtime metadata, from which the drivers take their target id and the display name their errors show, and whose `checkViolationErrors` lists the error numbers the database reports a failed CHECK constraint with, as in `createMysqlRuntimeDriverDescriptor({ target: mariadbTargetDescriptorMetaRuntime, checkViolationErrors: [4025] })`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'createMysql(?:Runtime|Control)DriverDescriptor\(\s*[''"`]'
  - id: mysql-codec-descriptor-wrap-parameter
    summary: |
      A MySQL or MariaDB codec descriptor now has `wrapParameter(parameter, ref)`, which returns the expression a parameter of its codec is written as, and the codec registry refuses a descriptor without it. A descriptor that extends `MysqlCodecDescriptor` or is made with `mysqlCodec()` inherits it. One that implements `AnyMysqlCodecDescriptor` itself must add it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bAnyMysqlCodecDescriptor\b'
  - id: adapters-report-include-capabilities
    summary: |
      The ORM loads includes with the one-query include only when the contract's `sql` group reports `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`. An SQL adapter must report each of them where it is true of its database. An adapter that reports none of them gets one query per relation: its users' paged and `distinct` includes need window functions, `prepared.all()`, `prepared.first()` and `prepared.firstOrThrow()` with includes throw `ORM.CAPABILITY_MISSING`, and a read with includes runs several statements.
  - id: has-one-key-must-be-unique
    summary: |
      Building a SQL contract fails with `CONTRACT.RELATION_INVALID` when a one-to-one relation, `rel.hasOne(Target, { by: ... })` in TypeScript, names `by` fields of the target model that no primary key, unique constraint or unique index without a `where` covers exactly. Make those fields unique, or make the relation `rel.hasMany`. PSL schemas are not affected: PSL already refused a singular back-relation over a non-unique foreign key. The detection matches TypeScript sources that declare a `hasOne` relation.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])rel\s*\.\s*hasOne\s*\('
  - id: ts-renamed-postgres-json-column-helper
    summary: |
      The PostgreSQL column helper `jsonColumn` is renamed `plainJsonColumn`, after the explicit type it gives (`PlainJson`, a `json` column). The old name is removed. The contract does not change. SQLite's `jsonColumn` has a rename of its own.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])jsonColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*jsonColumn(?![\w$])'
  - id: ts-postgres-explicit-json-type
    summary: |
      In `postgresExplicitTypes` and `postgresScalarTypes` from the PostgreSQL target, the explicit type of a `json` column is `PlainJson`. `postgresExplicitTypes.Json` is removed, and `postgresScalarTypes.Json` is now a type choice, not a type constructor. Read `PlainJson` where code needs the `json` type constructor.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])postgres(?:Explicit|Scalar)Types(?:\.Json|\[[ \t]*[''"]Json[''"][ \t]*\])(?![\w$])'
  - id: psl-renamed-sql-string
    summary: |
      The SQL family's `sql.String(n)`, a `varchar(n)` column on PostgreSQL, SQLite and MySQL, is renamed `sql.Varchar(n)`. `sql.String` stays for one release line as a deprecated alias that warns with `PSL_DEPRECATED_SCALAR_NAME`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w.])sql\s*\.\s*String\s*\('
  - id: ts-renamed-sql-string
    summary: |
      In a TypeScript contract, `type.sql.String(n)` is renamed `type.sql.Varchar(n)`. `type.sql.String` still compiles as a deprecated alias and gives the same type and contract.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])sql\s*\.\s*String\s*\('
  - id: sqlite-decimal-codec
    summary: |
      On SQLite, `Decimal` is now a convenience type over the explicit type `DecimalString`, with its own codec `sqlite/decimal@1` on the same `text` column. A field written `Decimal` (or `type.Decimal()`) emitted `sqlite/text@1` before. Re-emit the contract and sign the database; no column changes and no data moves. Stored text that is not a decimal now fails to read, so find and fix such rows.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*[A-Za-z_]\w*[ \t]+Decimal(?![\w])'
        - '=[ \t]*Decimal(?![\w])'
  - id: ts-sqlite-decimal-codec
    summary: |
      In a SQLite TypeScript contract, `type.Decimal()` now emits codec `sqlite/decimal@1` instead of `sqlite/text@1`, and `type.DecimalString()` is the same type. Re-emit the contract and sign the database; no column changes and no data moves.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*[''"](?:@prisma/orm-sqlite|@internal/sqlite)/contract-builder[''"])[\s\S]*\.\s*Decimal\s*\('
  - id: sqlite-bigintnumber-deprecated
    summary: |
      On SQLite, `BigIntNumber` is a deprecated alias of `IntegerNumber` that warns with `PSL_DEPRECATED_SCALAR_NAME`, and a field written with it now emits codec `sqlite/integer@1` instead of `sqlite/bigintnumber@1`. Write `BigInt(as: number)` (or `type.BigInt({ as: 'number' })`), or `IntegerNumber`, which the warning names; both give the same contract. Re-emit the contract and sign the database. No column changes and no data moves.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\w.])BigIntNumber(?![\w])'
        - '\.\s*BigIntNumber\s*\('
  - id: sqlite-integer-safe-range
    summary: |
      On SQLite, an `Int` field, and every field whose codec is `sqlite/integer@1` (`IntegerNumber`, `BigInt(as: number)`, the deprecated `BigIntNumber`), now refuses to write a number that is not an integer within ±(2^53 − 1), such as `1.5`, with `RUNTIME.ENCODE_FAILED`, and reading a stored number that is not an integer, such as a `real`, raises `RUNTIME.DECODE_FAILED` naming the table and column. Before, the codec wrote any number as it was and read such a number as it was. A stored integer outside the range, which failed to read in a row with a `RangeError` from `node:sqlite` before, now raises `RUNTIME.DECODE_FAILED` naming the table and column. `sql/int@1` checks a read the same way. Find rows that hold such values and fix them.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*[A-Za-z_]\w*[ \t]+(?:Int|IntegerNumber)(?![\w])'
        - '=[ \t]*(?:Int|IntegerNumber)(?![\w])'
        - 'BigInt[ \t]*\([ \t]*as[ \t]*:[ \t]*number'
        - '(?<![\s\S])(?=[\s\S]*[''"](?:@prisma/orm-sqlite|@internal/sqlite)/contract-builder[''"])[\s\S]*\.\s*(?:Int|IntegerNumber)\s*\('
        - '(?<![\s\S])(?=[\s\S]*[''"](?:@prisma/orm-sqlite|@internal/sqlite)/contract-builder[''"])[\s\S]*\.\s*BigInt\s*\(\s*\{[^}]*as\s*:\s*[''"]number[''"]'
        - '(?<![\w$])(?:integerNumberColumn|sqliteIntegerColumn)(?![\w$])'
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])integerColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*integerColumn(?![\w$])'
  - id: ts-renamed-sqlite-column-helpers
    summary: |
      The SQLite column helpers are renamed after the explicit type each gives: `integerColumn` is `integerNumberColumn` (`IntegerNumber`), `bigintColumn` is `integerBigIntColumn` (`IntegerBigInt`) and `jsonColumn` is `plainJsonColumn` (`PlainJson`). The old names are removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])'
  - id: psl-renamed-mongo-int64
    summary: |
      On MongoDB, the explicit type `Int64` (a BSON long read as a `bigint`) is renamed `Int64BigInt`. `Int64` stays for one release line as a deprecated alias that warns with `PSL_DEPRECATED_SCALAR_NAME`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w.])Int64(?![\w])'
  - id: ts-removed-mongo-int64-helper
    summary: |
      In a MongoDB TypeScript contract, `type.Int64()` is removed. Write `type.BigInt()`, the convenience type, or `type.Int64BigInt()`, the explicit type. Both give the same contract.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.\s*Int64(?![\w])'
        - '\{[^{}]*\bInt64\b[^{}]*\}\s*=\s*\w'
  - id: re-emit-for-include-capabilities
    summary: |
      SQL adapters report two new capabilities in the `sql` group, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`, which together with `sql.jsonAgg` decide whether the ORM loads includes with the one-query include or with one query per relation. The PostgreSQL and MySQL adapters now also report `sql.jsonAgg`. Run `prisma contract emit` to record them in `contract.json` and `contract.d.ts`. A contract that is not re-emitted keeps working, because the runtime merges the adapter's capabilities over the contract's, and the profile hash does not change, so no database needs signing again. The contract snapshots under `migrations/snapshots/` need no change.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"targetFamily"\s*:\s*"sql")(?![\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAggWithoutTruncation")'
        - '(?<![\s\S])(?=[\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAgg")'
  - id: mysql-reemit-contract
    summary: |
      On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, and the target has new codecs for them. The emitted `contract.d.ts` gains aggregate result types for the new codecs. Re-emit the contract; its hashes do not change, so the database needs no migration and no new signature. `contract.json` changes only by the capabilities `re-emit-for-include-capabilities` describes.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '[''"]@prisma/orm-(?:mysql|mariadb)/config[''"]'
  - id: activity-handle-transaction-takes-callback
    summary: |
      An activity handle's `transaction` member, from `startActivityOn` in `@prisma/orm-family-sql/runtime` or from a runtime's `startActivity`, takes a callback: `handle.transaction(fn, options)` runs `fn` in a transaction through `withTransaction` and resolves with its result. It no longer returns a `RuntimeTransaction` for the caller to commit or roll back. The detection matches TypeScript sources that call an optional `transaction` member.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.transaction\?\.\('
  - id: activity-handle-transaction-and-in-transaction-required
    summary: |
      An activity handle, the `ActivityHandle` from `startActivityOn` or `startActivity` in `@prisma/orm-family-sql/runtime`, always has `transaction(fn, options)` and a new `inTransaction()` member. On a handle opened inside a transaction, or on a connection whose transaction is open, `transaction(fn)` runs `fn` in a savepoint, and `transaction(fn, options)` rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`. An object built by hand and typed as `ActivityHandle` must have both members, and a wrapper that copies a handle member by member must forward them. The detection matches TypeScript sources that name the type or call an optional `transaction` member.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ActivityHandle(?![\w$])'
        - '\.transaction\?\.\('
  - id: activity-route-transaction-always-defined
    summary: |
      `ActivityRoute.transaction`, from `@prisma/orm-family-sql/runtime`, is always a function; its type no longer includes `undefined`. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ActivityRoute(?![\w$])'
  - id: orm-write-inside-transaction-suspends-tx
    summary: |
      An ORM write of more than one statement inside a transaction runs in a savepoint. While it runs, other work sent on the same transaction rejects with `RUNTIME.TRANSACTION_SUSPENDED`. When such a write fails with an error that ends the whole transaction, such as a deadlock on MySQL or MariaDB, it rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, whose `cause` is the database's error, and the transaction is closed. The detection matches TypeScript sources that call `transaction` and `Promise.all` or `Promise.allSettled`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\.transaction\s*\()[\s\S]*Promise\.all'
  - id: sql-runtime-base-own-transaction-removed
    summary: |
      `SqlRuntimeBase.ownTransaction` is removed, and `ActivityRoute.transaction` is now `(parent, fn, options) => Promise<R>`: it runs `fn` in a transaction beneath `parent`, usually with `withTransaction(provider, fn, options, parent)`, instead of returning a `RuntimeTransaction`. `withTransaction` takes that optional `parent` and passes it to `provider.connection({ activityParent })`. The detection matches TypeScript sources that call `ownTransaction` or build an `ActivityRoute`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])ownTransaction\s*\('
        - '(?<![\w$])ActivityRoute(?![\w$])'
  - id: orm-runtime-queryable-transaction-removed
    summary: |
      The ORM client's `RuntimeQueryable` type, from `@prisma/orm-family-sql/orm-client`, no longer has an optional `transaction` member. The ORM runs a write of several statements in a transaction of the call's own activity handle and never calls `transaction` on the queryable it is given. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])RuntimeQueryable(?![\w$])'
  - id: rollback-after-commit-rejects
    summary: |
      `rollback()` on a runtime transaction or savepoint whose `commit()` the database applied rejects with `RUNTIME.TRANSACTION_CLOSED` and sends nothing; it used to resolve. This includes a `commit()` that rejected because an `activityEnded` hook threw after the `COMMIT`. The detection matches TypeScript sources that call `rollback()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.rollback\s*\(\s*\)'
  - id: transaction-context-has-transaction
    summary: |
      `TransactionContext`, from `@prisma/orm-family-sql/runtime`, has a required `transaction(fn)` member: it runs `fn` in a savepoint and passes it the savepoint's `TransactionContext`. An object an extension builds by hand and types as `TransactionContext` must have the member. A context type that extends `TransactionContext` has the member too, with a callback that receives the runtime's context, unless the extension declares its own. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])TransactionContext(?![\w$])'
  - id: transaction-settlement-state-has-closed-and-abandon
    summary: |
      `TransactionSettlementState`, from `@prisma/orm-family-sql/runtime/internal/prepared-query`, has two required members: `closed`, whether the transaction is closed, and `abandon()`, which invalidates the transaction and ends its activity. An object of this type built by hand must have both; code that forwards the member of a transaction it wraps needs no change. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])TransactionSettlementState(?![\w$])'
  - id: postgres-transaction-context-has-transaction
    summary: |
      `PostgresTransactionContext`, from `@prisma/orm-postgres/runtime`, has a required `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type. A context an extension builds for its own transactions and types as `PostgresTransactionContext` must have the member, or be typed with the runtime's `transaction` in its place. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PostgresTransactionContext(?![\w$])'
  - id: supabase-transaction-context-has-transaction
    summary: |
      `SupabaseTransactionContext`, from `@prisma/orm-extension-supabase/runtime`, is `PostgresTransactionContext`, so it has a required `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a `SupabaseTransactionContext`. A context an extension builds for its own transactions and types as `SupabaseTransactionContext` must have the member. The detection matches TypeScript sources that name the type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])SupabaseTransactionContext(?![\w$])'
  - id: facade-transaction-contexts-have-transaction
    summary: |
      `MysqlTransactionContext` (`@prisma/orm-mysql/runtime`) and `SqliteTransactionContext` (`@prisma/orm-sqlite/runtime`) declare their own `transaction(fn)` member: `tx.transaction(fn)` runs `fn` in a savepoint and passes it a context of the same type, not the runtime's `TransactionContext`. A context an extension builds for its own transactions and types as one of them must have the member. The detection matches TypeScript sources that name one of the types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Mysql|Sqlite)TransactionContext(?![\w$])'
  - id: relation-mutator-writes-parameter
    summary: |
      The boolean type parameter `FilteredWritesDisabled` of `RelationMutator` (its sixth), exported from `@prisma/orm-family-sql/orm-client`, is replaced by `Writes extends 'many' | 'one' | 'none'`, which also decides whether the mutator offers the new `update(data)` and `delete()` members. The type also gains three parameters after `ParentLinkFields`: `NsId`, `ConflictActions` and `DeleteDisabled extends boolean = false`, which makes `delete` unavailable. `VariantRelationMutator` is new in this release and takes the same parameters after `VariantValue`. Code that passes the `Writes` argument replaces `false` with `'many'`, and `true` with `'one'` for a to-one relation in `update()` data or `'none'` in `create()` data. Code that leaves the argument out gets the default `'many'` and is unaffected. The types may be imported under another name; follow the local name.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Variant)?RelationMutator\s*<'
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])(?:Variant)?RelationMutator(?![\w$])[^}]*\}'
  - id: foreign-key-with-relation-callback-refused
    summary: |
      `update()` data that sets a field of the foreign key the record holds for a relation (many-to-one, such as `Post.authorId` for `Post.author`) and also has a callback on that relation is refused with `ORM.ARGUMENT_INVALID` (`meta.problem: 'foreign-key-with-relation-mutation'`, with `meta.relation` and `meta.fields`) before any statement runs. It used to run, and a `create`, `connect` or `disconnect` callback overwrote the foreign key the data set. Keep either the foreign key or the callback.
  - id: mongo-collection-has-prepared
    summary: |
      `MongoCollection`, from `@prisma/orm-mongo/orm`, has a `prepared` member (`all()`, `first()`, `firstOrThrow()`), and its `limit` and `offset` take a number or a prepared placeholder. An object you type as `MongoCollection` yourself, such as a test double, needs `prepared`, and its `limit` and `offset` must accept the wider argument.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - ':\s{0,20}MongoCollection<[^<>]{0,200}(?:<[^<>]{0,200}>[^<>]{0,200}){0,4}>\s{0,20}=\s{0,20}\{'
        - '\bimplements\s{1,20}MongoCollection\b'
  - id: mongo-prepare-member-moved
    summary: |
      `MongoPrepareMember` moved and changed meaning. It is no longer exported from `@prisma/orm-mongo/family-runtime`; it is exported from `@prisma/orm-mongo/runtime`, takes the contract as its type argument instead of codec types, and has the client's `prepare` method, which also takes an ORM read and returns `MongoPreparedFrom<Params, Q>`. `MongoRuntime` declares its own `prepare`, which takes plans only.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)\s{1,20}(?:type\s{1,20})?\{[^}]{0,300}\bMongoPrepareMember\b[^}]{0,300}\}\s{0,20}from\s{0,20}[''"]@prisma/orm-mongo/family-runtime[''"]'
        - ':\s{0,20}MongoPrepareMember\b(?!\s{0,20}<)'
  - id: mongo-where-filter-takes-placeholders
    summary: |
      `MongoWhereFilter`, from `@prisma/orm-mongo/orm`, lets each scalar field's value also be a `MongoPreparedParamRef`, the placeholder a `prepare` callback receives. Code that takes a `MongoWhereFilter` and reads a field's value as the field's type must handle the placeholder first.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoWhereFilter\b'
  - id: compile-mongo-query-has-no-row-type
    summary: |
      `compileMongoQuery`, from `@prisma/orm-mongo/orm`, takes no type argument and returns `MongoQueryPlan<Record<string, unknown>>`. A call that passed a row type, `compileMongoQuery<Row>(...)`, no longer compiles.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bcompileMongoQuery\s{0,20}<'
  - id: runner-records-database-policies
    summary: |
      `MigrationRunnerPerSpaceOptions` (from `@prisma/orm-framework/components/control`) has a new optional field, `databasePolicies`. A target's migration runner that receives it sets `meta.policies` of the space's marker to it in the marker update at the end of the run, inside the run's transaction where the target has one, and leaves the rest of `meta` as it is. A run with no migrations and `databasePolicies` set still writes the marker, and writes no ledger entry. A marker write without `databasePolicies` must leave `meta` unchanged, `initMarker`'s upsert included. The `destination` that `initMarker` and `updateMarker` of `SqlControlAdapter` and `MongoControlAdapter` take is the framework's `MarkerDestination`, which carries the same optional `databasePolicies`; store it with `storedDatabasePolicies` under `DATABASE_POLICIES_META_KEY`. `MigrationRunner.execute` takes a new optional `expectedDatabasePolicies` beside `perSpaceOptions`: the policies the caller checked. Once the runner holds its marker lock, and before it applies the first space, it reads the application space's marker and calls `compareMarkerDatabasePolicies(marker, expectedDatabasePolicies)`. On `moved` it returns `databasePoliciesMovedFailure(expectedDatabasePolicies, comparison.found)` (`MIGRATION.MARKER_CAS_FAILURE` with `meta.reason: 'databasePolicies'`) without running any operation; on `unreadable` it throws `errorMarkerPoliciesCorrupt` (from `@prisma/orm-framework/errors/execution`), whose advice keeps the marker. A SQL target's runner does all of this with one call to `checkDatabasePoliciesHeld(family, driver, expectedDatabasePolicies)` from `@prisma/orm-family-sql/family/control`; a MongoDB runner compares with `compareMarkerDatabasePolicies` before its first space, and after a failed marker write asks `markerSwapFailure(found, expectedStorageHash, checkedPolicies)` from `@prisma/orm-family-mongo/family/control` why it failed. `ControlFamilyInstance.signSpaces` takes the same `expectedDatabasePolicies` beside `spaces` and compares them the same way before it writes any marker, whether or not the application space is among `spaces`; when they no longer hold it returns only a conflict for the application space with `reason: 'databasePolicies'`, `checked` and the `comparison`, and no `contract`. Every other conflict now carries `reason: 'storageHash'`. Likewise, the `MIGRATION.MARKER_CAS_FAILURE` a runner returns when the marker's storage hash moved under it carries `meta.reason: 'storageHash'` beside `space`, `expectedStorageHash`, `foundStorageHash` and `destinationStorageHash`. `MongoControlAdapter.updateMarker` takes an optional fifth argument, and `MarkerOperations.updateMarker` an optional fourth, `checkedPolicies` (`DatabasePolicies`): the policies the run checked. The update then matches only a marker whose `meta.policies` reads as them, however it is stored: no key outside `DATABASE_POLICIES_KEYS` and `DATA_PROTECTION_KEYS`, `change` as a set, each data protection setting by value, and an absent setting only where `checkedPolicies` has its default. `MarkerOperations` also has a required `markerLocation`, the collection that holds the markers, which the runner names in errors. When that update fails, `markerSwapFailure` reports a moved storage hash, moved policies, unreadable policies, or a marker changed and changed back; map them to the storage-hash failure, `databasePoliciesMovedFailure`, `errorMarkerPoliciesCorrupt`, and a `MIGRATION.MARKER_CAS_FAILURE` with `meta.reason: 'markerChanged'`. Do not retry the update. The SQL family's `insertMarker` takes `MarkerInsert`, a `MarkerDestination` without `databasePolicies`. The marker update is written when anything changed or policies are given; a ledger entry is written only when the run applied a migration edge, as before.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*databasePolicies)(?=[\s\S]*\b(?:SqlControlAdapter|MongoControlAdapter|MigrationRunner)\b)[\s\S]*\b(?:initMarker|updateMarker)\s*[(:]'
  - id: control-family-access-changes-of
    summary: |
      `ControlFamilyInstance` (from `@prisma/orm-framework/components/control`) has a new required method, `accessChangesOf(operations)`. It takes the operations of one recorded migration and returns a `MigrationAccessChange` (`{ operationIndex, subject, widens }`) for each operation that changes who can read or write data, `operationIndex` being its position in `operations`. `db migrate` refuses such a migration on a database whose data protection policy records `access-widening-forbidden`. Recognise an operation from its structure, such as its target details and the id its operation factory builds, never from its label. A family whose operations never change access returns `[]`. `SqlControlTargetDescriptor` (from `@prisma/orm-family-sql/family/control`) has a new required `accessChangesOf` with the same signature, which the SQL family instance calls; a SQL target with no operation that changes access sets `accessChangesOf: () => []`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*accessChangesOf)(?=[\s\S]*\bControlFamilyInstance\b)[\s\S]*\bstorageNameOf\s*[(:]'
        - '(?<![\s\S])(?![\s\S]*accessChangesOf)(?=[\s\S]*\bSqlControlTargetDescriptor\b)[\s\S]*\bclassifyEntityKind\s*:'
  - id: aggregate-planner-access-changes-of
    summary: |
      `planMigration(...)` and `resolveRecordedPath(...)` from `@prisma/orm-toolchain/migration-tools/aggregate` take a required `accessChangesOf(operations)` beside `storageNameOf`. The aggregate planner calls it once per recorded migration, with that migration's operations, and lists what it returns in the space's `accessChanges`, at positions in the whole path. Pass the family instance's `accessChangesOf`, or `() => []` in a test.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*accessChangesOf)(?=[\s\S]*\b(?:planMigration|resolveRecordedPath)\s*\()[\s\S]*\bstorageNameOf\s*:'
  - id: schema-tables-same-name
    summary: |
      In `@prisma/orm-family-sql/family/control`, `SchemaTables` gains a required `sameName(left, right)`: whether the database takes two table or column names for one, the comparison its `tablesNamed` and `columnsNamed` use. A `SchemaTables` or a test double of it adds `sameName`; use the new `exactName` export where names compare exactly.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])SchemaTables(?![\w$])'
  - id: plan-statements-plans-stored-name-renames
    summary: |
      `planStatements` from `@prisma/orm-family-sql/family/control` now plans a table or column rename for a model or field that keeps its name while its stored name changes, with no statement, whenever there is an origin contract. Its result, `PlannedStatements`, gains `alreadyRenamedTables` (tables whose rename the database already has, whose constraint renames a target puts before its creates and after the drops that free their new names) and `storageRenames` (a `StorageRenames`, or `undefined` with no origin contract). `StatementPlanningTarget` no longer extends `TableRenameByHand`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:planStatements|PlannedStatements|StatementPlanningTarget)(?![\w$])'
  - id: subjects-of-calls-storage-renames
    summary: |
      The context that `subjectsOfCalls` from `@prisma/orm-family-sql/family/control` takes gains a required `storageRenames`: the `storageRenames` of `planStatements`' result; `new StorageRenames([], fromContract, contract, exactName)` for a target that plans no renames; or `undefined` with no origin contract.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])subjectsOfCalls(?![\w$])'
  - id: stored-value-keep-data-edit-removed
    summary: |
      `StoredValueSubject.keepDataEdit` and the `keepData` and `swapsValues` fields of `StoredValueRewrite` (from `@prisma/orm-family-sql/family/control`) are gone, so the `dataLoss` entries of `CallSubjects` no longer carry `keepDataEdit`. A stored value whose member keeps its name is now rewritten by the plan, not asked about. Code that read these fields stops reading them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:keepDataEdit|keepData|swapsValues)(?![\w$])'
  - id: engine-pin-moves-to-0-10-4
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.10.4` (up from 0.10.0). An extension package that depends on `@prisma/cli-engine` for its tests or tooling must move to `0.10.4`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.(?:\d|10\.[0123xX*])(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?(?:[\^~]|[<>]=?\s*)?0\.(?:\d|10\.[0123xX*])(?!\d)'
  - id: consent-required-summary-is-one-fixed-sentence
    summary: |
      The first line of `CLI.CONSENT_REQUIRED` is now one fixed sentence. It no longer names the subject of a statement question, and it no longer quotes the question of a consent that `--confirm` answers. Code that matched the old first line must read the error's `code`, `why` and `meta` instead.
    detection:
      glob: "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,snap,json,sh,bash,yml,yaml}"
      matches:
        - 'needs? a statement'
        - '--yes cannot give'
        - '--yes cannot grant'
        - '--yes does not give it'
        - 'requires explicit consent, (?:and|which)'
        - 'Grant it by passing --confirm'
        - 'session is not interactive'
---

# 8.0.0-rc.24 → 8.0.0-rc.25 — Extension author upgrade instructions

The examples write the ORM client as `db.orm.public.<Model>`, which is the PostgreSQL form with its namespace. On SQLite, MySQL and MariaDB the same collection is `db.orm.<Model>`.

## Order of the steps

Make the changes below in any order, with three exceptions:

1. Add `pg` and `@types/pg` where they are needed, and move a declared `@prisma/cli-engine` to `0.10.4`, before you run the package manager's install for the upgrade (`pg-is-a-peer-dependency`, `extension-importing-pg-peers-it`, `engine-pin-moves-to-0-10-4`).
2. Before you run `prisma contract emit` or `prisma migration plan` for any reason in this guide, make the config changes these commands need: name the types module and the migration module (`target-package-names-generated-file-modules`, `extension-config-names-generated-file-modules`, `mysql-config-components-carry-family-and-modules`), and give `typescriptContractFromPath` its target (`typescript-contract-from-path-requires-target`). Without them, emitting fails with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`.
3. Make the changes to contract sources (`has-one-key-must-be-unique`, the renamed PostgreSQL, SQLite and MongoDB types and column helpers) before you re-emit the contract (`re-emit-for-include-capabilities`, `mysql-reemit-contract`, and the SQLite entries that say to re-emit). One emit then covers all of them.


## Peer dependencies and the config type

### `pg-is-a-peer-dependency`

Make this change before you run the package manager's install for the upgrade. In each `package.json` that `detection` matches, if the package's tests or scripts load the Postgres driver, make sure `devDependencies` has `pg` in a range that allows 8.22.0 or later within major version 8 and `@types/pg` in a range that allows 8.20.0 or later; add `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"` where they are missing. Without them, a test or script that loads the Postgres driver fails because Node.js cannot find the package `pg`.

### `extension-importing-pg-peers-it`

For each published extension package whose source files `detection` matches, move `pg` and `@types/pg` out of `dependencies` if they are there, and declare them in `peerDependencies` as `"pg": "^8.22.0"` and `"@types/pg": "^8.20.0"`. Keep them in `devDependencies` too, so the extension's own tests install them. Skip files under the extension's tests: a test that imports `pg` needs only the `devDependencies` entry.

### `config-type-renamed-to-prisma-config`

In every file the detection matches, rename each import, re-export and type use of `PrismaNextConfig` to `PrismaConfig`. If the file already has its own `PrismaConfig`, import the type under an alias instead, such as `import type { PrismaConfig as PrismaToolchainConfig }`, and use the alias. Leave string literals that happen to contain the text alone; they are application values, not the type. Its type parameters do not change. Then run the project's formatter, since a shorter name can let an import fit on one line.

```ts
// Before
import type { PrismaNextConfig } from '@prisma/orm-toolchain/cli/config-types';
const config: PrismaNextConfig<'sql', 'postgres'> = defineConfig({ /* ... */ });

// After
import type { PrismaConfig } from '@prisma/orm-toolchain/cli/config-types';
const config: PrismaConfig<'sql', 'postgres'> = defineConfig({ /* ... */ });
```


## A target package names the modules generated files import from

Prisma no longer works out which package a generated file should import from. The package an application installs for its target says so, in the config. Prisma's own target packages do this the same way.

An extension that only contributes types, operations or codecs to an existing target, and has no contract of its own, needs none of the changes in this section, as long as each type declaration it makes states a module of its own published package.

### `target-package-names-generated-file-modules`

This applies to a package that an application installs to use a target: one that exports a `defineConfig` built on the framework's `defineConfig`, from `@prisma/orm-framework/config/config-types` or `@prisma/orm-toolchain/cli/config-types`. It has three things to do.

**1. Export a module with the types a generated `contract.d.ts` imports.** It only re-exports: the framework's contract types, the family's, and the target's codec and operation types.

```ts
// src/contract-types.ts, exported as <your package>/contract-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from './codec-types';
export type * from './operation-types';
```

**2. State that module in the type declarations of the target and adapter you hand to the config.** `restateTypeDeclarations` returns a copy of a descriptor whose type declarations name the module you give it, keeping each name and alias. Assemble the components in one file, and build both `defineConfig` and any control client from it:

```ts
// src/components.ts
import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';

export const typesModule = 'prisma-orm-acmedb/contract-types';
export const migrationModule = 'prisma-orm-acmedb/migration';

export const target = restateTypeDeclarations(dbTarget, typesModule);
export const adapter = restateTypeDeclarations(dbAdapter, typesModule);
```

An application on your package can import only from packages it depends on directly, which is your package and not the ones it is built from. This is what makes the generated file name yours.

**3. Name both modules in the config.**

```ts
// src/config.ts
import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import { defineConfig as defineFrameworkConfig } from '@prisma/orm-framework/config/config-types';
import { adapter, createNamespace, driver, family, migrationModule, pack, target, typesModule } from './components';

export function defineConfig(options: { contract: string; output: string }) {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    contract: {
      ...prismaContract(options.contract, {
        output: options.output,
        target: pack,
        createNamespace,
      }),
      typesModule,
    },
    migrations: { module: migrationModule },
  });
}
```

`migrations.module` names the module that exports the migration base class, the command-line entry and your operation helpers: everything your migration renderer writes an import for.

Neither module may be empty, a path or a URL. Name it the way your package is imported.

Then check from outside: install your package in a scratch application from a tarball, run `prisma contract emit` and `prisma migration plan`, and typecheck with `skipLibCheck` off. Every import in the generated files should name your package, an extension's own package, or a relative path.

### `extension-config-names-generated-file-modules`

This applies to an extension that has a contract of its own: it has a `prisma.config.ts` that imports `defineConfig` from `@prisma/orm-toolchain/cli/config-types` or `@prisma/orm-framework/config/config-types`, possibly under another name, and passes it the family, target and adapter, and it commits a generated `contract.d.ts` and migrations.

Name both modules in the object passed to that call, with a types module private to the extension package:

```ts
contract: { ...contractSource, typesModule: '#contract-types' },
migrations: { module: '@prisma/orm-target-postgres/target/migration' },
```

```json
{ "imports": { "#contract-types": "./src/contract-types.ts" } }
```

`src/contract-types.ts` exports the framework's contract types, the family's, and the target's codec and operation types, as in `target-package-names-generated-file-modules` above. A relative path such as `'./contract-types'` is refused: the copy of the contract kept beside each migration is written into another folder, where that path points at nothing.

If your build inlines that module into a declaration file you publish, check that the built file still exports every type. A bundler can drop a whole-module `export type *` when it inlines the module; naming each type in the re-export avoids that.

Then run `prisma contract emit` in the extension and commit the regenerated files.

### `family-imports-are-import-requirements`

This applies to a package that implements a family's `EmissionSpi`, from `@prisma/orm-framework/components/emission`.

```ts
// before
getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[];
// after
getFamilyImports(typesModule: string): ReadonlyArray<ImportRequirement>;
```

Return one `ImportRequirement`, from `@prisma/orm-framework/ts-render`, for each type the family's part of `contract.d.ts` uses, each with `moduleSpecifier: typesModule` and `typeOnly: true`, and with `alias` where the generated file uses the type under another name. Do not build or return import text.

`ImportSpecifierResolver`, `keepInternalSpecifiers` and `resolveRequirementSpecifiers` are removed. Nothing translates a module name any more, so remove their uses.

### `migration-renderer-takes-the-migration-module`

This applies to a package that implements a migration planner whose plan has `renderTypeScript`.

```ts
// before
renderTypeScript(resolveImportSpecifier: ImportSpecifierResolver): string;
// after
renderTypeScript(migrationModule: string): string;
```

Write every import of the migration base class, the command-line entry and your operation helpers from `migrationModule`. It is the config's `migrations.module`. Remove any module name the renderer or its operations held themselves.

### `emitter-takes-the-types-module`

This applies to code that calls the emitter directly, from `@prisma/orm-toolchain/emitter`.

- `generateContractDts` takes the types module as its fifth argument. Pass the config's `contract.typesModule`.
- In `EmitOptions`, pass `typesModule` and remove `resolveImportSpecifier`.
- `generateImportLines`, which returned lines of import text, is replaced by `typesImportRequirements`, which returns import requirements. Render them with the helper in `@prisma/orm-framework/ts-render`.

### `mysql-config-components-carry-family-and-modules`

This applies to a package that builds its `defineConfig` with `createMysqlDefineConfig`, as a target that speaks the MySQL protocol does.

Pass three more members:

```ts
export const defineConfig = createMysqlDefineConfig({
  pack,
  family,
  target,
  adapter,
  driver,
  typesModule: 'prisma-orm-acmedb/contract-types',
  migrationModule: 'prisma-orm-acmedb/migration',
});
```

- `family` is the SQL family's control descriptor. The helper no longer supplies it.
- `typesModule` and `migrationModule` are the two modules of your package that generated files import from. The helper names them in the config, so your package must export both.
- `target` and `adapter` are used as given. Restate their type declarations yourself with `restateTypeDeclarations`, as in `target-package-names-generated-file-modules` above.

### `control-api-takes-types-module`

A script or test that calls the control client passes the module the generated contract types import from:

```ts
await client.emit({ contractConfig: { source, output, typesModule } });
await client.renderContractDts({ contract, typesModule });
```

Take the value from the config: `defineConfig(...).contract.typesModule`.

Code that calls the control API's operations directly, from `@prisma/orm-toolchain/cli/control-api`, removes the `projectDir` option from contract emit, `migration new` and `migration plan`, and passes the config to `preflightRefAdvancement` where it passed `projectDir`.

### `component-type-import-module-is-not-a-literal-type`

This applies to code that reads the module of a type import from a Prisma target or adapter descriptor, such as `postgresAdapter.types.codecTypes.import.package`, and relies on its type being one exact string.

The value is unchanged. Its type is now a template string type, because the module is filled in when the package is built. Replace a type-level comparison with the exact string by a comparison of the value, or by a check of the suffix.

### `toolchain-publish-surface-entrypoints-removed`

Remove every import of `@prisma/orm-toolchain/publish-surface` and its two subpaths. They held the table and the functions that translated module names when files were generated. That translation no longer happens, so there is nothing to call in their place.


## A TypeScript contract must be built for the config's target

### `typescript-contract-from-path-requires-target`

In every file the detection matches, give each call of `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types`, under whatever name the file imports it, all three arguments. Pass the output path second, or `undefined` to keep the default beside the contract. Pass as the third an object with `target`, the pack ref of the target the config is for, and `contractBuilderModule`, that target's `contract-builder` entry, such as `@prisma/orm-postgres/contract-builder`. Keep any `defaultControlPolicy` and `createNamespace` the call already passed beside them. The option types are exported from the same entry as `TypeScriptContractFromPathOptions` and `ConfigTarget`, though an object literal is enough. The loader then refuses a contract built for another target with `CONTRACT.TARGET_MISMATCH`.

```ts
// Before
typescriptContractFromPath('prisma/contract.ts', 'prisma/contract.json', {
  defaultControlPolicy: 'external',
  createNamespace: postgresCreateNamespace,
});

// After
typescriptContractFromPath('prisma/contract.ts', 'prisma/contract.json', {
  target: postgresPackRef,
  contractBuilderModule: '@prisma/orm-postgres/contract-builder',
  defaultControlPolicy: 'external',
  createNamespace: postgresCreateNamespace,
});
```


## `prisma orm init` sets up a project from the target package

### `target-package-exports-an-init-contribution`

`prisma orm init` installs the target package first, then loads the default export of its `init` entrypoint and writes the project from it. The CLI holds no template for any target.

This applies to a package that adds a target and wants `prisma orm init` to set up projects on it. Nothing changes for a package that does not.

A user reaches your package with `prisma orm init --target <your package name>`; `init-reaches-a-target-package-by-name` below says what your package needs for that.

Export an `init` entrypoint whose default export satisfies `InitContribution`:

```ts
// src/init.ts, exported as <your package>/init
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'AcmeDB',
  configModule: 'prisma-orm-acmedb/config',
  peerPackages: ['acmedb-driver'],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: () => dbFile,
  envExample: () => 'DATABASE_URL="acmedb://localhost:5000/mydb"\n',
  quickReference: (input) => renderQuickReference(input),
} satisfies InitContribution;
```

- `db.ts` and `.env.example` read the connection string from `DATABASE_URL`, and `dotenv` is installed with your package, so `db.ts` may import `dotenv/config`. `--probe-db` reads `DATABASE_URL` from the shell's environment, not from `.env`.
- `peerPackages` names the drivers your package requires as peers. `init` reads it only after your package is installed, so it cannot help a package manager that refuses to install your package without its peers. For a package Prisma lists, the list names the drivers so they go into that first install.
- `readme`, `serverRequirement`, `probe` and `prisma7QuickReference` are optional. A `probe` must settle within the 60 seconds `init` gives it. Give `prisma7QuickReference` when your `configModule` exports `prisma7Schema`.
- The entrypoint may import types from the framework, and no framework code that runs. The CLI that loads it can be a different installed copy of the framework from the one your package depends on.

### `init-reaches-a-target-package-by-name`

```bash
prisma orm init --target prisma-orm-acmedb --authoring psl
```

This applies to a package that adds a target and exports an init contribution, or wants to. Nothing changes for a package that does not. The guide for the whole package is `references/build-a-target-package.md` in the `prisma-8` skill.

Check these against your package:

- **The keyword.** Add `"keywords": ["prisma-orm-extension"]` to your `package.json`. Before `init` installs a package that is not in Prisma's list of short names, it reads the package's keywords and refuses a package without this one. It reads the registry's `latest` manifest when it is about to install your package, and the installed `package.json` when the project already declares your package and has it on disk. When it cannot read your package from the registry, for example one that needs credentials or a scope's own registry, it asks the user to install your package first.
- **The package name.** `--target` takes your package's name as published, with no version or tag.
- **The first install.** `init` does not know your drivers before your package is installed, and it does not work them out from the registry. It installs your package and `dotenv`, and the package manager handles your required peer dependencies its own way. A package manager set up to refuse a package whose peers are missing fails that install, and `init` reports the failure. After loading your contribution, `init` declares its `peerPackages` in a later install. Your `init` entrypoint is loaded between the two installs, so it must load without the drivers present.
- **Other required peers.** `init` installs only `peerPackages`. Tell your users in your README about any other peer your package requires.
- **`--json`.** The result reports your package name as both `target` and `package`.
- **Prisma 7 schemas.** `init` maps the provider of a Prisma 7 schema to a target package through Prisma's list only. In a project with a Prisma 7 schema, `--target <your package>` sets up a fresh contract and leaves the schema alone, and `--from-prisma7-schema` with `--target <your package>` is refused.


## Targets that extend MySQL

### `mysql-driver-factories-take-the-target`

Find each call to `createMysqlRuntimeDriverDescriptor` or `createMysqlControlDriverDescriptor` that passes a target id, and pass the target's runtime metadata instead, which carries its `targetId` and its `displayName`, and the error numbers the database reports a failed CHECK constraint with (3819 on MySQL, 4025 on MariaDB):

```ts
// was createMysqlRuntimeDriverDescriptor('mariadb')
const driver = createMysqlRuntimeDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
  checkViolationErrors: [4025],
});
```

A target without metadata of its own passes an object with the two fields: `{ target: { targetId: 'mariadb', displayName: 'MariaDB' }, checkViolationErrors: [4025] }`.

### `mysql-codec-descriptor-wrap-parameter`

In each matched file, find any object or class that implements `AnyMysqlCodecDescriptor` itself, without extending `MysqlCodecDescriptor` (from `@prisma/orm-target-mysql/target/codec-descriptor`) or being made with `mysqlCodec()`. If a matched file gives the type another name, such as `type CustomDescriptor = AnyMysqlCodecDescriptor`, search the project for that name too: a descriptor typed through it can sit in a file this step does not match. The same holds for a descriptor written as a plain object with no type: check every descriptor your extension gives a MySQL or MariaDB client in its codec list, since the codec registry refuses one without the method with `RUNTIME.CODEC_DESCRIPTOR_INVALID`. Give each such descriptor a `wrapParameter` method that returns the parameter it is given:

```ts
import type { CodecRef } from '@prisma/orm-framework/components/codec';
import type { AnyExpression, AnyParamRef } from '@prisma/orm-family-sql/relational-core/ast';

wrapParameter(parameter: AnyParamRef, _ref: CodecRef): AnyExpression {
  return parameter;
}
```

The MySQL renderer calls it for every parameter of the codec but those of `LIMIT` and `OFFSET`, with the parameter as an expression and the codec reference, which carries the column's type parameters, and writes the expression it returns into the statement. Return an expression around the parameter only when the server must read the value as a particular type, as MySQL's own `mysql/decimal@1` returns `CastExpr.as(parameter, 'DECIMAL(65,30)')` for a column with at most 35 digits before the point, and a cast with fewer digits after the point for a wider column, read from the type parameters of the codec reference. The expression must hold the parameter exactly once, or the renderer refuses the statement with `RUNTIME.CODEC_DESCRIPTOR_INVALID`. Without the method, building the codec registry fails with `RUNTIME.CODEC_DESCRIPTOR_INVALID`. A file that only uses `AnyMysqlCodecDescriptor` as a type, such as the type of a parameter, needs no change.


## SQL adapters report the include capabilities

### `adapters-report-include-capabilities`

Add the three keys to your adapter's `sql` capability group, each set to `true` only where your database meets it:

- `jsonAgg`: the database aggregates rows into a JSON array.
- `outerReferencesInDerivedTables`: a reference to the outer query resolves inside a derived table in a subquery.
- `jsonAggWithoutTruncation`: an oversized JSON aggregate fails or cannot be decoded, and never comes back as a shorter valid array.

```ts
export const myAdapterCapabilities = {
  sql: {
    jsonAgg: true,
    outerReferencesInDerivedTables: true,
    jsonAggWithoutTruncation: true,
  },
};
```

If your database lacks any of them, leave that key out or set it to `false`. The ORM then loads each include with one query per relation, and your users meet these differences:

- A paged include (`limit` or `offset`) and a `distinct()` include are numbered with `ROW_NUMBER()`, so the database needs window functions.
- `prepared.all()`, `prepared.first()` and `prepared.firstOrThrow()` with includes throw `ORM.CAPABILITY_MISSING`, because a prepared read is one statement.
- A read with includes sends one statement for its rows and one for each included relation, outside a transaction.


## A `hasOne` relation needs a unique key on the target

### `has-one-key-must-be-unique`

A `hasOne` relation says that at most one row of the target model points at each row of this model. The SQL contract build now checks that the target's `by` fields are unique. They are unique when one of these covers exactly those fields, in any order:

- the target's primary key;
- a unique constraint (`.unique()` on the field, or `constraints.unique([...])` in `.attributes()`);
- a unique index (`constraints.index([...], { unique: true })` in `.sql()`) without a `where`.

A unique constraint over more fields than `by`, or over only some of them, does not count. When none matches, `prisma contract emit` and `defineContract` fail:

```text
CONTRACT.RELATION_INVALID: Relation "User.profile" is one-to-one, but the fields "userId" of model "Profile" are not unique. Add a unique constraint over exactly those fields, or make "profile" a hasMany relation.
```

In every file the detection matches, find each `rel.hasOne(Target, { by: ... })` whose `by` fields of `Target` are not unique, and apply one of the two fixes below. Then re-emit the contract with `prisma contract emit`.

**Each parent has at most one related row: make the key unique.** Add a unique constraint over exactly the `by` fields of the target model. For one field, use `.unique()`:

```ts
// Before
const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
  },
});

// After
const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).unique(),
  },
});
```

For several fields, add `constraints.unique([fields.a, fields.b])` to the target's `.attributes()`. The contract's storage gains a unique constraint, so plan and apply a migration for it. The migration fails if the table already holds two rows with the same key; remove the duplicates first.

**A parent can have several related rows: use `hasMany`.** Replace `rel.hasOne(Target, { by })` with `rel.hasMany(Target, { by })`. The relation then reads as an array of rows instead of one row or `null`, so update the code that reads or writes it.


## PostgreSQL's `Json` is a convenience type, and `sql.String` is `sql.Varchar`

On PostgreSQL, `Json` is now a convenience type, as `Int` and `String` are. Its optional `storage` argument chooses the column: `Json` and `Json(storage: json)` are a `json` column, and `Json(storage: jsonb)` is a `jsonb` column. Written bare, `Json` gives the same `json` column as before, so schemas need no change and every contract stays the same. `Jsonb` is unchanged.

The explicit type of a `json` column is named `PlainJson`, and the column helper is renamed to match it.

On every SQL target, `sql.String(n)` is renamed `sql.Varchar(n)`, with `sql.String` kept as a deprecated alias.

### `ts-renamed-postgres-json-column-helper`

The detection matches a file that imports or re-exports `jsonColumn` from `@prisma/orm-postgres/adapter/column-types`, `@prisma/orm-target-postgres/adapter/column-types` or the Prisma repository's workspace package for it, or imports one of them as a namespace and reads `jsonColumn` from it. In that file, rename the import or re-export and every use of the name. Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it:

```ts
import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(plainJsonColumn); // was jsonColumn
```

`field.column(type.Json())` and `field.column(type.PlainJson())` give the same column. A file that imports `jsonColumn` from a SQLite package is covered by `ts-renamed-sqlite-column-helpers`, not this one.

### `ts-postgres-explicit-json-type`

Read the `json` type constructor as `PlainJson`:

```ts
import { postgresExplicitTypes } from '@prisma/orm-target-postgres/target';

postgresExplicitTypes.PlainJson.output.codecId; // was postgresExplicitTypes.Json, 'pg/json@1'
```

`postgresScalarTypes.Json` is the convenience type, a type choice whose `storage` option picks `PlainJson` or `Jsonb`. Code that reads `.output` from it, or treats it as a type constructor, reads `postgresScalarTypes.PlainJson` instead.

### `psl-renamed-sql-string`

`sql.String(n)` shared a name with the `String` convenience type and meant something else: a `varchar(n)` column. It is renamed `sql.Varchar(n)`. In each matched schema, replace `sql.String(` with `sql.Varchar(`, in fields and in `types {}` aliases:

```prisma
model Label {
  id   Int             @id
  name sql.Varchar(50) // was sql.String(50)
}
```

The contract does not change. `sql.Char(n)` keeps its name.

### `ts-renamed-sql-string`

In each matched file, rename every `sql.String` call to `sql.Varchar`, including a call split across lines such as `type.sql` and `.String(64)` on the next line:

```ts
field.column(type.sql.Varchar(50)); // was type.sql.String(50)
```

The contract does not change.


## SQLite scalars get convenience types

On SQLite, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL and MongoDB. Each chooses one explicit type: `Int` is `IntegerNumber`, `BigInt` is `IntegerBigInt`, `BigInt(as: number)` is `IntegerNumber`, `Float` is `Real`, `Decimal` is `DecimalString`, `String` is `Text`, `Boolean` is `IntegerBoolean`, `Bytes` is `Blob` and `Json` is `PlainJson`. An explicit type is named after the SQLite column type that stores it: `Text`, `Real` and `Blob`. `integer` is read by more than one codec of its data type, so those types carry the value too: `IntegerNumber` and `IntegerBigInt`. A type with a data type of its own, which a `text` column stores, is named after that data type: `DecimalString`, `PlainJson` and the date and time types. `IntegerBoolean` is an exception: `sqlite/boolean` is a data type of its own, which an `integer` column stores, and its name takes the form of the other `integer` types. Written bare, `Int`, `BigInt`, `Float`, `String`, `Bytes` and `Json` give the same codec as before.

Two names change the contract. A `Decimal` field gets its own codec, `sqlite/decimal@1`, where it was the same codec as `String`. `BigIntNumber` is a deprecated alias of `IntegerNumber`, so its codec id changes. Neither changes a column, and no data moves.

`Boolean` is new on SQLite: a schema can now write a `Boolean` field, or `type.Boolean()` in a TypeScript contract. It is an `integer` column holding 1 for `true` and 0 for `false`, which is what SQLite's own `TRUE` and `FALSE` are, with its own codec `sqlite/boolean@1`. `@default(true)` is written `DEFAULT 1`. A stored value other than 0 or 1 raises `RUNTIME.DECODE_FAILED`, naming the column. A field takes equality filters, and is not ordered or summed. No existing schema used it, so nothing changes for one.

`Int` and every other field on the codec `sqlite/integer@1` now checks that a value is an integer within the safe integer range, as `BigIntNumber` did; see `sqlite-integer-safe-range`.

A `BigInt` field now reads every stored 64-bit integer. Before, reading a row that held an integer outside ±(2^53 − 1) failed in `node:sqlite` with a `RangeError` whose code is `ERR_OUT_OF_RANGE`, so only a read through an `include()` or a `sumBigInt` gave the value. Nothing in the schema changes for it. A value read without an integer codec, such as a column of a raw SQL query, is now a `number` within the safe integer range and an exact `bigint` outside it, where the read threw before. `JSON.stringify` throws on a `bigint`, so code that serializes such a row prints the value with `String(value)`. A `BigInt` field also refuses to write a `bigint` outside the signed 64-bit range with `RUNTIME.ENCODE_FAILED`, where `node:sqlite` threw a `TypeError` before.

The column helpers of the TypeScript contract builder are renamed after the explicit type each gives, and `decimalStringColumn` and `integerBooleanColumn` are new.

### Sign the database with the new contract

The `Decimal` and `BigIntNumber` changes below change the contract's storage hash, so `db verify` reports `CONTRACT.MARKER_MISMATCH` until the database is signed with the new contract. After re-emitting the contract:

- In a project with migrations, run `migration plan --from <latest migration>`, where `<latest migration>` is the name of the newest folder under `migrations/`. It writes a migration with no operations, which names the changed table, and `db migrate` applies it and signs the database. No table is rebuilt. Without `--from`, `migration plan` starts from the `db` ref. A project that applied its migrations with `db migrate` before this release, without `--advance-ref`, has none, so the command refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`.
- In a project without migrations, run `db update`. It runs no operation and signs the database.

`db verify --schema-only` passes before and after: the columns are the same.

### `sqlite-decimal-codec`

This applies to a schema whose target is SQLite. On PostgreSQL and MongoDB, `Decimal` does not change; skip this entry there. The detection matches every schema with a field or a `types {}` alias written `Decimal`, whatever its target.

Nothing in the schema changes. Re-emit the contract: each `Decimal` field's column now has codec `sqlite/decimal@1` and data type `sqlite/decimal` where it had `sqlite/text@1`. Then sign the database as described above.

`sqlite/decimal@1` reads and writes decimal text such as `"12.50"`, as before. It now refuses to write text that is not a decimal, and reading stored text that is not a decimal raises `RUNTIME.DECODE_FAILED`, naming the column. Such text is most often the `''` that an earlier migration wrote into the rows of a new required `Decimal` column; a new required column is now filled with `'0'`. Find those rows with this query, putting in each `Decimal` column and its table:

```sql
SELECT rowid, "price"
FROM "product"
WHERE "price" IS NOT NULL
  AND NOT (
    typeof("price") = 'text'
    AND ltrim("price", '-') <> ''
    AND length("price") - length(ltrim("price", '-')) <= 1
    AND ltrim("price", '-') NOT GLOB '*[^0-9.]*'
    AND ltrim("price", '-') NOT GLOB '*.*.*'
    AND ltrim("price", '-') NOT GLOB '.*'
    AND ltrim("price", '-') NOT GLOB '*.'
  );
```

Set each row it returns to a decimal, such as `UPDATE "product" SET "price" = '0' WHERE "price" = '';`, or make the field optional and set it to `NULL`.

Stored text that is a decimal but has leading zeros or a minus sign on zero, such as `"0012.50"` or `"-0"`, stays as it is and still reads. An equality filter no longer finds it: the codec now writes a value, and compares a filter value, without the leading zeros or the minus sign on zero, so a filter for `"0012.50"` looks for `"12.50"`. This query returns those rows:

```sql
SELECT rowid, "price"
FROM "product"
WHERE ltrim("price", '-') GLOB '0[0-9]*'
   OR ("price" GLOB '-*' AND ltrim("price", '-0.') = '');
```

Set each row it returns to the same number without the leading zeros or the minus sign on zero, such as `UPDATE "product" SET "price" = '12.50' WHERE "price" = '0012.50';`.

A `Decimal` field can be compared for equality only. Text compares by its characters, so `"1.5"` and `"1.50"` are different values, and ordering, the text filter `like` and aggregates such as `sum` and `max` are not offered; code that used them on a `Decimal` field no longer type-checks. A `Decimal` default may be written as text, `@default("12.50")`, or as a whole number, `@default(3)`. A number with a fraction, such as `@default(1.5)`, is refused when the contract is emitted, with `Expected a quoted string or a number that sqlite/decimal can hold; got sqlite/real`: write it as text, `@default("1.5")`.

Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from.

### `ts-sqlite-decimal-codec`

In a SQLite TypeScript contract, `type.Decimal()` and `type.DecimalString()` give the same column, with codec `sqlite/decimal@1`. The code does not change. Re-emit the contract and sign the database as described above; the notes under `sqlite-decimal-codec` about stored text that is not a decimal, equality and the column's values apply here too. A file that matches only because another library's `Decimal(` is called in it needs no change.

### `sqlite-bigintnumber-deprecated`

This applies to a SQLite schema or TypeScript contract. On PostgreSQL, `BigIntNumber` was deprecated in an earlier release; skip this entry there.

In each matched SQLite schema, replace the type `BigIntNumber` with `BigInt(as: number)`, in fields, value object members and `types {}` aliases. In a SQLite TypeScript contract, replace `type.BigIntNumber()` with `type.BigInt({ as: 'number' })`. The deprecation warning names `IntegerNumber`, the explicit type, which gives the same contract as `BigInt(as: number)`; either is right:

```prisma
model Post {
  id        Int                 @id
  viewCount BigInt(as: number)  // was BigIntNumber
}
```

`Int` gives the same column too. The field's codec id changes from `sqlite/bigintnumber@1` to `sqlite/integer@1`, which writes and reads a `number` within the safe integer range, as `sqlite/bigintnumber@1` did; `sqlite-integer-safe-range` says what a value outside it raises. Re-emit the contract and sign the database as described above.

`sqlite/bigintnumber@1` stays: `count()` and the `sum` of an integer column still read their result through it, so a reference to it in generated `contract.d.ts` aggregate types is expected. A file that matches only because a comment or a string mentions `BigIntNumber` needs no change. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is.

### `sqlite-integer-safe-range`

This applies to a SQLite schema or TypeScript contract. On PostgreSQL and MongoDB, `Int` does not change; skip this entry there. The detection matches every schema with an `Int` field, whatever its target, because the change is to what the codec accepts, not to how the field is written.

Nothing in the schema or the contract changes. The codec `sqlite/integer@1`, which `Int`, `IntegerNumber`, `BigInt(as: number)` and the deprecated `BigIntNumber` give, now checks every value in both directions:

- A write of a number that is not an integer, such as `1.5`, or of an integer outside ±(2^53 − 1), the range a JavaScript `number` holds exactly, fails with `RUNTIME.ENCODE_FAILED` before any SQL runs, as in `sqlite/integer@1 value must be an integer within the safe integer range, got 1.5`. Before, the number was written as it was: SQLite stored `1.5` as a `real` in the `integer` column, and an integer past the range had already lost digits in the JavaScript `number` before it was written. Round the value in the application, or give the field `BigInt` if it needs the full 64-bit range.
- A read of a stored number that is not an integer, such as the `real` `1.5` an earlier write stored, fails with `RUNTIME.DECODE_FAILED` and names the table and column, as in `Column "line_item"."quantity" holds 1.5, which is not an integer within the safe integer range.` Before, a read of the row gave the number as it was, and a read through an `include()` already failed.
- A read of a stored integer outside the range fails with `RUNTIME.DECODE_FAILED` and names the table and column, in a row and through an `include()`, as in `Column "line_item"."quantity" holds 9007199254740993, which is not an integer within the safe integer range.` Before, a read of the row failed in `node:sqlite` before any codec ran, with a `RangeError` whose code is `ERR_OUT_OF_RANGE` and which named no column, and a read through an `include()` already raised `RUNTIME.DECODE_FAILED`.
- A stored blob fails with `RUNTIME.DECODE_FAILED` and names the table and column, in a row and through an `include()`, as in `Column "line_item"."quantity" holds bytes x'35', which is not an integer within the safe integer range.` `sql/int@1` reads a blob the same way. Before, some blobs were read as a number: in a row a one-byte blob read as the value of its byte, so `x'07'` read as 7, and a longer blob such as `x'3132'` was refused; through an `include()` a blob whose bytes spell digits read as that number, so `x'3132'` read as 12.

`sql/int@1`, which a TypeScript contract can name on SQLite, reads the same way: a stored number that is not an integer, an integer outside the range and a blob each raise `RUNTIME.DECODE_FAILED` naming the table and column. Before, it read a stored number in a row as it was.

Find such rows with this query, putting in each `Int` column and its table:

```sql
SELECT rowid, "quantity"
FROM "line_item"
WHERE "quantity" IS NOT NULL
  AND (
    typeof("quantity") <> 'integer'
    OR "quantity" > 9007199254740991
    OR "quantity" < -9007199254740991
  );
```

Set each row it returns to an integer within the range. A fraction inside the range can be rounded, such as `UPDATE "line_item" SET "quantity" = CAST(round("quantity") AS INTEGER) WHERE typeof("quantity") = 'real' AND abs("quantity") <= 9007199254740991;`. A value outside the range cannot be repaired by a cast, which stops at the 64-bit limit and stays outside the range: set it to the value the application means, or change the field to `BigInt`, which reads the full 64-bit range. Run the query again afterward; the upgrade is done when it returns no rows. A project whose rows the query does not return needs no change.

### `ts-renamed-sqlite-column-helpers`

The detection matches a file that imports or re-exports `integerColumn`, `bigintColumn` or `jsonColumn` from `@prisma/orm-sqlite/adapter/column-types` or `@prisma/orm-target-sqlite/adapter/column-types`, or imports one of them as a namespace and reads one of those names from it. In that file, rename the import or re-export and every use of the name:

| Old name | New name | Explicit type |
| --- | --- | --- |
| `integerColumn` | `integerNumberColumn` | `IntegerNumber`, codec `sqlite/integer@1` |
| `bigintColumn` | `integerBigIntColumn` | `IntegerBigInt`, codec `sqlite/bigint@1` |
| `jsonColumn` | `plainJsonColumn` | `PlainJson`, codec `sqlite/json@1` |

```ts
import { integerNumberColumn, plainJsonColumn } from '@prisma/orm-sqlite/adapter/column-types';

field.column(integerNumberColumn); // was integerColumn
field.column(plainJsonColumn); // was jsonColumn
```

Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it. `field.column(type.Int())` and `field.column(type.IntegerNumber())` give the same column. A file that imports `jsonColumn` from a PostgreSQL package is covered by `ts-renamed-postgres-json-column-helper`, not this one. `textColumn`, `realColumn` and `blobColumn` keep their names. `decimalStringColumn` is new and gives `DecimalString`, codec `sqlite/decimal@1`, and `integerBooleanColumn` is new and gives `IntegerBoolean`, codec `sqlite/boolean@1`.


## MongoDB scalars get convenience types

On MongoDB, `Int`, `BigInt`, `Float`, `Decimal`, `Boolean`, `Bytes`, `String` and `Json` are now convenience types, as on PostgreSQL. Each chooses one explicit type named after the BSON type that stores it: `Int` is `Int32`, `BigInt` is `Int64BigInt`, `BigInt(as: number)` is `Int64Number`, `Float` is `Double`, `Decimal` is `Decimal128`, `Boolean` is `Bool`, `Bytes` is `Binary`, `String` is `BsonString` and `Json` is `PlainJson`. Every contract stays the same.

`Int`, `Float` and `Boolean` no longer warn, and `type.Int()`, `type.Float()` and `type.Boolean()` exist again. `BigInt`, `Bytes` and `Decimal`, which MongoDB refused before, now resolve.

### `psl-renamed-mongo-int64`

In each matched schema, replace the type `Int64` with `BigInt`, the convenience type, or `Int64BigInt`, the explicit type. Do this in fields, value object members and `types {}` aliases. Leave `Int64Number` as it is, or write it `BigInt(as: number)`:

```prisma
model Post {
  id    ObjectId @id @map("_id")
  views BigInt   // was Int64
}
```

The contract does not change. A file that matches only because a comment or a string mentions `Int64` needs no change. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from, and `Int64` still reads there as the same type.

### `ts-removed-mongo-int64-helper`

In each matched file, replace every `Int64` read from the `type` helpers with `BigInt` or `Int64BigInt`. This covers a call, a call split across lines, and a read with no call, such as `const long = type.Int64`:

```ts
field.scalar(type.BigInt()); // was type.Int64()
```

A helper taken out of `type` by destructuring, such as `const { Int64 } = type`, also matches. Take out `BigInt` or `Int64BigInt` instead and rename its calls. The contract does not change. A file that matches only because a comment mentions `.Int64`, or because it uses another library's `Int64`, such as Apache Arrow's `new arrow.Int64()`, needs no change.


## Re-emit SQL contracts

### `re-emit-for-include-capabilities`

Run `prisma contract emit` for every SQL contract. The emitted `capabilities.sql` gains the new keys the adapter reports:

```json
"sql": {
  "jsonAgg": true,
  "jsonAggWithoutTruncation": true,
  "outerReferencesInDerivedTables": true
}
```

A MariaDB contract gains only `"jsonAgg": true`: MariaDB does not report the other two, and the emitter leaves out a capability that is `false`. Without them the ORM loads includes on MariaDB with one query per relation.

### `mysql-reemit-contract`

On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL, SQLite and MongoDB. Each chooses one explicit type named after the MySQL column type that stores it: `Int` is `Int4`, `BigInt` is `Int8BigInt`, `BigInt(as: number)` is `Int8Number`, `Float` is `Float8` (a `double`), `Decimal` is `NumericString(65, 30)`, `String` is `Varchar(191)` and `String(storage: text)` is `Text`, `Boolean` is `Bool` (a `tinyint(1)`), `Bytes` is `Longblob` and `Json` is `PlainJson`. A field written `Int`, `BigInt` or `String` gives the same codec as before, so no schema needs a change.

In each matched project, emit the contract again:

```bash
pnpm prisma contract emit
```

The generated `contract.d.ts` gains entries under `AggregateTypes` for the new codecs, such as `sum` over `mysql/decimal@1` and `avg` over `mysql/double@1`. The hashes in `contract.json` do not change, so the database's signature stays as it is and no migration is needed; `contract.json` changes only by the capabilities `re-emit-for-include-capabilities` describes. Leave the `contract.d.ts` copy inside each migration snapshot under `migrations/snapshots/` as it is.

A SQL contract on MySQL or MariaDB is emitted once for this entry and `re-emit-for-include-capabilities`.


## An activity handle runs `transaction(fn)` through `withTransaction`

### `activity-handle-transaction-takes-callback`

Where code calls `transaction` on an activity handle, pass the work as a callback and drop the `commit()` and `rollback()` calls. The callback receives the same context `withTransaction` passes to its callback. `withTransaction` commits when the callback resolves, rolls back when it throws, and gives the connection back. A failed `COMMIT` rejects with `RUNTIME.TRANSACTION_COMMIT_FAILED` and a failed `ROLLBACK` after a callback error with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, each with the original error as `cause`. Code that matched on the driver's error from those calls matches on these codes instead. Leave calls on a connection, `connection.transaction(options)`, as they are; only the handle's member changed.

Before:

```ts
const tx = await handle.transaction?.(options);
if (tx) {
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
```

After:

```ts
return handle.inTransaction()
  ? handle.transaction((tx) => work(tx))
  : handle.transaction((tx) => work(tx), options);
```

The member is always there (`activity-handle-transaction-and-in-transaction-required`), so the test for it goes too. On a handle opened inside a transaction the callback runs in a savepoint, and passing options there rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`, so pass them only outside a transaction.

A handle opened on a connection the caller holds runs the transaction on that connection and leaves it held after a commit or a rollback. After a failed `BEGIN`, a failed `ROLLBACK` or a timeout the connection is destroyed, and a later `release()` by its holder rejects.

### `activity-handle-transaction-and-in-transaction-required`

Drop the optional call on a handle's `transaction`: write `handle.transaction(...)` in place of `handle.transaction?.(...)`. Code that tested for the member, such as `'transaction' in handle` or `handle.transaction === undefined`, to learn whether the handle was opened inside a transaction calls `handle.inTransaction()` instead. Inside a transaction, call `handle.transaction(fn)` without options.

An object built by hand and typed as `ActivityHandle`, such as a stub in a test, gains both members:

```ts
const handle: ActivityHandle<'my-call'> = {
  ...members,
  transaction: (fn, options) => inner.transaction(fn, options),
  inTransaction: () => inner.inTransaction(),
};
```

A wrapper that copies a handle's members by name, for example to record the statements it sends, forwards `inTransaction` too. Without it the ORM treats the handle as outside a transaction and passes its implicit transaction options, and on a facade that sets them, such as MySQL's, a write of several statements inside a transaction rejects with `RUNTIME.SAVEPOINT_OPTIONS_UNSUPPORTED`.

### `activity-route-transaction-always-defined`

A `SqlRuntimeBase` subclass that builds an `ActivityRoute` sets `transaction` to a function; `transaction: undefined` no longer typechecks. Remove checks of the member for `undefined`. `sql-runtime-base-own-transaction-removed` below gives the function's new shape.

### `orm-write-inside-transaction-suspends-tx`

Where code runs an ORM write of several statements, such as a create with a nested relation, at the same time as other work on the same transaction, for example in `Promise.all`, await the write before sending the other work:

```ts
await tx.orm.public.Post.create({ title, author: (author) => author.create(user) });
await tx.execute(plan);
```

On any SQL database, when such a write fails with an error that ends the whole transaction, such as a deadlock on MySQL or MariaDB, the rollback to the savepoint fails too. The write then rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, whose `cause` is the database's error, and the transaction is closed. Before, it rejected with the database's error itself. Code that retries on the database's deadlock error reads that error from `error.cause`.

### `sql-runtime-base-own-transaction-removed`

A `SqlRuntimeBase` subclass that built an `ActivityRoute` with `transaction: (parent, options) => ...` and began the transaction through `this.ownTransaction(...)` now runs the callback with `transaction: (parent, fn, options) => withTransaction(provider, fn, options, parent)`. The provider's `connection(options)` opens the connection beneath `options?.activityParent`, and that connection's `transaction(options)` calls `beginTransactionOn(connection, owner, parent, options)` with the same parent. Delete the method that called `ownTransaction`.

Before:

```ts
transaction: (parent, options) => runtime().beginRoleTransaction(binding, parent, options),

private async beginRoleTransaction(binding, parent, options) {
  const { conn, session } = await this.openRoleConnection(binding, { activityParent: parent });
  return this.ownTransaction(session, () => this.beginTransactionOn(conn, session, parent, options));
}
```

After:

```ts
connection: (options) => open(options)(),

transaction: (parent, fn, options) => withTransaction(scope, fn, options, parent),
```

Here `scope` is the role scope whose `connection(options)` opens a role session with `openRoleConnection(binding, options)`.

In the method that builds the session, take `const parent = options?.activityParent;` and pass `parent` in place of `undefined` to `beginTransactionOn` in the session's `transaction(options)`.

### `orm-runtime-queryable-transaction-removed`

Remove any `transaction` member written only so the ORM could open a transaction on a queryable typed `RuntimeQueryable`; the ORM no longer reads it. Code that called `transaction` through a value typed `RuntimeQueryable` types the value as the runtime type it holds, such as `Runtime`, `RuntimeConnection` or an activity handle.

### `rollback-after-commit-rejects`

Remove a `rollback()` call that runs after `commit()` resolved, such as one in a `finally` block or in a `catch` that also handles a hook error thrown from `commit()`. Where `commit()` can reject, call `rollback()` only when the transaction did not commit, or wrap the work in `withTransaction`, which decides this itself.


## Transaction contexts have `transaction` for nested transactions

`tx.transaction(fn)` inside a transaction now runs `fn` in a savepoint. The entries below say what an extension that builds or types a transaction context itself must add.

### `transaction-context-has-transaction`

An object built by hand and typed as `TransactionContext`, such as a stub in a test, gains a `transaction` member. Delegate it to the context the object wraps, or reject when the object has none:

```ts
const ctx: TransactionContext = {
  get invalidated() {
    return inner.invalidated;
  },
  query: (plan) => inner.query(plan),
  execute: (plan) => inner.execute(plan),
  transaction: (fn) => inner.transaction(fn),
};
```

A context type that extends `TransactionContext` and builds its object with `withTransactionMembers` now has `transaction` in its type and at run time, and the callback receives the runtime's `TransactionContext`, without the extension's members. To pass the extension's context instead, declare `transaction` on the type and add the member as in the example under `postgres-transaction-context-has-transaction`.

### `transaction-settlement-state-has-closed-and-abandon`

Give an object you build by hand and type as `TransactionSettlementState` a `closed` getter and an `abandon()` method. Where the object wraps a transaction, forward both to it.

### `postgres-transaction-context-has-transaction`

Where an extension builds the context of its own transactions with `withTransactionMembers(txCtx, members)` and gives it the type `PostgresTransactionContext`, or a type that aliases it, do one of the following.

To offer nested transactions, add a `transaction` member that calls the runtime context's `transaction` and builds the extension's context for the nested one. Build the context in a function that calls itself for the nested context, so each nested context has the member too:

```ts
function buildTransactionContext(txCtx: TransactionContext): PostgresTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...members(txCtx),
    transaction: <R>(
      fn: (tx: PostgresTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  });
}

return withTransaction(runtime, (txCtx) => fn(buildTransactionContext(txCtx)), options);
```

To keep the extension's context out of nested transactions, type it with the runtime's member, which the object already has through `withTransactionMembers`; the nested callback then receives the runtime's `TransactionContext`:

```ts
export type MyTransactionContext<
  TContract extends Contract<SqlStorage>,
  TCollections extends CollectionClasses = NoCollectionClasses,
> = Omit<PostgresTransactionContext<TContract, TCollections>, 'transaction'> &
  Pick<TransactionContext, 'transaction'>;
```

### `supabase-transaction-context-has-transaction`

`SupabaseTransactionContext` is `PostgresTransactionContext`. Where an extension builds a context with `withTransactionMembers(txCtx, members)` and types it as `SupabaseTransactionContext`, add a `transaction` member built as in the example under `postgres-transaction-context-has-transaction`, with `SupabaseTransactionContext` in place of `PostgresTransactionContext`.

### `facade-transaction-contexts-have-transaction`

Where an extension builds the context of its own transactions with `withTransactionMembers(txCtx, members)` and gives it the type `MysqlTransactionContext` or `SqliteTransactionContext`, add a `transaction` member that calls the runtime context's `transaction` and builds the extension's context for the nested one, as in the example under `postgres-transaction-context-has-transaction`:

```ts
function buildTransactionContext(txCtx: TransactionContext): MysqlTransactionContext<TContract, TCollections> {
  return withTransactionMembers(txCtx, {
    ...members(txCtx),
    transaction: <R>(
      fn: (tx: MysqlTransactionContext<TContract, TCollections>) => PromiseLike<R>,
    ) => txCtx.transaction((nested) => fn(buildTransactionContext(nested))),
  });
}

return withTransaction(runtime, (txCtx) => fn(buildTransactionContext(txCtx)), options);
```

Code that only receives `tx` from `db.transaction(...)` needs no change: the callback of `tx.transaction(...)` now receives the same type as `tx`, which has every member the runtime's `TransactionContext` has.


## The relation mutator types take `Writes` and `DeleteDisabled`

### `relation-mutator-writes-parameter`

`RelationMutator<TContract, ModelName, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions, DeleteDisabled>` and `VariantRelationMutator<TContract, ModelName, VariantValue, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions, DeleteDisabled>` are the types of the mutator a relation callback receives. `RelationMutator` used to take a boolean, `FilteredWritesDisabled`, in the place of `Writes`, and had no `NsId`, `ConflictActions` or `DeleteDisabled`; `VariantRelationMutator` is new in this release. Nested `update(data)` and `delete()` of one related row are new, and `Writes` says which row writes the mutator offers:

| `Writes` | Relation | `where()` returns | `updateAll`, `deleteAll` | `update`, `delete` |
| --- | --- | --- | --- | --- |
| `'many'` (default) | to-many, including many-to-many | a mutator with `update`, `delete`, `updateAll`, `deleteAll` | available | only after `where()` |
| `'one'` | to-one, including a relation the record holds the key for | a mutator with `update`, `delete` | not available | available |
| `'none'` | in `create()` | not available | not available | not available |

An unavailable member takes a `never` parameter, so a call is a type error.

`DeleteDisabled` is `false` by default. It applies with `Writes = 'one'`: when it is `true`, `delete`, bare and after `where()`, takes a `never` parameter. With `Writes = 'many'` it has no effect. The ORM sets it on a relation whose foreign key, held by the record, is required.

In every file the detection matches, find each use of `RelationMutator<...>` or `VariantRelationMutator<...>`. A file may import them under another name, as in `import type { RelationMutator as RM } from '@prisma/orm-family-sql/orm-client'`; follow the local name. Where a use of `RelationMutator` passes its sixth argument:

- `false` becomes `'many'`.
- `true` becomes `'none'` in `create()` data. In `update()` data it becomes `'one'` for a to-one relation, which offers `update` and `delete`; when the record holds the relation's foreign key and that key is required, also pass `DeleteDisabled = true`, because the ORM refuses `delete` there.

A use that leaves the `Writes` argument out gets `'many'` and needs no change. Code that lists the members of a mutator, for example with `keyof`, also sees `update` and `delete`.

### `foreign-key-with-relation-callback-refused`

`update()` data that sets the foreign key the record holds for a relation and also has a callback on that relation is now refused, whatever the callback returns (`create`, `connect`, `disconnect`, `update` or `delete`). The ORM refuses it while it plans the write, before any statement runs, with:

```text
ORM.ARGUMENT_INVALID: update() data sets "authorId", the foreign key of relation "author", and also has a callback on "author"; set the foreign key or use the callback
```

`meta.relation` names the relation and `meta.fields` the foreign-key fields the data sets. A foreign-key field whose value is `undefined` does not count. It is not a type error.

Such data used to run, and a `create`, `connect` or `disconnect` callback silently overwrote the foreign key the data set.

For each such call, keep one of the two. To point the record at another row, set the foreign key, or use `connect` on the relation:

```ts
// before
await db.orm.public.Post.where({ id: 10 }).update({
  authorId: 2,
  author: (author) => author.connect({ id: 2 }),
});

// after
await db.orm.public.Post.where({ id: 10 }).update({
  author: (author) => author.connect({ id: 2 }),
});
```

To change or delete the row the record points at and also point the record at another row, make two calls: first the callback, then the foreign key. Run them in one transaction, because the single call was atomic.

```ts
// before
await db.orm.public.Post.where({ id: 10 }).update({
  authorId: 2,
  author: (author) => author.update({ name: 'Ada' }),
});

// after
await db.transaction(async (tx) => {
  await tx.orm.public.Post.where({ id: 10 }).update({
    author: (author) => author.update({ name: 'Ada' }),
  });
  await tx.orm.public.Post.where({ id: 10 }).update({ authorId: 2 });
});
```


## MongoDB prepared ORM reads

### `mongo-collection-has-prepared`

Give a hand-written `MongoCollection` a `prepared` member, and widen `limit` and `offset`. A test double that never prepares can throw:

```ts
const users: MongoCollection<Contract, 'User'> = {
  // ...
  limit: (n) => users,
  offset: (n) => users,
  prepared: {
    all: () => { throw new Error('not used in this test'); },
    first: () => { throw new Error('not used in this test'); },
    firstOrThrow: () => { throw new Error('not used in this test'); },
  },
};
```

### `mongo-prepare-member-moved`

Import `MongoPrepareMember` from `@prisma/orm-mongo/runtime` and give it the contract: `MongoPrepareMember<Contract>` is an object type that has the `prepare` method of a `mongo()` client. Where you meant an object with the runtime's `prepare`, write `Pick<MongoRuntime, 'prepare'>`, or type the value as `MongoRuntime`:

```ts
import type { MongoRuntime } from '@prisma/orm-mongo/family-runtime';
import type { MongoPrepareMember } from '@prisma/orm-mongo/runtime';

const clientPrepare: MongoPrepareMember<Contract> = db;
const runtimePrepare: Pick<MongoRuntime, 'prepare'> = await db.runtime();
```

### `mongo-where-filter-takes-placeholders`

Where you read a value out of a `MongoWhereFilter`, check for a placeholder before using it as the field's type:

```ts
import { isMongoPreparedParamRef } from '@prisma/orm-mongo/value';

const name = filter.name;
const label = name === undefined || isMongoPreparedParamRef(name) ? undefined : name.toUpperCase();
```

A placeholder's value is known only when a prepared statement runs.

### `compile-mongo-query-has-no-row-type`

Drop the type argument from `compileMongoQuery(...)`. Where you need a row type, type the rows where you read them.


## Migration runners record the database's policies, and families name the operations that change access

A database now records its policies in its marker: whether `db update` may move it, and its data protection settings. `db migrate` refuses a recorded migration that changes who can read or write data on a database whose data protection policy forbids it. A target's migration runner and control adapter write and check the policies, and a family names the operations that change access.

### `runner-records-database-policies`

In the runner's marker update, pass the policies on in the destination, and do not skip the marker write when nothing ran but policies are to be recorded:

```ts
const destination = {
  storageHash,
  profileHash,
  invariants: plan.providedInvariants,
  ...(options.databasePolicies === undefined ? {} : { databasePolicies: options.databasePolicies }),
};

const nothingToRecord =
  isSelfEdge && operationsExecuted === 0 && invariantsAlreadyHeld && options.databasePolicies === undefined;
```

In the control adapter, write `meta.policies` when `destination.databasePolicies` is set, and never reset `meta` otherwise: an upsert that used to set `meta` to `{}` on conflict leaves `meta` alone unless it records policies.

Before the runner applies its first space, check that the policies the caller checked still hold: a SQL target calls `checkDatabasePoliciesHeld(family, driver, expectedDatabasePolicies)`; a MongoDB runner calls `compareMarkerDatabasePolicies` and, after a failed marker write, `markerSwapFailure`.

The other required changes, for every target:

- `MigrationRunner.execute` takes an optional `expectedDatabasePolicies` beside `perSpaceOptions`. Once the runner holds its marker lock, and before it applies the first space, it reads the application space's marker and calls `compareMarkerDatabasePolicies(marker, expectedDatabasePolicies)`. On `moved` it returns `databasePoliciesMovedFailure(expectedDatabasePolicies, comparison.found)` (`MIGRATION.MARKER_CAS_FAILURE` with `meta.reason: 'databasePolicies'`) without running any operation. On `unreadable` it throws `errorMarkerPoliciesCorrupt` from `@prisma/orm-framework/errors/execution`.
- The `MIGRATION.MARKER_CAS_FAILURE` a runner returns when the marker's storage hash moved under it carries `meta.reason: 'storageHash'`.
- `ControlFamilyInstance.signSpaces` takes the same `expectedDatabasePolicies` beside `spaces` and compares them before it writes any marker, whether or not the application space is among `spaces`. When they no longer hold, it returns only a conflict for the application space with `reason: 'databasePolicies'`, `checked` and the `comparison`, and no `contract`. Every other conflict carries `reason: 'storageHash'`.
- A ledger entry is written only when the run applied a migration edge, as before.

For a SQL target:

- The `destination` that `initMarker` and `updateMarker` of `SqlControlAdapter` take is the framework's `MarkerDestination`, which carries the optional `databasePolicies`. Store it with `storedDatabasePolicies` under `DATABASE_POLICIES_META_KEY`.
- `insertMarker` takes `MarkerInsert`, a `MarkerDestination` without `databasePolicies`.

For a MongoDB target:

- `MongoControlAdapter.updateMarker` takes an optional fifth argument, and `MarkerOperations.updateMarker` an optional fourth, `checkedPolicies` (`DatabasePolicies`): the policies the run checked. The update then matches only a marker whose `meta.policies` reads as them.
- `MarkerOperations` has a required `markerLocation`, the collection that holds the markers, which the runner names in errors.
- When the marker update fails, `markerSwapFailure(found, expectedStorageHash, checkedPolicies)` from `@prisma/orm-family-mongo/family/control` reports a moved storage hash, moved policies, unreadable policies, or a marker changed and changed back. Map them to the storage-hash failure, `databasePoliciesMovedFailure`, `errorMarkerPoliciesCorrupt`, and a `MIGRATION.MARKER_CAS_FAILURE` with `meta.reason: 'markerChanged'`. Do not retry the update.

### `control-family-access-changes-of`

A family that implements `ControlFamilyInstance` itself adds `accessChangesOf` beside `storageNameOf`:

```ts
return {
  familyId: 'my-family',
  storageNameOf(operation) {
    return myStorageNameOf(operation);
  },
  accessChangesOf() {
    return [];
  },
  …
};
```

A SQL target adds `accessChangesOf` to its control target descriptor beside `classifyEntityKind`:

```ts
const descriptor: SqlControlTargetDescriptor<'my-target', MyPlanTargetDetails> = {
  …
  classifyEntityKind: relationalNodeEntityKind,
  accessChangesOf: () => [],
  …
};
```

A target with operations that change who can read or write rows, such as disabling row-level security or dropping a row-level-security policy, returns one entry for each, with `widens: true` when the operation only lets more people read or write and `false` when it can go either way. A test double of either one sets `accessChangesOf: () => []`.

### `aggregate-planner-access-changes-of`

Pass `accessChangesOf` to each `planMigration({ ... })` and `resolveRecordedPath({ ... })` call, beside `storageNameOf`:

```ts
// Before
planMigration({ ...inputs, storageNameOf: (operation) => family.storageNameOf(operation) });

// After
planMigration({
  ...inputs,
  storageNameOf: (operation) => family.storageNameOf(operation),
  accessChangesOf: (operations) => family.accessChangesOf(operations),
});
```

In a test, `accessChangesOf: () => []` lists none.


## A changed stored name is a rename in the SQL family's planning

The SQL family now treats a model, field or enum member that keeps its contract name as the same object when its stored name or stored value changes. These changes to `@prisma/orm-family-sql/family/control` follow from it. The family also exports `StorageRenames`, `exactName`, `SameName` and `ModelTable` (which moved, and is still exported under the same name).

### `schema-tables-same-name`

Before:

```ts
const tables: SchemaTables = {
  hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
  hasTable: (namespaceId, table) => schema.hasTable(namespaceId, table),
  // ...
};
```

After:

```ts
import { exactName } from '@prisma/orm-family-sql/family/control';

const tables: SchemaTables = {
  sameName: exactName,
  hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
  hasTable: (namespaceId, table) => schema.hasTable(namespaceId, table),
  // ...
};
```

A database that compares names without case passes its own comparison, the same one its `tablesNamed` and `columnsNamed` use.

### `plan-statements-plans-stored-name-renames`

A target that calls `planStatements` keeps putting its `calls` first in the plan. The calls may now include renames no statement asked for. Put the renames of the constraints of each table in `alreadyRenamedTables` before the plan's creates, but after a drop that frees the name a rename gives. Pass `storageRenames` on to `subjectsOfCalls`, as below. An object literal typed as `StatementPlanningTarget` that also holds `renderTableRename` and `tableRenameByHand` keeps them only where a `TableRenameByHand` is expected.

### `subjects-of-calls-storage-renames`

Before:

```ts
subjectsOfCalls(subjects, { fromContract, contract, origins, byHand, removedVariants });
```

After, for a target that plans statements:

```ts
subjectsOfCalls(subjects, {
  fromContract,
  contract,
  origins,
  storageRenames: statements.value.storageRenames,
  byHand,
  removedVariants,
});
```

After, for a target that plans no renames:

```ts
import { exactName, StorageRenames } from '@prisma/orm-family-sql/family/control';

subjectsOfCalls(subjects, {
  fromContract,
  contract,
  origins: NO_RENAMED_ORIGINS,
  storageRenames:
    fromContract === null ? undefined : new StorageRenames([], fromContract, contract, exactName),
  byHand,
  removedVariants,
});
```

The advice on keeping the rows of a dropped table now comes from `storageRenames`; with `undefined`, a dropped table gets none.

### `stored-value-keep-data-edit-removed`

Remove reads of `keepDataEdit`, `keepData` and `swapsValues`. `keepRowsEdit` is unchanged and still gives the edit that keeps the rows a removal would lose.


## The CLI engine is 0.10.4, and its consent error has one fixed first line

### `engine-pin-moves-to-0-10-4`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.10.3`, `0.10.2`, `0.10.1`, `0.10.0` or any earlier 0.x) to `0.10.4` and reinstall.

### `consent-required-summary-is-one-fixed-sentence`

Two errors have the code `CLI.CONSENT_REQUIRED`. Both are raised when the run cannot ask (it is not interactive, or `--yes` is set). The first line (the `summary`) of each changed, and both now have the same one:

- `This command requires explicit consent, but it was not provided.`
- Under `--yes`: `This command requires explicit consent for which --yes is not sufficient.` Engines 0.10.2 and 0.10.3 said `This command requires explicit consent, and --yes does not give it.`

**A statement question nobody answered.** `prisma migration plan` or `prisma db update` would lose data or change access, and no `--rename`, `--delete` or similar flag answers the question.

- Before: `"User.nick" needs a statement, and the session is not interactive.`, or `2 subjects need a statement, and the session is not interactive: "Bug", "Task".` for several questions. Under `--yes`, the line said `which --yes cannot give` in place of `and the session is not interactive`.
- `why` (the questions), the next actions, `meta`, the code and the exit code (2) are unchanged. Read the unanswered subjects from `meta.unanswered` (each with its `subject` and `verbs`).

**A consent that `--confirm` answers.** For example `prisma init` over a project it would replace.

- Before: `"<question>" requires explicit consent, and the session is not interactive.`, or `…, which --yes cannot grant.` under `--yes`. When the consent has a token, the line ended `Grant it by passing --confirm <token>.`
- The question is now in `why`, which this error did not have before. The next action, `meta.consentToken`, the code and the exit code (2) are unchanged. Read the token from `meta.consentToken`.

For every file matched by `detection`, stop matching the first line of this error. A match on `session is not interactive` needs a change only where it is for this error; other errors still use those words. Branch on the error's `code` (`CLI.CONSENT_REQUIRED`). The code alone does not tell the two errors apart: the first has `meta.unanswered`, and the second does not.
