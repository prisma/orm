---
from: "8.0.0-rc.24"
to: "8.0.0-rc.25"
changes:
  - id: postgres-lc-monetary-not-set
    summary: |
      The PostgreSQL driver no longer sets `lc_monetary=C` on its connections, so a pooled Prisma Postgres URL connects. An application with `money` columns (`Money` in PSL, `@db.Money` in a Prisma 7 schema) now needs the database to print `money` in the `C` form itself. Run `SHOW lc_monetary` as the application's role. `C`, `POSIX` and `en_US`, with or without an encoding suffix such as `C.UTF-8`, and Prisma Postgres need no action. Under any other locale a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`: run `ALTER ROLE <role> SET lc_monetary = 'C'` before deploying the upgrade. `ALTER DATABASE <database> SET lc_monetary = 'C'` also works, but changes `money` for every other client of the database. Raw SQL that selects `money` as text now prints in the database's own locale.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,sql,json}"
      matches:
        - '(?<![\w$])Money(?![\w$])'
        - 'pg/money@1'
        - '::\s*(?:money|MONEY)(?![\w$])'
  - id: pg-is-a-peer-dependency
    summary: |
      `pg` (`^8.22.0`) and `@types/pg` (`^8.20.0`) are now required peer dependencies of `@prisma/orm-postgres`, `@prisma/orm-target-postgres` and `@prisma/orm-extension-supabase`, not dependencies. The application declares the driver itself, so the `pg.Pool` it passes in and the `pg` types Prisma 8 declares come from one copy. A project that depends on one of these packages must declare `pg` in a range inside `^8.22.0`, and `@types/pg` in a range inside `^8.20.0`. Some package managers install a missing required peer automatically, but not all do, and not in every configuration (Yarn, `legacy-peer-deps`, pnpm with `autoInstallPeers: false`), so declare both in every case.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-(?:postgres|target-postgres|extension-supabase)"\s*:'
  - id: temporal-polyfill-peer-range-moves-to-1-0-8
    summary: |
      The required peer range of `temporal-polyfill` moves from `^1.0.4` to `^1.0.8` on every database package: `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-mongo` and their `@prisma/orm-target-*` packages. A project that declares `temporal-polyfill` itself, as earlier guides told Yarn projects and npm projects with `legacy-peer-deps` to do, changes its range to `^1.0.8` and reinstalls, so the lockfile does not keep a version below 1.0.8.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"temporal-polyfill"\s*:\s*"[\^~]?1\.0\.[0-7](?![\d])'
        - '[''"]?temporal-polyfill[''"]?:\s*[''"]?[\^~]?1\.0\.[0-7](?![\d])'
  - id: config-type-renamed-to-prisma-config
    summary: |
      The config type that `defineConfig` returns is renamed from `PrismaNextConfig` to `PrismaConfig`, in `@prisma/orm-toolchain/cli/config-types` and every package that re-exports it. The old name is gone. The detection matches TypeScript sources that name the old type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PrismaNextConfig(?![\w$])'
  - id: hand-assembled-config-names-generated-file-modules
    summary: |
      A config built with the framework's own `defineConfig`, and not a target package's, must name the module generated contract types import from (`contract.typesModule`) and the module migration files import from (`migrations.module`). Without `contract.typesModule`, every command that writes contract types fails with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`: `prisma contract emit`, `prisma migration plan` and `prisma migration new` always, `prisma db init`, `prisma db update` and `prisma db sign` when they advance a ref, and `prisma db migrate` when it advances a ref to a contract that has no snapshot under `migrations/snapshots/`. `prisma migration plan` and `prisma migration new` write that snapshot for every migration they create, so `prisma db migrate` rarely needs the module. Without `migrations.module`, `prisma migration plan` and `prisma migration new` fail with `CONFIG.MIGRATION_MODULE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: control-api-takes-types-module
    summary: |
      The control client's `emit` requires `contractConfig.typesModule`, and `renderContractDts` requires `typesModule`: the module the generated contract types import from. The `projectDir` option of the control API's contract emit, `migration new` and `migration plan` operations is removed.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'contractConfig\s*:'
        - '(?<![\w$])renderContractDts\s*\('
        - '@prisma/orm-toolchain/cli/control-api'
  - id: toolchain-publish-surface-entrypoints-removed
    summary: |
      `@prisma/orm-toolchain/publish-surface`, `@prisma/orm-toolchain/publish-surface/import-roots` and `@prisma/orm-toolchain/publish-surface/shells` are removed. Nothing replaces them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-toolchain/publish-surface'
  - id: typescript-contract-for-another-target-refused
    summary: |
      `prisma contract emit` now refuses a SQL config's TypeScript contract that imports `defineContract` from another target's package, such as a contract that imports `defineContract` from `@prisma/orm-sqlite/contract-builder` in a project whose config comes from `@prisma/orm-postgres/config`. Such a contract used to emit and then fail when the client loaded it. The CLI reports it as `CONTRACT.TARGET_MISMATCH`, with `expected`, `actual` and `contract` in its `meta`, and its fix names the module to import `defineContract` from. A PostgreSQL config whose `contract` is a ready contract config, such as `typescriptContract(contract)`, is refused the same way when its contract was built for another target. The detection matches TypeScript files that import `defineContract` from a SQL target package.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '@prisma/orm-(?:postgres|sqlite|mysql|mariadb)/contract-builder'
  - id: typescript-contract-from-path-requires-target
    summary: |
      `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types` now takes three arguments: the contract path, the output path (or `undefined`), and an options object that must hold the configured target's pack ref as `target` and that target's `contract-builder` module as `contractBuilderModule`. Calls with one or two arguments, or with only `defaultControlPolicy` and `createNamespace`, no longer compile, and in JavaScript they throw. The detection matches TypeScript and JavaScript files that import it from the SQL family, under any name; the MongoDB family's function of the same name is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-family-sql|internal/sql-contract-ts)/(?:contract-ts/)?config-types)[\s\S]*\btypescriptContractFromPath\b'
  - id: migrate-options-ref
    summary: |
      The control client's `migrate` options (`MigrateOptions`, from `@prisma/orm-toolchain/cli/control-api`) no longer take `refHash`, `refInvariants` and `refName`. Pass the target as `target` (`MigrateTarget`). For a ref, pass it whole with its name: `target: { kind: 'ref', ref: { name, ...entry } }` (`NamedRef`, from `@prisma/orm-toolchain/migration-tools/refs`); the application space walks to its hash by a path that provides its invariants, and its declared policies are checked. For a contract hash, pass `target: { kind: 'hash', hash }`. `dbUpdate` takes the same `ref` for the ref `--to` named: its hash must be the storage hash of the `contract` you pass, or the call returns a failure result with code `CLI.INVALID_ARGUMENTS` before it reads the database. `migrate` and `dbUpdate` return the same code for `permitPolicyChange: true` without a ref. `dbSign` takes a required `invocation`, like `migrate`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$])refHash\s*[:,}]'
        - '(?<![\w$])refInvariants\s*[:,}]'
  - id: db-sign-invocation
    summary: |
      `DbSignOptions` has a required `invocation`, `{ cwd, configPath, dbGiven }`, so the advice of a refusal repeats the `--config` and `--db` the command was given. Pass the same `invocation` you pass to `migrate`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.dbSign\s*\('
  - id: permit-policy-change
    summary: |
      A ref can declare the policies its database should have, in a `policies` field of its ref file, and the database's marker records the policies in force. `migrate` and `dbUpdate` refuse a ref whose declared policies differ from the database's with `MIGRATION.POLICY_MISMATCH`, unless the new option `permitPolicyChange: true` consents to writing them. Pass `permitPolicyChange` only when the person running the deploy has said the ref's policies should be applied. A database whose change policy does not permit the operation refuses with `MIGRATION.CHANGE_POLICY_FORBIDS`; `db sign` refuses the same way.
  - id: psl-schema-must-be-utf8
    summary: |
      A Prisma schema file that is not valid UTF-8 is now refused with `PSL_SCHEMA_READ_FAILED`, naming the file. Before, each invalid byte was silently replaced with U+FFFD and the file loaded. Reopen each such file in the encoding it was written in, such as Windows-1252, and save it as UTF-8; opening it as UTF-8 and saving keeps the wrong character. If the text is already damaged, restore it from a good copy.
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
  - id: ts-renamed-postgres-json-column-helper
    summary: |
      The PostgreSQL column helper `jsonColumn` is renamed `plainJsonColumn`, after the explicit type it gives (`PlainJson`, a `json` column). The old name is removed. The contract does not change. SQLite's `jsonColumn` has a rename of its own.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])jsonColumn(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@prisma/orm-target-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*jsonColumn(?![\w$])'
  - id: ts-renamed-sqlite-column-helpers
    summary: |
      The SQLite column helpers are renamed after the explicit type each gives: `integerColumn` is `integerNumberColumn` (`IntegerNumber`), `bigintColumn` is `integerBigIntColumn` (`IntegerBigInt`) and `jsonColumn` is `plainJsonColumn` (`PlainJson`). The old names are removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"]'
        - 'import[ \t]+(?:type[ \t]+)?\*[ \t]*as[ \t]+([\w$]+)[ \t]+from[ \t]*[''"](?:@prisma/orm-sqlite/adapter/column-types|@prisma/orm-target-sqlite/adapter/column-types|@internal/adapter-sqlite/column-types)[''"][\s\S]*(?<![\w$])\1\s*\.\s*(?:integerColumn|bigintColumn|jsonColumn)(?![\w$])'
  - id: sqlite-bigintnumber-deprecated
    summary: |
      On SQLite, `BigIntNumber` is a deprecated alias of `IntegerNumber` that warns with `PSL_DEPRECATED_SCALAR_NAME`, and a field written with it now emits codec `sqlite/integer@1` instead of `sqlite/bigintnumber@1`. Write `BigInt(as: number)` (or `type.BigInt({ as: 'number' })`), or `IntegerNumber`, which the warning names; both give the same contract. Re-emit the contract and sign the database. No column changes and no data moves.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\w.])BigIntNumber(?![\w])'
        - '\.\s*BigIntNumber\s*\('
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
  - id: psl-optional-mongo-convenience-names
    summary: |
      Optional: in a MongoDB schema, the explicit types `Int32`, `Double` and `Bool` may be written as the convenience types `Int`, `Float` and `Boolean`. The contract does not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bObjectId\b)[\s\S]*(?<![\w.])(?:Int32|Double|Bool)(?![\w])'
  - id: has-one-key-must-be-unique
    summary: |
      Building a SQL contract fails with `CONTRACT.RELATION_INVALID` when a one-to-one relation, `rel.hasOne(Target, { by: ... })` in TypeScript, names `by` fields of the target model that no primary key, unique constraint or unique index without a `where` covers exactly. Make those fields unique, or make the relation `rel.hasMany`. PSL schemas are not affected: PSL already refused a singular back-relation over a non-unique foreign key. The detection matches TypeScript sources that declare a `hasOne` relation.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])rel\s*\.\s*hasOne\s*\('
  - id: sti-variant-unscoped-index-refused
    summary: |
      `prisma contract emit` now refuses every `@unique` and `@@unique`, and most `@@index` without `where:`, on a single-table variant, and stores a variant `@@index` with `where:` that it used to drop. Rewrite each refused attribute as the partial index the message gives, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@base\s*\()[\s\S]*(@unique|@@index\s*\()'
  - id: sti-variant-foreign-keys-stored
    summary: |
      A relation on a single-table variant now stores its foreign key on the base table, with a backing index unless the relation says `index: false`; both used to be dropped. Re-emit the contract, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@base\s*\()[\s\S]*@relation\s*\([^)]*fields\s*:'
  - id: contract-types-import-from-the-target-package
    summary: |
      A generated `contract.d.ts` imports all its framework, family and target types from one module of the target package, such as `@prisma/orm-postgres/contract-types`, and `contract.json` no longer records where an extension's types are imported from. Run `prisma contract emit` to regenerate both files.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '@prisma/orm-[a-z-]+/(contract/types|family-contract|target/(codec|operation)-types|adapter/codec-types)'
  - id: re-emit-for-include-capabilities
    summary: |
      SQL adapters report two new capabilities in the `sql` group, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`, which together with `sql.jsonAgg` decide whether the ORM loads includes with the one-query include or with one query per relation. The PostgreSQL and MySQL adapters now also report `sql.jsonAgg`. Run `prisma contract emit` to record them in `contract.json` and `contract.d.ts`. A contract that is not re-emitted keeps working, because the runtime merges the adapter's capabilities over the contract's, and the profile hash does not change, so no database needs signing again. The contract snapshots under `migrations/snapshots/` need no change.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"targetFamily"\s*:\s*"sql")(?![\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAggWithoutTruncation")'
        - '(?<![\s\S])(?=[\s\S]*"target"\s*:\s*"mariadb")(?![\s\S]*"jsonAgg")'
  - id: re-emit-mysql-contract-for-aggregates
    summary: |
      The MySQL target now contributes the ORM's aggregates, so `include('posts', (p) => p.count())`, `combine()` and `aggregate()` run on MySQL and MariaDB. Run `prisma contract emit` so `contract.d.ts` carries the aggregate types; until then TypeScript does not offer `count()`, `sum()`, `avg()`, `min()` and `max()`. The contract hashes do not change; `contract.json` changes only by the capabilities `re-emit-for-include-capabilities` describes.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '(?<![\s\S])(?=[\s\S]*readonly target: .(?:mysql|mariadb).)[\s\S]*AggregateTypes = Record<string, never>'
  - id: mysql-reemit-contract
    summary: |
      On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, and the target has new codecs for them. The emitted `contract.d.ts` gains aggregate result types for the new codecs. Re-emit the contract; its hashes do not change, so the database needs no migration and no new signature. `contract.json` changes only by the capabilities `re-emit-for-include-capabilities` describes.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '[''"]@prisma/orm-(?:mysql|mariadb)/config[''"]'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.25. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.24"'
  - id: sql-stored-name-change-is-a-rename
    summary: |
      On PostgreSQL and SQLite, a model, field or enum member that keeps its name while its `@@map`, `@map` or stored value changes is now renamed, or has its stored value replaced, by `migration plan` and `db update`, with no question. The by-hand rename these changes needed before is no longer needed.
  - id: sql-stored-name-delete-is-unused
    summary: |
      A `--delete` statement that a script passed to allow the drop and create of a table or column whose stored name changed now answers no question, and the run fails with `CLI.CONSENT_UNUSED`.
  - id: sql-stored-name-empty-table
    summary: |
      To get an empty table or column under a new stored name instead of renaming the old one, remove the model or field in one change and add it back in a second.
  - id: sql-stored-name-swaps-refused
    summary: |
      Swaps, chains and takeovers of table and column names, which planned with no question before and left rows under the wrong model, are now refused with `MIGRATION.PLANNING_FAILED`. So are enum members that swap stored values or take the stored value of a removed member, which were asked about before. Chains of enum stored values are planned.
  - id: sql-lowered-table-names-renamed
    summary: |
      A project with an origin snapshot whose tables still have the names an earlier release gave models with no `@@map` (the first letter lowered) now gets those tables renamed to the model names, with no question. Add `@@map` to keep the old names.
  - id: mongo-nested-removals-are-asked
    summary: |
      A MongoDB plan now asks about a field a value object or an embedded model loses, a stored value an enum loses, and a variant the contract removes or whose discriminator value changes, where it planned only a validator change before. `--delete` removes the key or the value from the documents, or deletes the variant's documents.
  - id: mongo-nested-statements-are-planned
    summary: |
      `--rename` of a value object field, of an embedded model's field, of an enum value, and of a variant whose discriminator value changes, `--convert` of a variant, and `--backfill` of a field inside a value object or an embedded model now plan rewrites of the documents on MongoDB instead of failing with `MIGRATION.PLANNING_FAILED`.
  - id: mongo-nested-required-field-gets-temporary-value
    summary: |
      A required field new inside a MongoDB value object or embedded model is now filled with a temporary value in the objects that lack it, as at the top level, unless `--backfill` names it.
  - id: json-default-proto-key-kept
    summary: |
      A JSON column default that has a `__proto__` key now keeps that key in `contract.json` and in the storage hash; it used to be dropped. Re-emit the contract, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'json`[^`]*__proto__'
  - id: mongo-proto-names-refused
    summary: |
      A MongoDB contract now refuses a model, composite type or value object, collection or root named `__proto__`, and the TypeScript builder refuses an enum with that name too. In a PSL contract, an enum named `__proto__` is not refused: it is left out of the contract without an error, together with every field typed by it. Choose another name.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '__proto__'
  - id: sql-proto-names-refused
    summary: |
      A SQL contract now refuses a namespace, table, column, model, field or enum named `__proto__` with `CONTRACT.NAME_UNUSABLE_AS_KEY`, and a `__proto__` key in an object literal of a TypeScript contract. Before, the entry was dropped or the contract came out wrong. Choose another name.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '__proto__'
  - id: update-data-refuses-discriminator
    summary: |
      Update data on a polymorphic model no longer takes the discriminator field: setting it is a type error, and at run time it is refused with `ORM.FIELD_IMMUTABLE`. Before, it changed only the base table and left the variant's rows inconsistent. Remove the discriminator from update data.
  - id: init-target-takes-a-package-name
    summary: |
      `prisma orm init --target` takes the name of a target package, such as `--target @prisma/orm-sqlite`, beside the short names `postgres` and `mongodb`. The `--json` result gains `package`, the name of the target package, and its `target` is the package name when the package has no short name. A script that reads the result needs a change only if it accepts no `target` but `postgres` and `mongodb`.
    detection:
      glob: "**/*.{sh,bash,zsh,ts,mts,cts,js,mjs,cjs,json,yml,yaml}"
      matches:
        - 'orm init\b[^\n]*--json'
  - id: orm-write-inside-transaction-suspends-tx
    summary: |
      An ORM write of more than one statement on `tx.orm`, such as a create with a nested relation, runs in a savepoint. While it runs, other work sent on the same `tx` rejects with `RUNTIME.TRANSACTION_SUSPENDED`. When such a write fails with an error that ends the whole transaction, such as a deadlock on MySQL or MariaDB, it rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, whose `cause` is the database's error, and the transaction is closed. The detection matches TypeScript sources that call `transaction` and `Promise.all` or `Promise.allSettled`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\.transaction\s*\()[\s\S]*Promise\.all'
  - id: foreign-key-with-relation-callback-refused
    summary: |
      `update()` data that sets a field of the foreign key the record holds for a relation (many-to-one, such as `Post.authorId` for `Post.author`) and also has a callback on that relation is refused with `ORM.ARGUMENT_INVALID` (`meta.problem: 'foreign-key-with-relation-mutation'`, with `meta.relation` and `meta.fields`) before any statement runs. It used to run, and a `create`, `connect` or `disconnect` callback overwrote the foreign key the data set. Keep either the foreign key or the callback.
  - id: nullable-unique-key-is-no-row-identity
    summary: |
      A unique key with a nullable column no longer identifies a row: two rows may both hold NULL in it. A table whose only unique key has a nullable column now has no row identity, on every database, and the ORM refuses the calls that need one with `ORM.ROW_IDENTITY_MISSING`. Give such a table a primary key, or make the unique key's columns `NOT NULL`.
  - id: relation-mutation-error-codes-merged
    summary: |
      A nested relation mutation now refuses malformed input with `ORM.ARGUMENT_INVALID` instead of `ORM.RELATION_MUTATION_INVALID`, and an operation it does not support in that position with `ORM.OPERATION_UNSUPPORTED` instead of `ORM.RELATION_MUTATION_UNSUPPORTED`. The error's `meta` is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - 'ORM\.RELATION_MUTATION_(?:INVALID|UNSUPPORTED)(?![\w$])'
  - id: nested-create-on-polymorphic-target-needs-variant
    summary: |
      In a relation callback whose target is a polymorphic base model, `r.create(data)` no longer compiles. Create the rows with `r.variant(value).create(data)` and drop the discriminator field from the data.
  - id: variant-create-without-returning-names-create
    summary: |
      `create()` on a variant stored in its own table, on a contract without the `returning` capability, fails with `ORM.CAPABILITY_MISSING` whose message and `meta.action` name `create()` instead of `createAll()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'createAll\(\) requires contract capability \\?"returning'
        - 'action\s*[:=]+\s*[''"`]createAll\(\)[''"`]'
  - id: disconnect-on-required-relation-refused
    summary: |
      In `update()` data, `r.disconnect()` on a relation whose foreign key is required (not nullable) no longer compiles, and at run time it is refused with `ORM.OPERATION_UNSUPPORTED` (`meta.reason: 'required-foreign-key'`) before any statement runs, instead of failing with the database's NOT NULL error. A `disconnect` that would have changed no row, such as `disconnect(criteria)` that matches no related row, is refused too; it used to succeed. When `meta.model` is the model being updated, the record holds the key: link it to another row with `connect` or delete the record. Otherwise the related rows hold the key: connect them to another record or delete them. Many-to-many `disconnect` and `disconnect` on an optional relation are unchanged.
  - id: to-one-disconnect-criteria-applied
    summary: |
      In `update()` data, `r.disconnect(criteria)` on a relation the record holds the key for (many-to-one) now unlinks the record only when the row it is linked to matches one of the criteria; before, it ignored the criteria and always unlinked. Where the criteria do not match the linked row, the foreign key stays unchanged, and the other updates of the same `update()` still apply. Pass no criteria to unlink whatever row is linked. `r.variant(value).disconnect(criteria?)` on such a relation is now available and unlinks only a linked row of that variant. All of this applies to a relation whose foreign key is optional: on a required key, `disconnect` is refused with `ORM.OPERATION_UNSUPPORTED` (`reason: 'required-foreign-key'`) before its criteria or variant are looked at.
  - id: disconnect-empty-criteria-disconnects-nothing
    summary: |
      In `update()` data, `r.disconnect([])` with an explicit empty list of criteria now disconnects nothing. Before, it acted as `r.disconnect()`: on a relation the record holds the key for it unlinked the record, and on a one-to-many or one-to-one relation it unlinked every related row. Many-to-many `disconnect([])` is still refused.
  - id: create-all-skip-refuses-rows-without-conflict-key
    summary: |
      `createAll(rows, { onConflict: 'skip' })` and `createAndCount(rows, { onConflict: 'skip' })` now refuse, before any statement runs, a row that gives no value for any key the option watches, with `ORM.ARGUMENT_INVALID`. Such a row was inserted before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])onConflict\s*:\s*[\x27"]skip[\x27"]'
  - id: create-all-skip-refuses-tables-without-keys
    summary: |
      `createAll(rows, { onConflict: 'skip' })` and `createAndCount(rows, { onConflict: 'skip' })` without `conflictOn` now refuse a table with no primary key, unique constraint or unique index over columns, with `ORM.ARGUMENT_INVALID`. Every row was inserted before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])onConflict\s*:\s*[\x27"]skip[\x27"]'
  - id: sql-builder-enum-comparison-values-are-checked
    summary: |
      In the SQL builder, a raw value compared with a column in `fns.eq`, `fns.ne`, `fns.gt`, `fns.gte`, `fns.lt`, `fns.lte`, `fns.in` or `fns.notIn` must now have the type the contract gives that column, as it already must in `insert`, `update` and the ORM client's `where`. This affects every column whose contract type is narrower than its codec's type: enums stored as text or integers, native enums, and columns with a typed override. A value that is not a member, such as a misspelling, is now a type error. Before, the query ran and matched no rows, or, for a native enum, the database rejected the value. So is a value typed as a plain `string` or `number`, or a `string[]` passed to `fns.in`. Fix the value, or narrow it to the column's type before comparing. To match a value the column's type no longer lists, such as in a migration that renames an enum member, compare with `fns.raw` instead.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'fns\.(?:eq|ne|gt|gte|lt|lte|in|notIn)\('
  - id: mysql-errors-drop-meta-target
    summary: |
      Errors from the MySQL codecs, the SQL lexer, the codec registry and the driver's parameter checks no longer carry `meta.target: 'mysql'`, since the same code now serves MariaDB. Code that reads `error.meta.target` from them gets `undefined`; read the target from the client the error came from (`db.stack.target.targetId`) instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(?:mysql|mariadb))[\s\S]*\bmeta\??\.target\b'
  - id: db-migrate-advances-db-ref
    summary: |
      `prisma db migrate` now advances the `db` ref after a successful apply when the connection comes from `prisma.config.ts` and the CLI does not detect CI. Without `--advance-ref`, it still advances nothing with `--db` or in CI. A `db migrate --advance-ref db` that reads its connection from the config outside CI can drop the flag; one that passes `--db` or runs in CI keeps it. A deploy or script that runs `db migrate` from the config outside a CI runner, and must not change `migrations/app/refs/db.json`, passes the new `--no-advance-ref` or `--db`. A failed ref write is now a warning and the command exits 0, which matters to a script that checks the exit code of `db migrate --advance-ref`. The detection finds `db migrate` commands that pass `--advance-ref`, and those that pass neither `--db` nor `--no-advance-ref`, including a Dockerfile's exec form, a YAML list and a command split with a backslash between `db` and `migrate`; it reads the flags only on the line where `migrate` is; check each against the cases below, and look for others in files it does not search.
    detection:
      glob: "**/{*.json,*.sh,*.bash,*.zsh,*.yml,*.yaml,*.toml,*.md,*.mdx,*.ts,*.mts,*.js,*.mjs,*.cjs,Dockerfile*,*.dockerfile,Procfile*,Makefile,justfile}"
      matches:
        - '(?<![\w-])db(?:\s+|\s*\\\n\s*|["'']?\s*[,\n]\s*(?:-\s+)?["'']?)migrate\b(?:(?=[^\n]*--advance-ref\b)|(?![^\n]*--(?:db|no-advance-ref)\b))'
  - id: engine-pin-moves-to-0-10-4
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.10.4` (up from 0.10.0). A project that depends on `@prisma/cli-engine` itself must move to `0.10.4`.
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

# 8.0.0-rc.24 → 8.0.0-rc.25 — User upgrade instructions

The examples write the ORM client as `db.orm.public.<Model>`, which is the PostgreSQL form with its namespace. On SQLite, MySQL and MariaDB the same collection is `db.orm.<Model>`.

## Order of the steps

Do the steps in this order, and skip a step that does not apply to the project:

1. Before you deploy the upgrade, on PostgreSQL with `money` columns, make the database print `money` in the `C` form (`postgres-lc-monetary-not-set`). The old release still forces it on its own connections, so do this first.
2. Before you run the install for the upgrade, fix the dependencies in `package.json`: declare `pg` and `@types/pg` for the PostgreSQL packages (`pg-is-a-peer-dependency`), move a declared `temporal-polyfill` to `^1.0.8` (`temporal-polyfill-peer-range-moves-to-1-0-8`), and move a declared `@prisma/cli-engine` to `0.10.4` (`engine-pin-moves-to-0-10-4`). Then upgrade the Prisma packages.
3. Change the config and the scripts that call the control client: the renamed config type (`config-type-renamed-to-prisma-config`), the modules a hand-assembled config names (`hand-assembled-config-names-generated-file-modules`), `typesModule` and the removed `projectDir` (`control-api-takes-types-module`), the removed `publish-surface` entries (`toolchain-publish-surface-entrypoints-removed`), the arguments of `typescriptContractFromPath` (`typescript-contract-from-path-requires-target`), and the `migrate`, `dbUpdate` and `dbSign` options (`migrate-options-ref`, `db-sign-invocation`, `permit-policy-change`). Change the commands that run `prisma db migrate`, in scripts, deploys and docs, for the `db` ref it now advances (`db-migrate-advances-db-ref`).
4. Change the contract sources. Make each TypeScript contract import `defineContract` from its config's target (`typescript-contract-for-another-target-refused`). Save every schema file as UTF-8 (`psl-schema-must-be-utf8`). Rewrite the renamed types and helpers: `sql.String` (`psl-renamed-sql-string`, `ts-renamed-sql-string`), the PostgreSQL and SQLite column helpers (`ts-renamed-postgres-json-column-helper`, `ts-renamed-sqlite-column-helpers`), SQLite's `BigIntNumber` (`sqlite-bigintnumber-deprecated`) and MongoDB's `Int64` (`psl-renamed-mongo-int64`, `ts-removed-mongo-int64-helper`, and optionally `psl-optional-mongo-convenience-names`). Fix each `hasOne` relation without a unique key (`has-one-key-must-be-unique`) and each attribute of a single-table variant that emit refuses (`sti-variant-unscoped-index-refused`). Rename anything named `__proto__` (`sql-proto-names-refused`, `mongo-proto-names-refused`).
5. Run `prisma contract emit` once for every contract and commit what it writes. One emit covers `contract-types-import-from-the-target-package`, `re-emit-for-include-capabilities`, `re-emit-mysql-contract-for-aggregates`, `mysql-reemit-contract`, `sqlite-decimal-codec`, `ts-sqlite-decimal-codec`, `sti-variant-foreign-keys-stored`, `json-default-proto-key-kept` and `contract-artifacts-restamp`. Leave the contract copies under `migrations/` as they are.
6. Before you plan any migration, read what the planner now does: on PostgreSQL and SQLite a changed stored name is a rename (`sql-stored-name-change-is-a-rename`, `sql-stored-name-delete-is-unused`, `sql-stored-name-empty-table`, `sql-stored-name-swaps-refused`, `sql-lowered-table-names-renamed`), and on MongoDB changes inside documents are asked about and planned (`mongo-nested-removals-are-asked`, `mongo-nested-statements-are-planned`, `mongo-nested-required-field-gets-temporary-value`). A migration planned in the next step can hold such renames. If you add `@@map` to keep a table's old name, run `prisma contract emit` again first.
7. Bring each database up to date. Plan and apply a migration for a new unique key (`has-one-key-must-be-unique`), for a JSON default that has a `__proto__` key (`json-default-proto-key-kept`) and for the indexes and foreign keys of single-table variants (`sti-variant-unscoped-index-refused`, `sti-variant-foreign-keys-stored`). On SQLite, fix stored values the stricter codecs refuse (`sqlite-decimal-codec`, `sqlite-integer-safe-range`), then sign the database with the new contract as the SQLite section describes. One migration can cover all of these. In a project that applied its earlier migrations with `db migrate` and no `--advance-ref`, there is no `db` ref for `migration plan` to start from: pass `--from <latest migration>`, as the SQLite section shows.
8. Change the application code: work sent on a transaction while an ORM write runs on it (`orm-write-inside-transaction-suspends-tx`), update data that sets a discriminator (`update-data-refuses-discriminator`), `update()` data that sets a foreign key and also has a callback on its relation (`foreign-key-with-relation-callback-refused`), tables whose only unique key has a nullable column (`nullable-unique-key-is-no-row-identity`), the ORM error codes of nested relation mutations (`relation-mutation-error-codes-merged`), nested creates on a polymorphic model (`nested-create-on-polymorphic-target-needs-variant`, `variant-create-without-returning-names-create`), `disconnect` (`disconnect-on-required-relation-refused`, `to-one-disconnect-criteria-applied`, `disconnect-empty-criteria-disconnects-nothing`), `onConflict: 'skip'` (`create-all-skip-refuses-rows-without-conflict-key`, `create-all-skip-refuses-tables-without-keys`), SQL builder comparisons (`sql-builder-enum-comparison-values-are-checked`), code that reads `meta.target` from a MySQL error (`mysql-errors-drop-meta-target`), scripts that read the `--json` result of `prisma orm init` (`init-target-takes-a-package-name`) and code that matches the first line of `CLI.CONSENT_REQUIRED` (`consent-required-summary-is-one-fixed-sentence`). Three of these fixes change the contract: giving a table a primary key or required key fields (`nullable-unique-key-is-no-row-identity`), giving a table a key for `onConflict: 'skip'` (`create-all-skip-refuses-tables-without-keys`), and making a foreign key optional (`disconnect-on-required-relation-refused`). After any of them, emit the contract and plan and apply a migration again.


## PostgreSQL: `money` needs the database's `lc_monetary` to print the `C` form

### `postgres-lc-monetary-not-set`

Earlier releases started every PostgreSQL connection with `lc_monetary=C`, so `money` read and wrote the same value in any locale. A per-transaction connection pooler, such as the pooled address of Prisma Postgres, refuses a connection that asks for that setting, so the driver no longer sends it. The database must now provide it.

This matters only if the application reads or writes `money` columns.

1. Connect as the role the application uses, to the database and address it uses, and run `SHOW lc_monetary`. Use `psql` or another client, not Prisma: earlier releases set `lc_monetary` to `C` on their own connections, so a query through them prints `C` whatever the database has.
2. If it prints `C`, `POSIX` or `en_US`, with or without an encoding suffix (`C.UTF-8`, `en_US.UTF-8`), stop. Prisma Postgres also needs no action.
3. Otherwise, set it before you deploy the upgrade, while the old release still forces `C` on its own connections:

   ```sql
   ALTER ROLE app_role SET lc_monetary = 'C';
   -- or, for every role:
   ALTER DATABASE app_db SET lc_monetary = 'C';
   ```

   Prefer the role. The database setting also changes how every other client of that database prints and reads `money`.

   The setting applies to server connections opened afterwards. Behind a connection pooler, it takes effect once the pooler replaces its existing server connections.

   PostgreSQL uses the most specific setting: one made for the role in one database (`ALTER ROLE app_role IN DATABASE app_db SET …`) wins over the role's, and the role's wins over the database's. So repeat step 1 on a new connection, through the pooler if the application uses one, and deploy the upgrade only once it prints `C`.

If you upgrade first, a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`. Under a locale with two fraction digits, such as `de_DE` or `en_GB`, nothing is stored wrong, and setting `lc_monetary` afterwards is enough.

