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
  - id: field-type-params-come-from-the-domain-type
    summary: |
      A field's type parameters now come from its domain type only. `EmissionSpi.resolveFieldTypeParams` is removed, `generateFieldOutputTypesMap` from `@internal/emitter` takes `(models, codecLookup)`, and `buildSqlContractFromDefinition` reads a field's type parameters from its descriptor. Drop the hook and the resolver argument, and give a value-object field its column's descriptor.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bresolveFieldTypeParams\b'
        - '\bgenerateFieldOutputTypesMap\s*\('
        - '\bbuildSqlContractFromDefinition\s*\('
  - id: codec-lookup-has-no-descriptor-for
    summary: |
      `CodecLookup` no longer has `descriptorFor`. A lookup that builds a column's codec is a `CodecLookupWithDescriptors`, whose `descriptorFor` is required: the `codecLookup` option of `defineContract`, `ContractSourceContext.codecLookup` and `CodecRegistry`. `emptyCodecLookup` is a plain `CodecLookup`. Type such a lookup `CodecLookupWithDescriptors` and give it a `descriptorFor` that answers from the same codecs as `get`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCodecLookup\b'
        - '\bemptyCodecLookup\b'
        - '\bcodecLookup\s*:'
        - '\bdescriptorFor\?\.'
  - id: codecs-decode-json-reads-stored-forms
    summary: |
      A built-in codec's `decodeJson` now throws `RUNTIME.DECODE_FAILED` for JSON that is not a stored form of its type. Pass it the stored form. A codec an extension contributes should read the same way: every form the database writes for its type, and nothing else.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bdecodeJson\b'
  - id: mongo-codec-requires-decode-json
    summary: |
      `mongoCodec` now requires `decodeJson` unless the codec's application type is exactly `JsonValue`. Add a `decodeJson` that refuses JSON of another kind with `RUNTIME.DECODE_FAILED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmongoCodec\s*\('
  - id: sql-float-json-helpers-removed
    summary: |
      `sqlFloatEncodeJson`, `sqlFloatDecodeJson` and `isNonFiniteText` are no longer exported from `@internal/sql-relational-core/ast`. Use `encodeJsonFloat`, `decodeJsonFloat(codecId, json)` and `isNonFiniteText` from `@internal/framework-components/codec`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bsqlFloat(?:En|De)codeJson\b'
        - '\bisNonFiniteText\b'
  - id: sql-infer-psl-contract-takes-build-context
    summary: |
      A SQL target's `inferPslContract` hook now takes the stack's PSL build context as its second parameter, `(schema, context, describedContracts?)`, as `buildPslContract` does. A target that implements it accepts the context and reads type constructors and codecs from it. Code that called the hook on a target descriptor calls it on the SQL family instance instead, which supplies the context.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\binferPslContract\b'
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
  - id: adapter-writes-column-defaults
    summary: |
      The control adapter writes every column's `DEFAULT …` clause, through a new required method, `renderColumnDefault(column, table)`, on `ExecuteRequestLowerer` and `SqlControlAdapter` (`family/control-adapter`). An adapter, and any fake lowerer in tests, must implement it. `buildColumnDefaultSql` is removed from `target/planner-ddl-builders`: build the column and call `renderColumnDefault`. `SetDefaultCall` (`target/op-factory-call`) takes the column, `new SetDefaultCall(schema, table, column, operationClass)`, instead of its name and `defaultSql`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbuildColumnDefaultSql\b'
        - '\bnew\s+SetDefaultCall\s*\('
        - '(?<![.\w])lowerToExecuteRequest\s*[(:]'
        - '\bimplements\b[^{]*\b(?:ExecuteRequestLowerer|SqlControlAdapter)\b'
  - id: adapter-control-loads-temporal-polyfill
    summary: |
      The adapter's control entry, `adapter/control` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`, now loads `temporal-polyfill` too, as the target's control entry does since `temporal-polyfill-is-a-peer-dependency`. A Yarn project that added the polyfill for that change needs nothing more. An extension package that installs with Yarn and loads only the adapter's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '[''"]@prisma/orm-(?:target-)?postgres/adapter/control[''"]'
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

