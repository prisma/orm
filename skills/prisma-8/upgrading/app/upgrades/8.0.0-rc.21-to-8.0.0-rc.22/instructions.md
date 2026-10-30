---
from: "8.0.0-rc.21"
to: "8.0.0-rc.22"
changes:
  - id: one-orm-version
    summary: |
      Every `@prisma/orm-*` package and the `prisma` CLI must run one version of Prisma ORM. With more than one copy installed, commands and clients stop with `RUNTIME.MULTIPLE_ORM_COPIES`.
    detection:
      glob: "package.json"
      matches:
        - '"@prisma/orm-'
  - id: value-objects-in-storage
    summary: |
      A contract keeps its value objects in storage, at `storage.namespaces.<ns>.entries.valueObject`, and a field holding one names it by its storage coordinate. On SQL, a discriminator column names a value set, `<Base>.<field>`, of its variants' values. A `contract.json` that keeps `valueObjects` in the domain plane is refused with `CONTRACT.VALIDATION_FAILED`, saying to re-emit it. Run the colocated script on the project: it rewrites every contract and snapshot, renames the snapshot directories to their new storage hashes, and rewrites the migrations, refs, `migration.ts` files and `contract.d.ts` files that name them. Then sign each database and re-emit the contract.
    detection:
      glob: "**/*.json"
      matches:
        - '"valueObjects"\s*:'
    script: ./scripts/value-objects-in-storage/value-objects-in-storage.ts
  - id: value-object-types-from-storage
    summary: |
      `ValueObjectTypesFromDomain`, exported by `@prisma/orm-mongo/contract/types`, is now `ValueObjectTypesFromStorage` and takes the contract's storage namespaces. A committed `contract.d.ts` that imports it compiles again once it is re-emitted. Code of your own that imports it changes the name and passes `Contract['storage']['namespaces']`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectTypesFromDomain\b'
  - id: postgres-value-object-checks
    summary: |
      On PostgreSQL, the contract derives a check for every value object column and every discriminator column of a managed table. The next `prisma migration plan` adds them, and `prisma db migrate` fails on a row that does not fit, including a row whose value object has a key the value object does not declare, which the SQL ORM never refused. Find such rows before you apply the migration.
  - id: discriminator-typed-by-variant-values
    summary: |
      A SQL discriminator field is typed by its variants' values, such as `'bug' | 'feature'`, instead of `string`. Code that assigns such a field to a `string` still compiles; a type assertion that expects `string` changes to the union.
  - id: psl-date-time-types-are-convenience-types
    summary: |
      In a Prisma 8 schema on PostgreSQL, `DateTime`, `Date` and `Time` are now convenience types that choose an explicit type from their arguments, and their defaults read different values: `DateTime` is a `timestamptz(3)` column read as a JavaScript `Date`, and `Date` and `Time` are read as strings. To keep what a field reads today, and its contract, rename `DateTime` to `TimestamptzTemporal`, `Date` to `DateTemporal` and `Time` to `TimeTemporal`, keeping the arguments: `Time(3)` becomes `TimeTemporal(3)`. A Prisma 7 schema, which has a `datasource` block, and SQLite and MongoDB schemas are not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?(?:DateTime|Date|Time)(?![\w$])'
  - id: ts-date-time-helpers-are-convenience-types
    summary: |
      In a TypeScript contract on PostgreSQL, `type.DateTime(...)`, `type.Date(...)` and `type.Time(...)` are now the convenience types, whose arguments are one object with the keys `as`, `storage` and `precision`, so `type.Time(3)` no longer compiles. To keep what a field reads today, call `type.TimestamptzTemporal(...)`, `type.DateTemporal()` and `type.TimeTemporal(...)` with the same arguments.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:DateTime|Date|Time)\('
  - id: prisma7-schema-reads-dates
    summary: |
      A contract from `prisma7Schema(...)` on PostgreSQL now reads a Prisma 7 `DateTime` field as a JavaScript `Date`, as Prisma 7 did, instead of a string: a plain `DateTime` is `TimestampJsDate(3)` and a `@db.Timestamptz(p)` field is `TimestamptzJsDate(p)`. The columns do not change, but the contract's codecs and storage hash do. Re-emit with `prisma contract emit`, run `prisma db sign`, and change application code that read those fields as strings to read a `Date`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: temporal-type-aliases-on-datetime
    summary: |
      On PostgreSQL, `temporal.CreatedAt` and `temporal.UpdatedAt` are now built on `DateTime`, a `timestamptz(3)` column read as a JavaScript `Date`, instead of a `timestamptz` column read as a `Temporal.Instant`, and the `temporal.CreatedAtString`, `temporal.UpdatedAtString`, `temporal.CreatedAtJsDate` and `temporal.UpdatedAtJsDate` aliases are removed, in PSL and as `type.temporal.*()` in a TypeScript contract. Write the type and the generators instead, as the table in the body shows, to keep each field and its contract.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])temporal\.(?:Created|Updated)At(?:String|JsDate)?(?![\w$])'
  - id: date-default-below-a-millisecond
    summary: |
      On PostgreSQL and MySQL, a column read as a JavaScript `Date` (`DateTime` at its default, `TimestamptzJsDate`, `TimestampJsDate`, MySQL's `DateTime`) now refuses a `@default` with digits below a millisecond, which a `Date` cannot hold, and `prisma contract emit` reports it. Keep the default by changing the field to `DateTime(as: string)` or `DateTime(as: temporal)`, or by writing the default as a `sql` expression.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@default\((?:timestamp(?:tz)?|datetime)`[^`]*\.\d{3}\d*[1-9]'
  - id: date-now-takes-column-precision
    summary: |
      On PostgreSQL, the `now` generator of a timestamp column read as a JavaScript `Date` (`DateTime`, `TimestamptzJsDate`, `TimestampJsDate`, `temporal.CreatedAt` and `temporal.UpdatedAt`) or as a `Temporal` value (`DateTime(as: temporal)`, `TimestamptzTemporal`, `TimestampTemporal` and `TimestampInstant`) now takes the column's precision and rounds the time down to it, so the value the client holds is the value PostgreSQL stores. A `timestamp(0)` column no longer gets a time PostgreSQL rounds up to the next second. The generator's precision is in the contract's execution section, so re-emit with `prisma contract emit` and commit `contract.json` and `contract.d.ts`; only the execution hash changes, so there is no migration and no `prisma db sign`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bprisma7Schema\s*\('
        - '@on(?:Create|Update)\(now\(\)\)'
        - '(?<![\w$])temporal\.(?:Created|Updated)At(?![\w$])'
        - '(?<![\w$])temporal\.timestamp(?:tz(?:JsDate)?)?\s*\('
        - '(?<![\w$])gen\.now\(\)'
  - id: contract-emit-pins-pack-files
    summary: |
      `prisma contract emit` now writes each composed extension pack's files under `migrations/<space-id>/` (the pack's head ref, its contract snapshot and its migrations), as `migration plan` already did. Re-run `prisma contract emit` and commit what it writes under `migrations/`. A project that composes a pack and never ran `migration plan` gains those files; `prisma db sign` needs them.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - 'extensions\s*:\s*\[\s*[^\]\s]'
  - id: packs-declare-their-postgres-extension
    summary: |
      The pgvector, PostGIS and ParadeDB packs now declare their Postgres extension (`vector`, `postgis`, `pg_search`) in their contract, and their head ref no longer requires the `pgvector:install-vector-v1`, `postgis:install-postgis-v1` or `paradedb:install-pg-search-v1` invariant. After `prisma contract emit` moves `migrations/<space-id>/` to the new head, run `prisma db migrate` on each database: one migration moves the pack's space from its old head and creates the extension only if it is missing. A database that has the extension and no pack marker can instead be adopted with `prisma db sign`.
    detection:
      glob: "**/migrations/*/refs/head.json"
      matches:
        - '(?:pgvector:install-vector|postgis:install-postgis|paradedb:install-pg-search)-v1'
  - id: mongo-merged-redundant-indexes
    summary: |
      Every MongoDB contract source now merges identical and redundant indexes in a collection. Identical indexes, which TypeScript and PSL refused before (`CONTRACT.NAME_DUPLICATE`, `PSL_INVALID_INDEX`), become one index. So do two indexes that differ only in an option set to `false`, such as `{ unique: false }` beside the same index without it. A unique and a plain index on the same keys, such as `@unique` and `@@index` on one field, become one unique index. Before, a TypeScript or PSL contract held both indexes of such a pair, and the migration that created them failed. No source change is needed. Run `prisma contract emit`; a contract that held such a pair gets a new storage hash. Delete a migration planned earlier that creates both indexes, and plan it again.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*\n\s*(\w+)\s[^\n]*@unique\b(?!\()[\s\S]*@@index\(\[\1\]\)'
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*@@unique\((\[[^\]]*\])\)[\s\S]*@@index\(\1\)'
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*@@index\((\[[^\]]*\])\)[\s\S]*@@unique\(\1\)'
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bindex\(\s*(\{[^}]*\})\s*,\s*\{\s*unique\s*:\s*true\s*\}\s*\)[\s\S]*\bindex\(\s*\1\s*\)'
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bindex\(\s*(\{[^}]*\})\s*\)[\s\S]*\bindex\(\s*\1\s*,\s*\{\s*unique\s*:\s*true\s*\}\s*\)'
  - id: mongo-driver-from-runtime-descriptor
    summary: |
      `createMongoDriver` and `MongoDriverImpl` are no longer exported. `@prisma/orm-mongo/driver` and `@prisma/orm-target-mongo/driver` now export what `driver/control` and `driver/runtime` export, as the Postgres packages do. Create a runtime driver from the descriptor that `@prisma/orm-mongo/driver/runtime` exports by default, then connect it. The detection matches files that name `createMongoDriver` or `MongoDriverImpl`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])(?:createMongoDriver|MongoDriverImpl)(?![\w$])'
  - id: mongo-query-takes-context
    summary: |
      `mongoQuery({ contract })` from `@prisma/orm-mongo/query-builder` no longer compiles: `mongoQuery` takes `{ context }`, an execution context. Replace `mongoQuery({ contract })` with `mongoStatic({ contract }).query` from `@prisma/orm-mongo/static`, or with `db.query` when you have a client from `mongo({ contract })`. Both validate the contract once. The detection matches files that call `mongoQuery` with a `contract` option, import it under another name, or call it through a namespace import.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongoQuery\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoQuery\s+as\s+[\w$]+'
        - '(?<![\s\S])(?=[\s\S]*\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*[\x27\x22](?:@prisma/orm-(?:family-)?mongo/query-builder|@internal/mongo-query-builder)[\x27\x22])[\s\S]*(?<![\w$.])\1\s*\.\s*mongoQuery\s*\('
  - id: mongo-orm-takes-context
    summary: |
      `mongoOrm()` takes `{ context, runtime }`, as the SQL `orm({ context, runtime })` does: pass the execution context instead of the contract, rename `executor` to `runtime`, and drop `enums` and `mutationDefaults`, which the ORM now reads from the context. `mongoRaw()` takes `{ context }` instead of `{ contract }`. `createMongoCollection()` takes `({ context, runtime }, modelName)`. The `MongoOrmEnums` type and the error code `ORM.MUTATION_DEFAULTS_MISSING` are gone. Use `db.orm` and `db.raw` from `mongo({ contract })`, or `mongoStatic({ contract }).raw`. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, call `mongoOrm` with `executor` or `enums`, call `createMongoCollection` without a context object, pass `mutationDefaults`, or name `MongoOrmEnums` or `ORM.MUTATION_DEFAULTS_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongo(?:Orm|Raw)\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoOrm\s*(?:<[^>()]*>)?\s*\(\s*\{(?:[^{}]|\{[^{}]*\})*\b(?:executor|enums)\b'
        - '(?<![\w$.])createMongoCollection\s*(?:<[^>()]*>)?\s*\(\s*(?!\{)'
        - '(?<![\w$])mutationDefaults\s*:'
        - '(?<![\w$])MongoOrmEnums(?![\w$])'
        - 'MUTATION_DEFAULTS_MISSING'
  - id: mongo-runtime-takes-adapter
    summary: |
      `createMongoRuntime()` takes `{ context, adapter, driver }`, as the SQL runtime does: create the adapter with `stack.adapter.create(stack)` and pass it beside the context. The runtime reads the target from `context.contract.target`, so build the context over the validated contract. `MongoExecutionContext` no longer has a `stack` member or a second type parameter, and its contract must be a MongoDB contract, as SQL's `ExecutionContext` requires a SQL contract: write `MongoExecutionContext<Contract>`, and build it with `createMongoExecutionContext({ contract, stack })` over a validated contract. `createMongoExecutionStack()` still takes an optional `driver`; given one, it returns `MongoExecutionStackWithDriver`, whose `driver` is always set, and without one it returns `MongoExecutionStack`, which has no `driver` member, as for SQL. `buildMongoEnums()` is removed: read the contract's enum accessors from `db.enums`, from `mongo({ contract })` or `mongoStatic({ contract })`. `MongoExecutionContext` has no `enums` member. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments or a non-contract type argument, or name `buildMongoEnums` or `MongoEnumAccessors`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])createMongoRuntime\s*\('
        - '(?<![\w$])[\w$]*[cC]ontext\s*\.\s*stack(?![\w$])'
        - '(?<![\w$])MongoExecutionContext\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*,'
        - '(?<![\w$])MongoExecutionContext\s*<\s*(?:unknown|\{)'
        - '(?<![\w$.])(?:buildMongoEnums|MongoEnumAccessors)(?![\w$])'
  - id: client-connect-safe-to-call-again
    summary: |
      `connect()` without options on a `postgres()`, `sqlite()`, `mysql()` or `mongo()` client no longer rejects when the client is connecting or connected. It waits for the connection and resolves with the runtime. `connect(options)` on such a client still rejects with `DRIVER.ALREADY_CONNECTED`, but its message is now `<Target> client is already bound` (for example `Postgres client is already bound`), it has a `why`, and its `fix` changed. Remove code that catches `DRIVER.ALREADY_CONNECTED` from a `connect()` without options, or that avoids calling `connect()` after a query: neither is needed. Update code or tests that match the old message `<Target> client already connected` or the old `fix` "Call connect() at most once per client.". A `connect()` that is waiting when `close()` is called now rejects with `DRIVER.NOT_CONNECTED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'DRIVER\.ALREADY_CONNECTED'
        - '(?:Postgres|SQLite|MySQL|Mongo) client already connected'
        - 'Call connect\(\) at most once per client'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.22. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.21"'
