---
from: "8.0.0-rc.22"
to: "8.0.0-rc.23"
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-mysql
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-mysql` and `@prisma/orm-target-mysql`. The MySQL control plane, such as the `prisma` commands, imports it, because MySQL now has the convenience date and time types, and `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mysql@"
        - "@prisma/orm-target-mysql@"
      anyMatch: true
  - id: mysql-datetime-writes-are-checked
    summary: |
      A MySQL `DateTime` field now refuses to write a year before 1000 or after 9999 with `RUNTIME.ENCODE_FAILED`, before the value reaches MySQL. Reads are unchanged, and no migration is needed.
    detection:
      glob: "**/package.json"
      contains:
        - "@prisma/orm-mysql"
        - "@prisma/orm-target-mysql"
      anyMatch: true
  - id: temporal-polyfill-is-a-peer-dependency-of-sqlite
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-sqlite` and `@prisma/orm-target-sqlite`. The SQLite control plane, such as the `prisma` commands and the Vite plugin, imports it, because SQLite now has the convenience date and time types, and `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-sqlite@"
        - "@prisma/orm-target-sqlite@"
      anyMatch: true
  - id: psl-renamed-postgres-scalar-types
    summary: |
      In a Prisma 8 schema on PostgreSQL, `SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real`, `VarChar` and `VarBit` are deprecated and report `PSL_DEPRECATED_SCALAR_NAME` as a warning. Write the convenience call that gives the same type instead: `Int(storage: int2)`, `BigInt(as: number)`, `Decimal(precision: p, scale: s)`, `BigInt(storage: numeric)`, `Float(storage: float4)` and `String(storage: varchar, length: n)`; `VarBit` has no convenience type and becomes `Varbit`. The contract does not change. A Prisma 7 schema, which has a `datasource` block, is not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar|VarBit)(?![\w$])'
  - id: ts-renamed-postgres-scalar-helpers
    summary: |
      In a TypeScript contract on PostgreSQL, `type.SmallInt()`, `type.BigIntNumber()`, `type.Numeric(...)`, `type.UnboundedInt()`, `type.Real()`, `type.VarChar(...)` and `type.VarBit(...)` are deprecated. They still compile and give no warning, and they are removed together with the deprecated schema names. Call the convenience helper that gives the same type instead, such as `type.String({ storage: 'varchar', length: 64 })` for `type.VarChar(64)`, or `type.Varbit(n)` for `type.VarBit(n)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar|VarBit)\('
  - id: ts-renamed-postgres-column-helpers
    summary: |
      The PostgreSQL column helpers `int8Column` and `numericColumn` are renamed to `int8BigIntColumn` and `numericStringColumn`, after the explicit types they give (`Int8BigInt` and `NumericString`). The old names are removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])(?:int8Column|numericColumn)(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
  - id: pack-extension-found-on-search-path
    summary: |
      The pgvector, PostGIS, ParadeDB and citext packs declare their extension in the unbound namespace, so `db sign` and `db verify` accept the extension in any schema on the connection's search path, such as Supabase's `extensions`. Each pack has a new head and one new migration with no operations. A project that composes one of these packs runs `prisma contract emit`, which writes the pack's new migration under `migrations/<pack>/`, and then `prisma db migrate`, which applies it without changing the database.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '@prisma/orm-extension-(pgvector|postgis|paradedb)/control|@prisma/orm-postgres-contrib/citext/control'
  - id: remove-pack-extension-declaration
    summary: |
      An application contract may not declare an extension that a composed pack declares. `contract emit` refuses such a PSL declaration with `PSL_ENTITY_DECLARED_BY_PACK`, and `migration plan` and `db update` refuse it as a conflict. Remove the application's own `extension vector {}`, `extension postgis {}`, `extension pg_search {}` or `extension citext {}` block, or its `extension(...)` handle, when the project composes the pack that declares it.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - 'extension\s+(vector|postgis|pg_search|citext)\s*\{'
        - 'extension\(\s*[''"](vector|postgis|pg_search|citext)[''"]'
  - id: mongo-contracts-record-index-names
    summary: |
      Every index of a MongoDB contract records the name MongoDB stores it under, so every MongoDB contract with an index gets a new storage hash. An index written without a name is named after its keys and directions, such as `email_1`, which is the name earlier releases gave it in the database, so no database changes. A contract without index names is rejected with `CONTRACT.VALIDATION_FAILED`. Run `prisma contract emit`, run the colocated script, which names the indexes of the contract snapshots under `migrations/snapshots/`, then run `prisma db sign` or plan a migration, which has no operations.
    detection:
      glob: "**/*.json"
      matches:
        - '"kind"\s*:\s*"mongo-index"(?!\s*,\s*"name")'
    script: ./scripts/mongo-index-names/mongo-index-names.ts
  - id: mongo-unnamed-indexes-with-one-name-refused
    summary: |
      MongoDB PSL and TypeScript `defineContract` refuse two indexes of one collection that get one name. Two indexes written without a name on the same keys and directions, such as a unique and a plain index on `email`, a sparse and a plain one, or one `@@index([title])` on each of two variants of one base, are both named `email_1` or `title_1`. MongoDB could never hold both under that name, so no migration could create them. PSL reports `PSL_INVALID_INDEX` at the second index and TypeScript throws `CONTRACT.NAME_DUPLICATE`. Name one of them with `map:` in PSL or the index option `name` in TypeScript.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@base\([\s\S]*@@(?:index|unique|textIndex)\('
        - '\bindex\(\s*\{[^}]*\}\s*,\s*\{[^}]*\b(?:sparse|partialFilterExpression|collation|expireAfterSeconds)\b'
  - id: mongo-prisma6-index-names
    summary: |
      A contract read from a Prisma 6 MongoDB schema with `prisma6Schema()` names each index as Prisma 6 named it: by `map:` (or `name:` on `@@index`), otherwise `<collection>_<fields>_key` for a unique index and `_idx` for others, such as `User_email_key`. `db verify` now checks these names against the database. The reader refuses what Prisma 6 refuses: two indexes of one model with one name (`PSL.PRISMA6_MONGO_INDEX_NAME_DUPLICATE`), and an empty `map` or one longer than 127 bytes (`PSL.PRISMA6_MONGO_INDEX_NAME_INVALID`).
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@db\.ObjectId\b)[\s\S]*(?:@unique\b|@@(?:unique|index|fulltext)\()'
  - id: mongo-index-operations-by-name
    summary: |
      A MongoDB migration creates and drops each index by its name. `prisma migration plan` writes the name into `migration.ts`, as in `createIndex("users", [{ field: "email", direction: 1 }], { name: "User_email_key", unique: true })` and `dropIndex("users", [{ field: "email", direction: 1 }], { name: "User_email_key", unique: true })`. The operation id is `index.<collection>.<create|drop>(<name>)`, such as `index.users.create(email_1)`, where it was `index.users.create(email:1)`. A `migration.ts` written by an earlier release keeps working: an index without a name is named after its keys, as before.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,json,sh,yml,yaml}"
      matches:
        - 'index\.[\w$-]+\.(?:create|drop)\([^)]*:'
  - id: mongo-prisma6-indexes-as-prisma6-reads-them
    summary: |
      A Prisma 6 MongoDB schema read by `prisma6Schema()` no longer has its indexes merged. Two indexes of one model with the same fields and the same written sort, of any kind (`@unique`, `@@unique`, `@@index`, `@@fulltext`), are refused with `PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS`, as Prisma 6 refuses them. A unique and a plain index on the same keys that Prisma 6 accepts, such as `@unique` beside `@@index([email(sort: Asc)])`, are both kept, so the contract describes the database Prisma 6 built and gets a new storage hash. Prisma 8 PSL and TypeScript `defineContract` still merge identical and redundant indexes; their contracts do not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@db\.ObjectId\b)[\s\S]*(?:@unique\b|@@(?:unique|index|fulltext)\()'
  - id: mongo-client-takes-extensions
    summary: |
      `mongo()` and `mongoStatic()` from `@prisma/orm-mongo` take an `extensions` option, as `postgres()` does, and refuse a contract that requires an extension pack they are not given, with `RUNTIME.MISSING_EXTENSION_PACK`. A MongoDB project whose `prisma.config.ts` composes extension packs passes each pack's runtime descriptor to `mongo({ extensions })` and `mongoStatic({ extensions })`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-mongo/config)[\s\S]*[{,]\s{0,100}extensions\s{0,20}[:,}]'
  - id: mongo-contract-requires-target
    summary: |
      A MongoDB `contract.json` must have `"target"`, as a SQL contract must. `contractFromJson`, `mongo()` and `mongoStatic()` refuse a contract without it with `CONTRACT.VALIDATION_FAILED`. Every contract `prisma contract emit` writes has it, so only a hand-written or hand-edited contract is affected.
    detection:
      glob: "**/*.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"target"\s*:)[\s\S]*"targetFamily"\s*:\s*"mongo"'
  - id: supabase-one-binding-input
    summary: |
      `supabase()` now checks its database input the way `postgres()` does, when it is called (see the change `postgres-checks-database-input` for the checks both share). Passing both `url` and `pg` rejects with `RUNTIME.BINDING_INVALID`, where `pg` used to win silently; pass only one. An empty `url` used to make `pg` connect with the `PG*` environment variables or to localhost; it now rejects with `RUNTIME.BINDING_INVALID`, so check that the variable you pass as `url` is set. A `url` that cannot be parsed or is not `postgres://` / `postgresql://` also rejects with `RUNTIME.BINDING_INVALID`, instead of failing on the first query. `pg: null` and a `pg` value that is neither a `pg.Pool` nor a `pg.Client` now reject with `RUNTIME.BINDING_INVALID` instead of `SUPABASE.CONFIG_INVALID`. A `pg.Client` still rejects with `SUPABASE.CONFIG_INVALID`, and its message is now "Supabase takes a pg.Pool or a url, not a pg.Client". The `RUNTIME.BINDING_INVALID` errors of `supabase()` list only the inputs it takes (`url`, a `pg.Pool`, `binding: { kind: 'url', url }` or `{ kind: 'pgPool', pool }`) and carry `meta.extension: 'supabase'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*[{A-Za-z_$]'
        - 'The pg option takes a pg\.Pool'
        - 'import\s*\{[^}]*(?<![\w$])supabase\s+as\s+[A-Za-z_$][^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)extension-supabase(?:/[^''"]*)?[''"]'
  - id: postgres-checks-database-input
    summary: |
      `postgres()` and `supabase()` check their database input when they are called and reject a wrong one with `RUNTIME.BINDING_INVALID`, with a message that names the option, a `why` and a `fix`; `meta.receivedType` gives the value's type, never the value. `null` or a value of the wrong type as `pg`, `url` or `binding` (a `pg` or `binding` that is not an object, a `url` that is not a string) rejects; `postgres()` used to throw a `TypeError` with no error code. The check runs before the inputs are counted, so `{ url: null, pg: pool }` fails on `url`, not with "Provide one binding input"; match on the new code, and pass the option only when it has a value. A `binding` object whose `kind` is not `'url'`, `'pgPool'` or `'pgClient'` (for example `{}`, an array or a misspelt kind) rejects; `postgres()` used to accept it and throw a `TypeError` on the first query. A `binding` of kind `'url'` whose `url` is not a string, is empty, cannot be parsed or is not `postgres://` / `postgresql://` rejects; `postgres()` used to pass it to `pg`, and an empty one connected with the `PG*` environment variables or to localhost. A `binding` whose `pool` or `client` is not an object rejects; `postgres()` used to fail on the first query.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])(?:pg|url|binding)\s*:\s*(?:null\b|[^,}\n]*(?:\?|\|\||:)\s*null\b)'
        - '(?<![\w$.])(?:postgres|supabase)(?:<[^>]*>)?\(\s*\{(?:[^()]|\((?:[^()]|\([^()]*\))*\))*?(?<![\w$])binding\s*:\s*\{[^}]*?(?<![\w$])kind\s*:\s*([''"`])(?!(?:url|pgPool|pgClient)\1)[^''"`]*\1'
        - '(?<![\w$.])postgres(?:<[^>]*>)?\(\s*\{(?:[^()]|\((?:[^()]|\([^()]*\))*\))*?(?<![\w$])binding\s*:\s*\{[^}]*?(?<![\w$])kind\s*:\s*([''"`])url\1'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.23. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.22"'