A pack that ships a contract with such fields re-emits it with `build:contract-space` (`prisma contract emit`).

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

`pg/text-array@1`, the codec of a contract-free `textArray()` column, reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`, and so is its entry in the Postgres `CodecTypes`. Code typed by a `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`. Read through an `.include()`, a two-dimensional `text[]` value now throws `RUNTIME.DECODE_FAILED`, where it read as the text `"a,b"`.

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

## `field-type-params-come-from-the-domain-type`

- `buildSqlContractFromDefinition` takes a model field's domain type parameters from its `descriptor.typeParams`, or else from the named storage type its `descriptor.typeRef` names. A value-object model field carries its column's `descriptor` (the target's value-object storage type) instead of the builder assuming `jsonb`. A value-object member has no `columnName` and is typed by a codec and its type parameters only.
- `EmissionSpi.resolveFieldTypeParams` is removed. A family whose domain fields do not carry their type parameters puts them there when it builds the contract.
- `generateFieldOutputTypesMap` from `@internal/emitter` takes `(models, codecLookup)`: its third parameter, the type-parameter resolver, is removed with the hook.

## `codec-lookup-has-no-descriptor-for`

`codecForRef(lookup, ref)` from `@internal/framework-components/codec` builds a column's codec from its descriptor, with the column's type parameters, so everything that builds one takes a `CodecLookupWithDescriptors`. `CodecLookup` no longer declares `descriptorFor`, not even as optional. Each of these no longer compiles:

- a `codecLookup` for `defineContract` or a `ContractSourceContext` without `descriptorFor`. Add one, as the registry `assemblePostgresCodecRegistryWithBuiltins` returns does, or leave `codecLookup` out of `defineContract` so it assembles the target's registry;
- a stub built as `{ ...emptyCodecLookup, get }` where a `CodecLookupWithDescriptors` is expected, because `emptyCodecLookup` no longer has a `descriptorFor` that answers `undefined`. Add a `descriptorFor` that answers for the same codecs as `get`, so the two never disagree;
- an object literal typed `CodecLookup` that sets `descriptorFor`, or a call `lookup.descriptorFor?.(id)` on a `CodecLookup`. Type the lookup `CodecLookupWithDescriptors` and call `descriptorFor(id)`.

## `codecs-decode-json-reads-stored-forms`

Code that calls a built-in codec's `decodeJson` must pass the stored JSON form of its type; another kind throws `RUNTIME.DECODE_FAILED` with the codec id in `meta`. A codec an extension contributes should follow the same rule, stated on `Codec.decodeJson` in `@internal/framework-components/codec`: read a stored JSON form of its type, including every form the database writes for it, and throw on anything else.

A codec's `decodeJson` reads a value in the stored JSON form of its type: a column's literal default in `contract.json`, a member of a value-object default, and a value inside the JSON the database returns for an included relation. The text codecs (`pg/text@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sqlite/text@1`, `pg/enum@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/tsquery@1`, `pg/timetz@1`, `pg/text-array@1` and the date and time codecs), the integer codecs `pg/int4@1`, `pg/int2@1` and `sql/int@1`, and `pg/bool@1` used to pass any JSON value through. Each now refuses a value of another kind with `RUNTIME.DECODE_FAILED`, naming the codec: a text codec takes a JSON string, `pg/int4@1` a JSON integer from -2147483648 to 2147483647, `pg/int2@1` one from -32768 to 32767, `sql/int@1` a safe integer, or on PostgreSQL, where its column is an int4, an integer from -2147483648 to 2147483647, `pg/bool@1` `true` or `false`, `pg/uuid@1` a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and a bit string only `0` and `1`. `pg/vector@1` refuses JSON that is not an array of the column's number of finite numbers with the same shape, as in `pg/vector@1 JSON value must be an array of 3 finite numbers`, where it said `Vector length mismatch` or `Vector value must contain only numbers`. `pg/int8@1` and `sqlite/bigint@1` take decimal text in the signed 64-bit range. `pg/timestamptz-date@1` refused a bad string with a plain `RangeError`; it now raises `RUNTIME.DECODE_FAILED` like the others. Every form PostgreSQL and SQLite write for a value the application type holds is still read; see `text-array-elements-nullable` and `sqlite-int-include-refuses-inexact-values` for the two stored values that now throw instead of reading wrong.

The float codecs `pg/float8@1`, `pg/float4@1`, `pg/float@1`, `sql/float@1` and `sqlite/real@1` take a finite JSON number or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which PostgreSQL writes for those values in JSON, and `encodeJson` writes that text for them. SQLite writes an infinity in JSON as `9.0e+999`, so on SQLite the float codecs' JSON projection writes the text instead. `sql/float@1`, `pg/float@1` and `sqlite/real@1` used to refuse NaN and the infinities, so an `.include()` of a row holding one failed with `RUNTIME.DECODE_FAILED`; it now reads the value. SQLite cannot store NaN, so on SQLite `sqlite/real@1` and `sql/float@1` refuse it; see `sqlite-nan-parameters-refused`.

Helpers for following the rule:

- `@internal/framework-components/codec` exports the JSON readers every family's codecs share: `decodeJsonString`, `decodeJsonMatching`, `decodeJsonBoolean`, `decodeJsonInteger` (with an `IntegerRange`), `decodeJsonIntegerText` (decimal text, with an optional `BigIntRange`), `decodeJsonFloat` and `encodeJsonFloat`, and `refuseJsonValue`, which raises the refusal they all raise: `RUNTIME.DECODE_FAILED`, `<codecId> JSON value must be <what it takes>`, with `meta.codecId` and `meta.received`, the value it got as JSON text, cut to 100 characters. It also exports the ranges they take, `INT32_RANGE` and `SAFE_INTEGER_RANGE` (`IntegerRange`, which `isIntegerIn(value, range)` tests a value against) and `INT64_RANGE` and `SAFE_INTEGER_BIGINT_RANGE` (`BigIntRange`), and `isNonFiniteText`, which says whether text is `NaN`, `Infinity` or `-Infinity`. The built-in codecs' refusals no longer say `database JSON value`.
- `@internal/utils/text` exports `counted`, which writes a count and its noun for a refusal, such as `3 characters`, and `withoutTrailing(text, character)`, which drops a trailing run of one character in time linear in the run's length.

## `mongo-codec-requires-decode-json`

`mongoCodec` now requires `decodeJson` when the codec's application type is narrower than `JsonValue`, such as `string` or `number`; only a codec whose application type is exactly `JsonValue` may leave it out. A codec that leaves it out no longer compiles. Supply a `decodeJson` that refuses a JSON value of another kind with `RUNTIME.DECODE_FAILED`, such as `decodeJsonString` or another reader from `@internal/framework-components/codec`.

## `sql-float-json-helpers-removed`

Replace `sqlFloatEncodeJson(value)` with `encodeJsonFloat(value)` and `sqlFloatDecodeJson(json)` with `decodeJsonFloat(codecId, json)`, and import `isNonFiniteText` from `@internal/framework-components/codec` instead of `@internal/sql-relational-core/ast`. An import of `isNonFiniteText` that already names `@internal/framework-components/codec` needs no change.

## `sql-infer-psl-contract-takes-build-context`

The SQL family calls a target's `inferPslContract(schema, context, describedContracts?)` with the same `SqlPslBuildContext` it passes `buildPslContract`: the stack's authoring contributions, codec lookup and data types. `contract emit` reads the inferred schema with that stack, so a target reads a written type's codec and type parameters from `context.authoringContributions.type` and `context.codecLookup` instead of a table of its own. A target that implements the hook adds the parameter.

Code that called the hook on a target descriptor, such as a script that infers PSL from an introspected schema, has no context to pass. It calls the SQL family instance's `inferPslContract(schema)`, which builds the context from the control stack it was created with:

```ts
// before
const inferPslContract = postgresTargetDescriptor.inferPslContract;
if (!inferPslContract) {
  throw new Error('the postgres target descriptor has no inferPslContract');
}
const ast = inferPslContract(rawSchemaNode);