Under a locale with no or three fraction digits, such as `ja_JP`, `ko_KR` or `ar_KW`, upgrading first also stores wrong amounts. PostgreSQL scales a written value by the locale's fraction digits, so `1234.56` is stored as 1235 units under `ja_JP`. After you set `lc_monetary` to `C`, those rows read back 100 times too small (or 10 times too large under a three-digit locale), with no error. If the application wrote `money` values between the upgrade and the change, correct those rows before you change the setting.

Raw SQL of your own that selects a `money` value as text printed the `C` form, `$1,234.56`, on Prisma's connections. It now prints in the database's locale.

The CLI needs nothing: it sets `lc_monetary` itself while it reads the database and applies migrations.


## Dependencies: `pg` and `@types/pg` are peer dependencies, and `temporal-polyfill` moves to `^1.0.8`

### `pg-is-a-peer-dependency`

Make this change before you run the package manager's install for the upgrade. A project that pins `pg` below 8.22.0 conflicts with the new peer range, and some package managers refuse to install until the range is fixed. If the install already failed on that conflict, make the change and run the install again.

In each `package.json` that `detection` matches and lists the Postgres package under `dependencies` or `devDependencies`:

1. If `dependencies` has no `pg`, add `"pg": "^8.22.0"`. If it has one whose range allows any version outside `^8.22.0` (for example `8.20.0`, `^8.0.0`, `~8.21.0` or `>=8.20.0 <8.22.0`), change it to `^8.22.0`, so the install cannot keep an older version from the lockfile. If the range is a reference such as `catalog:` or `workspace:`, check the range it resolves to and change it there.
2. If neither `devDependencies` nor `dependencies` has `@types/pg`, add `"@types/pg": "^8.20.0"` to `devDependencies`. If it has one whose range allows any version outside `^8.20.0`, change it to `^8.20.0`.