---

# 8.0.0-rc.21 → 8.0.0-rc.22 — User upgrade instructions

## Order of the steps

Do the steps in this order, and skip a step that does not apply to the project:

1. Upgrade the Prisma packages, and check that one copy of Prisma ORM is installed (`one-orm-version`).
2. If a `contract.json` keeps `valueObjects` in its domain plane, run the colocated script and sign each database before anything re-emits the contract (`value-objects-in-storage`, steps up to and including "Sign each database").
3. Change a PostgreSQL contract source. First rename every `DateTime`, `Date` and `Time` field type, and `type.DateTime(...)`, `type.Date(...)` and `type.Time(...)`, to the explicit type it stood for (`psl-date-time-types-are-convenience-types`, `ts-date-time-helpers-are-convenience-types`). Then rewrite each `temporal.CreatedAt`, `temporal.UpdatedAt` and removed `temporal.*` alias from its table (`temporal-type-aliases-on-datetime`). Do the renames first: the alias table writes `DateTime(as: ...)`, which is already the new convenience type and must not be renamed again. Then fix a default the new `Date` fields refuse (`date-default-below-a-millisecond`).
4. Change MongoDB application code: create the driver from its descriptor (`mongo-driver-from-runtime-descriptor`), and pass an execution context to the query builder, raw lane, ORM and runtime (`mongo-query-takes-context`, `mongo-orm-takes-context`, `mongo-runtime-takes-adapter`).
5. Run `prisma contract emit` and commit what it writes, including the files under `migrations/` (this also covers `contract-emit-pins-pack-files`, `date-now-takes-column-precision`, `mongo-merged-redundant-indexes` and `contract-artifacts-restamp`).
6. Bring each database up to date: run `prisma db migrate` for a pgvector, PostGIS or ParadeDB pack (`packs-declare-their-postgres-extension`); run `prisma db sign` for a project that reads a Prisma 7 schema (`prisma7-schema-reads-dates`); on MongoDB, replace a planned migration that creates two indexes now merged (`mongo-merged-redundant-indexes`); on PostgreSQL, plan and apply the value object checks (`postgres-value-object-checks`).
7. Change the remaining application code: read a Prisma 7 `DateTime` field as a `Date` (`prisma7-schema-reads-dates`), drop handlers for a repeated `connect()` (`client-connect-safe-to-call-again`), and update value object and discriminator types (`value-object-types-from-storage`, `discriminator-typed-by-variant-values`).


