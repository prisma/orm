---
from: "8.0.0-rc.14"
to: "8.0.0-rc.15"
changes:
  - id: contract-stores-data-type
    summary: |
      A SQL contract names each column's data type in `dataType` (for example `pg/int4`) instead of
      its database type name in `nativeType`. Upgrade every extension that ships migrations in the
      same step, then run the colocated script on the project: it rewrites every contract, writes
      its lists in this release's new form, renames the snapshot directories to the new storage
      hashes, and rewrites the migrations, refs, `migration.ts` files and `contract.d.ts` files
      that name them.
    detection:
      glob: "**/*.json"
      matches:
        - '"nativeType"\s*:\s*"'
    script: ./scripts/data-type-in-contract/data-type-in-contract.ts
  - id: sign-databases-after-upgrade
    summary: |
      The upgrade changes every contract's storage hash, so every database's marker names a hash
      the project no longer has. Run `prisma db sign` against every database before deploying the
      application built with the new contract. `db sign` now signs every contract space, and its
      `--json` document is `{ ok, summary, spaces, advancedRefs }`.
  - id: column-descriptors-drop-native-type
    summary: |
      A hand-written column descriptor names its codec only: `{ codecId: 'pg/text@1' }` instead of
      `{ codecId: 'pg/text@1', nativeType: 'text' }`. Code that reads or builds a column of a stored
      contract uses `dataType` (for example `pg/text`) instead of `nativeType` (`text`).
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?<!readonly\s+)nativeType\s*:\s*[''"]'
        - '\.nativeType\b'
  - id: parameter-casts-use-base-names
    summary: |
      PostgreSQL parameter casts are written with the data type's base name: `$1::int4` instead of
      `$1::integer`, and likewise `int2`, `int8`, `float4`, `float8` and `bool` instead of
      `smallint`, `bigint`, `real`, `double precision` and `boolean`. Logged SQL and SQL snapshots
      in tests change to match.
    detection:
      glob: "**/*.{ts,mts,cts,sql,json,snap}"
      matches:
        - '\$\d+::(?:integer|smallint|bigint|real|double precision|boolean)\b'
  - id: ts-contract-lists-extension-codecs
    summary: |
      A TypeScript contract built with `defineContract` from `@prisma/orm-postgres/contract-builder`
      or `@prisma/orm-sqlite/contract-builder` names each column's database type from the data type
      its codec represents. A contract that uses an extension's codec without listing the extension
      in `extensions` now fails with `CONTRACT.CODEC_DESCRIPTOR_MISSING`. List the extension.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*(?<![\w$])defineContract(?![\w$]))[\s\S]*[''"]@prisma/orm-extension-(?:pgvector|postgis|arktype-json)/column-types[''"]'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*(?<![\w$])defineContract(?![\w$]))[\s\S]*(?<![\w$])codecId\s*:\s*[''"](?:pg/vector|pg/geometry|arktype/json)@\d+[''"]'
  - id: sqlite-contract-d-ts-char-aggregates
    summary: |
      On SQLite, `sql/char@1` and `sql/varchar@1` are registered codecs. Re-emit the contract:
      `contract.d.ts` gains `min` and `max` aggregate rows for both codecs. `contract.json`, its
      hashes and the migration SQL do not change.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '^(?![\s\S]*[''"]sql/char@1[''"]\s*:\s*\{\s*readonly output)[\s\S]*@prisma/orm-(?:target-)?sqlite/'
  - id: column-helpers-raise-type-params-invalid
    summary: |
      pgvector's `vector(length)` and PostGIS's `geometry({ srid })` and `pgGeometryColumn({ srid })`
      no longer check their arguments. Building the contract checks every column's parameters
      against its data type: an argument outside its bounds now fails `defineContract` with
      `CONTRACT.TYPE_PARAMS_INVALID` instead of failing the helper call with
      `CONTRACT.ARGUMENT_INVALID`, and `srid: 0` is refused when the contract is built, not later
      when a migration is planned.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bCONTRACT\.ARGUMENT_INVALID\b'
        - '\bsrid\s*:\s*0\b'
  - id: reemit-explicit-list-cardinality
    summary: Re-emit list contracts with nested element nullability while preserving scalar JSON.
  - id: refresh-historical-list-contracts
    summary: Refresh historical MongoDB contract snapshots and their migration references together; for SQL contracts, `contract-stores-data-type` rewrites them.
  - id: mongo-nullable-list-containers
    summary: Re-emit Mongo contracts and migrate validators to accept nullable list containers.
  - id: domain-types-match-their-columns
    summary: |
      The domain half of an emitted SQL contract now carries the type parameters and enum value sets the schema declares: on fields typed by a named type, on enum list fields, and on composite type members. In `contract.d.ts`, a composite type member with type parameters now has the parameterized output type. Re-emit the contract. This change leaves the storage half, every hash and migration snapshots unchanged.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
        - '"valueObjects"\s*:'
        - '"valueSet"\s*:'
  - id: value-object-default-matches-composite-type
    summary: |
      A literal default on a field typed by a composite type must now match the composite type, with each member value read by the member's codec and each enum member value one of the enum's values, or the schema is refused. Fix the default the diagnostic names.
    detection:
      glob: "**/*.prisma"
      matches:
        - '^\s*type\s+\w+\s*\{'
  - id: composite-type-attributes-refused
    summary: |
      An attribute on a composite type or on one of its members is now refused, where it used to be ignored. Remove it.
    detection:
      glob: "**/*.prisma"
      matches:
        - '^\s*type\s+\w+\s*\{'
  - id: codecs-check-stored-json
    summary: |
      A TypeScript `.default()` value or `enumType` member that its column's codec does not take is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` or `CONTRACT.ENUM_INVALID`. A `contract.json` that holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, and a `migration.ts` that holds one fails when it runs. Correct the value the error names.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.default\(\s*(?!now\(|sql`|autoincrement\()'
        - '\benumType\s*\('
  - id: psl-values-checked-by-codecs
    summary: |
      A PSL schema whose SQL enum member its codec does not take, or whose literal default its column's type does not hold, is now refused at `contract emit`, where it used to load. Correct the member or the default.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"(?:pg|sql|sqlite)/'
        - '^\s*\w+\s*=\s*-?\d{10,}\s*$'
        - '@default\(\s*(?:"|-?\d|\[)'
  - id: uuid-defaults-stored-as-postgresql-writes
    summary: |
      A uuid default written in upper case, in braces or without hyphens, in PSL or in a TypeScript `.default()`, is now stored as PostgreSQL writes it, so emitting the contract again changes its storage hash. Earlier versions could not apply such a contract: the command that applied it failed and changed nothing. Emit the contract again, then run that command again. With migrations, first delete the migration package that never applied.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bUuid\b[^\n]*@default\(\s*"(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")\{?[0-9A-Fa-f]{4}'
        - '\b(?:uuidNative|pgUuidColumn)\s*\([^\n]*\.default\(\s*[''"`](?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[''"`])\{?[0-9A-Fa-f]{4}'
        - '^\s*\.default\(\s*[''"`](?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[''"`])(?=[^''"`\n]*[A-F{-])\{?[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12}\}?[''"`]'
  - id: ts-enum-member-written-as-stored
    summary: |
      `defineContract` from the Postgres and SQLite packages now refuses an `enumType` member that its codec takes but stores as a different value, with `CONTRACT.ENUM_INVALID`. A uuid member written with an upper-case hex digit, in braces, or with hyphens anywhere other than the 8-4-4-4-12 positions Postgres prints (including none) is refused, because `pg/uuid@1` stores lower-case 8-4-4-4-12 text. Write each refused member as the error message says, re-emit, and apply a migration that replaces the enum's CHECK constraint.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benumType\('
  - id: mongo-codecs-check-json
    summary: |
      The built-in Mongo codecs now refuse a JSON value that is not the JSON form of their type, where most passed it through: a PSL enum member whose value its `@@type` codec does not take is now refused at `contract emit`, and a TypeScript `enumType` member that `mongo/objectId@1` or `mongo/int32@1` does not hold is refused when the contract is built. Correct the member.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '@@type\(\s*"mongo/'
        - '[''"]mongo/(?:objectId|int32)@1[''"]'
        - '\bMONGO_(?:OBJECTID|INT32)_CODEC_ID\b'
  - id: text-array-elements-nullable
    summary: |
      A `textArray()` column's elements are now typed `string | null`, because a `text[]` holds NULL elements, which it reads as `null`. Handle the `null`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\btextArray\s*\('
        - '[''"]pg/text-array@1[''"]'
  - id: char-reads-drop-only-padding
    summary: |
      A `char(n)` column now reads the same through `.include()` as through a flat read: without the trailing spaces that pad it, where an include used to return them, and keeping a trailing tab or newline, which a flat read used to drop. Compare `char` values without their padding.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"(?:sql|pg)/char@1"'
  - id: sqlite-nan-parameters-refused
    summary: |
      On SQLite, NaN written to a float column or used as a filter value now throws `RUNTIME.ENCODE_FAILED` naming the codec, where SQLite stored NULL or matched nothing. Write `null` for no value.
    detection:
      glob: "**/contract.json"
      matches:
        - '"target"\s*:\s*"sqlite"'
  - id: sqlite-int-include-refuses-inexact-values
    summary: |
      On SQLite, an `.include()` of a row whose `sql/int@1` column holds an INTEGER past 2^53, or a REAL, now throws `RUNTIME.DECODE_FAILED`, where it read the value rounded or with a fraction. Store such values in a `BigInt` or `Float` column.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"sql/int@1"'
  - id: prefixed-sql-tags-are-removed
    summary: |
      The tags `pg.sql` and `sqlite.sql` are removed. Write `sql`.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '(?<![\w./-])(pg|sqlite)\s*\.\s*sql\s*\\?[\x60"'']'
  - id: default-diagnostic-codes-changed
    summary: |
      Four PSL diagnostic codes for written values changed: `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` is now `PSL_UNKNOWN_LITERAL_TAG`, `PSL_INVALID_JSON_LITERAL` is now `PSL_INVALID_LITERAL`, `PSL_DEFAULT_TYPE_INCOMPATIBLE` is now `PSL_VALUE_TYPE_INCOMPATIBLE`, or `PSL_DEFAULT_LIST_EXPECTED` for a single value on a list column, and most cases of `PSL_INVALID_DEFAULT_LITERAL` moved to `PSL_INVALID_LITERAL`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '\bPSL_INVALID_JSON_LITERAL\b'
        - '\bPSL_UNKNOWN_DEFAULT_LITERAL_TAG\b'
        - '\bPSL_DEFAULT_TYPE_INCOMPATIBLE\b'
        - '\bPSL_INVALID_DEFAULT_LITERAL\b'
  - id: migration-ts-column-defaults
    summary: |
      In `migration.ts`, the adapter writes every column default, reading it with the column's codec. Postgres `setDefault` takes the column as `col(name, type, { default, codecRef })` instead of `column` (the name) and `defaultSql`. A SQLite `addColumn` or `recreateTable` column carries `default` and `codecRef` instead of `defaultSql`, and a `recreateTable` postcheck for a default is `{ description, columnDefault }`. An earlier `migration.ts` that uses `defaultSql` no longer compiles, and running it with `node migration.ts` stops with `MIGRATION.OPERATION_OPTION_REMOVED`; its `ops.json` still applies.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bdefaultSql\s*:'
  - id: postgres-changed-default-applied
    summary: |
      On PostgreSQL, `db update` and `db migrate` now change a column default that is already there. They used to skip the change and then fail with `MIGRATION.SCHEMA_VERIFY_FAILED`. A migration an earlier version planned still skips it: before you apply it, delete its package and plan it again, or rewrite its `setDefault` call to the form `migration-ts-column-defaults` shows and run its `migration.ts` to write `ops.json` again.
    detection:
      glob: "**/ops.json"
      matches:
        - '"id":\s*"setDefault\.'
  - id: cli-error-from-caught
    summary: |
      `mapCaughtMigrationError` is removed from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`). Use `errorFromCaught(error, why)`, which always returns an error: a CLI error as it is, any error with a structured code as itself, and anything else as `CLI.UNEXPECTED` with `why(message)`. It throws an `InternalError` again.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmapCaughtMigrationError\b'
  - id: sql-with-a-line-comment-gets-a-new-wire-name
    summary: |
      An index, check or policy whose SQL body contains both `--` and a line break gets a new name in `contract.json` once. The next `migration plan` drops and recreates the object.
    detection:
      glob: "**/contract.json"
      matches:
        - '"(?:[^"\\]|\\.)*?--(?:[^"\\]|\\.)*?\\n|"(?:[^"\\]|\\.)*?\\n(?:[^"\\]|\\.)*?--'
  - id: strict-verify-unclaimed-code
    summary: |
      `prisma db verify --strict` now reports a database holding tables no contract declares under `CONTRACT.SCHEMA_VERIFICATION_FAILED`, in both the diagnostic and the JSON result's `code`. It used to report `CONTRACT.MARKER_REQUIRED`. The exit code is still 4. `CONTRACT.MARKER_REQUIRED` now only means the database has not been signed.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,yml,yaml,json}"
      matches:
        - 'CONTRACT\.MARKER_REQUIRED'
  - id: prisma7-schema-date-types-are-text
    summary: |
      A contract from `prisma7Schema(...)` now reads a Prisma 7 `DateTime` column and `@db.Timestamp`, `@db.Timestamptz`, `@db.Date` and `@db.Time` columns as the text PostgreSQL prints (`TimestampString(3)`, `TimestampString(p)`, `TimestamptzString(p)`, `DateString`, `TimeString(p)`), not as `Temporal` values. `@updatedAt` still writes UTC. The application needs no `Temporal` for them. Re-emit, change code that treats these fields as `Temporal` values, then run `prisma db sign`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: contract-infer-writes-text-date-types
    summary: |
      `prisma contract infer` now writes `TimestampString(p)`, `TimestamptzString(p)`, `DateString` and `TimeString(p)` for `timestamp`, `timestamptz`, `date` and `time` columns, where it wrote `Timestamp(p)`, `Timestamptz(p)`, `Date` and `Time(p)`. A contract inferred earlier keeps its types until infer runs again.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'Contract inferred from the live database schema'
  - id: text-timestamp-now-is-utc
    summary: |
      A `timestamp` column of type `TimestampString(p)` that the ORM fills with `now` now receives the UTC wall-clock time on a host outside UTC. Before, it received the host's local time. No code changes.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '\btimestampString\s*\([^)\n]*\bnow\b'
  - id: contract-infer-writes-bytea-default-literals
    summary: |
      `prisma contract infer` now writes a `bytea` column default as a base64 literal, `@default("aGVsbG8=")`, where it wrote ``@default(sql`'\\x68656c6c6f'::bytea`)``. A contract emitted from the new output stores a value instead of an expression, so it gets a new storage hash while the database does not change. Re-emit, then `prisma db sign`, or record an empty migration with `prisma migration new`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\bBytes(?:\[\])?\??[ \t]+[^\n]*@default\(sql[^\n]*::bytea'
  - id: prisma6-int-written-as-long
    summary: |
      A contract read with `prisma6Schema(...)` now gives a plain Prisma 6 `Int` field, and `Int @db.Long`,
      the `mongo/int64Number@1` codec: the application type stays `number`, and Prisma 8 now writes these
      fields as a BSON long, as Prisma 6 does, instead of an int. A document in which such a field holds a
      fractional number, which the previous contract let Prisma 8 write, now fails to read with
      `RUNTIME.DECODE_FAILED`: repair those documents, then re-emit the contract.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma6Schema\s*\('
  - id: prisma6-bytes-objectid-is-hex
    summary: |
      A Prisma 6 MongoDB schema with a native type Prisma 6 accepts now emits with `prisma6Schema(...)`
      (only `DateTime @db.Timestamp` is still refused). A `Bytes @db.ObjectId` field holds an ObjectId, so
      Prisma 8 reads it as a 24-digit hex string and writes only a hex string or an ObjectId; a 12-byte
      `Buffer` or `Uint8Array`, which the Prisma 6 client uses for it, is refused.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\bBytes(?:\[\])?\??[ \t]+[^\n]*@db\.ObjectId\b'
  - id: writes-on-a-conditional-collection-are-refused
    summary: |
      A write (`update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) on a collection that is filtered on some code paths and not on others no longer compiles. A pattern cannot tell which collections those are: act only where the compiler reports "The 'this' context of type '...' is not assignable to method's 'this' of type 'HasWhere'". Filter on every path, or make the write only where the filter was applied.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:updateAll|updateAndCount|deleteAll|deleteAndCount)\s*\('
        - '\.update\s*\('
        - '\.delete\s*\(\s*(?:\)|\()'
  - id: writes-refuse-what-they-would-ignore
    summary: |
      `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` now throw `ORM.ARGUMENT_INVALID` on a collection that has a `limit`, an `offset`, a `cursor`, `distinct` or `distinctOn`. These writes change every row that matches the filter; their statement cannot apply any of these, so they were ignored and more rows changed than the chain asked for. Remove them before the write, or read the rows first and change them by their ids. `update` with a relation callback now throws on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`, which it ignored; filter it to the one row instead. `update` and `delete` without a relation callback change the row `first()` returns, as before, except after `limit(0)`: they changed one row and now change none and return `null`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:limit|offset|cursor|distinct|distinctOn)\s*\([^)]*\)[\s\S]{0,300}?\.(?:update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*\('
        - '\.orderBy\s*\([\s\S]{0,300}?\.update\s*\('
  - id: cursor-and-distinct-on-check-the-receiver
    summary: |
      `cursor` and `distinctOn` now require an order on the collection they are called on, checked on the receiver. A cast on the argument, such as `cursor({ id } as never)`, no longer bypasses the check; add the `orderBy`, or cast the collection to `Ordered<C>` where the query is meant to have no order.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:cursor|distinctOn)\s*\([^)]*\bas\s+never\b'
  - id: apply-is-a-collection-member
    summary: |
      Every collection now has an `apply` method. A custom collection class that declares its own `apply` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*apply\s*[(<:=?]'
  - id: scope-is-a-collection-member
    summary: |
      Every collection now has a `scope` method. A custom collection class that declares its own `scope` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*scope\s*[!(<:=?]'
  - id: overriding-a-chaining-method
    summary: |
      In a class that extends `Collection`, an override of a chaining method (`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor`, `include`) or of a method that returns rows (`all`, `first`, `create`, `createAll`, `upsert`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) must use the new signature, which takes a `this` parameter.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|override|async)\s+)*(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include|all|first|create|createAll|upsert|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*[(<]'
  - id: collection-state-flags-are-boolean
    summary: |
      In `DefaultCollectionTypeState`, `hasWhere`, `hasOrderBy` and `hasUniqueFilter` are `boolean` (not known) instead of `false`. Code that expects `false` on a collection with no filter or order must expect `boolean`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bhas(?:Where|OrderBy|UniqueFilter)\b[''"]?\]?\s*,\s*false\b'
        - '\bhas(?:Where|OrderBy|UniqueFilter)\s*:\s*false\b'
  - id: read-collection-state-and-row-with-helpers
    summary: |
      A collection's type state and row are read with `CollectionTypeStateOf<C>` and `CollectionRowOf<C>`, not by inferring the type arguments of `Collection`. The type arguments keep what the collection started with.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCollection<[^;]*?\binfer\b'
  - id: return-type-of-a-chaining-method
    summary: |
      `ReturnType` of `where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` or `include` no longer gives a collection. Write `Filtered<C>` after `where`, `Ordered<C>` after `orderBy`, and `C` after the others, or take `typeof` of a value.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bReturnType<[^>]*\[[''"](?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)[''"]\]'
        - '\bReturnType<\s*typeof\s+[\w$.]+\.(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)\b'
  - id: chaining-methods-take-no-explicit-type-arguments
    summary: |
      `include`, `distinct` and `distinctOn` with explicit type arguments no longer compile: `posts.include<'user'>('user')` and `posts.distinct<['title']>('title')` fail, and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments; they are inferred from the arguments, so `posts.distinct('title')` needs none.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:include|distinct|distinctOn)<'
  - id: custom-collection-methods-chain
    summary: |
      Optional. Custom collection methods now stay available after the built-in chaining methods. Where code repeats a class method's body inline after a chaining call, it can call the method instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bextends\s+Collection<'
  - id: variant-takes-discriminator-value
    summary: |
      `.variant()` on a polymorphic SQL or Mongo ORM collection takes the discriminator value a variant declares instead of the variant's model name: `db.orm.public.Task.variant('bug')` for `@@base(Task, "bug")`, where it used to be `.variant('Bug')`. A value the model does not declare, or a call on a model with no discriminator, now throws `ORM.ARGUMENT_INVALID` instead of returning the collection unchanged. `.variant()` on a collection that already has a variant selected is now rejected: select the variant from the base collection.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.variant\('
  - id: imported-postgres-field-checks-defaults
    summary: |
      The `field` exported by the Postgres facade's `contract-builder` entry now has the Postgres presets and checks a `.default(...)` value against the Postgres target's column types, as the `defineContract` callback's `field` does; it does not know the column types an extension adds, such as pgvector's, so it does not check those. A default of the wrong type, which compiled before and failed when the contract was built, is now a compile error; give the value the column's type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s*\{[^}]*\bfield\b[^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)postgres/contract-builder[''"]'
  - id: re-emit-for-the-row-locking-capabilities
    summary: "The Postgres adapter reports seven new capability keys (sql.forUpdate, sql.forShare, sql.lockOf, sql.lockNowait, sql.lockSkipLocked, postgres.forNoKeyUpdate, postgres.forKeyShare), which gate the new row-locking methods on the SQL builder; a contract emitted before this release does not carry them and the methods are unavailable against it, so re-emit the contract before using them."
    detection:
      glob: "**/contract.json"
      contains:
        - '"distinctOn"'
  - id: cache-annotation-ttl-removed
    summary: "cacheAnnotation from @prisma/orm-extension-middleware-cache no longer takes ttl. Every annotated read is now cached, including cacheAnnotation({}) and cacheAnnotation({ key }), which used to pass through uncached; how long an entry lives is the store's policy (the default store: 60 seconds). Remove ttl from every cacheAnnotation call."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcacheAnnotation\s*\('
  - id: cache-annotation-skip-renamed-bypass
    summary: "cacheAnnotation({ skip }) is now cacheAnnotation({ bypass }), and the CachePayload type is now CacheAnnotationOptions. Detection finds skip written inside a cacheAnnotation({ ... }) literal and any use of CachePayload; options built elsewhere without that type are not detected."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bCachePayload\b'
        - '\bcacheAnnotation\s*\(\s*\{[^}]*\bskip\s*:'
  - id: cache-middleware-store-options
    summary: "createCacheMiddleware no longer takes maxEntries or clock. Pass them to createInMemoryCacheStore and hand that store to createCacheMiddleware({ store }), or drop them when they match the new defaults (1000 entries). Detection finds maxEntries or clock written in the options literal of a createCacheMiddleware call; it also matches an already-migrated createCacheMiddleware({ store: createInMemoryCacheStore({ maxEntries }) }), which needs no change."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcreateCacheMiddleware\s*\(\s*\{[^}]*\b(maxEntries|clock)\s*:'
  - id: cache-store-object-arguments
    summary: "A custom CacheStore is now a cache of values with a version per key: CacheStore<TMeta, TValue>. get({ key, meta }) replaces get(key) and returns a CacheEntry { key, meta, version, data } whose data is { empty: true } or { empty: false, value }; set(entry, value) replaces set(key, entry, ttlMs), stores only if the key's version still equals entry.version, and returns whether it stored; a new required unset({ keys, meta }) removes values and increments their keys' versions. CachedEntry is replaced by CacheEntry, and the rows type by CachedRows."
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bCacheStore\b'
        - '\bCachedEntry\b'
        - '\bcreateCacheMiddleware\s*\('
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the
      Supabase extension, now writes 8.0.0-rc.15. Run `contract emit` once after upgrading so the
      emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.14"'
---

# 8.0.0-rc.14 → 8.0.0-rc.15 — User upgrade instructions

## Order of steps

Apply this guide from top to bottom. Several entries tell you to run `prisma contract emit`. In a SQL project, do the first steps in this order:

1. Upgrade the framework packages and every extension that ships migrations in the same step (`contract-stores-data-type`).
2. Run the `data-type-in-contract` script (`contract-stores-data-type`) before any step that re-emits a contract. The script changes only files in the old format.
3. Run `prisma db sign` against every database (`sign-databases-after-upgrade`) before you re-emit. `db sign` must see the contract the database was created from, as the script rewrote it, before a re-emit changes it again.
4. Make the changes the other entries describe in your schema, your TypeScript contract and your application code.
5. Run `prisma contract emit`. One emit after all those changes covers every entry that asks you to re-emit.
6. Where an entry says the re-emit changes the storage hash, follow that entry's database steps: sign again, or plan and apply a migration. Do this before you deploy the application built with the new contract.

A MongoDB project skips steps 2 and 3, because the script rewrites SQL contracts only.

## `contract-stores-data-type`

Upgrade every extension that ships migrations (for example `@prisma/orm-extension-pgvector` and `@prisma/orm-extension-postgis`) in the same step as the framework, to the release its authors published for this change. An extension whose contract space is still in the old format makes the project refuse to load.

Do this before any other step of this release that re-emits a contract: the script changes only files in the old format, and `prisma db sign` (`sign-databases-after-upgrade`) must see the contract the database was created from before a re-emit changes it again. Commit your work first, so the script's changes can be reviewed and undone with git. The script follows links to files and directories, also outside the root, and rewrites the files there; commit or back up those too. Then run the script from the project root:

```sh
node <skill>/upgrading/app/upgrades/8.0.0-rc.14-to-8.0.0-rc.15/scripts/data-type-in-contract/data-type-in-contract.ts
```

`<skill>` is the directory of the synced `prisma-8` skill. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL contract in the old format (a column or `storage.types` entry that stores `nativeType`), skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old-format contract: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root. In each contract it rewrites, it also writes lists in this release's new form (`reemit-explicit-list-cardinality`): a list column or field stored as `many: true` becomes `many: { elementNullable: false }`, and `contract.d.ts` declares `many` on every column. This is the SQL part of `refresh-historical-list-contracts`.

On PostgreSQL, a list column of an enum keeps the membership check its database has, because the database still holds that check. Run `prisma db sign` before you emit the contract again. The next `prisma contract emit` writes the check as `array_remove(…) <@ ARRAY[…]` under a new name; `prisma migration plan` then writes a migration that drops the old check and adds the new one, and `prisma db migrate` applies it. The plan warns that dropping the old check may lose data; it does not, because only the check changes, not the column. If you already emitted before signing, `db sign` reports the new check as missing:

- In a project with migrations, sign each database with the storage hash the script printed (`prisma db sign <new hash>`), then plan and migrate as above.
- In a project without migrations, kept with `db init` or `db update`, run `prisma db update` and type the database name when it asks; where nobody can answer, run `prisma db update --no-interactive --confirm <database>`. It drops the old check and adds the new one, and `prisma db verify` then passes. `prisma db sign <new hash>` fails there with `MIGRATION.REF_NOT_FOUND`, because no migration holds that hash.

If the script stops on an error, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. After an error, Ctrl-C or a crash, run it again: it finishes the upgrade. A file the script was writing at that moment is either unchanged or complete, and it removes its own temporary files (ending in `.data-type-in-contract-tmp`) on the next run.

Run your formatter afterwards. The script replaces text in `migration.ts` and `contract.d.ts`, so the import order in `migration.ts` and the line wrapping in `contract.d.ts` can differ from what a fresh emit and your formatter produce.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A contract already in the new format is never changed, even when its stored hash does not match its content, so a project already in the new format is left unchanged, and the script says that nothing changed. If it finds no SQL contract under the root, it says so; run it again from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for an old-format contract whose stored storage hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a column uses a codec it does not know (`<file>: unknown codec <id>; name its data type with --data-type <id>=<data type id>`) or when a renamed snapshot directory already exists with different content.

The script knows every codec that Prisma and its own extensions ship. For a codec from another extension, pass the line that extension publishes in its upgrade notes, once per codec, for example `--data-type acme/shape@1=acme/shape`. The option cannot change the data type of a codec the script already knows for a contract's target, but it can name the data type of a shared `sql/*` codec on a target the script does not know.

On SQLite, the contract now stores a literal default of an `Int` column as digit text, as it already stored a `BigInt` default: an `Int` default that was the JSON number `42` becomes the text `"42"`. The script makes this change. Planned SQL does not change (`DEFAULT 42`), and a database the previous release created still verifies. A `BigInt` default of 2^53 or less, which the previous release's check after `prisma db migrate` reported as missing, now passes. The same holds for the members of an `enum` typed by an integer codec (`@@type("sqlite/integer@1")`, `@@type("sql/int@1")`): the script writes their stored values as digit text. The schema does not change: members are written as before, for example `Low = 1`. An `enum` typed by `sqlite/json@1` now stores the JSON text of each member's document, and the script rewrites its stored values to that text; in the schema, write each member as a string holding that JSON text, for example `Low = '"low"'` instead of `Low = "low"`, and `Level = "1"` instead of `Level = 1`.

## `sign-databases-after-upgrade`

The upgrade gives every contract a new storage hash. Each database's marker still holds the old hash, so until you sign it:

- `prisma db migrate` refuses to run with `MIGRATION.MARKER_MISMATCH`;
- `prisma db verify` exits with code 4 and `CONTRACT.MARKER_MISMATCH`;
- `prisma migration status` does not label the migrations applied before the upgrade as applied.

The running application does not report the mismatch: it keeps answering queries and logs nothing, because the `postgres()` client has no logger for the marker check.

Run `prisma db sign` against every database (development, staging, production) before you deploy the application built with the new contract:

```sh
prisma db sign --db "$DATABASE_URL"
```

`db sign` verifies the live schema of every contract space (the application's and each extension's) against its contract, then writes the marker of every space that verified, in one transaction on PostgreSQL and SQLite. It advances each signed space's `db` ref, or the ref `--advance-ref <name>` names. Running it again changes nothing. A space that fails verification is not signed: the command prints its differences and exits with code 4. Repair that schema first (for example a Supabase database whose `auth` schema drifted from the extension's contract), then sign again.

A script that reads `db sign --json` reads one outcome per space. The document was `{ ok, summary, contract, target, marker }` for the application's space; it is now:

```json
{
  "ok": true,
  "summary": "Database signed",
  "spaces": [
    {
      "space": "app",
      "status": "updated",
      "contract": { "storageHash": "…", "profileHash": "…" },
      "previous": { "storageHash": "…", "profileHash": "…" }
    }
  ],
  "advancedRefs": [{ "space": "app", "name": "db", "hash": "…" }]
}
```

Every space has `space`, `status` and `contract`, the hashes of the space's contract. `status` is `created` (the space had no marker), `updated` (with `previous`, the hashes the marker held), `unchanged` (the marker already held the contract's hashes), `failed` or `conflict`. A failed space also has `schema`, the verification result, and `ok` is `false`. A space in conflict is one whose marker another process, such as `migrate`, changed while `db sign` ran: it has `expected` and `found`, the marker hashes `db sign` read and the ones it found, it is not signed, and the command exits with code 4; run `db sign` again once that process has finished.

Code that signs through the programmatic control API calls `client.dbSign({ contract, migrationsDir })` instead of `client.sign({ contract })`, which is removed with `SignOptions` and `SignDatabaseResult`. `dbSign` verifies every contract space and signs each one that verified, as `db sign` does.

## `column-descriptors-drop-native-type`

In `contract.ts` and every other file that builds a column descriptor by hand, delete the `nativeType` property. The contract takes the column's data type from its codec.

```ts
// before
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const Priority = enumType('Priority', { codecId: 'pg/int4@1', nativeType: 'int4' }, member('Low', 0));

// after
const pgText = { codecId: 'pg/text@1' } as const;
const Priority = enumType('Priority', { codecId: 'pg/int4@1' }, member('Low', 0));
```

Code that reads a column of a stored contract (`contract.storage…tables[name].columns[name]`) reads `dataType`, the data type id such as `pg/text`, instead of `nativeType`, the database type name such as `text`:

```tsx
// before
<span className="col-type">{column.nativeType}</span>

// after
<span className="col-type">{column.dataType}</span>
```

Code that builds a stored contract's column by hand, for example a test fixture, writes the data type id in `dataType` instead of the type name in `nativeType`:

```ts
// before
id: { nativeType: 'uuid', nullable: false, codecId: 'pg/uuid@1' },

// after
id: { dataType: 'pg/uuid', nullable: false, codecId: 'pg/uuid@1' },
```

A type written by hand for such a contract changes the same way: `readonly nativeType: 'int4'` becomes `readonly dataType: 'pg/int4'`.

## `parameter-casts-use-base-names`

Update tests that assert query text or SQL snapshots:

| Before | After |
| --- | --- |
| `$1::integer` | `$1::int4` |
| `$1::smallint` | `$1::int2` |
| `$1::bigint` | `$1::int8` |
| `$1::real` | `$1::float4` |
| `$1::double precision` | `$1::float8` |
| `$1::boolean` | `$1::bool` |
| `$1::integer[]` | `$1::int4[]` |

Extension types keep their names (`$1::vector`, `$1::geometry`).

## `ts-contract-lists-extension-codecs`

A column's stored database type name is now written from the data type of the column's codec, so the contract build needs the pack that provides the codec. Add every extension whose codec the contract uses:

```ts
import pgvector from '@prisma/orm-extension-pgvector/pack';
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract(
  { extensions: { pgvector } },
  ({ field, model }) => ({
    // …
  }),
);
```

A contract that already lists the extension changes nothing. `contract.json` does not change.

## `sqlite-contract-d-ts-char-aggregates`

Run `prisma contract emit` for a SQLite project. The emitted `contract.d.ts` adds these rows under both `AggregateTypes.max.byCodec` and `AggregateTypes.min.byCodec`:

```ts
readonly 'sql/char@1': { readonly output: 'sql/char@1'; readonly nullable: true };
readonly 'sql/varchar@1': { readonly output: 'sql/varchar@1'; readonly nullable: true };
```

`contract.json`, `storageHash`, `profileHash` and migration snapshots do not change, so no migration or re-sign is needed.

## `column-helpers-raise-type-params-invalid`

The error now comes from `defineContract`, not from the helper call. Code that catches it by its code checks the new code, around the contract build:

```ts
// before
if (error.code === 'CONTRACT.ARGUMENT_INVALID') { /* … */ }

