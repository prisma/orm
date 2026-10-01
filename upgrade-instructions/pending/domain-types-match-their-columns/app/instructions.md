---
changes:
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
  - id: codecs-check-stored-json
    summary: |
      A TypeScript `.default()` value or `enumType` member that its column's codec does not take is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` or `CONTRACT.ENUM_INVALID`. A `contract.json` that holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, and a `migration.ts` that holds one fails when it runs. Correct the value the error names.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.default\(\s*(?!now\(|sql`|autoincrement\()'
        - '\benumType\s*\('
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
  - id: mongo-codecs-check-json
    summary: |
      The built-in Mongo codecs now refuse a JSON value that is not the JSON form of their type, where most passed it through: a PSL enum member whose value its `@@type` codec does not take is now refused at `contract emit`, and a TypeScript `enumType` member that `mongo/objectId@1` or `mongo/int32@1` does not hold is refused when the contract is built. Correct the member.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '@@type\(\s*"mongo/'
        - '[''"]mongo/(?:objectId|int32)@1[''"]'
        - '\bMONGO_(?:OBJECTID|INT32)_CODEC_ID\b'
  - id: composite-type-attributes-refused
    summary: |
      An attribute on a composite type or on one of its members is now refused, where it used to be ignored. Remove it.
    detection:
      glob: "**/*.prisma"
      matches:
        - '^\s*type\s+\w+\s*\{'
  - id: cli-error-from-caught
    summary: |
      `mapCaughtMigrationError` is removed from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`). Use `errorFromCaught(error, why)`, which always returns an error: a CLI error as it is, any error with a structured code as itself, and anything else as `CLI.UNEXPECTED` with `why(message)`. It throws an `InternalError` again.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmapCaughtMigrationError\b'
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
---

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

## `codecs-check-stored-json`

The built-in SQL, PostgreSQL and SQLite codecs now refuse a value that is not a stored form of their type, including one its type parameters rule out, where most used to pass it through. A TypeScript `.default()` given such a value is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` naming the model and field: a value of another kind, such as a number for a text column, or one the PostgreSQL column rules in `psl-values-checked-by-codecs` refuse, such as `'toolong'` for a `varchar(3)` column. A TypeScript `enumType` member its codec does not take is refused the same way, with `CONTRACT.ENUM_INVALID` naming the enum, the member and the codec: for example a `pg/char@1` or `sql/char@1` member longer than one character on PostgreSQL, since the enum's column is `character`, which holds one. Correct the value the error names.

A `contract.json` with such a default, emitted by an earlier version or edited by hand, still loads. `db init`, `db update` and `migration plan` used to plan the default; they now stop with `CONTRACT.DEFAULT_INVALID`, which names the table, the column, the codec and the value. Emit the contract again with this version, and correct the default in the contract source if emit refuses it. Running a `migration.ts` that an earlier version planned with such a default fails with the same message; correct the default in that file. Every statement that writes a default reads it this way: a new table or column, a changed default, and on SQLite a rebuilt table, which used to write a changed default or a rebuilt table's defaults unread. Each element of a list default is read the same way, and the message names the element's position: `Column "post"."tags" has a default (element 2) its codec pg/text@1 refuses: pg/text@1 JSON value must be a string`. A NULL element stays NULL. The codecs that carry PostgreSQL's own date and time text, those of `DateString`, `TimeString`, `TimestampString`, `TimestamptzString` and `Timetz`, read only a date or time in ISO 8601 or as PostgreSQL writes it, so such a default as `'now'`, which PostgreSQL would read once when it creates the table, is refused the same way. An `.include()` of such a column reads the text PostgreSQL writes in the ISO DateStyle, its default; on a server set to another DateStyle it now fails with `RUNTIME.DECODE_FAILED`, where it passed the text through. Set `DateStyle` to `ISO` on that server.

## `text-array-elements-nullable`