A project that already declares both inside those ranges needs no change.

A workspace library that lists the Postgres package only under `peerDependencies` does not get `pg` in its `dependencies`. Give it `pg` and `@types/pg` in `peerDependencies` with the same ranges, and in `devDependencies` if its own tests need them, so that it and the application share one copy.

Without `pg`, the application fails at startup because Node.js cannot find the package `pg`. Without `@types/pg`, TypeScript cannot resolve the `pg` types that Prisma 8's declarations import. Prisma 8's Postgres driver passes the `sslnegotiation` connection setting, which `pg` accepts from 8.22.0.

### `temporal-polyfill-peer-range-moves-to-1-0-8`

In each `package.json`, or catalog in `pnpm-workspace.yaml`, that `detection` matches, change the `temporal-polyfill` range to `^1.0.8`, then reinstall. If the range is a reference such as `catalog:`, change the range it resolves to. A project that does not declare `temporal-polyfill` itself needs no change: its package manager installs the peer at a version inside the new range.


## `PrismaNextConfig` is now `PrismaConfig`

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


## Generated files import from the module the target package names

The target package an application's `prisma.config.ts` imports, such as `@prisma/orm-postgres`, now tells Prisma which modules generated files import from. The CLI no longer reads the application's `package.json` to work that out.

An application whose config calls a target package's `defineConfig` needs only the first change below.