## One version of Prisma ORM

Commands and clients now refuse to start when Prisma ORM is loaded from more than one folder. Before, a project with mismatched versions could fail later with an internal error, for example on the first literal `@default` in `prisma contract emit`.

After upgrading, check that one copy is installed:

1. Every `@prisma/orm-*` entry in `package.json` other than `@prisma/orm-extension-*` names the same version. Extensions carry their own version; each one must depend on that same version of Prisma ORM.
2. The `prisma` CLI runs that version. `npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework` lists every copy and the package that brought it.

If more than one version is listed, align the versions and reinstall. If every copy is the same version, delete `node_modules` and the lockfile and reinstall. With pnpm, copies of one version can also differ by their peer dependencies: `pnpm why @prisma/orm-framework` shows the difference, and giving every dependent the same peer leaves one copy.


## Value objects are storage entities

### `value-objects-in-storage`

Before you upgrade, apply every pending migration to each database (development, staging, production) with the release you are upgrading from, so each database is at the last migration. Then commit your work, so the script's changes can be reviewed and undone with git. Then upgrade the Prisma packages to this release. Run the script before you re-emit the contract: `prisma db sign` must see the contract the database was created from before a re-emit adds the new checks. Run it from the project root:

```sh
node <path-to-this-guide>/scripts/value-objects-in-storage/value-objects-in-storage.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL or MongoDB contract keeping value objects in the domain plane, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. In each contract it:

- moves each value object from `domain.namespaces.<ns>.valueObjects` to `storage.namespaces.<ns>.entries.valueObject`;
- writes each field that holds a value object as `{ kind: 'valueObject', plane: 'storage', namespaceId, entityKind: 'valueObject', entityName }` instead of `{ kind: 'valueObject', name }`;
- points a value object member typed by an enum at the enum's storage value set (`plane: 'storage'`, `entityKind: 'valueSet'`);
- on SQL, writes the value set of each discriminator, keyed `<Base>.<field>` in the base table's namespace and holding the variants' values, sorted, and points the discriminator column at it. A column an enum types keeps the enum's value set.

Storage now holds the value objects, so each contract it rewrites has a new storage hash. The script renames each snapshot directory to the new hash and rewrites every `migration.json` (with its `migrationHash`), ref, `migration.ts` and `contract.d.ts` that names an old one. It does not add the PostgreSQL checks described in `postgres-value-object-checks`: a snapshot records what its migrations created, and none created those checks.

When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project already in the new form is left unchanged, and the script says that nothing changed. It changes no file and exits 1 when a file it must read is not valid JSON, when a contract's stored hash does not match its content, when a field holds a value object the contract does not declare, when a member's enum has no storage value set, when a discriminator's value set name is already taken by an enum, when a renamed snapshot directory already exists with different content, or when it cannot read a directory under the root. If it stops on an error partway, for example on a full disk, run it again: it finishes the upgrade.

The script rewrites a snapshot's `contract.d.ts` for the moved value objects. In every `contract.d.ts` it finds, including those of contracts without value objects, it also passes the storage namespaces to `FieldTypesFromDomain`, which now requires them. It does not add the types of the discriminator value sets. Nothing reads them from a snapshot: a `migration.ts` that imports a snapshot's `contract.d.ts` compiles without them, and `prisma contract emit` writes them for the emitted contract.

Then:

1. Sign each database (development, staging, production) with the rewritten contract, before you re-emit: `prisma db sign --db "$DATABASE_URL"`. Its marker still holds the old storage hash, so until it is signed `prisma db migrate` refuses with `MIGRATION.MARKER_MISMATCH` and `prisma db verify` with `CONTRACT.MARKER_MISMATCH`. This works for a database at the last migration. It also points your local `db` ref at the rewritten contract, writing the ref if the project had none; `prisma migration plan` starts from that ref.
2. Re-emit the contract: `prisma contract emit`.
3. On PostgreSQL, plan the migration that adds the new checks with `prisma migration plan`, and apply it to each database with `prisma db migrate --advance-ref db --db "$DATABASE_URL"`, as `postgres-value-object-checks` describes. `--advance-ref db` moves the `db` ref to the new contract. Without it the ref stays at the contract of step 1, and the next `prisma migration plan` starts from there and writes a second migration that adds the same checks. On MongoDB there is nothing to plan: the collection validators do not change.

A database you could not migrate before the upgrade is behind the last migration, and `prisma db sign --db "$DATABASE_URL"` fails on it with `CONTRACT.SCHEMA_VERIFICATION_FAILED`, because it signs against the last contract. Do not follow its advice to run `prisma db update`: that skips the pending migrations. Instead, sign the database at the new hash of the hash its marker holds, then migrate it:

```sh
prisma db sign --contract <new hash> --no-advance-ref --db "$DATABASE_URL"
prisma db migrate --db "$DATABASE_URL"
prisma db verify --strict --db "$DATABASE_URL"
```

Find the new hash in the script's output: the marker holds the `<old>` hash of one `<old> -> <new>` line. `--no-advance-ref` leaves your local `db` ref where it is.

### `value-object-types-from-storage`

```ts
// before
import type { ValueObjectTypesFromDomain } from '@prisma/orm-mongo/contract/types';
type Outputs = ValueObjectTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, never, {}, 'output'>;