---

# 8.0.0-rc.22 → 8.0.0-rc.23 — User upgrade instructions

## Order of the steps

Do the steps in this order, and skip a step that does not apply to the project:

1. Upgrade the Prisma packages. A project that installs with Yarn and uses MySQL or SQLite adds `temporal-polyfill` to its dependencies (`temporal-polyfill-is-a-peer-dependency-of-mysql`, `temporal-polyfill-is-a-peer-dependency-of-sqlite`).
2. Change the contract sources. On PostgreSQL, rewrite the deprecated scalar type names and helpers (`psl-renamed-postgres-scalar-types`, `ts-renamed-postgres-scalar-helpers`, `ts-renamed-postgres-column-helpers`). Remove the application's own declaration of an extension that a composed pack declares (`remove-pack-extension-declaration`). On MongoDB, name one of two indexes that get one name (`mongo-unnamed-indexes-with-one-name-refused`).
3. Change MongoDB and PostgreSQL application code: pass the extension packs to `mongo()` and `mongoStatic()` (`mongo-client-takes-extensions`), and give `supabase()` and `postgres()` one valid database input (`supabase-one-binding-input`, `postgres-checks-database-input`).
4. Run `prisma contract emit` and commit what it writes, including the files under `migrations/`. Fix what it refuses for a Prisma 6 MongoDB schema (`mongo-prisma6-indexes-as-prisma6-reads-them`, `mongo-prisma6-index-names`). This step also covers `mongo-contract-requires-target`, `pack-extension-found-on-search-path` and `contract-artifacts-restamp`.
5. On MongoDB, run the colocated script to name the indexes of the contract snapshots under `migrations/snapshots/` (`mongo-contracts-record-index-names`).
6. Bring each database up to date: run `prisma db migrate` for a pgvector, PostGIS, ParadeDB or citext pack (`pack-extension-found-on-search-path`). On MongoDB, run `prisma db sign`, or plan and apply the migration with no operations (`mongo-contracts-record-index-names`). For a Prisma 6 MongoDB schema, run `prisma db verify` before you sign (`mongo-prisma6-index-names`).
7. Change the remaining code: scripts and tests that match a MongoDB index operation id (`mongo-index-operations-by-name`), and MySQL writes of a year before 1000 or after 9999 (`mysql-datetime-writes-are-checked`). Check a SQLite `date('now')` default that `db verify` reports (`temporal-polyfill-is-a-peer-dependency-of-sqlite`).