// after
if (error.code === 'CONTRACT.TYPE_PARAMS_INVALID') { /* … */ }
```

The error's `meta` is `{ dataType, parameters, modelName, fieldName }`, for example `{ dataType: 'postgis/geometry', parameters: ['srid'], modelName: 'Place', fieldName: 'location' }`, in place of `helperPath`, `expected` and `received`. A contract that passes `srid: 0` now fails when it is built; PostgreSQL refuses an SRID below 1, so such a column never migrated. Use a real SRID such as `4326`, or `geometryColumn` for a column with no SRID.

The build checks every column, so the PostgreSQL column helpers' parameters are checked too: a contract with `varcharColumn(0)` or `numericColumn(2000)` now fails when it is built, where before `migration plan` or `db verify` failed.

## `reemit-explicit-list-cardinality`

Re-run contract emission from each application's original PSL or TypeScript authoring source using its existing Prisma configuration (`pnpm exec prisma contract emit`, with `--config` where needed). Replace both `contract.json` and `contract.d.ts`, including contracts for composed spaces. Do not patch just the generated declarations or copy old hashes into newly emitted JSON. Scalar-only contract JSON remains compatible: omitted `many` in serialized model and value-object fields still means scalar. Generated domain-field declarations also omit scalar `many`; SQL storage-column declarations retain required cardinality.

For hand-authored contract objects, replace a list's `many: true` with `many: { elementNullable: false }` to preserve its existing strict-element meaning. Serialized non-list model and value-object fields may omit `many`; deserialization normalizes omission to `many: false`, and canonical emission omits it again. Keep nested `elementNullable: false` in list descriptors. Native SQL array columns use the same descriptor; non-array storage columns use `many: false`. If adopting an intermediate representation with a sibling `elementNullable`, move that property into the `many` descriptor and remove the sibling. Explicit malformed `many` values, including the old boolean-list form and descriptors without a boolean `elementNullable`, and sibling-property representations are rejected. Do not change relation cardinality or mark JSON-backed value-object storage as a native SQL array.

Keep `nullable` unchanged: it describes the whole value, not list elements. Existing `String[]` and `String[]?` declarations and `.many()` calls retain non-null elements. Only when nullable elements are intended, use `String?[]` / `String?[]?` or `.many({ elementsNullable: true })` / `.many({ elementsNullable: true }).nullable()`. The authoring option is plural `elementsNullable`; the emitted descriptor uses singular `elementNullable`. Generated types distinguish `ReadonlyArray<T | null>` from `ReadonlyArray<T> | null`.

Keep explicit `.noCheck('elementNotNull')` / `@noCheck(elementNotNull)` waivers on strict lists. They waive enforcement without permitting null in the declared element type. Do not infer nullable elements from a waiver or replace waivers during this representation upgrade. If intentionally changing a list to nullable elements, remove that now-inapplicable waiver and review the resulting PostgreSQL check-constraint change or MongoDB validator change separately.

## `refresh-historical-list-contracts`

For SQL contracts, the `contract-stores-data-type` script of the same release rewrites stored list columns and fields to this form and refreshes hashes and snapshot names, so historical SQL snapshots need no re-emission; MongoDB contracts still do. On PostgreSQL, the script keeps the membership check of an enum list column as the database holds it; run `prisma db sign` before you emit the contract again, and the next `prisma contract emit` writes the new check under a new name, which `prisma migration plan` and `prisma db migrate` then apply.

For MongoDB contracts, inventory every stored contract pair, not only the current application contract: include migration snapshots, fixture migration chains, composed-space snapshots, and any generated contracts imported by application tooling. Re-emit each historical state from its own authoring source and configuration, preserving that state's extensions, storage mappings, defaults, and explicit waivers. Do not emit today's schema over every historical snapshot.

Use the project's snapshot-store and migration-generation tooling to write each emitted JSON/declaration pair and update its references. The new native-list representation can change contract hashes even when existing strict-list DDL is unchanged. When a hash changes, create the corresponding content-addressed snapshot entry and update imports of both JSON and declarations, migration start/end contract hashes, and dependent migration metadata consistently. Process predecessor states before successors, including all branches and composed-space dependencies; regenerate derived migration identifiers and parent references where the tooling requires it. Preserve the recorded operations unless a separate reviewed schema change is intended.

Do not blanket-replace hexadecimal filenames, rename snapshot directories without updating references, edit hash fields by hand, or delete snapshots still referenced by a migration. Check that every reference resolves and that every stored JSON/declaration pair describes the same historical state. If the original source or a complete reference mapping is unavailable, stop and recover it rather than guessing.

For already-applied migrations, retain the original history and reconcile the database's recorded migration identities and contract markers through the project's supported migration procedure before deploying newly emitted contracts. Do not rewrite applied history or reset a database merely to satisfy the new hashes. Rehearse the transition on a disposable database and verify both the migration graph and database contract verification; a clean typecheck alone cannot establish consistency.

## `mongo-nullable-list-containers`

For Mongo schemas with nullable list containers (`T[]?` or `T?[]?`), re-emit the current `contract.json` and `contract.d.ts` using your normal `prisma contract emit` command. The collection validator now uses `bsonType: ['null', 'array']` for these fields; element constraints and required-list behavior are unchanged. The changed validator changes the storage hash, so keep the generated contract pair together.

For an existing database, preserve applied migrations and their contract snapshots. Plan a new migration from the existing contract to the re-emitted contract, review the validator update, and apply it through your normal migration deployment flow before writing explicit null containers. Deploying new application code alone does not update a Mongo collection validator. Do not rewrite applied historical migrations or their hashes.

For disposable example or test databases whose migration fixtures are regenerated from source, regenerate that fixture chain with its existing tooling, including referenced contract snapshots and migration metadata, and recreate the disposable database. In the Prisma 8 source repository, `pnpm fixtures:emit` re-emits current contracts and regenerates example migration fixtures; retain existing content-addressed snapshots alongside any newly emitted snapshots, then run the example's formatter/import organizer if new snapshot paths change import order. This fixture-only procedure is not a production migration procedure.

## `domain-types-match-their-columns`

Run `prisma contract emit`. `contract.json` and `contract.d.ts` gain these entries in the domain half:

| PSL | Added to the field's domain entry |
| --- | --- |
| `code Short`, with `types { Short = VarChar(10) }` (also `Short[]`) | `"typeParams": { "length": 10 }` on `type` |
| `roles Role[]`, where `Role` is an `enum` | `"valueSet": { "plane": "domain", "entityKind": "enum", "namespaceId": "public", "entityName": "Role" }`, as `role Role` already had |
| composite type member `amount Numeric(10, 2)` (also a list, or a named type) | `"typeParams": { "precision": 10, "scale": 2 }` on `type` |
| composite type member `role Role` or `roles Role[]` | the same `valueSet` as a model field of that enum |

A named type without parameters, such as `Email = String`, adds nothing.

In `contract.d.ts`, a composite type's output type (`AddressOutput`) now gives a member with type parameters the parameterized output type a model field of that type has, such as `Varchar<10>` or `Numeric<10, 2>`, instead of the codec's plain output type. These are branded strings, so code that builds such an output object from plain strings, such as a test fixture or a mock, no longer type-checks. Build the value as the ORM returns it, or type it with the composite type's input type (`AddressInput`), which is unchanged.

Migration snapshots under `migrations/snapshots/<hash>/` need no change. Migration commands read only their storage half, which is unchanged.

`prisma contract print` now expects a field typed by a parameterized named type, and an enum list field, to carry these domain entries. It refuses a contract emitted before this change that lacks them. Re-emit it first.

## `value-object-default-matches-composite-type`

A literal default on a field typed by a composite type used to be stored whatever its shape. It is now checked, naming the path that is wrong, as in `Field "User.home.street"`:

- A single value object takes a JSON object, and a list of them a JSON array: `` homes Address[] @default(json`{"street": "x"}`) `` is refused; write `@default([])` or `` @default(json`[{"street": "x"}]`) ``. JSON `null` is taken when the field is optional. `PSL_VALUE_TYPE_INCOMPATIBLE`.
- A key that is not a member is refused, and so is a missing member that is not optional, and `null` for a member that is not optional. `PSL_VALUE_TYPE_INCOMPATIBLE`.
- The default holds each member in the form its codec stores, so the member's codec must read the value. A `Decimal`, `Numeric(p, s)` or `BigInt` member takes a decimal string, `"1.5"`, and a number is refused; a `String` member takes a JSON string, so `"street": 1` is refused; a `DateTime` member takes a date and time string; a `Json` member takes any JSON value. `PSL_INVALID_DEFAULT_LITERAL`, with the codec's message.
- A member typed by an enum takes only the enum's values: `PSL_INVALID_DEFAULT_LITERAL`, `Expected one of:` the values.
- Nested value objects are checked the same way.

Correct the value the diagnostic names.

## `composite-type-attributes-refused`

An attribute inside a `type` block was ignored: `street String @default("x")` stored no default, and `@@map` mapped nothing. Each is now refused, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` on a member and `PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE` on the type. Remove the attribute. To give a value object a default, write it on the model field as a whole value, such as `` home Address @default(json`{"street": "x"}`) ``.