// after
import type { ValueObjectTypesFromStorage } from '@prisma/orm-mongo/contract/types';
type Outputs = ValueObjectTypesFromStorage<Contract['storage']['namespaces'], CodecTypes, never, {}, 'output'>;
```

### `postgres-value-object-checks`

For each column that holds a value object, the contract derives a check named `<table>_<column>_shape_<hash>`. It accepts a JSON object with every required member, each of its JSON type, no other key, and for a list column an array of such objects; a nullable column also accepts SQL `NULL` and JSON `null`. For each discriminator column it derives `<table>_<column>_check_<hash>`, which accepts only the variants' values. A table whose control policy is not managed gets neither check.

After you re-emit the contract, `prisma migration plan` writes a migration that adds the checks. It starts from the `db` ref that `prisma db sign` wrote. Its DDL preview prints each check's expression. Before you run `prisma db migrate`, find the rows that would fail by selecting the rows where the expression is not true, for example:

```sql
SELECT id, address FROM "public"."user"
WHERE NOT ("address" IS NULL OR jsonb_path_match("address", 'strict … ') IS TRUE);

SELECT id, type FROM "public"."task" WHERE NOT ("type" IN ('bug', 'feature'));
```

Adding a check takes a lock on the table while Postgres reads every row to check it. Any later change to a value object renames the check, so the check is dropped and added again, and the rows are read again. Apply the migration when the table can wait for that read.

Copy the expression from the preview between `CHECK (` and the closing `)`. Fix or delete each row the query returns, for example by removing the extra keys with `UPDATE "public"."user" SET address = address - 'extra' WHERE address ? 'extra'`, then apply the migration with `prisma db migrate --advance-ref db`. A migration that fails on a row changes nothing, and the error names the check, its table and column, and the query that finds the rows; fix the rows and run `prisma db migrate --advance-ref db` again.

### `discriminator-typed-by-variant-values`

```ts
// before
expectTypeOf(task.type).toEqualTypeOf<string>();