## MySQL: `temporal-polyfill` is a peer dependency, and `DateTime` writes are range-checked

### `temporal-polyfill-is-a-peer-dependency-of-mysql`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-mysql` or `@prisma/orm-target-mysql`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.

An existing MySQL contract needs no other change: `DateTime` with no arguments is the type `DateTime` was before, renamed `DatetimeJsDate(3)`, and emits the same contract.

### `mysql-datetime-writes-are-checked`

Nothing to change in code. A `Date` before the year 1000 or after 9999 written to a MySQL `DateTime` field is now refused with `RUNTIME.ENCODE_FAILED`. MySQL documents only those years for `datetime`. If the application writes such dates, keep them in range or store them in a `String` field.


## SQLite: `temporal-polyfill` is a peer dependency

### `temporal-polyfill-is-a-peer-dependency-of-sqlite`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-sqlite` or `@prisma/orm-target-sqlite`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.

An existing SQLite contract needs no other change: `DateTime` with no arguments is the type `DateTime` was before, renamed `DatetimeJsDate`, and emits the same contract.

One case reads differently. `db verify` used to read a database default of `date('now')` or `CURRENT_DATE` as `now()`, so it matched a field written `@default(now())` of any type. It now reads it as the current date, which only a `Date @default(now())` field writes, and a `now()` on a `DateTime` or `String` field means the current instant. If `db verify` now reports such a column, write the field as `Date @default(now())` when it holds a calendar date, or as ``@default(sql`date('now')`)`` to keep its type. Do not run `db update` first: it would change the column's default to the current instant, and new rows would get the instant instead of the date.