## `codecs-check-stored-json`

The built-in SQL, PostgreSQL and SQLite codecs now refuse a value that is not a stored form of their type, including one its type parameters rule out, where most used to pass it through. A TypeScript `.default()` given such a value is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` naming the model and field: a value of another kind, such as a number for a text column, or one the PostgreSQL column rules in `psl-values-checked-by-codecs` refuse, such as `'toolong'` for a `varchar(3)` column. A TypeScript `enumType` member its codec does not take is refused the same way, with `CONTRACT.ENUM_INVALID` naming the enum, the member and the codec: for example a `pg/char@1` or `sql/char@1` member longer than one character on PostgreSQL, since the enum's column is `character`, which holds one. Correct the value the error names.

A `contract.json` with such a default, emitted by an earlier version or edited by hand, still loads. `db init`, `db update` and `migration plan` used to plan the default; they now stop with `CONTRACT.DEFAULT_INVALID`, which names the table, the column, the codec and the value. Emit the contract again with this version, and correct the default in the contract source if emit refuses it. Running a `migration.ts` that an earlier version planned with such a default fails with the same message; correct the default in that file. Every statement that writes a default reads it this way: a new table or column, a changed default, and on SQLite a rebuilt table, which used to write a changed default or a rebuilt table's defaults unread. Each element of a list default is read the same way, and the message names the element's position: `Column "post"."tags" has a default (element 2) its codec pg/text@1 refuses: pg/text@1 JSON value must be a string`. A NULL element stays NULL. The codecs that carry PostgreSQL's own date and time text, those of `DateString`, `TimeString`, `TimestampString`, `TimestamptzString` and `Timetz`, read only a date or time in ISO 8601 or as PostgreSQL writes it, so such a default as `'now'`, which PostgreSQL would read once when it creates the table, is refused the same way. An `.include()` of such a column reads the text PostgreSQL writes in the ISO DateStyle, its default; on a server set to another DateStyle it now fails with `RUNTIME.DECODE_FAILED`, where it passed the text through. Set `DateStyle` to `ISO` on that server.

## `psl-values-checked-by-codecs`

The PSL reader reads each literal default, and each member of a SQL `enum`, with the column's codec, so the stricter codecs refuse schemas that loaded before. A value of another kind is refused: a text codec takes a string, an integer codec an integer in its range, `Boolean` `true` or `false`, and `Uuid` a UUID. On PostgreSQL the codecs also check what the column stores:

- `VarChar(n)` and `Char(n)` take at most n characters, counted by code point, and a `Char` value's trailing spaces do not count. A `Char` without a length is `character(1)`, so it takes one character.
- `Bit(n)` takes exactly n bits and `VarBit(n)` at most n, and a bit column without a length is `bit(1)`.
- `Numeric(p, s)` takes a value it stores without rounding.
- `Int`, `sql/int@1` and an enum whose members are integers take an integer from -2147483648 to 2147483647, and `SmallInt` one from -32768 to 32767.
- `Real` takes a finite number only if float4 holds it, neither overflowing to an infinity nor becoming 0.

Such a default used to load, and the migration planned and applied; the first insert that used the default then failed. A `Char` or bit column without a length, which did not apply on PostgreSQL whatever its default, now applies as `character(1)` or `bit(1)`. SQLite does not enforce a declared length, so on SQLite the char and varchar codecs take text of any length. Each of these is now refused at `contract emit`:

| Schema | Diagnostic |
| --- | --- |
| `enum P { @@type("pg/int4@1") Low = "low" }` | `PSL_EXTENSION_INVALID_VALUE`: `enum "P" member "Low" was rejected by codec "pg/int4@1": pg/int4@1 JSON value must be an integer from -2147483648 to 2147483647` |
| the same enum with a bare `Low` | `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`: `enum "P" member "Low" has no value and codec "pg/int4@1" does not accept a bare name as input` |
| `enum P { @@type("pg/text@1") Low = 1 }` | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/text has no cast from pg/int2; it casts from nothing` |
| an enum without `@@type` whose integer members include one outside -2147483648 to 2147483647, such as `Low = 3000000000` | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2` |
| `u Uuid @default("nope")` | `PSL_INVALID_LITERAL`, `"nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.` |
| `s VarChar(3) @default("toolong")` | `PSL_INVALID_DEFAULT_LITERAL`, `sql/varchar@1 JSON value must be a string of at most 3 characters` |
| `c Char @default("abc")` on PostgreSQL | `PSL_INVALID_DEFAULT_LITERAL`, `sql/char@1 JSON value must be a string of at most 1 character before any trailing spaces` |
| `enum P { @@type("sql/int@1") Low = 3000000000 }` on PostgreSQL | `PSL_EXTENSION_INVALID_VALUE`, `enum "P" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2` |
| `n Numeric(5, 2) @default(1.555)` | `PSL_INVALID_DEFAULT_LITERAL`, `pg/numeric@1 JSON value must be a decimal string that numeric(5, 2) stores without rounding` |