// after
expectTypeOf(task.type).toEqualTypeOf<'bug' | 'feature'>();
```


## `DateTime`, `Date` and `Time` are convenience types on PostgreSQL

On PostgreSQL, Prisma 8 has two layers of date and time types. The explicit types name the column type and the kind of value the application reads, such as `TimestamptzTemporal` or `DateString`. The convenience types `DateTime`, `Date`, `Time` and the new `Duration` are named for what a field means, and each becomes one explicit type, chosen by its optional `as` and `storage` arguments. Their defaults need no `Temporal` polyfill:

| Written | Becomes | Column | The application reads |
| --- | --- | --- | --- |
| `DateTime` | `TimestamptzJsDate(3)` | `timestamptz(3)` | a JavaScript `Date` |
| `Date` | `DateString` | `date` | a string, such as `"2024-02-29"` |
| `Time` | `TimeString` | `time` | a string, such as `"09:30:00"` |
| `Duration` | `IntervalString` | `interval` | an ISO 8601 duration, such as `"P1M"` |

Until this release, `DateTime`, `Date` and `Time` were explicit types that read `Temporal.Instant`, `Temporal.PlainDate` and `Temporal.PlainTime`. A schema that keeps those names now reads other values, and its contract changes.

### `psl-date-time-types-are-convenience-types`

To keep each field as it is, rename its type, keeping its arguments and attributes:

| Before | After |
| --- | --- |
| `DateTime` | `TimestamptzTemporal` |
| `Date` | `DateTemporal` |
| `Time(p?)` | `TimeTemporal(p?)` |

```prisma
model Event {
  id      Int                 @id
  at      TimestamptzTemporal // was DateTime
  day     DateTemporal        // was Date
  opensAt TimeTemporal(0)     // was Time(0)
}
```

A field written as `DateTime(as: ...)`, `Date(as: ...)` or `Time(as: ...)` already uses the convenience type, for example one the `temporal-type-aliases-on-datetime` table wrote; leave it as it is. The detection cannot tell which target a schema is for, so it also matches SQLite's and MySQL's `DateTime` and MongoDB's `Date`. A match in a project whose `prisma.config.ts` uses the SQLite, MySQL or MongoDB target needs no change: on those targets the names keep their meaning.

A type alias written with one of the names, such as `types { Stamp = DateTime @onCreate(now()) }`, is renamed the same way. Rename only field types and alias types in Prisma 8 schemas whose config uses the PostgreSQL target, including the `contract.prisma` copies in migration folders; leave a model or field named `Date`, comments, and Prisma 7 schemas as they are. Re-emit the contract with `prisma contract emit`: it is byte for byte the same as before.

To move a field to the new defaults instead, keep the name, update the application code that reads the field, and run `prisma contract emit`. What the database needs then depends on the type:

- **`Date` and `Time`** keep their `date` and `time(p)` columns, when a precision is written by name (`Time(precision: 0)` for `Time(0)`), and change only the codec, so the database does not change, but the contract hash does.
  - With migrations: `prisma migration plan` writes a migration with no operations, then `prisma db migrate` applies it and moves the marker.
  - With `prisma db update`: run it. It applies no operations and records the new contract on the database.
- **`DateTime`** makes the column `timestamptz(3)`, and a schema that wrote `DateTime` before had a `timestamptz` column, which holds microseconds. Lowering the precision rounds stored values to milliseconds, so both commands ask before they change it. Run `prisma migration plan --delete <Model>.<field>` and then `prisma db migrate`, or `prisma db update --delete <Model>.<field>`, which accepts the rounding. A JavaScript `Date` holds milliseconds only, so to keep microseconds, keep the `Temporal.Instant` field: write `DateTime(as: temporal)`, which is exactly `TimestamptzTemporal`.

### `ts-date-time-helpers-are-convenience-types`

Rename only in contracts on PostgreSQL; `type.DateTime(...)` in a SQLite or MySQL contract keeps its meaning.

```ts
field.column(type.TimestamptzTemporal()); // was type.DateTime()
field.column(type.DateTemporal()); // was type.Date()
field.column(type.TimeTemporal(3)); // was type.Time(3)
```


## The tools write the convenience date and time types

### `prisma7-schema-reads-dates`

`prisma7Schema(...)` reads each Prisma 7 date and time field as the type the convenience default gives for its column:

| Prisma 7 field | Prisma 8 type | The application reads |
| --- | --- | --- |
| `DateTime` | `TimestampJsDate(3)`, printed `DateTime(storage: timestamp)` | a JavaScript `Date`, the stored value read as UTC |
| `@db.Timestamptz(p)` | `TimestamptzJsDate(p)`, printed `DateTime(precision: p)` | a JavaScript `Date` |
| `@db.Timestamp(p)` | `TimestampJsDate(p)` | a JavaScript `Date`, the stored value read as UTC |
| `@db.Date` | `DateString` | an ISO 8601 string, such as `2026-09-14`, the same text as before |
| `@db.Time(p)` | `TimeString(p)` | an ISO 8601 string, such as `10:00:00.5`, the same text as before |
| `@db.Timetz(p)` | `Timetz(p)` | an ISO 8601 string with a full offset, such as `10:00:00+02:00`, or `10:00:00Z` for UTC; it was `10:00:00+02` and `10:00:00+00` |

Before this release the first three read strings, such as `2026-09-14 10:00:00.123`. `@updatedAt` and `@default(now())` now write a `Date` for these fields. The three string types read ISO 8601 since 8.0.0-rc.21, whatever the contract source. The `iso-string-date-time-values` change in the 8.0.0-rc.20 → 8.0.0-rc.21 guide gives every form that changes, such as a date before year 1, and how to update code that reads them.

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`:

1. Run `prisma contract emit` and commit the new `contract.json` and `contract.d.ts`. The storage hash changes, because the columns' codecs change; the columns themselves do not.
2. Run `prisma db sign` against each database, so its marker records the new contract. Commit the snapshot and the `db` ref it writes under `migrations/`, replacing the previous ones.
3. Change code that read a `DateTime` or `@db.Timestamptz` field as a string. It now gets a `Date`, and a write takes a `Date`:

   ```ts
   // before: user.updatedAt was "2026-09-14 10:00:00.123"
   console.log(user.updatedAt.replace(' ', 'T'));
   // after: user.updatedAt is a Date
   console.log(user.updatedAt.toISOString());
   ```

A `Date` holds milliseconds. A `@db.Timestamptz(6)` or `@db.Timestamp(6)` column with values that use the extra digits reads with them dropped. To keep them, write the Prisma 8 schema yourself with `DateTime(as: string)` or `DateTime(as: temporal)` for that field.

A `Date` cannot hold `infinity` or `-infinity` either. A row that stores one now fails to read with `RUNTIME.DECODE_FAILED`, where it read as the string `infinity` before. For a column that can hold them, write the Prisma 8 schema yourself with `DateTime(as: string, storage: timestamp, precision: 3)` for that field; `DateTime(as: temporal)` cannot hold them either.

### `temporal-type-aliases-on-datetime`

`temporal.CreatedAt` is now `DateTime @onCreate(now())` and `temporal.UpdatedAt` is `DateTime @onCreate(now()) @onUpdate(now())`, a `timestamptz(3)` column read as a JavaScript `Date`. To keep each field exactly as it is, and its contract, write the type and the generators the alias stood for:

| Before | After, in PSL |
| --- | --- |
| `temporal.CreatedAt` | `DateTime(as: temporal) @onCreate(now())` |
| `temporal.UpdatedAt` | `DateTime(as: temporal) @onCreate(now()) @onUpdate(now())` |
| `temporal.CreatedAtString` | `DateTime(as: string) @onCreate(now())` |
| `temporal.UpdatedAtString` | `DateTime(as: string) @onCreate(now()) @onUpdate(now())` |
| `temporal.CreatedAtJsDate` | `TimestamptzJsDate @onCreate(now())` |
| `temporal.UpdatedAtJsDate` | `TimestamptzJsDate @onCreate(now()) @onUpdate(now())` |