## PostgreSQL's integer, decimal, float and text types are convenience types

On PostgreSQL, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean` and `Bytes` are now convenience types, as `DateTime` already is. Each is named for what a field means, and its optional `storage` argument (and `as`, for `BigInt`) chooses an explicit type named after the database type. Written bare, each gives the same type as before, so schemas that use these names need no change.

The explicit types took the database's names. Seven old names stay for one release line as deprecated aliases: they give the same codec and the same contract, and `prisma contract emit` and the editor report a warning where one is written.

### `psl-renamed-postgres-scalar-types`

Rewrite each field or `types {}` alias written with an old name, keeping its other arguments and attributes:

| Before | After | Explicit type it gives |
| --- | --- | --- |
| `SmallInt` | `Int(storage: int2)` | `Int2` |
| `BigIntNumber` | `BigInt(as: number)` | `Int8Number` |
| `Numeric` | `Decimal` | `NumericString` |
| `Numeric(p)` | `Decimal(precision: p)` | `NumericString(p)` |
| `Numeric(p, s)` | `Decimal(precision: p, scale: s)` | `NumericString(p, s)` |
| `UnboundedInt` | `BigInt(storage: numeric)` | `NumericBigInt` |
| `Real` | `Float(storage: float4)` | `Float4` |
| `VarChar` | `String(storage: varchar)` | `Varchar` |
| `VarChar(n)` | `String(storage: varchar, length: n)` | `Varchar(n)` |
| `VarBit` | `Varbit` | `Varbit` |
| `VarBit(n)` | `Varbit(n)` | `Varbit(n)` |

`VarBit` has no convenience type, so its replacement is the explicit type. For the others, writing the explicit type in the last column instead is equally correct; it is the same type, and both emit the same contract. The warning names the explicit type because it is the exact replacement for the old name.

```prisma
model Account {
  id     Int                                  @id
  visits Int(storage: int2)                   // was SmallInt
  rank   BigInt(as: number)                   // was BigIntNumber
  price  Decimal(precision: 10, scale: 2)     // was Numeric(10, 2)
  code   String(storage: varchar, length: 12) // was VarChar(12)
}
```

Rewrite only Prisma 8 schemas whose config uses the PostgreSQL target, including the `contract.prisma` copies in migration folders. The detection cannot tell which target a schema is for, so it also matches SQLite's `BigIntNumber` and MySQL's `VarChar`; a match in a project whose `prisma.config.ts` uses the SQLite or MySQL target needs no change. Update comments and documentation that name the old types the same way. Re-emit the contract with `prisma contract emit`: it is byte for byte the same as before.

### `ts-renamed-postgres-scalar-helpers`

Rewrite only in contracts on PostgreSQL:

```ts
field.column(type.Int({ storage: 'int2' })); // was type.SmallInt()
field.column(type.BigInt({ as: 'number' })); // was type.BigIntNumber()
field.column(type.Decimal({ precision: 10, scale: 2 })); // was type.Numeric(10, 2)
field.column(type.BigInt({ storage: 'numeric' })); // was type.UnboundedInt()
field.column(type.Float({ storage: 'float4' })); // was type.Real()
field.column(type.String({ storage: 'varchar', length: 64 })); // was type.VarChar(64)
field.column(type.Varbit(16)); // was type.VarBit(16)
```

The explicit helpers `type.Int2()`, `type.Int8Number()`, `type.NumericString(10, 2)`, `type.NumericBigInt()`, `type.Float4()` and `type.Varchar(64)` give the same types.

The old helpers still compile, and nothing warns where they are called. They are removed in the same release as the deprecated schema names, so rewrite them now.

### `ts-renamed-postgres-column-helpers`

The detection matches a file that imports `int8Column` or `numericColumn` from `@prisma/orm-postgres/adapter/column-types` or `@internal/adapter-postgres/column-types`. In that file, rename the import and every use of the imported name. Each column helper is named after the explicit type it gives:

```ts
import { int8BigIntColumn, numericStringColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(int8BigIntColumn); // was int8Column
field.column(numericStringColumn(10, 2)); // was numericColumn(10, 2)
```


## Pack extensions are found through the search path

The pgvector pack's contract now declares `vector` in the unbound namespace, the same as this PSL:

```prisma
namespace unbound {
  extension vector {}
}
```

### `pack-extension-found-on-search-path`

1. Run `prisma contract emit`. It writes the pack's new migration and head under `migrations/<pack>/`.
2. Run `prisma db migrate` against each database. The new migration has no operations.

A database where the extension is in a schema that is not on the connection's search path now fails `db verify`, and the message names the schema and the search path. Add that schema to the search path of the role the application connects as, or reinstall the extension in a schema on the search path.

### `remove-pack-extension-declaration`

If the project composes the pgvector, PostGIS, ParadeDB or citext pack, delete the application's own declaration of that pack's extension, then run `prisma contract emit`. The pack installs the extension. Keep the declaration of any other extension.


## MongoDB indexes carry their names

Every index of a MongoDB contract now records its name, and migrations create and drop each index by that name. The Prisma 6 reader names indexes as Prisma 6 did, and it no longer merges them. Do the changes in this section with one `prisma contract emit` and one `prisma db sign` (or one migration) per project.

### `mongo-contracts-record-index-names`

For this schema:

```prisma
model Post {
  id       ObjectId @id @map("_id")
  authorId ObjectId

  @@index([authorId])
  @@map("posts")
}
```

each index in `contract.json` gains its name:

```diff
 {
   "keys": [{ "direction": 1, "field": "authorId" }],
-  "kind": "mongo-index"
+  "kind": "mongo-index",
+  "name": "authorId_1"
 }
```

`authorId_1` is the name the index already has in the database, so the database needs no change. Only the storage hash changes.

1. Commit your work first, so the changes can be reviewed and undone with git.
2. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
3. Run the colocated script from the project root:

   ```sh
   node <path-to-this-guide>/scripts/mongo-index-names/mongo-index-names.ts
   ```

   Node 24 or later runs the TypeScript script directly. It reads and writes files only. It rewrites every `*.json` file under the root that is a MongoDB contract with an index without a name, skipping `node_modules`, `.git`, `dist` and `build`, and the `contract.d.ts` next to it (`<name>.d.ts` next to `<name>.json`). These are the contract snapshots under `migrations/snapshots/<hash>/`, which no command regenerates. Each snapshot index takes the name that its own project's emitted contract gives the index with the same collection, keys and options, so a project whose contract comes from `prisma6Schema()` gets Prisma 6's names, such as `User_email_key`. A snapshot's project is the nearest folder, going up from the folder that holds its `migrations` folder, that holds an emitted contract, and the walk stops at the first folder with a `package.json`, the project root, so a name never comes from another project of a monorepo; contracts under a `snapshots` folder are never used as a source. When no emitted contract of the project has the index, or two of them name it differently, the index gets the name earlier releases gave it in the database, its keys and directions such as `email_1`, and the script prints one line saying so for each such index; check those names against the database with `prisma db verify` after the upgrade. The script writes each file in the layout `contract emit` writes it. The snapshot directory names stay as they are. A contract that step 2 emitted already has names and is left alone. The script prints each file it rewrote, or that nothing changed. It does not follow symbolic links: it names each one it finds and exits 1, and if a link holds migration snapshots, run the script again on the folder it points to. If it cannot match the index types of a `contract.d.ts` with its `contract.json`, it says so and exits 1; add `readonly name: '<name>'` beside `readonly kind: 'mongo-index'` in each index type by hand.

   To rewrite a file by hand instead, add `"name"` to each object whose `kind` is `mongo-index`: the name the emitted contract gives the same index, or else its keys and directions, such as `"name": "createdAt_-1_authorId_1"` for the keys `createdAt` descending and `authorId` ascending. Add the matching type in `contract.d.ts`.
4. Bring each database to the new storage hash:
   - For a project kept with `db init` or `db update`, run `prisma db sign`.
   - For a project with migrations, run `prisma migration plan`. The migration it plans has no operations; apply it with `prisma db migrate`.

For a disposable example or test database whose migration chain is regenerated from its schemas, regenerate the chain with its own tooling instead of steps 3 and 4, and recreate the database. In this repository, `pnpm fixtures:emit` re-emits every contract and regenerates the example migrations, writing their snapshots under the new storage hashes; delete the snapshot directories no migration names any more. This is not a procedure for a production database: keep applied migrations and their snapshots, and follow steps 3 and 4.

A database that a Prisma 6 schema read with `prisma6Schema()` describes holds the names Prisma 6 gave its indexes, not the names after their keys; see `mongo-prisma6-index-names`.

### `mongo-unnamed-indexes-with-one-name-refused`

This schema is now refused, because both indexes would be named `email_1`:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique

  @@index([email], sparse: true)
  @@map("users")
}
```

Name one of them:

```prisma
  @@index([email], sparse: true, map: "email_sparse")
```

In TypeScript:

```ts
indexes: [index({ email: 1 }, { unique: true }), index({ email: 1 }, { sparse: true, name: 'email_sparse' })],
```

No database holds such a pair yet: earlier releases planned both under `email_1`, and MongoDB refused the second. The index you leave unnamed keeps its name, so its database index stays; the migration creates the one you named.

Two indexes of variants of one base on the same field are refused the same way; name each, such as `@@index([title], map: "bug_title")` on `Bug` and `@@index([title], map: "feature_title")` on `Feature`.

Two identical indexes with different names are refused too, because MongoDB cannot hold an index twice: PSL reports `PSL_INVALID_INDEX` at the second, and TypeScript throws `CONTRACT.NAME_DUPLICATE`. Remove one, or give both the same name, which merges them.

### `mongo-prisma6-indexes-as-prisma6-reads-them`

`prisma6Schema()` describes the database Prisma 6 built, so it no longer merges indexes. This schema is now refused, because Prisma 6 refuses it too:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique

  @@index([email])
}
```

1. Run `prisma contract emit` for each project that reads a Prisma 6 schema with `prisma6Schema()`.
2. If it reports `PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS`, the schema has two indexes that Prisma 6 refuses, or two that Prisma 6 accepts but MongoDB cannot hold, because they have the same keys and options in one collection. The message names both. If one is unique and the other is not, remove the one that is not, so the unique constraint stays. Otherwise remove either.
3. If the storage hash changed, the schema writes a unique and a plain index on the same keys with different written sorts, and the contract now holds both, as the database does. Run `prisma db sign` again.

### `mongo-prisma6-index-names`

For this Prisma 6 schema:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique

  @@index([email(sort: Asc)])
}
```