### `contract-types-import-from-the-target-package`

Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.

The generated `contract.d.ts` now has one import statement for its framework, family and target types:

```ts
import type { CodecTypes as PgTypes, Contract as ContractType, ContractWithTypeMaps } from '@prisma/orm-postgres/contract-types';
```

where it had several, from `@prisma/orm-postgres/contract/types`, `@prisma/orm-postgres/family-contract/types` and `@prisma/orm-postgres/target/codec-types`. Each extension's types still come from the extension's own package.

In `contract.json`, each extension under `extensions` no longer records where its types are imported from: the `import` of its codec, operation and query operation types, its `typeImports` and its `parameterizedOutputTypes`. An extension's `types` entry disappears when nothing else is left in it. Nothing read these.

A file generated before the upgrade keeps working, because the modules it imports are still exported.

Leave the copies of the contract kept beside each migration, under `migrations/snapshots/`, as they are. They keep working, and no command rewrites a snapshot that already exists; only a snapshot written from now on has the new form. Do not edit them or any `migration.ts` by hand.

### `hand-assembled-config-names-generated-file-modules`

This applies only to a config that imports `defineConfig` from `@prisma/orm-framework/config/config-types` or `@prisma/orm-toolchain/cli/config-types` and passes the family, target, adapter and driver itself. A config that calls a target package's `defineConfig` already names both modules.

Add `typesModule` to the `contract` section and `module` to the `migrations` section of the object passed to that `defineConfig`, leaving the rest of the file as it is:

```ts
defineConfig({
  family,
  target,
  adapter,
  driver,
  contract: { ...contractSource, typesModule: '#contract-types' },
  migrations: { module: '@prisma/orm-target-postgres/target/migration' },
})
```

- `contract.typesModule` names a module that exports the framework's contract types, the family's contract types and the target's codec and operation types. Write one in the application that re-exports them:

  ```ts
  // src/contract-types.ts
  export type * from '@prisma/orm-framework/contract/types';
  export type * from '@prisma/orm-family-sql/contract/types';
  export type * from '@prisma/orm-target-postgres/target/codec-types';
  export type * from '@prisma/orm-target-postgres/target/operation-types';
  ```

  and give it a name private to the application, in `package.json`:

  ```json
  { "imports": { "#contract-types": "./src/contract-types.ts" } }
  ```

- `migrations.module` names the module that exports the migration base class and the target's operation helpers. For Postgres that is `@prisma/orm-target-postgres/target/migration`.
- Neither may be empty, a path or a URL. `'./contract-types'` is refused when the config is loaded, because generated files are written into more than one folder and a relative path is right for at most one of them.
- The application must depend directly on every package these modules import from. The target's and adapter's own types are imported from the target's package, such as `@prisma/orm-target-postgres`, so the application depends on that too.

### `control-api-takes-types-module`

A script that calls the control client passes the module the generated contract types import from:

```ts
await client.emit({ contractConfig: { source, output, typesModule } });
await client.renderContractDts({ contract, typesModule });
```

Take the value from the config: `defineConfig(...).contract.typesModule`. For an application on a target package it is that package's `contract-types` entrypoint, such as `'@prisma/orm-postgres/contract-types'`.

A script that calls the control API's contract emit, `migration new` or `migration plan` operations directly, from `@prisma/orm-toolchain/cli/control-api`, removes the `projectDir` option. The operations read the module names from the config they are given.

### `toolchain-publish-surface-entrypoints-removed`

Remove every import of `@prisma/orm-toolchain/publish-surface` and its two subpaths. They held the table and the functions that translated module names when files were generated. That translation no longer happens, so there is nothing to call in their place.


## A TypeScript contract must be built for the config's target

### `typescript-contract-for-another-target-refused`

For each file the detection matches that is a contract a `prisma.config.ts` names in `contract`, compare the package it imports `defineContract` from with the package the config imports `defineConfig` from. If they name different databases, change the contract's import to the `contract-builder` entry of the config's package, then run `prisma contract emit`. This also holds for a contract a PostgreSQL config passes as `typescriptContract(contract)`. If the two already match, nothing changes.

```ts
// prisma.config.ts imports defineConfig from '@prisma/orm-postgres/config'

// Before
import { defineContract } from '@prisma/orm-sqlite/contract-builder';

// After
import { defineContract } from '@prisma/orm-postgres/contract-builder';
```

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

An application whose call passes neither `defaultControlPolicy` nor `createNamespace` can instead pass the contract's path to its target's `defineConfig`, such as `defineConfig({ contract: './prisma/contract.ts' })` from `@prisma/orm-postgres/config`, which calls `typescriptContractFromPath` with `target` and `contractBuilderModule` itself. `defineConfig` passes no control policy, so a call that sets one must keep calling `typescriptContractFromPath`.


## `migrate` takes the target ref whole, and consents to a policy change

### `migrate-options-ref`

```ts
// Before
await client.migrate({
  contract,
  migrationsDir,
  invocation,
  refHash: entry.hash,
  refInvariants: entry.invariants,
  refName: 'production',
});

// After
await client.migrate({
  contract,
  migrationsDir,
  invocation,
  target: { kind: 'ref', ref: { name: 'production', ...entry } },
  // or, for a contract hash rather than a ref: target: { kind: 'hash', hash },
  // Only when the deploy should write the ref's declared policies into the database:
  permitPolicyChange: true,
});
```

`dbUpdate` takes the same `ref` for the ref `--to` named. Its hash must be the storage hash of the `contract` you pass, or the call returns a failure result with code `CLI.INVALID_ARGUMENTS` before it reads the database.