Give each enum member a value its codec takes, and each default a value its column's type holds unchanged. A `Uuid` default is still read in any form PostgreSQL reads; see `uuid-defaults-stored-as-postgresql-writes`.

## `uuid-defaults-stored-as-postgresql-writes`

A `Uuid` default may be written in any form PostgreSQL reads: either case, with or without a hyphen after any group of four digits, and optionally in braces. The contract now stores it as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and so does a TypeScript `.default()` on a `pg/uuid@1` column, so the applied default verifies against the database with no difference.

Earlier versions stored such a default as written. The database stores the lower-case form, so the check that runs after the change is applied failed: `db init`, `db update` and `db migrate` stopped with `MIGRATION.RUNNER_FAILED` and rolled the change back. The database has none of the changes that contract adds, and no marker for it. With this version, a `contract.json` that still holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, as `codecs-check-stored-json` describes.

Emit the contract again with this version. The stored default changes, and with it the storage hash. Then:

- For a project kept with `db init` or `db update`, run the command that failed again. It applies the contract, and `db verify` then passes.
- For a project with migrations, delete the migration package that never applied: its directory under `migrations/app/`, and its contract snapshot `migrations/snapshots/<hash>/`, where `<hash>` is the `to` hash in the package's `migration.json`. Then run `prisma migration plan` and `prisma db migrate`. Left in place, the package stays in the migration graph, ending at a contract no database reaches.