the contract names the indexes `User_email_key` and `User_email_idx`, as Prisma 6 `db push` named them. Run `prisma contract emit` and `prisma db verify`; a database Prisma 6 built verifies. Then run `prisma db sign` for the new storage hash. Run the script of `mongo-contracts-record-index-names` after the emit: it gives each index of your migration snapshots the Prisma 6 name the emitted contract gives it, so the next `prisma migration plan` does not drop and recreate them.

If the emit reports `PSL.PRISMA6_MONGO_INDEX_NAME_DUPLICATE`, two indexes of one model get one name, which Prisma 6 refuses too, such as `@@index([name])` beside `@@index([name(sort: Asc)])`, both named `User_name_idx`. Give one a name with `map:`. If it reports `PSL.PRISMA6_MONGO_INDEX_NAME_INVALID`, a `map:` is empty or longer than 127 bytes; give the index a name Prisma 6 accepts.

If `db verify` reports an index whose name differs, the database holds that index under another name than Prisma 6 would give it. Write that name with `map:`, so the contract states what the database holds.

### `mongo-index-operations-by-name`

A `migration.ts` that `prisma migration plan` writes now names each index:

```ts
// before
createIndex('users', [{ field: 'email', direction: 1 }], { unique: true }),
dropIndex('users', [{ field: 'legacy', direction: 1 }]),
// after
createIndex('users', [{ field: 'email', direction: 1 }], { name: 'email_1', unique: true }),
dropIndex('users', [{ field: 'legacy', direction: 1 }], { name: 'legacy_1', unique: true }),
```