// after
const ast = sqlFamilyDescriptor.create(controlStack).inferPslContract(rawSchemaNode);
```

`sqlFamilyDescriptor` is the default export of `@internal/family-sql/control`, and `controlStack` is the stack `createControlStack` from `@internal/framework-components/control` builds for the family, target, adapter and driver the script already uses.

## `cli-error-from-caught`

`mapCaughtMigrationError(error)`, exported from `@prisma/orm-toolchain/cli/control-api` (`@internal/cli/control-api`), returned a CLI error unchanged and `null` for anything else, which the caller wrapped as `CLI.UNEXPECTED`. `errorFromCaught(error, why)`, exported from the same place, does the whole job: it returns a CLI error unchanged, reports any other error with a structured `NAMESPACE.SUBCODE` code as itself, reports anything else as `CLI.UNEXPECTED` with `why` given the error's message, and throws an `InternalError` again. Replace `mapCaughtMigrationError(error) ?? errorUnexpected(...)` with `errorFromCaught(error, (message) => ...)`. A caller that holds a database connection string passes it as `errorFromCaught(error, why, { connection })`, which removes it from every field of the reported error.

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

The `migration.ts` that `migration plan` writes for a new SQLite table now gives each column its `codecRef`, so running it writes the same `ops.json` as the plan.

## `adapter-writes-column-defaults`

The control adapter writes every column default that DDL writes, for a new table, a new column, a changed default and a rebuilt SQLite table, through one method on `ExecuteRequestLowerer`, which `SqlControlAdapter` extends (`family/control-adapter` of `@prisma/orm-postgres`, `@prisma/orm-sqlite` and `@prisma/orm-family-sql`):

```typescript
renderColumnDefault(column: DdlColumn, table: string): Promise<string>
```

It returns the `DEFAULT …` clause for the column, or `''` when the column has none or writes it another way, as an autoincrement column does. It reads a literal default, and each element of a list default, with the column's codec first, so a value the codec refuses is `CONTRACT.DEFAULT_INVALID` naming the table and the column.

- **An `ExecuteRequestLowerer` or `SqlControlAdapter` implementation** must add the method, and so must a fake lowerer in tests. An adapter returns the clause its CREATE TABLE writes for the column. To read a literal default with the column's codec, use `encodeLiteralDefault` and `encodeListLiteralDefault` from `relational-core/ast`. A fake that writes no defaults can return `''`:

  ```typescript
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: '', params: [] }),
    lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
    renderColumnDefault: async () => '',
  };
  ```

- **`buildColumnDefaultSql`** is removed from `target/planner-ddl-builders` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`. Build the column with `col`, `lit` and `fn` from `relational-core/contract-free`, and ask the adapter for the clause:

  ```typescript
  // before
  const clause = buildColumnDefaultSql({ kind: 'literal', value: 'member' }, { nativeType: 'text' });
  // after
  const clause = await adapter.renderColumnDefault(
    col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }),
    'user',
  );
  ```

- **`SetDefaultCall`** (`target/op-factory-call` of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`) takes the column instead of its name and the SQL text:

  ```typescript
  // before
  new SetDefaultCall('public', 'user', 'role', "DEFAULT 'member'", 'widening');
  // after
  new SetDefaultCall('public', 'user', col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }), 'widening');
  ```

## `adapter-control-loads-temporal-polyfill`

The adapter contributes the PostgreSQL type constructors, which it imports from the target's control entry, and that entry sets up the fallback `Temporal` from `temporal-polyfill`. So the adapter's control entry, `@prisma/orm-postgres/adapter/control` or `@prisma/orm-target-postgres/adapter/control`, now loads `temporal-polyfill` as well. Both packages declare it as a required peer dependency, and npm, pnpm and bun install it automatically.

For each Yarn project whose tests or tooling load the adapter's control entry, `detection` finds the import. If the project's `package.json` does not already list `temporal-polyfill`, add `"temporal-polyfill": "^1.0.4"` to its `devDependencies` and reinstall. Without it, a test or script that loads the adapter's control entry fails because Node.js cannot find the package `temporal-polyfill`.