## `ts-enum-member-written-as-stored`

The types of a TypeScript contract name each `enumType` member as written, in `db.enums` and in the types of the fields that use the enum, while `contract.json` and the database hold what the column's codec stores. The two now have to be the same value, so `defineContract` refuses a member its codec stores as something else and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Key"): member "A" is written "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11", but the column stores "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11". Write the member as "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11".
```

A member its codec does not take at all, such as text that is not a uuid on `pg/uuid@1`, is refused with a different message; `codecs-check-stored-json` describes it.

Refused members:

- On a uuid column (`pg/uuid@1`), a member with an upper-case hex digit, in braces, or with hyphens anywhere other than the 8-4-4-4-12 positions (including none). Write it in lower case, hyphenated 8-4-4-4-12.
- A member that got past the type check with a value of another type its codec still takes, for example through a cast: the number `1` on `pg/int8@1`, which stores `"1"`, is refused with "Write the member as 1n".

1. Run `prisma contract emit`, or run the code that calls `defineContract`. Each refused member is reported with the value to write. To find uuid members first, search the calls to `member(` in your contract for a uuid that is not lower case, hyphenated 8-4-4-4-12. The detection for this change looks for calls to `enumType(`; if you import it under another name, as in `import { enumType as defineEnum }`, it does not find them, so search for that name.
2. Rewrite each refused member as the message says. Code that reads members through the enum, such as `Key.members.A` or `db.enums.public.Key.members.A`, needs no change. Code that compares a value with the old spelling does: values read from the database were always in the stored form.
3. Re-emit. If a column uses the enum, its membership CHECK constraint's expression changes, and a CHECK constraint's name is derived from its expression, so the storage hash and the constraint's name both change. Plan and apply a migration: it drops the old CHECK constraint and adds the new one. Dropping a constraint is a destructive operation, so the plan needs the destructive operation class allowed.

## `mongo-codecs-check-json`

A Mongo codec's `decodeJson` reads the JSON form of its type. The Mongo runtime reads documents through `decode` and never calls it; the PSL reader calls it for each member of an enum. `mongo/string@1`, `mongo/objectId@1`, `mongo/int32@1`, `mongo/double@1`, `mongo/bool@1`, `mongo/vector@1` and `mongo/bson@1` used to return any JSON value as it was, so an enum member of the wrong kind was stored in the contract:

```prisma
enum Priority {
  @@type("mongo/int32@1")
  Low = "low"
}
```

This is now refused with `PSL_EXTENSION_INVALID_VALUE`, naming the codec's message, `mongo/int32@1 JSON value must be an integer from -2147483648 to 2147483647`. A member written without a value, such as a bare `Low`, under a codec that does not take text is `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`. Give each member a value of the codec's type.

Each codec now takes: `mongo/string@1` a string; `mongo/objectId@1` 24 hexadecimal digits; `mongo/int32@1` an integer from -2147483648 to 2147483647; `mongo/double@1` a number, or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which its `encodeJson` now writes for those values instead of a number JSON cannot hold; `mongo/bool@1` a boolean; `mongo/date@1` the text `Date.toISOString()` writes; `mongo/vector@1` an array of numbers; and `mongo/bson@1` canonical Extended JSON, the form its `encodeJson` writes. Another value throws `RUNTIME.DECODE_FAILED` with the codec id in `meta`. A TypeScript `enumType` member that `mongo/objectId@1` or `mongo/int32@1` does not hold now throws `RUNTIME.ENCODE_FAILED` when the contract is built.

## `text-array-elements-nullable`

`pg/text-array@1`, the codec of a contract-free `textArray()` column, reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`. Code typed by a `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`. Read through an `.include()`, a two-dimensional `text[]` value now throws `RUNTIME.DECODE_FAILED`, where it read as the text `"a,b"`.

## `char-reads-drop-only-padding`

PostgreSQL pads a `char(n)` value with spaces to its length: `'a'` in a `char(3)` column is stored as `'a  '`. A flat read dropped every trailing whitespace character, so a stored `'a\t'` also read as `"a"`, while `.include()` returned the padded text, `"a  "`. Both reads now return the value without the padding and nothing more: `"a"` for `'a'`, and `"a\t"` for `'a\t'`. On SQLite, which does not pad, both reads drop trailing spaces, as a flat read did. Code that compared an included `char` value with its padding, or relied on a flat read dropping a trailing tab or newline, compares the value without its padding.

## `sqlite-nan-parameters-refused`

SQLite cannot store NaN: bound as a parameter, it becomes NULL. So `create({ value: 0 / 0 })` on an optional `Float` column stored NULL, and `where((p) => p.value.eq(Number.NaN))` matched nothing. On SQLite, `sqlite/real@1` and `sql/float@1` now refuse NaN with `RUNTIME.ENCODE_FAILED`, `<codecId> value must be a number other than NaN, which SQLite cannot store`, with `meta.codecId` and `meta.received`: when they encode a value to write or filter by, and when they encode a TypeScript `.default()`, which is still refused when the contract is built with `CONTRACT.DEFAULT_INVALID`, now with this message. Their `decodeJson` refuses the text `"NaN"`. A NaN parameter no codec encoded, such as one in raw SQL, is refused by the SQLite driver with the same code: `Parameter 2 is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`, with `meta.paramIndex`, counted from 0. On a required column SQLite already refused the NULL, so only the error changes. Where a computed value can be NaN, write `null` for no value, and filter with `isNull()` for rows that have none. Infinity and -Infinity are stored and read back as before.

## `sqlite-int-include-refuses-inexact-values`

`sql/int@1` holds a JavaScript safe integer. On SQLite, an INTEGER column can hold a larger integer or a REAL. An `.include()` read such a value rounded or with a fraction; it now throws `RUNTIME.DECODE_FAILED`, naming the codec. A flat read is unchanged. Store an integer past 2^53 in a `BigInt` column and a fraction in a `Float` column.

## `prefixed-sql-tags-are-removed`

`pg.sql` and `sqlite.sql` were second names for the `sql` tag. They are removed, and a schema that uses one is refused with `PSL_UNKNOWN_LITERAL_TAG`: `Unknown literal tag "pg.sql". Known tags: sql, json.`

Replace the tag with `sql` and leave the text unchanged:

```diff
- createdAt DateTime @default(pg.sql`(now() + interval '1 hour')`)
+ createdAt DateTime @default(sql`(now() + interval '1 hour')`)
```

The stored default does not change, so no migration follows.

## `default-diagnostic-codes-changed`

This matters only to code that reads PSL diagnostic codes, such as a test that asserts one. The messages did not change, except for a `sql` literal inside a list literal and the list of known tags, both described below the table.

| Refusal | Old code | New code |
| --- | --- | --- |
| A tag no pack registered | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `PSL_UNKNOWN_LITERAL_TAG` |
| A `json` literal whose text is not a JSON document | `PSL_INVALID_JSON_LITERAL` | `PSL_INVALID_LITERAL` |
| Text an authoring entry or a cast refused | `PSL_INVALID_DEFAULT_LITERAL` | `PSL_INVALID_LITERAL` |
| A value whose type the column's type has no cast from, including a list written on a column that holds one value | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A written form the target has no data type for | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_VALUE_TYPE_INCOMPATIBLE` |
| A single value on a list column | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `PSL_DEFAULT_LIST_EXPECTED` |
| A value the column's codec refused | `PSL_INVALID_DEFAULT_LITERAL` | unchanged |
| A `sql` literal inside a list literal | `PSL_INVALID_DEFAULT_LITERAL`, at the element | `PSL_VALUE_TYPE_INCOMPATIBLE`, at the `@default` attribute |

`PSL_INVALID_JSON_LITERAL` no longer exists.

The unknown-tag message lists the known tags in the order the stack registers them. The SQL family registers `sql` before the target registers `json`, so a Postgres or SQLite stack lists `sql, json`, where it used to list `json, sql, pg.sql` or `json, sql, sqlite.sql`. The completion list and the `Expected one of` message of `@default` offer `sql` before `json` for the same reason.

A `sql` literal inside a list literal used to report `Literal tag "sql" produces a default of its own and cannot be an element of a list literal.` It is now refused by the cast rule, like any other value the column's type does not take: `Field "Post.tags" at element 1: pg/text has no cast from sql/expression; it casts from nothing`. Write the whole list as one `sql` literal instead, as in `` @default(sql`'{}'::text[]`) ``.

This supersedes the codes named in the `data-types-column-defaults` app instructions of the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: where they name `PSL_DEFAULT_TYPE_INCOMPATIBLE` for a value a column's type has no cast from, or `PSL_INVALID_JSON_LITERAL`, read the new codes above.

## `migration-ts-column-defaults`

A `migration.ts` no longer carries a column default as SQL text. The control adapter writes the `DEFAULT …` clause for every statement, the same way for a new table, a new column, a changed default and a rebuilt SQLite table, and it reads a literal default with the column's codec first. A `migration.ts` that sets a default the codec refuses fails when it runs, with `CONTRACT.DEFAULT_INVALID` naming the table and the column.

On PostgreSQL, `setDefault` takes the column and its default:

```typescript
// before
this.setDefault({ table: 'user', column: 'role', defaultSql: "DEFAULT 'member'" })
// after
this.setDefault({ table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }) })
```

On SQLite, a column in `addColumn` or `recreateTable` carries the default and its codec, and a `recreateTable` postcheck that checks a default names the column:

```typescript
// before
{ name: 'role', typeSql: 'TEXT', defaultSql: "DEFAULT 'member'", nullable: false }
{ description: 'verify "role" default on "user"', sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE ..." }
// after
{ name: 'role', typeSql: 'TEXT', default: { kind: 'literal', value: 'member' }, codecRef: { codecId: 'sqlite/text@1' }, nullable: false }
{ description: 'verify "role" default on "user"', columnDefault: 'role' }
```

An applied migration needs nothing: `db migrate` applies `ops.json`, which holds the SQL. Change a `migration.ts` this way only when you run it again to write `ops.json`. `node migration.ts` does not check types, so an earlier file still runs; `setDefault`, `addColumn` and `recreateTable` then refuse a `defaultSql` with `MIGRATION.OPERATION_OPTION_REMOVED`, naming the table and the column, rather than leave the default out. Rewrite the call as shown, or, if the migration is not applied, delete its package and run `migration plan` again.

The `migration.ts` that `migration plan` writes for a new SQLite table now gives each column its `codecRef`, so running it writes the same `ops.json` as the plan. To apply a changed PostgreSQL default that an earlier version planned, see [`postgres-changed-default-applied`](#postgres-changed-default-applied).

## `postgres-changed-default-applied`

A migration operation that changes an existing default on PostgreSQL checked afterwards only that the column has a default. The old default passes that check, and the runner skips an operation whose check already passes, so the default stayed as it was and verification then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. Such an operation now has no check afterwards and always runs; setting a default twice changes nothing.

A migration package an earlier version planned keeps the old check in `ops.json`. If one changes a default and you have not applied it, write its `ops.json` again before you apply it with `prisma db migrate`. Either delete the package and run `prisma migration plan` again, or rewrite its `setDefault` call in `migration.ts` to the form [`migration-ts-column-defaults`](#migration-ts-column-defaults) shows and then run the file (`node migration.ts`). Run unchanged, the file stops with `MIGRATION.OPERATION_OPTION_REMOVED`, because its `setDefault` still passes `defaultSql`. `db update` plans again each time, so it needs nothing.

## `cli-error-from-caught`

`mapCaughtMigrationError(error)`, exported from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`), returned a CLI error unchanged and `null` for anything else, which the caller wrapped as `CLI.UNEXPECTED`. `errorFromCaught(error, why)`, exported from the same place, does the whole job: it returns a CLI error unchanged, reports any other error with a structured `NAMESPACE.SUBCODE` code as itself, reports anything else as `CLI.UNEXPECTED` with `why` given the error's message, and throws an `InternalError` again. Replace `mapCaughtMigrationError(error) ?? errorUnexpected(...)` with `errorFromCaught(error, (message) => ...)`. A caller that holds a database connection string passes it as `errorFromCaught(error, why, { connection })`, which removes it from every field of the reported error.

## `sql-with-a-line-comment-gets-a-new-wire-name`

Prisma names an index, check or policy after a hash of its SQL body. Before hashing, it normalizes the body. A body that contains `--` now keeps its line breaks, because a line break ends the comment and so changes what the body means. Every other body normalizes as before.

This affects an index expression or predicate, a check expression, or a policy `using` or `withCheck` that contains both `--` and a line break. For such an object, re-emitting the contract changes the stored index, check or policy name in `contract.json`. The stored body does not change; only the hash input does.

Re-emit the contract and run `migration plan`. The name's hash suffix changes, so the planned migration drops and recreates each affected object once.

## `strict-verify-unclaimed-code`

For each place that reads `CONTRACT.MARKER_REQUIRED` from a `prisma db verify --strict` run to detect tables no contract declares, read `CONTRACT.SCHEMA_VERIFICATION_FAILED` instead, or read the names from the result's `unclaimed` list. Leave code that reads `CONTRACT.MARKER_REQUIRED` to detect an unsigned database unchanged.

## `prisma7-schema-date-types-are-text`

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`:

1. Run `prisma contract emit`. The date and time fields change type:

   | Prisma 7 field | Before | Now | Example value |
   | --- | --- | --- | --- |
   | `DateTime`, `DateTime @db.Timestamp(p)` | `Temporal.PlainDateTime` | `string` | `"2026-09-14 10:00:00.123"` (UTC, as Prisma 7 writes it) |
   | `DateTime @db.Timestamptz(p)` | `Temporal.Instant` | `string` | `"2026-09-14 10:00:00.123+00"` (on a server whose `TimeZone` is UTC) |
   | `DateTime @db.Date` | `Temporal.PlainDate` | `string` | `"2026-09-14"` |
   | `DateTime @db.Time(p)` | `Temporal.PlainTime` | `string` | `"10:00:00.123"` |

   `@db.Timetz` fields already read as text and do not change.

2. Change the code that reads or writes these fields:

   - `DateTime` and `@db.Timestamp`: the text holds UTC wall-clock time with a space between the date and the time, where `.toString()` on a `Temporal.PlainDateTime` printed a `T`. Where code printed or stored that form, replace `value.toString()` with `value.replace(' ', 'T')`. Where it compares or computes with the value, `` new Date(`${value.replace(' ', 'T')}Z`) `` is the instant.
   - `@db.Timestamptz`: the text carries the offset of the database session's `TimeZone`, `+00` on a server set to UTC. Do not apply `replace(' ', 'T')` to it. `new Date(value)` parses it in Node.js, and `new Date(value).toISOString()` prints the instant in UTC ending in `Z`, the form `.toString()` on a `Temporal.Instant` printed, with milliseconds always present.
   - `@db.Date` and `@db.Time`: the text is the form `.toString()` on a `Temporal.PlainDate` or `Temporal.PlainTime` printed.

   Write a string PostgreSQL reads, such as `"2026-09-14 10:00:00"` for `DateTime` or `"2026-09-14T10:00:00Z"` for `@db.Timestamptz`, instead of a `Temporal` value. `@updatedAt` still writes UTC, as it did before and as Prisma 7 does, so existing rows need no change.

3. If no other code in the application uses `Temporal`, remove the `import 'temporal-polyfill/full/global'` it had for these fields, and remove `temporal-polyfill` from the application's `dependencies`. Keep the dependency in a project that installs with Yarn: `@prisma/orm-postgres` declares it as a peer dependency, and Yarn does not install peers on its own.

4. Run `prisma db sign` against every database the application uses. The storage hash changed with the column types. Until a database is signed, `prisma db verify --db "$DATABASE_URL"` exits with code 4 and reports `CONTRACT.MARKER_MISMATCH`. The running application does not report the mismatch: it keeps answering queries and logs nothing, because the `postgres()` client has no logger for the marker check. The database itself needs no migration.

`prisma7Schema(...)` has no option to keep the `Temporal` types. A project that wants them writes a Prisma 8 contract, for example with `prisma contract print --output prisma/contract.prisma`, and changes the types there.

## `contract-infer-writes-text-date-types`

Nothing changes until `prisma contract infer` runs again. When it does, the rewritten contract uses the text types for `timestamp`, `timestamptz`, `date` and `time` columns. Follow steps 1 to 4 of `prisma7-schema-date-types-are-text` for the fields that changed, or change the types back to `Timestamp(p)`, `Timestamptz(p)`, `Date` and `Time(p)` in the inferred file to keep `Temporal` values.

A default of `infinity` or `-infinity` on one of these columns now prints as `@default("infinity")` where it printed a `sql` expression.

## `text-timestamp-now-is-utc`

This covers `temporal.timestampString(p, onCreate: now, onUpdate: now)` in PSL and `field.temporal.timestampString(...)` with `'now'` in TypeScript. Rows these fields wrote before this release on a host outside UTC hold that host's local time; rows written from now on hold UTC. A Prisma 7 `DateTime @updatedAt` read through `prisma7Schema(...)` is not affected: it wrote UTC before and still does.

## `contract-infer-writes-bytea-default-literals`

Nothing changes until `prisma contract infer` runs again. A schema that keeps the `sql` default keeps working: schema verification reads it as the same bytes as the default in the database.

When infer runs again, it writes each `bytea` default as the base64 the `Bytes` codec stores:

| Before | Now |
| --- | --- |
| ``@default(sql`'\\x68656c6c6f'::bytea`)`` | `@default("aGVsbG8=")` |
| ``@default(sql`ARRAY['\\x68656c6c6f'::bytea]`)`` | `@default(["aGVsbG8="])` |

1. Run `prisma contract emit`. The default is now stored as a value, so the storage hash changes. The default in the database does not change.
2. If you create the database with `prisma db init` or `prisma db update`, run `prisma db verify --schema-only` to confirm the schema matches, then `prisma db sign` to sign the database with the re-emitted contract.
3. If you use migrations, `prisma migration plan` refuses with "Contract changed but planner produced no operations", because nothing in the database changes. Run `prisma migration new --name bytea-default-literals` to write an empty migration from the earlier contract to the re-emitted one, then `prisma db migrate`. When `migration new` cannot tell where to start, pass `--from` with the `to` hash of your latest migration, which `prisma migration list` shows.

Sign the database or apply the migration before you deploy the re-emitted contract. Until then `prisma db verify` exits with code 4 and `CONTRACT.MARKER_MISMATCH`, because the database marker holds the earlier storage hash. The running application does not report the mismatch: it keeps answering queries and logs nothing.

## `prisma6-int-written-as-long`

Prisma 6 stores a plain `Int` on MongoDB as a BSON long and presents it as a `number`. A contract read with `prisma6Schema(...)` used to give such a field the 32-bit int codec, so Prisma 8 wrote new values as BSON ints, and a fractional number was accepted and stored as a double. It now uses `mongo/int64Number@1`: a stored long reads as a `number`, Prisma 8 writes a `number` back as a long, and a value that is not a whole number within ±(2^53 − 1) is refused instead of rounded. The application type does not change.

1. Repair every document in which a plain `Int` field holds a fractional number, whether the field is on the model, in an `Int[]` list, or in a composite type the model holds once or in a list. The previous contract let Prisma 8 store such a value as a BSON double, and `mongo/int64Number@1` refuses to read it (`RUNTIME.DECODE_FAILED`, "wire value is the fractional double 2.5"), so a query that returns such a document fails as a whole. For each plain `Int` field, in the collection its model is stored in, with the MongoDB shell (`mongosh`) or the driver:
   - List the affected documents, to decide how to repair them. For a field on the model, this finds the fractional values:

     ```js
     db.Post.find({ likes: { $type: 'double' }, $expr: { $ne: ['$likes', { $trunc: '$likes' }] } })
     ```

     For a list or a composite value, this finds every document with a double in the field: `db.Post.find({ scores: { $type: 'double' } })` for an `Int[]` field, and `db.Post.find({ 'addresses.zip': { $type: 'double' } })` for `zip` in a composite type, whether `addresses` holds one value or a list.

   - Store every double in the field as a long. Choose `$round` or `$trunc`: `$round` rounds to the nearest whole number and a half to the even one (2.5 becomes 2, 3.5 becomes 4); `$trunc` drops the fraction (2.9 becomes 2). Whole-number doubles become longs either way.

     ```js
     db.Post.updateMany({ likes: { $type: 'double' } }, [
       { $set: { likes: { $toLong: { $round: ['$likes', 0] } } } },
     ])
     ```

   - For an `Int[]` field, convert each double in the list:

     ```js
     db.Post.updateMany({ scores: { $type: 'double' } }, [
       {
         $set: {
           scores: {
             $map: {
               input: '$scores',
               in: {
                 $cond: [
                   { $eq: [{ $type: '$$this' }, 'double'] },
                   { $toLong: { $round: ['$$this', 0] } },
                   '$$this',
                 ],
               },
             },
           },
         },
       },
     ])
     ```

   - For a field of a composite type the model holds once (`address Address?`), write its dotted path (`'address.zip'` and `'$address.zip'`) in the filter and the update above.
   - For a field of a composite type the model holds in a list (`addresses Address[]`), the dotted path fails with "$round only supports numeric types, not array". Rewrite each element of the list instead:

     ```js
     db.Post.updateMany({ 'addresses.zip': { $type: 'double' } }, [
       {
         $set: {
           addresses: {
             $map: {
               input: '$addresses',
               in: {
                 $mergeObjects: [
                   '$$this',
                   {
                     zip: {
                       $cond: [
                         { $eq: [{ $type: '$$this.zip' }, 'double'] },
                         { $toLong: { $round: ['$$this.zip', 0] } },
                         '$$this.zip',
                       ],
                     },
                   },
                 ],
               },
             },
           },
         },
       },
     ])
     ```

   Here `Post`, `likes`, `scores`, `address`, `addresses` and `zip` stand for the collection and the field names in the database, after `@@map` and `@map`.
2. Run `prisma contract emit`. In `contract.d.ts`, each plain `Int` field of the Prisma 6 schema is now typed with `mongo/int64Number@1` instead of `mongo/int32@1`; both read and write a `number`, so application code needs no change. `db sign` and `db verify` need nothing new: the contract carries no validators.

## `prisma6-bytes-objectid-is-hex`

Before this release, `prisma6Schema(...)` refused every native type other than `String @db.ObjectId`. It now reads each native type Prisma 6 accepts on MongoDB as the codec for the BSON type Prisma 6 stores. Only `DateTime @db.Timestamp` is still refused.

A `Bytes @db.ObjectId` field stores an ObjectId, so Prisma 8 treats it like `String @db.ObjectId`: reads return the 24-digit hex string, and writes take a hex string or an ObjectId. The Prisma 6 client uses 12 bytes for the same field, and Prisma 8 refuses a `Buffer` or `Uint8Array` there.

Where application code that moves to the Prisma 8 client passes or reads such a field, convert at the boundary:

- bytes to the hex string Prisma 8 takes: `bytes.toString('hex')` for a `Buffer`, `Buffer.from(bytes).toString('hex')` for a `Uint8Array`
- the hex string Prisma 8 returns to bytes: `Buffer.from(hex, 'hex')`

The stored values do not change: Prisma 6 and Prisma 8 read and write the same ObjectId.

## `writes-on-a-conditional-collection-are-refused`

`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` and `include` now return the collection they were called on, with what they establish added to its type as a fact. A custom collection class keeps its methods through the chain, so `db.Post.where({ userId }).withTitle('orm')` and `db.Post.include('user').withTitle('orm')` compile.

The facts have names. Write a filtered collection's type as `Filtered<C>` and an ordered one as `Ordered<C>`. `Filtered<C>` is `C & HasWhere`, and `HasWhere` is the name error messages print. Import the names from the `orm-client` entry of your facade, for example `@prisma/orm-postgres/orm-client`.

This entry and `cursor-and-distinct-on-check-the-receiver`, `apply-is-a-collection-member`, `overriding-a-chaining-method`, `collection-state-flags-are-boolean`, `read-collection-state-and-row-with-helpers`, `return-type-of-a-chaining-method`, `chaining-methods-take-no-explicit-type-arguments` and `custom-collection-methods-chain` apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

A write needs a collection that is filtered on every code path. Code that filters only on some paths compiled before and no longer does:

```ts
const posts = search ? db.Post.withTitle(search) : db.Post;
await posts.deleteAll(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasWhere'
```

The same applies to an `if` with an early return, a `switch`, a loop, and a `let` reassigned in an `if`. Make the write only where the filter was applied, or filter on every path:

```diff
- const posts = search ? db.Post.withTitle(search) : db.Post;
- await posts.deleteAll();
+ if (search) {
+   await db.Post.withTitle(search).deleteAll();
+ }
```

If the code relied on deleting or updating every row when there is no filter, that was the unsafe case the check now refuses. State the intent with an explicit filter instead.

## `writes-refuse-what-they-would-ignore`

`updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter. They ignored a `limit`, an `offset`, a `cursor`, `distinct` and `distinctOn` on the collection, so a chain such as `db.orm.public.Post.where(...).limit(10).deleteAll()` deleted every matching row, not ten, and one with `.cursor({ id })` deleted the rows before the cursor too. They now throw `ORM.ARGUMENT_INVALID` instead. An order does not change which rows they change, and they still accept it. Remove what the write would ignore, or read the rows and change them by their ids:

```diff
- await db.orm.public.Post.where({ userId }).limit(10).deleteAll();
+ const ids = (await db.orm.public.Post.where({ userId }).select('id').limit(10).all()).map((p) => p.id);
+ await db.orm.public.Post.where((p) => p.id.in(ids)).deleteAll();
```

`update` and `delete` change one row, the one `first()` returns, so the order, the offset, the cursor, `distinct` and `distinctOn` choose it; they are unchanged, except after `limit(0)`. `first()` replaces the limit with 1, so after `limit(0)` they changed one row; they now change none and return `null`. A `limit(0)` that a request can set, such as a page size of zero, no longer writes.

The exception is `update` with a relation callback, such as `posts: (posts) => posts.connect(...)`. It finds its row by the filter alone and ignored the order, the limit, the offset, the cursor, `distinct` and `distinctOn`, so it could change another row than the chain chose. It now throws `ORM.ARGUMENT_INVALID` on a collection with any of them. Find the row first and filter to it:

```diff
- await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).update({ posts: (posts) => posts.connect([{ id: postId }]) });
+ const oldest = await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).select('id').first();
+ if (oldest) await users.where({ id: oldest.id }).update({ posts: (posts) => posts.connect([{ id: postId }]) });
```

## `cursor-and-distinct-on-check-the-receiver`

`cursor` and `distinctOn` need an order on the collection they are called on. The check is on the receiver, so a cast on the argument no longer bypasses it:

```ts
await db.Post.cursor({ id } as never).all(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasOrderBy'
```

Add the order the query needs:

```diff
- await db.Post.cursor({ id } as never).all();
+ await db.Post.orderBy((post) => post.id.asc()).cursor({ id }).all();
```

Where the query is meant to run without an order, cast the collection instead of the argument:

```ts
import type { Ordered } from '@prisma/orm-postgres/orm-client';

const unordered = db.Post as Ordered<typeof db.Post>;
await unordered.cursor({ id }).all();
```

## `apply-is-a-collection-member`

Collections have a new method, `apply(fn)`, which calls `fn` with the collection and returns the result. A custom collection class that declares its own `apply` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   apply(limit: number) { return this.limit(limit); }
+   firstPage(limit: number) { return this.limit(limit); }
  }
```

An aggregate operation named `apply` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## `scope-is-a-collection-member`

The `scope` change applies to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

Collections have a new method, `scope(body)`, which defines a scope for the collection's model: `db.orm.public.Post.scope((posts) => posts.select('id', 'title'))`. A custom collection class that declares its own `scope` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   scope(userId: string) { return this.where({ userId }); }
+   ownedBy(userId: string) { return this.where({ userId }); }
  }
```

An aggregate operation named `scope` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## `overriding-a-chaining-method`

A class that extends `Collection` and overrides one of the chaining methods, or one of the methods that return rows (`all`, `first`, `create`, `createAll`, `upsert` and the writes), must declare the override with the new signature: a type parameter for the receiver, a `this` parameter of that type, and the result type the base method returns. Call the base method with `call` and explicit type arguments, so that the receiver type passes through:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   override limit(n: number) {
-     return super.limit(Math.min(n, 100));
-   }
+   override limit<Self>(this: Self, n: number): Self {
+     return super.limit.call<Self, [number], Self>(this, Math.min(n, 100));
+   }
  }
```

Only classes that extend the SQL `Collection` are affected; skip matches in other classes.

## `collection-state-flags-are-boolean`

`DefaultCollectionTypeState` declares `hasWhere`, `hasOrderBy` and `hasUniqueFilter` as `boolean`, meaning not known. A method that establishes a flag sets it to `true`. Where your code expects `false`, expect `boolean`:

```diff
- type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], false>;
+ type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], boolean>;
```

A type of your own that sets a flag to `false` should set it to `boolean`. The writes still need `hasWhere: true`, and `cursor` and `distinctOn` still need `hasOrderBy: true`.

## `read-collection-state-and-row-with-helpers`

`where`, `orderBy` and `include` record what they establish in two declared properties, not in the type arguments of `Collection`. Inferring the third or fourth type argument gives the row and the state the collection started with. Read them with `CollectionRowOf` and `CollectionTypeStateOf` instead:

```diff
- type RowOf<C> = C extends Collection<infer _C, infer _M, infer Row, infer _S> ? Row : never;
- type UsersRow = RowOf<typeof users>;
+ import type { CollectionRowOf } from '@prisma/orm-postgres/orm-client';
+ type UsersRow = CollectionRowOf<typeof users>;
```

To keep a helper of your own, constrain its parameter, because both helpers require one:

```ts
import type { CollectionRowOf, CollectionTypeStateOf, HasRow, HasTypeState } from '@prisma/orm-postgres/orm-client';

type RowOf<C extends HasRow> = CollectionRowOf<C>;
type StateOf<C extends HasTypeState> = CollectionTypeStateOf<C>;
```

## `return-type-of-a-chaining-method`

The chaining methods are generic in their receiver, and `ReturnType` of a generic method uses the constraint of its type parameter. `ReturnType<PostCollection['where']>` is now `HasWhere`, and `ReturnType<PostCollection['limit']>` is `unknown`. Write the type with `Filtered` after `where`, `Ordered` after `orderBy`, and the collection type itself after `limit`, `offset`, `distinct`, `distinctOn` and `cursor`. You can also take `typeof` of a value:

```diff
- type MatchingPosts = ReturnType<PostCollection['where']>;
+ import type { Filtered } from '@prisma/orm-postgres/orm-client';
+ type MatchingPosts = Filtered<PostCollection>;
```

`ReturnType` of a method of your own class, such as `ReturnType<PostCollection['withTitle']>`, still works.

## `chaining-methods-take-no-explicit-type-arguments`

These methods infer their receiver from the call. With explicit type arguments the receiver is not inferred: `posts.include<'user'>('user')` does not compile, `posts.distinct<['title']>('title')` and `posts.distinctOn<['title']>('title')` fail with "Expected 2 type arguments, but got 1", and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments. They are inferred from the arguments, so `distinct<['title']>('title')` becomes `distinct('title')`:

```diff
- const titles = posts.distinct<['title']>('title');
+ const titles = posts.distinct('title');
```

To name the type of an include, call `include` on a value and take its type:

```diff
- type WithUser = ReturnType<typeof posts.include<'user'>>;
+ const withUser = posts.include('user');
+ type WithUser = typeof withUser;
```

## `custom-collection-methods-chain`

Custom collection methods are now available after `where`, `orderBy`, `limit` and the other chaining methods. Where code on a client built with `orm({ collections })` repeats a class method's body inline after a chaining call on that class, it can call the method. A client without custom classes, such as `db.orm`, has no such methods.

```diff
  return db.Post.forUser(userId)
-   .orderBy((post) => post.createdAt.desc())
+   .newestFirst()
    .limit(limit)
    .all();
```

Here `newestFirst()` is a method of the application's `PostCollection` whose body is that `orderBy`.

## `variant-takes-discriminator-value`

For every `.variant(...)` call matched by `detection`, replace the variant's model name with the discriminator value that variant declares. Read the value from the contract: in PSL it is the second argument of the variant's `@@base(Base, "<value>")`; in the TypeScript builder it is the `value` under the base model's `discriminator.variants.<VariantName>`; in `contract.json` it is `domain.namespaces.<ns>.models.<Base>.variants.<VariantName>.value`.

```ts
// before
db.orm.public.Task.variant('Bug');
db.orm.events.variant('ViewProductEvent');

// after, for @@base(Task, "bug") and a ViewProductEvent variant declaring "view-product"
db.orm.public.Task.variant('bug');
db.orm.events.variant('view-product');
```

Custom collection methods that call `this.variant('<ModelName>')`, and helpers or closures that call `.variant()`, change the same way. When the argument is a variable or a forwarded parameter, follow it back to where the model name is written and replace it there, including in type annotations that list variant model names. Update code comments and READMEs that show `.variant('<ModelName>')` too.

The type checker catches most old call sites, because the parameter only accepts the base model's declared values. It does not catch a call whose model-name argument happens to equal a declared value, for example a variant model declared with `@@base(Base, "Admin")`. Such a call keeps compiling and now selects the variant declaring that value, so check every call site against the contract rather than relying on type errors.

A call that passes a value through `as never` or another cast also escapes the type checker. At runtime, a value the base model does not declare, or a `variant()` call on a model without a discriminator, throws `ORM.ARGUMENT_INVALID`. The error names the model and lists its declared values. Previously the call returned the collection unchanged, so the query read every variant. Code that relied on that fallback must stop calling `variant()` in that case.

A second `.variant()` call on a variant collection is rejected. It no longer replaces the first selection: it is a type error, and at runtime it throws `ORM.OPERATION_UNSUPPORTED` naming the model and the discriminator value already selected. Select each variant from the base collection instead, and keep a reference to the base collection where code needs more than one variant.

```ts
// before
const bugs = db.orm.public.Task.variant('Bug');
const features = bugs.variant('Feature');

// after
const tasks = db.orm.public.Task;
const bugs = tasks.variant('bug');
const features = tasks.variant('feature');
```

## `imported-postgres-field-checks-defaults`

`import { field } from '@prisma/orm-postgres/contract-builder'` now gives the same field builders the `defineContract` callback receives, without the ones an extension adds: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()`, and `field.column(columnType)` as before. Its `.default(...)` now checks the value against the Postgres target's column types; a column type an extension adds, such as pgvector's `vector`, is not checked. A default of another type no longer compiles:

```diff
- field.column(int8Column).default(1)
+ field.column(int8Column).default(1n)
```

## `re-emit-for-the-row-locking-capabilities`

The typed SQL builder gains four methods that lock the rows a select reads, named after the SQL they render: `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()`. Each takes an optional `{ of, nowait, skipLocked }`: `of` names the tables or aliases to lock, and `nowait` and `skipLocked` exclude each other. A lock lasts until the transaction ends, so use it inside `db.transaction(...)`:

```ts
await db.transaction(async (tx) => {
  const [job] = await tx.query(
    tx.sql.public.job
      .select('id')
      .where((f, fns) => fns.eq(f.state, 'queued'))
      .limit(1)
      .forUpdate({ skipLocked: true })
      .build(),
  );
});
```

Each method and each option is gated on a capability key that the Postgres adapter now reports: `sql.forUpdate`, `sql.forShare`, `postgres.forNoKeyUpdate`, `postgres.forKeyShare`, and `sql.lockOf`, `sql.lockNowait`, `sql.lockSkipLocked` for the options. A `contract.json` emitted before this release carries none of them, so the methods do not exist on its builder.

Re-emit your contract to pick up the keys:

```console
prisma contract emit
```

Nothing else changes. The keys are additive, the storage hash does not move, and every existing query behaves exactly as before. You only need to re-emit if you want to use the new methods. SQLite reports none of the keys, because SQLite has no row locks.

## `cache-annotation-ttl-removed`

The read annotation no longer carries a lifetime. The store decides how long an entry lives. The default store, which `createCacheMiddleware()` uses when you pass no `store`, keeps every entry for 60 seconds.

This also changes behaviour without a type error. Before, a read annotated without `ttl` (`cacheAnnotation({})`, `cacheAnnotation({ key })`, or a `ttl` that evaluated to `undefined`) was not cached. Now every annotated read in runtime scope is cached. If a read must stay uncached, remove its annotation, or pass `cacheAnnotation({ bypass: true })`.

In each file that calls `cacheAnnotation(...)`:

1. Remove the `ttl` property. `cacheAnnotation({ ttl: 60_000 })` becomes `cacheAnnotation({})`, and `cacheAnnotation({ ttl, key })` becomes `cacheAnnotation({ key })`.
2. Remove any variable, function parameter or option field that existed only to supply that `ttl` (for example a `ttlMs` option on a helper that wraps the annotated read), and remove it from its callers.
3. If every read used the same lifetime and it was not 60 seconds, set it once on the store: `createCacheMiddleware({ store: createInMemoryCacheStore({ ttlMs }) })`. `ttlMs: Infinity` never expires. If reads need different lifetimes, write a custom `CacheStore` that reads the lifetime from the annotation's `meta` (see `cache-store-object-arguments`), and pass it as `cacheAnnotation({ meta: { ttlMs } })`.
4. Update comments and READMEs that say the annotation needs a `ttl`, that caching happens "within the TTL window" of the annotation, or that an annotation without `ttl` passes through. Say instead that an annotated read is cached and the default store keeps the entry for 60 seconds.

Before:

```ts
export async function getUsersCached(limit = 10, ttlMs = 60_000) {
  const plan = db.sql.public.user
    .select('id', 'email')
    .annotate(cacheAnnotation({ ttl: ttlMs }))
    .limit(limit)
    .build();
  return db.runtime().query(plan);
}
```

After:

```ts
export async function getUsersCached(limit = 10) {
  const plan = db.sql.public.user
    .select('id', 'email')
    .annotate(cacheAnnotation({}))
    .limit(limit)
    .build();
  return db.runtime().query(plan);
}
```

## `cache-annotation-skip-renamed-bypass`

In each file that imports from `@prisma/orm-extension-middleware-cache`:

1. Rename `skip` to `bypass` in every `cacheAnnotation(...)` argument: `cacheAnnotation({ skip: forceRefresh })` becomes `cacheAnnotation({ bypass: forceRefresh })`. Only rename `skip` inside a `cacheAnnotation` argument or a value typed `CachePayload`; leave other `skip` properties alone.
2. Rename the type `CachePayload` to `CacheAnnotationOptions`, in imports and in uses.
3. Update comments that describe `skip` on the annotation, or that say `skip` wins over a `ttl`.

## `cache-middleware-store-options`

In each call to `createCacheMiddleware(...)`:

- If the options contain only `maxEntries: 1000` (or `1_000`), and no `clock`, call `createCacheMiddleware()` with no options.
- Otherwise, move `maxEntries` and `clock` to a store: `createCacheMiddleware({ maxEntries: 500 })` becomes `createCacheMiddleware({ store: createInMemoryCacheStore({ maxEntries: 500 }) })`, importing `createInMemoryCacheStore` from `@prisma/orm-extension-middleware-cache`. The middleware's `clock` used to stamp `storedAt` only; it now drives the store's expiry.

`createInMemoryCacheStore` options are all optional now: `maxEntries` (default 1000), `ttlMs` (default 60 000) and `clock` (default `Date.now`).

## `cache-store-object-arguments`

Only for code that implements `CacheStore`, as a typed object, a class, or an object literal passed inline to `createCacheMiddleware({ store: { ... } })`. The types reject the old shape, but an untyped JavaScript store fails only at run time, so check each one.

1. Keep a version per key: an integer, 0 for a key never seen, that only `unset` changes. Keep it even for keys that hold no value, for at least as long as a read can take.
2. Change `get(key)` to `get({ key, meta })`, returning a `CacheEntry`: `{ key, meta, version, data }`, where `meta` is the `meta` passed in, `version` the key's current version, and `data` is `{ empty: true }` on a miss or `{ empty: false, value }` with the stored rows. `meta` is the read annotation's `meta`, or `undefined`. A store that matches `meta` folds the versions of whatever `meta` names into `version`, and does the same in `set`; a store that does not index `meta` ignores it here.
3. Change `set(key, entry, ttlMs)` to `set(entry, value)`, returning a boolean. `entry` is the `CacheEntry` your `get` returned; `value` is the rows. Store `value` under `entry.key` only if the key's version still equals `entry.version`, and return whether you stored. The comparison and the write must be atomic against `unset`: one synchronous step in memory, or one server-side script (for example Lua on Redis). There is no unconditional write and no `ttlMs` argument: the store sets the lifetime itself, as a fixed value or read from `entry.meta`. Code that prefilled the cache with `set(key, entry, ttlMs)` now calls `get` and then `set`.
4. Add `unset({ keys, meta })`. It removes the values stored under `keys` when `keys` is not `undefined`, and increments the version of every one of those keys, whether or not it holds a value. When `meta` is not `undefined`, it removes the values whose `meta` matches, compared by value, and increments their versions; a store that does not index `meta` must throw instead of ignoring it.
5. Replace `CachedEntry` with `CachedRows` (the rows, `readonly Record<string, unknown>[]`) for stored values and `CacheEntry` for what `get` returns. Type the store as `CacheStore<TMeta>`, which is `CacheStore<TMeta, CachedRows>`; `createCacheMiddleware` rejects a store of any other value type, `unknown` included. There is no `storedAt`.

Before:

```ts
const store: CacheStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as CachedEntry) : undefined;
  },
  async set(key, entry, ttlMs) {
    await redis.set(key, JSON.stringify(entry), 'PX', ttlMs);
  },
};
```

After:

```ts
const SET_IF_VERSION = `
  if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[1], 'PX', 60000)
  return 1`;

const store: CacheStore<unknown, CachedRows> = {
  async get({ key, meta }) {
    const [raw, version] = await redis.mget(`value:${key}`, `version:${key}`);
    return {
      key,
      meta,
      version: Number(version ?? 0),
      data: raw ? { empty: false, value: JSON.parse(raw) as CachedRows } : { empty: true },
    };
  },
  async set(entry, value) {
    const keys = [`value:${entry.key}`, `version:${entry.key}`];
    const json = JSON.stringify(value);
    return (await redis.eval(SET_IF_VERSION, 2, ...keys, json, entry.version)) === 1;
  },
  async unset({ keys, meta }) {
    if (meta !== undefined) {
      throw new Error('This store does not index meta');
    }
    for (const key of keys ?? []) {
      await redis
        .multi()
        .del(`value:${key}`)
        .incr(`version:${key}`)
        .pexpire(`version:${key}`, 60_000)
        .exec();
    }
  },
};
```

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.15`; any other difference in the emitted files comes from an earlier entry in this guide.