`dropIndex`'s options must list every option the index has, as `migration plan` writes them: its precheck requires an index with that name, those keys and exactly those options, so `dropIndex('users', keys, { name: 'legacy_1' })` fails for a unique index. A `dropIndex` without options checks the keys only.

Existing migration files need no change: a call without `name` uses the name after the keys, as before, and a `dropIndex` without options checks the index's keys only, as before. An applied migration's `ops.json` is applied as written.

A script or test that matches an operation id, such as `index.users.create(email:1)`, matches the name instead: `index.users.create(email_1)`.


## `mongo()` checks the extension packs a contract requires

A contract built with extension packs records them, and `mongo()` and `mongoStatic()` now refuse it unless they are given the same packs:

```typescript
import mongo from '@prisma/orm-mongo/runtime';
import myPack from 'my-mongo-pack/runtime';

export const db = mongo({ contract, url, extensions: [myPack] });
```

### `mongo-client-takes-extensions`

1. For each extension pack in `extensions` in `prisma.config.ts`, import the pack's runtime descriptor, usually from its `/runtime` entry.
2. Pass the descriptors as `extensions` to every `mongo(...)` and `mongoStatic(...)` call that takes this project's contract.

### `mongo-contract-requires-target`

Re-emit the contract with `prisma contract emit`, or add `"target": "mongo"` beside `"targetFamily": "mongo"` in a contract written by hand.