### `db-sign-invocation`

`dbSign` takes a required `invocation`, `{ cwd, configPath, dbGiven }`. Pass the same `invocation` you pass to `migrate`.

### `permit-policy-change`

A ref file may now carry `policies`:

```json
{
  "hash": "4b1c…e09a",
  "invariants": [],
  "policies": {
    "change": ["migrate"],
    "dataProtection": { "dataLoss": "data-loss-with-consent", "accessWidening": "access-widening-forbidden" }
  }
}
```

Code that writes ref files keeps the `policies` and `invariants` it read. Pass `permitPolicyChange: true` to `migrate` or `dbUpdate` only when the person running the deploy has said the ref's policies should be applied. A successful `migrate` that recorded policies returns them in `databasePoliciesUpdated`, one `{ setting, declared, inForce }` per setting it changed; `setting` is the key path in the ref's `policies` (`change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`). `dbUpdate`'s result carries the same field.


## Prisma schema files must be valid UTF-8

### `psl-schema-must-be-utf8`

If `contract emit` or another command now fails with `PSL_SCHEMA_READ_FAILED` and the message says the encoded data is not valid UTF-8, the named schema file contains bytes in another encoding. A common case is a Windows-1252 character, such as an em dash, typed into a comment on Windows.

Reopen the file in the encoding it was written in, for example with your editor's "Reopen with Encoding" set to Windows-1252, then save it as UTF-8 and run the command again. Opening the file as UTF-8 and saving it does not help, because the editor keeps the replacement character instead of the original one. If the text was already saved with replacement characters, restore it from a good copy, such as version control.


## PostgreSQL's `Json` is a convenience type, and `sql.String(n)` is `sql.Varchar(n)`

On PostgreSQL, `Json` is now a convenience type, as `Int` and `String` are. Its optional `storage` argument chooses the column: `Json` and `Json(storage: json)` are a `json` column, and `Json(storage: jsonb)` is a `jsonb` column. Written bare, `Json` gives the same `json` column as before, so schemas need no change and every contract stays the same. `Jsonb` is unchanged.

The explicit type of a `json` column is named `PlainJson`, and the column helper is renamed to match it.

On every SQL target, `sql.String(n)` is renamed `sql.Varchar(n)`, with `sql.String` kept as a deprecated alias.

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

### `ts-renamed-postgres-json-column-helper`

The detection matches a file that imports or re-exports `jsonColumn` from `@prisma/orm-postgres/adapter/column-types` or `@prisma/orm-target-postgres/adapter/column-types`, or imports one of them as a namespace and reads `jsonColumn` from it. In that file, rename the import or re-export and every use of the name. Any other form, such as a dynamic import, fails type-checking because the export is gone; rename it where the compiler reports it:

```ts
import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(plainJsonColumn); // was jsonColumn
```

`field.column(type.Json())` and `field.column(type.PlainJson())` give the same column. A file that imports `jsonColumn` from a SQLite package is covered by `ts-renamed-sqlite-column-helpers`, not this one.


## SQLite scalars get convenience types

On SQLite, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL and MongoDB. Each chooses one explicit type: `Int` is `IntegerNumber`, `BigInt` is `IntegerBigInt`, `BigInt(as: number)` is `IntegerNumber`, `Float` is `Real`, `Decimal` is `DecimalString`, `String` is `Text`, `Boolean` is `IntegerBoolean`, `Bytes` is `Blob` and `Json` is `PlainJson`. An explicit type is named after the SQLite column type that stores it: `Text`, `Real` and `Blob`. `integer` is read by more than one codec of its data type, so those types carry the value too: `IntegerNumber` and `IntegerBigInt`. A type with a data type of its own, which a `text` column stores, is named after that data type: `DecimalString`, `PlainJson` and the date and time types. `IntegerBoolean` is a data type of its own that an `integer` column stores, so its name takes the form of the other `integer` types. Written bare, `Int`, `BigInt`, `Float`, `String`, `Bytes` and `Json` give the same codec as before.

Two names change the contract. A `Decimal` field gets its own codec, `sqlite/decimal@1`, where it was the same codec as `String`. `BigIntNumber` is a deprecated alias of `IntegerNumber`, so its codec id changes. Neither changes a column, and no data moves.

`Boolean` is new on SQLite: a schema can now write a `Boolean` field, or `type.Boolean()` in a TypeScript contract. It is an `integer` column holding 1 for `true` and 0 for `false`, which is what SQLite's own `TRUE` and `FALSE` are, with its own codec `sqlite/boolean@1`. `@default(true)` is written `DEFAULT 1`. A stored value other than 0 or 1 raises `RUNTIME.DECODE_FAILED`, naming the column. A field takes equality filters, and is not ordered or summed. No existing schema used it, so nothing changes for one.

`Int` and every other field on the codec `sqlite/integer@1` now checks that a value is an integer within the safe integer range, as `BigIntNumber` did; see `sqlite-integer-safe-range`.

A `BigInt` field now reads every stored 64-bit integer. Before, reading a row that held an integer outside ±(2^53 − 1) failed in `node:sqlite` with a `RangeError` whose code is `ERR_OUT_OF_RANGE`, so only a read through an `include()` or a `sumBigInt` gave the value. Nothing in the schema changes for it. A value read without an integer codec, such as a column of a raw SQL query, is now a `number` within the safe integer range and an exact `bigint` outside it, where the read threw before. `JSON.stringify` throws on a `bigint`, so code that serializes such a row prints the value with `String(value)`. A `BigInt` field also refuses to write a `bigint` outside the signed 64-bit range with `RUNTIME.ENCODE_FAILED`, where `node:sqlite` threw a `TypeError` before.

The column helpers of the TypeScript contract builder are renamed after the explicit type each gives, and `decimalStringColumn` and `integerBooleanColumn` are new.

### Sign the database with the new contract

The `Decimal` and `BigIntNumber` changes below change the contract's storage hash, so `db verify` reports `CONTRACT.MARKER_MISMATCH` until the database is signed with the new contract. After re-emitting the contract:

- In a project with migrations, run `migration plan --from <latest migration>`, where `<latest migration>` is the name of the newest folder under `migrations/`. It writes a migration that names the changed table, and `db migrate` applies it and signs the database. When signing is the only change, the migration has no operations. It holds operations only for the other changes of this upgrade that you plan in it, as step 7 allows, such as the renames `sql-lowered-table-names-renamed` describes. No table is rebuilt for the `Decimal` and `BigIntNumber` changes. Without `--from`, `migration plan` starts from the `db` ref. A project that applied its migrations with `db migrate` before this release, without `--advance-ref`, has none, so the command refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`.
- In a project without migrations, run `db update`. It runs no operation and signs the database.

`db verify --schema-only` passes before and after: the columns are the same.

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

### `sqlite-bigintnumber-deprecated`

This applies to a SQLite schema or TypeScript contract. On PostgreSQL, `BigIntNumber` is covered by the PostgreSQL scalar rename of an earlier release; skip this entry there.

In each matched SQLite schema, replace the type `BigIntNumber` with `BigInt(as: number)`, in fields, value object members and `types {}` aliases. In a SQLite TypeScript contract, replace `type.BigIntNumber()` with `type.BigInt({ as: 'number' })`. The deprecation warning names `IntegerNumber`, the explicit type, which gives the same contract as `BigInt(as: number)`; either is right:

```prisma
model Post {
  id        Int                 @id
  viewCount BigInt(as: number)  // was BigIntNumber
}
```

`Int` gives the same column too. The field's codec id changes from `sqlite/bigintnumber@1` to `sqlite/integer@1`, which writes and reads a `number` within the safe integer range, as `sqlite/bigintnumber@1` did; `sqlite-integer-safe-range` says what a value outside it raises. Re-emit the contract and sign the database as described above.

`sqlite/bigintnumber@1` stays: `count()` and the `sum` of an integer column still read their result through it, so a reference to it in generated `contract.d.ts` aggregate types is expected. A file that matches only because a comment or a string mentions `BigIntNumber` needs no change. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is.

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

### `psl-optional-mongo-convenience-names`

This change is optional. In a MongoDB schema, `Int`, `Float` and `Boolean` are now the names to write, and they give exactly the same codecs as `Int32`, `Double` and `Bool`. To use them, replace the type `Int32` with `Int`, `Double` with `Float` and `Bool` with `Boolean`, in fields, lists, value object members and `types {}` aliases:

```prisma
model Order {
  id     ObjectId @id @map("_id")
  amount Int      // was Int32
  total  Float    // was Double
  paid   Boolean  // was Bool
}
```

The contract does not change. Do this only in a MongoDB schema: on other targets `Int32`, `Double` and `Bool` are different types or do not exist. Leave `Int32` in a codec id such as `mongo/int32@1`, and leave names that only start with these, such as a composite type named `DoubleValue`, as they are. Leave the `contract.prisma` copy inside each migration folder under `migrations/` as it is: it records the schema that migration was planned from.


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

#### Each parent has at most one related row: make the key unique

Add a unique constraint over exactly the `by` fields of the target model. For one field, use `.unique()`:

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

#### A parent can have several related rows: use `hasMany`

Replace `rel.hasOne(Target, { by })` with `rel.hasMany(Target, { by })`. The relation then reads as an array of rows instead of one row or `null`, so update the code that reads or writes it.


## Constraints declared on a single-table variant

This applies to SQL contracts only; a MongoDB contract is not affected, though the detection also matches MongoDB `.prisma` files. A single-table variant is a model with `@@base(Base, "value")` and no `@@map`. Its rows are stored in the base model's table, next to the rows of the base and of every other variant.

### `sti-variant-unscoped-index-refused`

#### A unique or an index without `where:` is refused

A unique constraint or a plain index on the shared table would also cover the other variants' rows. `prisma contract emit` used to drop these attributes from the contract. It now refuses each one at the attribute:

```text
PSL_UNSCOPED_INDEX_ON_STI_VARIANT: Model "Bug" shares the table of its base model "Task" (single-table inheritance), so "@unique" would also cover the rows of other variants. Without a condition, only the backing index of one of its own relations is accepted. Scope it to this variant instead: @@index([ticket], unique: true, where: sql`type = 'bug'`)
```

Without `where:`, only a plain `@@index` that backs one of the variant's own relations is still accepted: the index the relation's foreign key creates anyway, or the one its `index:` argument names. Another variant may not give the same index a different `name` or `map`, and it is not accepted over a column with a `@default`, since every row of the table gets that default.

A unique on a variant is always refused. A one-to-one relation from a single-table variant needs one, so it is not supported yet: the message for it says so and offers no partial index, which would not satisfy the relation. Make the relation one-to-many, or give the variant a table of its own with `@@map`.

In every file the detection matches, run `prisma contract emit` and find each `PSL_UNSCOPED_INDEX_ON_STI_VARIANT` it reports; leave the accepted forms above as they are. Replace each refused attribute with the `@@index` the message writes out: the same fields, `unique: true` for a unique one, and a `where:` condition that compares the base's discriminator column with the variant's value.

```prisma
// Before
model Bug {
  ticket String @unique

  @@base(Task, "bug")
}