`DateTime(as: temporal)` is exactly `TimestamptzTemporal`, and `DateTime(as: string)` exactly `TimestamptzString`; either form gives the same contract. `TimestamptzJsDate` keeps its explicit name, because `DateTime` gives `TimestamptzJsDate(3)`, which stores a precision the alias did not.

In a TypeScript contract, `field.column(type.temporal.CreatedAtString())` becomes `field.column(type.DateTime({ as: 'string' })).onCreate(gen.now())`, adding `.onUpdate(gen.now())` for an `UpdatedAt` alias, with `gen` taken from the `defineContract` callback beside `field` and `type`. Do the same for each alias in the table. Re-emit with `prisma contract emit`: the contract is the same as before.

To move a `temporal.CreatedAt` or `temporal.UpdatedAt` field to the new default instead, keep the alias and update the code that reads it to a `Date`. Its column becomes `timestamptz(3)`, which rounds stored values to milliseconds, so plan it with `prisma migration plan --delete <Model>.<field>` and apply it with `prisma db migrate`, or run `prisma db update --delete <Model>.<field>`.

If you followed the 8.0.0-rc.20 → 8.0.0-rc.21 guide's `remove-field-presets` change, a field it rewrote from `temporal.createdAt()` or `temporal.updatedAt()` to `temporal.CreatedAt` or `temporal.UpdatedAt` is such a field: write it from the table above to keep its contract.

The detection also matches `temporal.CreatedAt` and `temporal.UpdatedAt` in SQLite and MongoDB projects. There they keep their meaning and need no change.

### `date-default-below-a-millisecond`

A JavaScript `Date` holds milliseconds. A column read as a `Date` now refuses a default with more digits, instead of storing it and reading it back at the millisecond. For a field such as

```prisma
at DateTime(precision: 6) @default(timestamptz`2024-01-01T01:00:00.123456Z`)
```

write one of:

```prisma
at DateTime(as: string, precision: 6) @default(timestamptz`2024-01-01T01:00:00.123456Z`)
at DateTime(precision: 6) @default(sql`'2024-01-01 01:00:00.123456+00'::timestamptz`)
```

The first reads the field as a string, which keeps every digit. The second keeps the field a `Date` and the database default as written. Run `prisma contract emit` again. A Prisma 7 schema read by `prisma7Schema(...)` needs no change: such a default is kept as the SQL Prisma 7 created.

### `date-now-takes-column-precision`

A JavaScript `Date` holds milliseconds. On a column with fewer fraction digits, such as a Prisma 7 `@db.Timestamp(0) @updatedAt` field, the client used to generate a time such as `10:00:00.700` and PostgreSQL stored `10:00:01`, so the value a create returned before a read differed from the stored one. The `now` generator of a column read as a `Date`, such as `TimestamptzJsDate(0) @onCreate(now())`, now receives the column's precision, as the string and time generators already do, and writes `10:00:00`. The same holds for a timestamp column read as a `Temporal` value, such as `TimestamptzTemporal(0) @onCreate(now())` or `TimestampInstant(0) @onCreate(now())`: its `instantNow` or `plainDateTimeNow` generator now receives the precision too. Before, such a column stored `10:00:01`, a time after the write, and at `23:59:59.700` the next day's date.

The contract records the precision beside the generator, for example `{ "kind": "generator", "id": "timestampNow", "params": { "precision": 3 } }`. For each project with such a field, including every project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit` and commit the new `contract.json` and `contract.d.ts`. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`. SQLite and MongoDB contracts do not change.


## Extension packs declare their Postgres extension

Re-run `prisma contract emit` and commit the files it writes under `migrations/`. For pgvector, PostGIS and ParadeDB this moves `migrations/<space-id>/refs/head.json` to a head with no invariants and adds two migrations to `migrations/<space-id>/`: one from the pack's old head and one from the empty contract.

Then bring each database to the new head:

```bash
prisma db migrate
```

On a database the old install migration already ran on, the extension is installed, so the new migration only moves the pack's marker.


## MongoDB merges identical and redundant indexes