`pg/text-array@1`, the codec of a contract-free `textArray()` column, reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`. Code typed by a `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`. Read through an `.include()`, a two-dimensional `text[]` value now throws `RUNTIME.DECODE_FAILED`, where it read as the text `"a,b"`.

## `char-reads-drop-only-padding`

PostgreSQL pads a `char(n)` value with spaces to its length: `'a'` in a `char(3)` column is stored as `'a  '`. A flat read dropped every trailing whitespace character, so a stored `'a\t'` also read as `"a"`, while `.include()` returned the padded text, `"a  "`. Both reads now return the value without the padding and nothing more: `"a"` for `'a'`, and `"a\t"` for `'a\t'`. On SQLite, which does not pad, both reads drop trailing spaces, as a flat read did. Code that compared an included `char` value with its padding, or relied on a flat read dropping a trailing tab or newline, compares the value without its padding.

## `sqlite-nan-parameters-refused`

SQLite cannot store NaN: bound as a parameter, it becomes NULL. So `create({ value: 0 / 0 })` on an optional `Float` column stored NULL, and `where((p) => p.value.eq(Number.NaN))` matched nothing. On SQLite, `sqlite/real@1` and `sql/float@1` now refuse NaN with `RUNTIME.ENCODE_FAILED`, `<codecId> value must be a number other than NaN, which SQLite cannot store`, with `meta.codecId` and `meta.received`: when they encode a value to write or filter by, and when they encode a TypeScript `.default()`, which is still refused when the contract is built with `CONTRACT.DEFAULT_INVALID`, now with this message. Their `decodeJson` refuses the text `"NaN"`. A NaN parameter no codec encoded, such as one in raw SQL, is refused by the SQLite driver with the same code: `Parameter 2 is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`, with `meta.paramIndex`, counted from 0. On a required column SQLite already refused the NULL, so only the error changes. Where a computed value can be NaN, write `null` for no value, and filter with `isNull()` for rows that have none. Infinity and -Infinity are stored and read back as before.

## `sqlite-int-include-refuses-inexact-values`

`sql/int@1` holds a JavaScript safe integer. On SQLite, an INTEGER column can hold a larger integer or a REAL. An `.include()` read such a value rounded or with a fraction; it now throws `RUNTIME.DECODE_FAILED`, naming the codec. A flat read is unchanged. Store an integer past 2^53 in a `BigInt` column and a fraction in a `Float` column.

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
| `enum P { @@type("pg/text@1") Low = 1 }` | `PSL_EXTENSION_INVALID_VALUE`, `pg/text@1 JSON value must be a string` |
| an enum without `@@type` whose integer members include one outside -2147483648 to 2147483647, such as `Low = 3000000000` | `PSL_EXTENSION_INVALID_VALUE`, `pg/int@1 JSON value must be an integer from -2147483648 to 2147483647` |
| `u Uuid @default("nope")` | `PSL_INVALID_LITERAL`, `"nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.` |
| `s VarChar(3) @default("toolong")` | `PSL_INVALID_DEFAULT_LITERAL`, `sql/varchar@1 JSON value must be a string of at most 3 characters` |
| `c Char @default("abc")` on PostgreSQL | `PSL_INVALID_DEFAULT_LITERAL`, `sql/char@1 JSON value must be a string of at most 1 character before any trailing spaces` |
| `enum P { @@type("sql/int@1") Low = 3000000000 }` on PostgreSQL | `PSL_EXTENSION_INVALID_VALUE`, `sql/int@1 JSON value must be an integer from -2147483648 to 2147483647` |
| `n Numeric(5, 2) @default(1.555)` | `PSL_INVALID_DEFAULT_LITERAL`, `pg/numeric@1 JSON value must be a decimal string that numeric(5, 2) stores without rounding` |

Give each enum member a value its codec takes, and each default a value its column's type holds unchanged. A `Uuid` default is still read in any form PostgreSQL reads; see `uuid-defaults-stored-as-postgresql-writes`.

## `uuid-defaults-stored-as-postgresql-writes`

A `Uuid` default may be written in any form PostgreSQL reads: either case, with or without a hyphen after any group of four digits, and optionally in braces. The contract now stores it as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and so does a TypeScript `.default()` on a `pg/uuid@1` column, so the applied default verifies against the database with no difference.

Earlier versions stored such a default as written. The database stores the lower-case form, so the check that runs after the change is applied failed: `db init`, `db update` and `db migrate` stopped with `MIGRATION.RUNNER_FAILED` and rolled the change back. The database has none of the changes that contract adds, and no marker for it. With this version, a `contract.json` that still holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`, as `codecs-check-stored-json` describes.

Emit the contract again with this version. The stored default changes, and with it the storage hash. Then:

- For a project kept with `db init` or `db update`, run the command that failed again. It applies the contract, and `db verify` then passes.
- For a project with migrations, delete the migration package that never applied: its directory under `migrations/app/`, and its contract snapshot `migrations/snapshots/<hash>/`, where `<hash>` is the `to` hash in the package's `migration.json`. Then run `prisma migration plan` and `prisma db migrate`. Left in place, the package stays in the migration graph, ending at a contract no database reaches.

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

## `composite-type-attributes-refused`

An attribute inside a `type` block was ignored: `street String @default("x")` stored no default, and `@@map` mapped nothing. Each is now refused, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` on a member and `PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE` on the type. Remove the attribute. To give a value object a default, write it on the model field as a whole value, such as `` home Address @default(json`{"street": "x"}`) ``.

## `cli-error-from-caught`

`mapCaughtMigrationError(error)`, exported from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`), returned a CLI error unchanged and `null` for anything else, which the caller wrapped as `CLI.UNEXPECTED`. `errorFromCaught(error, why)`, exported from the same place, does the whole job: it returns a CLI error unchanged, reports any other error with a structured `NAMESPACE.SUBCODE` code as itself, reports anything else as `CLI.UNEXPECTED` with `why` given the error's message, and throws an `InternalError` again. Replace `mapCaughtMigrationError(error) ?? errorUnexpected(...)` with `errorFromCaught(error, (message) => ...)`. A caller that holds a database connection string passes it as `errorFromCaught(error, why, { connection })`, which removes it from every field of the reported error.

## `postgres-changed-default-applied`

A migration operation that changes an existing default on PostgreSQL checked afterwards only that the column has a default. The old default passes that check, and the runner skips an operation whose check already passes, so the default stayed as it was and verification then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. Such an operation now has no check afterwards and always runs; setting a default twice changes nothing.

A migration package an earlier version planned keeps the old check in `ops.json`. If one changes a default and you have not applied it, write its `ops.json` again before you apply it with `prisma db migrate`. Either delete the package and run `prisma migration plan` again, or rewrite its `setDefault` call in `migration.ts` to the form [`migration-ts-column-defaults`](#migration-ts-column-defaults) shows and then run the file (`node migration.ts`). Run unchanged, the file stops with `MIGRATION.OPERATION_OPTION_REMOVED`, because its `setDefault` still passes `defaultSql`. `db update` plans again each time, so it needs nothing.

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