// After
model Bug {
  ticket String

  @@index([ticket], unique: true, where: sql`type = 'bug'`)
  @@base(Task, "bug")
}
```

These attributes were never in the contract before, so the new index is a change to storage: plan and apply a migration for it. A unique index fails to build if two rows of the variant already hold the same value; remove the duplicates first.

#### An `@@index` with `where:` is now stored

A variant's `@@index` with `where:` used to be dropped from the contract too. It now becomes a partial index on the base model's table. Re-emit the contract with `prisma contract emit`, then plan and apply a migration to create the index.

### `sti-variant-foreign-keys-stored`

A relation with `fields:` on a variant now puts its foreign key on the base model's table. Before, it was dropped. The migration adds a backing index only when the relation derives one: a relation with `index: false` gets none, and one with `index: "<name>"` uses that index. Re-emit the contract with `prisma contract emit`, then plan and apply a migration to add them. The foreign key fails to build if a row already points at a missing row; fix those rows first.

When another model of the table maps the same column, it must declare the same relation: the same target, the same column pairs and the same referential actions. If it declares a different one, or maps the column as a plain field, the emit fails with `PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT`, because its rows would have to satisfy the foreign key too. It fails the same way when the relation's column has a `@default`, which every row of the table gets; remove the default. When the other foreign key is the base model's, keep only one of the two relations. Otherwise give the variant's field its own column with `@map`, in this order, so that no value is lost:

1. Keep the old shared column. Add the variant's new column beside it, nullable and without a foreign key yet: map the field to the new column, and remove both the relation field and its back-relation on the relation's target model for now, since a back-relation without its relation fails with `PSL_ORPHANED_BACKRELATION`. If the other model of the table declares a relation on the old column, remove that relation and its back-relation for now too, and keep its scalar field. From the migration below until step 5 is done, keep the application from writing the variant's rows, for example with the application stopped or in a maintenance window: step 2 overwrites a value written to the new column before the copy, and a value written to the old column after the copy is lost. Then plan and apply a migration that adds the new column. Check that it does not drop the old column, which the other model of the table still maps, and that it adds no foreign key on the old column.
2. Copy the values across for that variant's rows only, by discriminator value, as in `UPDATE actor SET human_contact_id = "contactId" WHERE kind = 'human'`.
3. Check that every copied value has its target row, as in `SELECT human_contact_id FROM actor WHERE human_contact_id IS NOT NULL AND human_contact_id NOT IN (SELECT id FROM contact)`, which must return no rows.
4. If you removed the relation of the other model of the table in step 1, clear the old column on the variant's rows, as in `UPDATE actor SET "contactId" = NULL WHERE kind = 'human'`, because that relation's foreign key will apply to every row of the table.
5. Restore the relations you removed, the variant's on its new column, with their back-relations. Plan and apply the migration that adds their foreign keys, and drop the old column only when no model maps it any more.


## Re-emit SQL contracts for the include capabilities

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


## MySQL and MariaDB: scalars get convenience types, and the ORM's aggregates run

On MySQL and MariaDB, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are now convenience types, as on PostgreSQL, SQLite and MongoDB. Each chooses one explicit type named after the MySQL column type that stores it: `Int` is `Int4`, `BigInt` is `Int8BigInt`, `BigInt(as: number)` is `Int8Number`, `Float` is `Float8` (a `double`), `Decimal` is `NumericString(65, 30)`, `String` is `Varchar(191)` and `String(storage: text)` is `Text`, `Boolean` is `Bool` (a `tinyint(1)`), `Bytes` is `Longblob` and `Json` is `PlainJson`. A field written `Int`, `BigInt` or `String` gives the same codec as before, so no schema needs a change.

The two entries below both ask for the contract to be emitted again; one `prisma contract emit` covers both.

### `re-emit-mysql-contract-for-aggregates`

Run `prisma contract emit` for every MySQL or MariaDB contract. The emitted `contract.d.ts` replaces `export type AggregateTypes = Record<string, never>;` with the aggregate overloads the MySQL target contributes, so TypeScript offers `count()`, `sum()`, `avg()`, `min()` and `max()` in `include('posts', (p) => p.count())`, `combine()` and `aggregate()`. Apart from the capabilities `re-emit-for-include-capabilities` describes, nothing else changes, and no database needs migrating or signing again.

On MySQL and MariaDB, `count` and `sum` over integers read as a JavaScript `number`, and fail with `RUNTIME.DECODE_FAILED` rather than round a value outside ±(2^53 − 1); `countBigInt` and `sumBigInt` read as a `bigint`. `avg` over an integer reads the mean as a `number`, computed as `CAST(SUM(x) AS DOUBLE) / COUNT(x)`, so it is the same whichever plan the server picks.

### `mysql-reemit-contract`

In each matched project, emit the contract again:

```bash
pnpm prisma contract emit
```

The generated `contract.d.ts` gains entries under `AggregateTypes` for the new codecs, such as `sum` over `mysql/decimal@1` and `avg` over `mysql/double@1`. The hashes in `contract.json` do not change, so the database's signature stays as it is and no migration is needed; `contract.json` changes only by the capabilities `re-emit-for-include-capabilities` describes. Leave the `contract.d.ts` copy inside each migration snapshot under `migrations/snapshots/` as it is.


## Contracts that record an extension's version

### `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.25`; any other difference in the emitted files comes from an earlier entry in this guide.


## A changed stored name is a rename on PostgreSQL and SQLite

A model, field or enum member with the same name in the contract source on both sides of a change is now the same object. When only what it is stored as changes, `migration plan` and `db update` rename the storage or replace the value. This applies on PostgreSQL and SQLite, with a snapshot of the contract the database is at. MySQL and MongoDB plan these changes as before.

### `sql-stored-name-change-is-a-rename`

Before, changing `@@map("users")` to `@@map("people")` on `model User` planned a drop of `users` and a create of `people`, and asked for `--delete User`. To keep the rows you renamed the table by hand: with `db update`, in the database; with `migration plan`, by writing `...this.renameTable({ table: 'users', to: 'people' })` into a `migration.ts` of its own.

Now the same change plans a rename of table `users` to `people` and the renames of its constraints (on PostgreSQL the plan prints `Rename table "users" to "people"`, on SQLite `Rename table users to people`), and asks nothing. A changed `@map` plans a column rename. An enum member that keeps its name and changes its stored value, such as `ARCHIVED = "archived"` to `ARCHIVED = "old"`, has the value replaced in every column the enum types in a table whose control policy is `managed`. A column in a table whose control policy is not `managed` keeps the old value: rewrite its values yourself. A table or column is renamed only when everything stored in it moves and its control policy is `managed` in both contracts; a variant that gains or loses a table of its own is still asked about.

Stop renaming by hand. Make the contract change and plan it. Migrations you already wrote by hand stay as they are.

### `sql-stored-name-delete-is-unused`

Before:

```bash
prisma migration plan --name move-users --delete User
```

Now this fails with `CLI.CONSENT_UNUSED`, since nothing asks about `User`. Remove the `--delete` from the script:

```bash
prisma migration plan --name move-users
```

A `--rename User:User` statement still fails with `MIGRATION.STATEMENT_INVALID`. Remove it too.

### `sql-stored-name-empty-table`

Before, a changed `@@map` gave you an empty table under the new name once you answered `--delete User`. Now it keeps the rows. To start empty, make two changes, each planned and applied before the next:

1. Remove `model User` from the schema, plan, and answer `--delete User`.
2. Add `model User` back with `@@map("people")`, and plan again.

### `sql-stored-name-swaps-refused`

Before, two models that swapped tables (`User` from `users` to `accounts` and `Account` from `accounts` to `users`) planned no drop and no create: each table was altered in place and then held the other model's rows. Now the plan fails with `MIGRATION.PLANNING_FAILED`, as in:

```text
Cannot rename table "accounts" to "users": table "users" is renamed in the same plan
```

The same holds for two fields that swap columns, a chain where one model or field moves to a name another frees, a model or field that takes the storage of one the change removes, and enum members that swap stored values or take the stored value of a removed member. Follow the message: make the change in two plans, each planned and applied before the next, through names nothing uses, such as `prisma_swap_users`, or, for a takeover, by first removing the model, field or enum member that holds the name. When that first plan removes an enum member and you answer `--delete`, a required column cannot keep the member's rows: delete them, or set them to a value the enum keeps, before the plan applies.

When the two tables or columns have the same shape and nothing else changes, the storage does not change at all, so `migration plan` still reports no change and writes nothing; `db update` refuses the swap. Make such a swap through a name nothing uses in the same way.

### `sql-lowered-table-names-renamed`

Before, a model with no `@@map` whose table still had the name an earlier release gave it, with the first letter lowered (`userProfile` for `model UserProfile`), was refused with `MIGRATION.TABLE_NAME_CASE_CHANGED` when planned from a snapshot that named the lowered table. Now, from such a snapshot, the plan renames `userProfile` to `UserProfile` with no question.

To keep the lowered name, add it with `@@map` before you plan:

```prisma
model UserProfile {
  id Int @id

  @@map("userProfile")
}
```


## MongoDB plans rewrite value objects, embedded models, enum values and variants

### `mongo-nested-removals-are-asked`

Where `migration plan` or `db update` now stops with a question, or with `CLI.CONSENT_REQUIRED` when nobody can answer, give the statement that says what the change means:

- A field a value object or an embedded model loses: `--rename Address.street:Address.line1` if it was renamed, or `--delete Address.street` to remove the key from every object (`removeStoredKey`).
- A stored value an enum loses: `--rename Status.ARCHIVED:Status.<new name>` to keep the documents under another member, or `--delete Status.ARCHIVED` to unset it in optional fields and take it out of lists (`removeStoredValue`). Where a required field holds it, the apply stops with `MIGRATION.PRECHECK_FAILED`, counts the documents and gives the edit that keeps them.
- A variant whose discriminator value changes: `--convert Bug` to rewrite the value, or `--delete Bug` to delete its documents (`deleteDocuments`).
- A variant the contract removes: `--rename Bug:Issue` if it was renamed, or `--delete Bug` to delete its documents (`deleteDocuments`).

A script that runs these commands with `--yes` and no statements now fails with `CLI.CONSENT_REQUIRED`; add the statements it lists.

### `mongo-nested-statements-are-planned`

A script or test that expects these statements to fail with `MIGRATION.PLANNING_FAILED` on MongoDB now gets a plan. A plan in which one operation writes a field, key or value that another operation of the same plan reads is still refused, with advice to make the change in two migrations: field, key and enum value renames that trade names or values or form a chain, a new required field under the name a rename moves away, a rename onto a name whose field the origin also stores, and variant changes where one variant takes a discriminator value another frees. MongoDB applies operations one at a time, so the later operation would act on what the earlier one wrote, or a re-run after a later operation stops would rewrite those documents twice.

If you rewrote such documents by hand in `mongosh` or in a `dataTransform` because the statement was refused, nothing changes for migrations you already applied.

### `mongo-nested-required-field-gets-temporary-value`

To write your own value instead, plan the change with `migration plan --backfill Address.zip` and write an aggregation expression in the `placeholder('Address.zip:value')` slot of each `fillStoredKey` it writes, such as `{ $literal: 'unknown' }`. A field whose type has no temporary value, such as a date, gets none, and the validator change's document check stops the apply while objects lack it; use `--backfill` for it.


## Names and keys that JavaScript objects inherit

Names such as `constructor` and `toString` now work everywhere as model, table, column and field names, and need no action. Three cases with `__proto__` do.

### `json-default-proto-key-kept`

```prisma
model User {
  id   Int   @id
  meta Jsonb @default(json`{ "__proto__": { "x": 1 }, "a": 2 }`)
}
```

`prisma contract emit` used to leave the `__proto__` key out of `contract.json` and out of the storage hash, so the database got the default `{"a": 2}`. It now keeps the key. For each file the detection matches:

1. Run `prisma contract emit`. The storage hash changes.
2. Run `prisma migration plan` and apply the migration, or run `prisma db update`. Either plans one operation per such column, `Set default on "<table>"."<column>"`.

Until the operation is applied, the SQL runtime logs `CONTRACT.MARKER_MISMATCH` as a warning and still runs queries. If you do not want the key in the default, remove it from the contract source instead.

### `mongo-proto-names-refused`

JavaScript reads `__proto__` as the prototype of an object rather than as a key, so a contract could not hold such a name: the client lost the model or collection. A MongoDB contract now refuses it. The TypeScript builder raises `CONTRACT.NAME_UNUSABLE_AS_KEY`; a PSL contract reports `PSL_STORED_NAME_UNSUPPORTED` at the declaration:

```text
A model is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