## `supabase()` and `postgres()` check their database input when they are called

### `supabase-one-binding-input`

```ts
// Before: pg was used and url ignored
const db = await supabase({ contract, url, pg: pool, jwtSecret });

// After
const db = await supabase({ contract, pg: pool, jwtSecret });
```

In each `supabase(...)` call, keep exactly one of `url`, `pg` and `binding`. If you import `supabase` under another name (`import { supabase as createDb } from ...`), check the calls of that name. If you passed both `url` and `pg`, keep `pg`: that is the one the client used.

If `url` comes from an environment variable, make sure it is set. An empty `url` used to connect to whatever the `PG*` environment variables or localhost pointed at; it now fails at startup.

Code or tests that match a `pg` refusal on `SUPABASE.CONFIG_INVALID` keep working for a `pg.Client`. Update a match on the old message "The pg option takes a pg.Pool" to "Supabase takes a pg.Pool or a url, not a pg.Client". A `pg` value that is neither a pool nor a client now fails with `RUNTIME.BINDING_INVALID`.

`supabase()`'s errors about its input list only what it takes, and their `meta.extension` is `'supabase'`.

### `postgres-checks-database-input`

These checks apply to `postgres()` and to `supabase()`.

`null` as `pg`, `url` or `binding` now fails with `RUNTIME.BINDING_INVALID` on `postgres()` and on `supabase()`, even when another input is given beside it: `{ url: null, pg: pool }` fails on `url`. Code such as `pg: config.pool ?? null`, `url: value || null`, `url: ready ? value : null` or `url: ready ? null : value` should leave the option out instead:

```ts
// Before
postgres({ contract, url: process.env['DATABASE_URL'] ?? null });

// After
const url = process.env['DATABASE_URL'];
postgres({ contract, ...(url === undefined ? {} : { url }) });
```

A `binding` whose `kind` is not `'url'`, `'pgPool'` or `'pgClient'` now fails with `RUNTIME.BINDING_INVALID` when `postgres()` or `supabase()` is called, not on the first query. Correct the kind, for example `{ kind: 'pgpool', pool }` becomes `{ kind: 'pgPool', pool }`.

A `binding` of kind `'url'` now has its `url` checked like a top-level `url`: it must be a non-empty `postgres://` or `postgresql://` string. An empty one used to connect to whatever the `PG*` environment variables or localhost pointed at. A `binding` whose `pool` or `client` is missing or not an object now fails when `postgres()` is called, not on the first query.


## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.23`; any other difference in the emitted files comes from an earlier entry in this guide.