Two indexes in one collection are identical when they have the same keys and the same options, counting an option set to `false` as unset. A plain index is redundant beside a unique index that is otherwise identical. The contract keeps the unique index, or the first of two identical ones, where it was written:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique

  @@index([email])
}
```

This now gives one unique index on `{ email: 1 }`. Indexes on the same keys with a different collation, partial filter or other option stay separate.

### `mongo-merged-redundant-indexes`

The detection matches a MongoDB schema or `defineContract` file that writes a unique and a plain index on the same keys. Identical indexes are not matched: the contract builder refused them before, so no working project has them.

1. Run `prisma contract emit`. If the storage hash changed, the contract held two indexes on the same keys that are now one: a unique and a plain index, or two indexes that differ only in an option set to `false`, such as `{ unique: false }` or `{ sparse: false }` beside the same index without it.
2. For a TypeScript or PSL contract, a migration planned before this upgrade that creates both indexes of such a pair never applied: its second `createIndex` fails with `MIGRATION.PRECHECK_FAILED`. Delete it and run `prisma migration plan` again.
3. If `prisma migration apply` stopped part way on that migration, what it created is still in the database:
   - If that migration also created the collection, for example the first migration of a new model, the new migration stops again at `collection.<Name>.create`, because creating a collection is never skipped. Drop it in `mongosh` (`db.User.drop()`) and apply the new migration. It creates the collection and the unique index. The collection is new, so it holds data only if something wrote to it after the failed apply. To keep that data, first find documents that share a value the unique index will refuse: `db.User.aggregate([{ $group: { _id: "$email", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])`. Change or remove them until that returns nothing. Then export the collection (`mongodump --uri "$DATABASE_URL" --collection User --out backup`), drop it, apply the new migration, and load the data back (`mongorestore --uri "$DATABASE_URL" --noIndexRestore --stopOnError backup`). `--noIndexRestore` keeps the plain index the failed migration created out of the collection. `--stopOnError` makes `mongorestore` stop instead of skipping a document the unique index refuses.
   - If the collection existed before and the index created first is the unique one, do nothing. The new migration finds it and skips creating it.
   - If the collection existed before and the index created first is the plain one, drop it before you apply the new migration, or its `createIndex` fails again with `MIGRATION.PRECHECK_FAILED`. This happens when the plain index was written first, for example `index({ email: 1 })` before `index({ email: 1 }, { unique: true })`, or `@@index([email])` on a model before `email String @unique` on a later model in the same collection. In `mongosh`, drop it by its key pattern, so its name does not matter: `db.User.dropIndex({ email: 1 })`.

In the `mongosh` commands above, replace `User` with your collection's name. It is the model name unless `@@map` changes it.


## Create a Mongo runtime driver from its descriptor

Put the descriptor on the execution stack, create the driver from the stack, and connect it to a binding. A `{ kind: 'url', url, dbName }` binding makes the driver open a `MongoClient` and close it on `close()`. A `{ kind: 'mongoClient', client, dbName }` binding uses your client and leaves it open.

```ts
// Before
import { createMongoDriver } from '@prisma/orm-mongo/driver';

const stack = createMongoExecutionStack({ target: mongoRuntimeTarget, adapter: mongoRuntimeAdapter });
const driver = await createMongoDriver(url, dbName);

// After
import mongoRuntimeDriver from '@prisma/orm-mongo/driver/runtime';

const stack = createMongoExecutionStack({
  target: mongoRuntimeTarget,
  adapter: mongoRuntimeAdapter,
  driver: mongoRuntimeDriver,
});
const driver = stack.driver.create();
await driver.connect({ kind: 'url', url, dbName });
```

Replace `MongoDriverImpl.fromDb(client.db(dbName))` with `driver.connect({ kind: 'mongoClient', client, dbName })` on a driver created the same way. Code that only sends DDL through a control adapter can use the control driver instead: `await mongoControlDriver.create(url)`, with `mongoControlDriver` the default export of `@prisma/orm-mongo/driver/control`. The control driver uses the database the URL names, so put `dbName` in the URL's path, for example `mongodb://localhost:27017/app`.

`createMongoRuntime(...)` closes the driver when the runtime closes, so keep calling `runtime.close()` and drop any separate `driver.close()`.


## The MongoDB query surfaces and runtime take an execution context

`mongoQuery`, `mongoRaw` and `mongoOrm` take `{ context }`, a MongoDB execution context, instead of `{ contract }`, as `sql({ context })` and the SQL ORM do. The context comes from `mongoStatic({ contract })` or `mongo({ contract })`, which validate the contract once.

```ts
// Before
import { mongoQuery } from '@prisma/orm-mongo/query-builder';
const query = mongoQuery({ contract });
const raw = mongoRaw({ contract });

// After
import mongoStatic from '@prisma/orm-mongo/static';
const { query, raw } = mongoStatic({ contract });

// Or, with a client
const db = mongo({ contract, url });
db.query.from('orders');
```

Code that builds the ORM itself passes the context, which also fills generated fields:

```ts
// Before
const orm = mongoOrm({ contract, executor, mutationDefaults: context, enums });
const users = createMongoCollection(contract, 'User', executor, enums, context);

// After, as the SQL orm({ context, runtime })
const orm = mongoOrm({ context, runtime: executor });
const users = createMongoCollection({ context, runtime: executor }, 'User');
```

The runtime takes an adapter beside the context, as the SQL runtime does, and reads the target from the context's contract:

```ts
// Before
const runtime = createMongoRuntime({ context, stack, driver });

// After
const stack = createMongoExecutionStack({ target, adapter });
const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
```

`MongoExecutionContext` takes one type parameter, a MongoDB contract: `MongoExecutionContext<Contract>`.


## `connect()` on a client is safe to call again

```ts
// Before
await db.orm.public.User.first();
await db.connect(); // rejected with DRIVER.ALREADY_CONNECTED

// After
await db.orm.public.User.first();
await db.connect(); // resolves with the same runtime
await db.connect({ url: other }); // rejects: "Postgres client is already bound"
```

A handler that only guarded a `connect()` without options can go:

```ts
// Before
await db.connect().catch((error) => {
  if (error.code !== 'DRIVER.ALREADY_CONNECTED') throw error;
});

// After
await db.connect();
```

Keep a handler that guards `connect(options)`: that call still rejects with `DRIVER.ALREADY_CONNECTED` on a bound client. Replace an assertion on the old message with the new one:

```ts
// Before
await expect(db.connect({ url })).rejects.toThrow('Postgres client already connected');

// After
await expect(db.connect({ url })).rejects.toThrow('Postgres client is already bound');
```

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.22`; any other difference in the emitted files comes from an earlier entry in this guide.