In a PSL contract, an enum named `__proto__` is not refused: it is left out of the contract without an error, together with every field typed by it.

Rename the model, composite type, enum or root. For a collection, name another collection with `@@map`. `@@map` only changes which collection the client reads and writes: documents already in a collection named `__proto__` stay there, so rename that collection in the database to the new name (`renameCollection`) in the same deployment. The TypeScript builder also refuses an object literal with a `__proto__` key, such as `models: { __proto__: Post, User }`, which used to drop the entry without an error.

### `sql-proto-names-refused`

A SQL contract refuses the same name. A namespace, table, column, model, field or enum named `__proto__`, including a stored name given with `@@map("__proto__")` or `@map("__proto__")`, fails `prisma contract emit` with:

```text
CONTRACT.NAME_UNUSABLE_AS_KEY: A table in namespace "public" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

Choose another name. In a TypeScript contract, an object literal with a `__proto__:` key is refused too; it used to drop the entry without an error. Such a contract did not work before: the entry was dropped or the contract came out wrong.

A SQL query builder `select` that names a result column `__proto__` is refused with `RUNTIME.AST_INVALID`; choose another alias.


## Concurrent work on `tx` during an ORM write

### `orm-write-inside-transaction-suspends-tx`

Inside `db.transaction(async (tx) => ...)`, where an ORM write of several statements runs at the same time as other work on `tx`, for example in `Promise.all`, await the write before sending the other work:

```ts
await tx.orm.public.Post.create({ title, author: (author) => author.create(user) });
await tx.execute(plan);
```

On any SQL database, when such a write fails with an error that ends the whole transaction, such as a deadlock on MySQL or MariaDB, the rollback to the savepoint fails too. The write then rejects with `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, whose `cause` is the database's error, and the transaction is closed. Before, it rejected with the database's error itself. Code that retries on the database's deadlock error reads that error from `error.cause`.


## `update()` data refuses a foreign key together with a callback on its relation

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

The relation callback's `update` and `delete` are new in this release. To use one of them on the row the record points at and also point the record at another row, make two calls: first the callback, then the foreign key. Run them in one transaction, so that both changes apply or neither does. Where the foreign key is required, the callback's `delete` is refused: set the foreign key first, then delete the old row through its own collection.

```ts
await db.transaction(async (tx) => {
  await tx.orm.public.Post.where({ id: 10 }).update({
    author: (author) => author.update({ name: 'Ada' }),
  });
  await tx.orm.public.Post.where({ id: 10 }).update({ authorId: 2 });
});
```


## Update data cannot set the discriminator of a polymorphic model

### `update-data-refuses-discriminator`

`update()`, `updateAll()`, `updateAndCount()`, the `update` data of `upsert()` and a nested `updateAll` no longer take the discriminator field of a polymorphic model. Setting it is a type error, and at run time it is refused with `ORM.FIELD_IMMUTABLE` before any statement runs. Before, the update changed the discriminator in the base table only, so the row's variant data no longer matched it.

Remove the discriminator from the update data. To move a row to another variant, delete it and create it as that variant.


## A unique key with a nullable column is no row identity

### `nullable-unique-key-is-no-row-identity`

The ORM matches rows by their primary key, or else by a unique key. It now skips a unique key that has a nullable column, because two rows can both hold `NULL` in it. If such a key is the only one a table has, the table has no row identity, and these calls fail with `ORM.ROW_IDENTITY_MISSING`:

- `update()` and `delete()`, on every database.
- `create()`, `createAll()`, `update()`, `updateAll()` and `upsert()` after `.include(...)`, on every database.
- On a database without `RETURNING`: `create()`, `createAll()` and `updateAll()` that return rows, since they read their rows back by key.
- On a database whose adapter does not report `sql.jsonAgg`, `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`: any read with an include of that table, at any level, and `deleteAll()` after `.include(...)`, since the included rows are matched to their parents by key.

`deleteAll()` on such a table, where it must read the rows before deleting them, deletes by the caller's condition, as it does on any table with no primary key or unique constraint.

Find each model whose table has no `@id` and whose `@unique` or `@@unique` fields include an optional one. Then do one of these:

- Add a primary key to the table (`@id` or `@@id`), and create a migration for it.
- Make the unique key's fields required, so its columns are `NOT NULL`, and create a migration for it.


## Nested relation mutation errors use the general ORM codes

### `relation-mutation-error-codes-merged`

Replace every comparison with the old codes:

- `ORM.RELATION_MUTATION_INVALID` becomes `ORM.ARGUMENT_INVALID`.
- `ORM.RELATION_MUTATION_UNSUPPORTED` becomes `ORM.OPERATION_UNSUPPORTED`.

The `meta` of these errors keeps its fields (`kind`, `relation`, `problem`, `reason` and the others). Code that needs to tell a nested relation mutation error from another error with the same code can check `meta.relation`, which the nested relation mutation errors with these two codes carry.


## A nested create on a polymorphic model names its variant

### `nested-create-on-polymorphic-target-needs-variant`

The mutator a relation callback receives for a polymorphic base model now has `variant(value)`, which takes a discriminator value the model declares, as a collection's `variant()` does. Its `create(data)` writes a complete row of that variant, including the row of a variant stored in its own table. `r.create(data)` on such a mutator now takes no data, as a collection's `create()` on a polymorphic base model without `variant()` does, so each such call is a type error. Run the project's typecheck to find them.

For each call, take the value of the discriminator field from the data, pass it to `variant(...)` and remove the field from the data:

```ts
// before
await db.orm.public.Project.where({ id: 1 }).update({
  tasks: (tasks) => tasks.create({ title: 'Crash on login', type: 'bug' }),
});

// after
await db.orm.public.Project.where({ id: 1 }).update({
  tasks: (tasks) => tasks.variant('bug').create({ title: 'Crash on login' }),
});
```

The data of `r.variant(value).create(...)` takes the variant's own fields too, such as `severity` for the `bug` variant, and requires those the variant requires; add them where the type check asks for them. When the rows of one call have different discriminator values, split it into one `variant(value).create(...)` per value and return them as an array from the callback.

A variant stored in its own table needs the contract capability `returning`; without it the call is refused with `ORM.CAPABILITY_MISSING`, as `create()` on that variant collection is.

### `variant-create-without-returning-names-create`

On a contract without the `returning` capability, `db.orm.public.Task.variant('feature').create(data)` for a variant stored in its own table is refused with `ORM.CAPABILITY_MISSING`. Its message is now `create() requires contract capability "returning"` and its `meta.action` is `'create()'`; they used to name `createAll()`. `createAll()` on the variant still names `createAll()`. Code or tests that match this error of a `create()` call by its message or by `meta.action === 'createAll()'` match `create()` instead.


## `disconnect` on a required relation is refused, and to-one `disconnect` applies its criteria

### `disconnect-on-required-relation-refused`

`r.disconnect()` in the data of `update()` sets the foreign key of the relation to null. When the record holds the key (a many-to-one relation, such as `Post.author`, which is also the side of a one-to-one that holds the key), that is the record's own key; when the related rows hold the key (one-to-many, or one-to-one from the side without the key), it is the key of the related rows. When that key is required, the database refused the statement with a NOT NULL error, which reached the caller unwrapped. When the related rows hold the key and no related row was changed, because `disconnect(criteria)` matched none of them or, without criteria, the record had no related rows, the statement changed nothing and succeeded; such a call is now refused as well, like every `disconnect` on that relation.

Such a call is now a type error, on an emitted `contract.d.ts` and on a contract built with the TypeScript contract builder. Run the project's typecheck to find them. At run time, the ORM refuses it while it plans the write, before any statement runs, with:

```text
ORM.OPERATION_UNSUPPORTED: disconnect() nested mutation for relation "author" cannot set "userId" of model "Post" to null, because the foreign key is required
```

`meta.reason` is `'required-foreign-key'`, `meta.model` names the model that holds the key and `meta.fields` its fields. Because nothing has been written, the whole `update()` is refused, including its own field changes.

For each such call, decide what should become of the row that holds the key. The refusal names it: when `meta.model` is the model being updated, the record holds the key; otherwise the related rows hold it.

When the record holds the key (a many-to-one relation, such as `Post.author`), the key is on the record being updated:

- To link the record to another row, use `connect` on the same relation instead:

  ```ts
  // before
  await db.orm.public.Post.where({ id: 10 }).update({
    author: (author) => author.disconnect(),
  });

  // after
  await db.orm.public.Post.where({ id: 10 }).update({
    author: (author) => author.connect({ id: 2 }),
  });
  ```

- To remove the record, delete it with its own collection, for example `db.orm.public.Post.where({ id: 10 }).delete()`.

When the related rows hold the key (one-to-many, or one-to-one from the side without the key), the key is on the related rows:

- To move them to another record, use `connect` on that record instead:

  ```ts
  // before
  await db.orm.public.User.where({ id: 1 }).update({
    posts: (posts) => posts.disconnect([{ id: 10 }]),
  });

  // after
  await db.orm.public.User.where({ id: 2 }).update({
    posts: (posts) => posts.connect({ id: 10 }),
  });
  ```

- To remove them, delete them: `r.where(filter).delete()` for one row or `r.where(filter).deleteAll()` for every match on a one-to-many relation, `r.delete()` on a one-to-one relation, or the related model's own `delete()`.

In both cases, if the row that holds the key may exist without the row it points at, make the foreign key optional in the contract (`.optional()` on the field, or `?` in PSL), re-emit the contract and migrate the column to nullable. `disconnect` is then available.

Code that caught the database's NOT NULL error of such a call catches `ORM.OPERATION_UNSUPPORTED` with `meta.reason === 'required-foreign-key'` instead.

### `to-one-disconnect-criteria-applied`

On a relation the record holds the key for, such as `author` on a post, `r.disconnect(criteria)` used to set the record's foreign key to null whatever row it was linked to; the criteria had no effect. It now sets it to null only when the linked row matches one of the criteria. Otherwise the foreign key stays unchanged, with no error, and the other updates of the same `update()`, such as changes to the record's own fields, still apply. `r.disconnect()` without criteria is unchanged.

This applies to a relation whose foreign key is optional. On a relation whose foreign key is required, every `disconnect`, with or without criteria and on a variant too, is refused with `ORM.OPERATION_UNSUPPORTED` (`reason: 'required-foreign-key'`) before its criteria or variant are looked at; see `disconnect-on-required-relation-refused`.

Find each `disconnect([...])` in a relation callback for a many-to-one relation. Where the call is meant to unlink the record whatever it is linked to, drop the criteria:

```ts
// before
await db.orm.public.Post.where({ id: 1 }).update({
  editor: (editor) => editor.disconnect([{ id: 7 }]),
});

// after, when the post should be unlinked from any editor
await db.orm.public.Post.where({ id: 1 }).update({
  editor: (editor) => editor.disconnect(),
});
```

Where the call is meant to unlink only from that row, keep it. Code that read the record back and expected the key to be null after a call whose criteria did not match the linked row now reads the unchanged key.

On a relation whose target is a polymorphic model and whose foreign key is optional, `r.variant(value).disconnect(criteria?)` is also available: it unlinks the record only when the linked row is of that variant and, when criteria are given, matches one of them.

### `disconnect-empty-criteria-disconnects-nothing`

`r.disconnect([])` with an explicit empty list of criteria used to behave as `r.disconnect()` without criteria: it unlinked the record on a relation the record holds the key for, and every related row on a one-to-many or one-to-one relation. An empty list now matches no row, so the call disconnects nothing; other updates in the same `update()` still apply. Many-to-many `disconnect([])` is still refused with `ORM.ARGUMENT_INVALID`. On a relation whose foreign key is required, `disconnect([])` is refused like every other `disconnect` (see `disconnect-on-required-relation-refused`).

Find each `disconnect(...)` whose criteria list can be empty, such as one built from a filtered array. Where the call is meant to unlink everything when the list is empty, call `disconnect()` without criteria in that case.


## `onConflict: 'skip'` refuses rows that cannot conflict

### `create-all-skip-refuses-rows-without-conflict-key`

With `onConflict: 'skip'`, `createAll` and `createAndCount` watch the fields named in `conflictOn` when given, and otherwise every primary key, unique constraint and unique index over columns of the table. A row can conflict when it gives a non-null value for every field of at least one of those keys. Values count when the row gives them or when the ORM fills them in from a create default such as `uuid()`, `cuid()` or `now()`. A column the database fills in (auto-increment, a database default) and `null` do not count.

A call with a row that cannot conflict now throws `ORM.ARGUMENT_INVALID` before any statement runs, and inserts no row. The error's `meta` gives the method, the model, `problem: 'row-cannot-conflict'`, the row's `index` and the `conflictKeys`; the message and `conflictKeys` list each conflict key by its storage columns, such as `invited_by_id` for the field `invitedById`. Before, such a row was always inserted, since nothing could collide with it.

For each call that throws:

1. If the row should be skipped when a matching row exists, give it a value for each field named in `conflictOn`, or name in `conflictOn` fields the row gives values for.
2. If the row should always be inserted, insert it with a separate `createAll(rows)` or `createAndCount(rows)` call without `onConflict`.

### `create-all-skip-refuses-tables-without-keys`

Without `conflictOn`, a call on a table with no primary key, unique constraint or unique index over columns now throws `ORM.ARGUMENT_INVALID` with `problem: 'no-conflict-key'` before any statement runs, since nothing in the table can collide. Before, every row was inserted. Leave `onConflict` out of such a call, or give the table a key and name it in `conflictOn`.


## SQL builder comparisons check values against the column's type

### `sql-builder-enum-comparison-values-are-checked`

A builder `where` such as `fns.eq(f.kind, 'humna')` on an enum column whose members are `human` and `agent` now fails to type-check, with the same error as `update({ kind: 'humna' })`. Correct the value to one of the enum's members.

The same check applies to any column whose contract type is narrower than its codec's type: an enum stored as an integer (`0 | 1 | 2`), a native enum, or a column with a typed override.

A value whose type is wider than the column's is also refused. For example, `fns.eq(f.status, req.query.status)` fails when `req.query.status` is a `string`, and `fns.in(f.status, values)` fails when `values` is a `string[]`. Narrow the value first, for example by checking it against the enum's members, so that TypeScript knows it is one of them.

To find rows that hold a value the column's type no longer lists, compare with a raw SQL operand, which keeps the codec's input type: ``fns.eq(fns.raw`kind`.returns('pg/text@1'), 'old_value')``.


## Errors from MySQL's shared code carry no `meta.target`

### `mysql-errors-drop-meta-target`

Find code that reads `meta.target` from an error a MySQL or MariaDB client raised, and read the target from the client instead: `db.stack.target.targetId` is `'mysql'` or `'mariadb'`.


## `prisma orm init --target` takes any target package by name

### `init-target-takes-a-package-name`

```bash
prisma orm init --target @prisma/orm-sqlite --authoring psl
```

`--target` is looked up among the short names (`postgres`, `mongodb` and their aliases). A value that is not one of them is taken as a package name: `init` installs that package and writes the project from the init contribution it exports. `--target postgres` and `--target mongodb` do what they did before. A value that is not a valid package name is refused with `CLI.INIT_INVALID_FLAG_VALUE` before anything changes, and the error's `meta.problems` says why. Before installing, `init` checks that the package lists the `prisma-orm-extension` keyword and refuses with `CLI.INIT_TARGET_PACKAGE_NOT_VERIFIED` when it does not. That includes `--target sqlite`, which names an unrelated package: use `--target @prisma/orm-sqlite`. The first error's `meta.allowed` still lists the short names only, and `meta.acceptsPackageName` is `true`.

Without `--target`, the picker has one more entry, "Another target package", which asks for the package name.

Nothing changes for a script that runs `init --target postgres` or `--target mongodb` and ignores fields it does not know.

In each matched file that reads the `--json` result of `prisma orm init`:

- The result has a new string field, `package`: the name of the target package, such as `@prisma/orm-postgres`. A reader that refuses unknown fields must allow it.
- `target` is still `postgres` or `mongodb` for those packages, also when the package was given by name (`--target @prisma/orm-postgres` reports `target: "postgres"`). For any other package it is the package name, so a reader that checks `target` against the two short names must accept any string. Use `package` when you need the package name.


## `db migrate` advances the `db` ref

### `db-migrate-advances-db-ref`

`prisma db migrate` now moves the `db` ref to the contract the database is at after it applies, the way `db init` and `db update` do. It does so only when the connection comes from `db.connection` in `prisma.config.ts` and the CLI does not detect CI. Unless the `CI` environment variable is `false`, which turns detection off whatever else is set, the CLI detects CI when `CI` is set or when a variable that CI services set is present, such as `BUILD_NUMBER`, `BUILD_ID` or `GITHUB_ACTIONS`. When CI detection is what stops the advance, the command says so with `MIGRATION.REF_NOT_ADVANCED_IN_CI`. A pipeline that runs `db migrate` from the config silences that notice with `--no-advance-ref`.

| Situation | Ref advancement |
| --- | --- |
| Connection from `prisma.config.ts`, CI not detected | `db` |
| Connection from `prisma.config.ts`, CI detected | None |
| `--db <url>` | None |
| `--advance-ref <name>` | `<name>` instead, in every case above |
| `--no-advance-ref` | None |
| The run ends at the empty contract, for example `--to @empty`; connection from `prisma.config.ts`, neither flag | None; `db` is left unchanged, with a warning when it exists |
| The run ends at the empty contract, `--advance-ref <name>` | Refused before anything is applied; before, the write failed after the apply |

Change the commands the project runs:

- In a development command that reads the connection from the config, such as a `package.json` script or a README step, remove `--advance-ref db` from `db migrate`. Keep it where the command passes `--db` or runs in CI, because there `db migrate` advances nothing by default.

  ```bash
  # Before
  prisma db migrate --advance-ref db
  # After
  prisma db migrate
  ```

- Add `--no-advance-ref`, or pass the URL with `--db`, wherever `db migrate` runs from the config outside a CI runner and must not change files in the repository. That covers deploys: a container entrypoint, a Kubernetes job, a release command such as Fly's `release_command`, or a deploy script on a server checkout. On a persistent checkout the run would otherwise rewrite the tracked `migrations/app/refs/db.json` to the deployed contract, and the next `git pull` that touches that file refuses. It also covers a job that commits its results.

A ref that `db migrate` cannot write, for example on a read-only filesystem, is now a warning, `MIGRATION.REF_NOT_WRITTEN`, and the command exits 0. Before, a failed `--advance-ref` write failed the command after the migrations had applied. A script that checked the exit code to detect that failure reads the warning from the `--json` result's diagnostics instead.


## The CLI engine is 0.10.4, and its consent error has one fixed first line

### `engine-pin-moves-to-0-10-4`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.10.3`, `0.10.2`, `0.10.1`, `0.10.0` or any earlier 0.x) to `0.10.4` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

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
