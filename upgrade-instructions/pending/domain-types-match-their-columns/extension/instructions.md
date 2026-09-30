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
      The built-in SQL, PostgreSQL and SQLite codecs now refuse a JSON value that is not a stored form of their type, including one its type parameters rule out, where they used to pass it through. A TypeScript `.default()` value or `enumType` member of that kind is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` or `CONTRACT.ENUM_INVALID`. The elements of a `textArray()` column can now be `null`. Correct the value the error names, and handle `null` elements.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.default\(\s*(?!now\(|sql`|autoincrement\()'
        - '\benumType\s*\('
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
  - id: psl-values-checked-by-codecs
    summary: |
      A PSL schema whose SQL enum member its codec does not take, or whose literal default its column's type does not hold, is now refused at `contract emit`, where it used to load. Correct the member or the default.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"(?:pg|sql|sqlite)/'
        - '^\s*\w+\s*=\s*-?\d{10,}\s*$'
        - '\bUuid\b[^\n]*@default\(\s*"'
        - '\b(?:VarChar|Char|Bit|VarBit|Numeric)\s*\(\s*\d[^\n]*@default\('
        - '\bChar\s[^\n]*@default\('
  - id: uuid-defaults-stored-as-postgresql-writes
    summary: |
      A uuid default written in upper case, in braces or without hyphens, in PSL or in a TypeScript `.default()`, is now stored as PostgreSQL writes it, so emitting the contract again changes its storage hash. Earlier versions could not apply such a contract: the command that applied it failed and changed nothing. Emit the contract again, then run that command again. With migrations, first delete the migration package that never applied.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bUuid\b[^\n]*@default\(\s*"(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")\{?[0-9A-Fa-f]{4}'
        - '\buuidNative\s*\([^\n]*\.default\(\s*[''"`](?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[''"`])\{?[0-9A-Fa-f]{4}'
  - id: mongo-codecs-check-json
    summary: |
      The built-in Mongo codecs now refuse a JSON value that is not the JSON form of their type, where most passed it through: a PSL enum member whose value its `@@type` codec does not take is now refused. Correct the member.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"mongo/'
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
      A SQL target's `inferPslContract` hook now takes the stack's PSL build context as its second parameter, `(schema, context, describedContracts?)`, as `buildPslContract` does. Accept it, and read type constructors and codecs from it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\binferPslContract\b'
  - id: cli-error-from-caught
    summary: |
      `mapCaughtMigrationError` is removed from `@internal/cli/control-api`. Use `errorFromCaught(error, why)`, which always returns an error: a CLI error as it is, any error with a structured code as itself, and anything else as `CLI.UNEXPECTED` with `why(message)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bmapCaughtMigrationError\b'
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

- A single value object takes a JSON object, and a list of them a JSON array: `` homes Address[] @default(json`{"street": "x"}`) `` is refused; write `@default([])` or `` @default(json`[{"street": "x"}]`) ``. JSON `null` is taken when the field is optional. `PSL_DEFAULT_TYPE_INCOMPATIBLE`.
- A key that is not a member is refused, and so is a missing member that is not optional, and `null` for a member that is not optional. `PSL_DEFAULT_TYPE_INCOMPATIBLE`.
- The default holds each member in the form its codec stores, so the member's codec must read the value. A `Decimal`, `Numeric(p, s)` or `BigInt` member takes a decimal string, `"1.5"`, and a number is refused; a `String` member takes a JSON string, so `"street": 1` is refused; a `DateTime` member takes a date and time string; a `Json` member takes any JSON value. `PSL_INVALID_DEFAULT_LITERAL`, with the codec's message.
- A member typed by an enum takes only the enum's values: `PSL_INVALID_DEFAULT_LITERAL`, `Expected one of:` the values.
- Nested value objects are checked the same way.

Correct the value the diagnostic names.

## `codecs-check-stored-json`

A codec's `decodeJson` reads a value in the stored JSON form of its type: a column's literal default in `contract.json`, a member of a value-object default, and a value inside the JSON the database returns for an included relation. The text codecs (`pg/text@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sqlite/text@1`, `pg/enum@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/tsquery@1`, `pg/timetz@1`, `pg/text-array@1` and the date and time codecs), the integer codecs `pg/int4@1`, `pg/int2@1` and `sql/int@1`, and `pg/bool@1` used to pass any JSON value through. Each now refuses a value of another kind with `RUNTIME.DECODE_FAILED`, naming the codec: a text codec takes a JSON string, `pg/int4@1` a JSON integer from -2147483648 to 2147483647, `pg/int2@1` one from -32768 to 32767, `sql/int@1` a safe integer, or on PostgreSQL, where its column is an int4, an integer from -2147483648 to 2147483647, `pg/bool@1` `true` or `false`, `pg/uuid@1` a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and a bit string only `0` and `1`. `pg/vector@1` refuses JSON that is not an array of the column's number of finite numbers with the same shape, as in `pg/vector@1 JSON value must be an array of 3 finite numbers`, where it said `Vector length mismatch` or `Vector value must contain only numbers`. `pg/int8@1` and `sqlite/bigint@1` take decimal text in the signed 64-bit range. `pg/timestamptz-date@1` refused a bad string with a plain `RangeError`; it now raises `RUNTIME.DECODE_FAILED` like the others. Every form PostgreSQL and SQLite write for a value the application type holds is still read. Two stored values the application type cannot hold now throw instead of reading wrong: a two-dimensional `text[]` value, which `pg/text-array@1` read as the text `"a,b"`, and, on SQLite, an INTEGER past 2^53 or a REAL stored in an INTEGER column, which `sql/int@1` read rounded or with a fraction.

`pg/text-array@1` reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`, and so is its entry in the Postgres `CodecTypes`. Code typed by a contract-free `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`.

The float codecs `pg/float8@1`, `pg/float4@1`, `pg/float@1`, `sql/float@1` and `sqlite/real@1` take a finite JSON number or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which PostgreSQL writes for those values in JSON, and `encodeJson` writes that text for them. SQLite writes an infinity in JSON as `9.0e+999`, so on SQLite the float codecs' JSON projection writes the text instead. `sql/float@1`, `pg/float@1` and `sqlite/real@1` used to refuse NaN and the infinities, so an `.include()` of a row holding one failed with `RUNTIME.DECODE_FAILED`; it now reads the value. SQLite cannot store NaN, so on SQLite `sqlite/real@1` and `sql/float@1` refuse it; see `sqlite-nan-parameters-refused`. No change is needed.

On PostgreSQL the codecs also check what the column stores. `VarChar(n)` and `Char(n)` (`sql/varchar@1`, `sql/char@1`, `pg/varchar@1`, `pg/char@1`) take at most n characters, counted as PostgreSQL counts them, by code point, and a `Char` value's trailing spaces do not count. A `Char` without a length is `character(1)`, so it takes one character. `Bit(n)` takes exactly n bits and `VarBit(n)` at most n, and a `pg/bit@1` column without a length is `bit(1)`, so it takes exactly one bit. `Numeric(p, s)` takes a value it stores without rounding, and `pg/numeric@1` takes only decimal text without an exponent or a leading `+`. The scale may now be negative or above the precision, from -1000 to 1000, as PostgreSQL 15 and later allow: `Numeric(5, -2)` stores multiples of 100, and `contract infer` writes such a column. `sql/int@1`, and `pg/int@1`, the codec of an enum whose members are integers, store an int4, so each takes an integer from -2147483648 to 2147483647. `pg/float4@1` takes a finite number only if float4 holds it, neither overflowing to an infinity nor becoming 0. A default that breaks one of these, such as `VarChar(3) @default("toolong")`, used to load, and the migration planned and applied; the first insert that used the default then failed. A `Char` or `pg/bit@1` column without a length did not apply on PostgreSQL, whatever its default. Such a default is now refused when the contract is emitted, with `PSL_INVALID_DEFAULT_LITERAL`, or `PSL_EXTENSION_INVALID_VALUE` for an enum member, and a TypeScript `.default()` when the contract is built, with `CONTRACT.DEFAULT_INVALID`. Shorten or correct the value. SQLite does not enforce a declared length, so on SQLite the char and varchar codecs take text of any length.

A TypeScript `.default()` given a value its column's type does not take is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` naming the model and field. A TypeScript `enumType` member its codec does not take is refused the same way, with `CONTRACT.ENUM_INVALID` naming the enum, the member and the codec: for example a `pg/char@1` or `sql/char@1` member longer than one character on PostgreSQL, since the enum's column is `character`, which holds one. A `contract.json` with such a default, emitted by an earlier version or edited by hand, still loads. `db init`, `db update` and `migration plan` used to plan the default, as above; they now stop with `CONTRACT.DEFAULT_INVALID`, which names the table, the column, the codec and the value. Emit the contract again with this version, and correct the default in the contract source if emit refuses it. Running a `migration.ts` that an earlier version planned with such a default fails with the same message; correct the default in that file. A PSL schema is refused earlier, when it is emitted; see `psl-values-checked-by-codecs`. A `null` literal default is written as `DEFAULT NULL`, as before.

## `char-reads-drop-only-padding`

PostgreSQL pads a `char(n)` value with spaces to its length: `'a'` in a `char(3)` column is stored as `'a  '`. A flat read dropped every trailing whitespace character, so a stored `'a\t'` also read as `"a"`, while `.include()` returned the padded text, `"a  "`. Both reads now return the value without the padding and nothing more: `"a"` for `'a'`, and `"a\t"` for `'a\t'`. On SQLite, which does not pad, both reads drop trailing spaces, as a flat read did. Code that compared an included `char` value with its padding, or relied on a flat read dropping a trailing tab or newline, compares the value without its padding.

## `sqlite-nan-parameters-refused`

SQLite cannot store NaN: bound as a parameter, it becomes NULL. So `create({ value: 0 / 0 })` on an optional `Float` column stored NULL, and `where((p) => p.value.eq(Number.NaN))` matched nothing. On SQLite, `sqlite/real@1` and `sql/float@1` now refuse NaN with `RUNTIME.ENCODE_FAILED`, `<codecId> value must be a number other than NaN, which SQLite cannot store`, with `meta.codecId` and `meta.received`: when they encode a value to write or filter by, and when they encode a TypeScript `.default()`, which is still refused when the contract is built with `CONTRACT.DEFAULT_INVALID`, now with this message. Their `decodeJson` refuses the text `"NaN"`. A NaN parameter no codec encoded, such as one in raw SQL, is refused by the SQLite driver with the same code: `Parameter 2 is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`, with `meta.paramIndex`, counted from 0. On a required column SQLite already refused the NULL, so only the error changes. Where a computed value can be NaN, write `null` for no value, and filter with `isNull()` for rows that have none. Infinity and -Infinity are stored and read back as before.

## `psl-values-checked-by-codecs`

The PSL reader reads each literal default, and each member of a SQL `enum`, with the column's codec, so the stricter codecs refuse schemas that loaded before. Each of these is now refused at `contract emit`:

| Schema | Diagnostic |
| --- | --- |
| `enum P { @@type("pg/int4@1") Low = "low" }` | `PSL_EXTENSION_INVALID_VALUE`: `enum "P" member "Low" was rejected by codec "pg/int4@1": pg/int4@1 JSON value must be an integer from -2147483648 to 2147483647` |
| the same enum with a bare `Low` | `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`: `enum "P" member "Low" has no value and codec "pg/int4@1" does not accept a bare name as input` |
| `enum P { @@type("pg/text@1") Low = 1 }` | `PSL_EXTENSION_INVALID_VALUE`, `pg/text@1 JSON value must be a string` |
| an enum without `@@type` whose integer members include one outside -2147483648 to 2147483647, such as `Low = 3000000000` | `PSL_EXTENSION_INVALID_VALUE`, `pg/int@1 JSON value must be an integer from -2147483648 to 2147483647` |
| `u Uuid @default("nope")` | `PSL_INVALID_DEFAULT_LITERAL`, `"nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.` |
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

These additions need no change, and help follow the rule:

- `@internal/framework-components/codec` exports the JSON readers every family's codecs share: `decodeJsonString`, `decodeJsonMatching`, `decodeJsonBoolean`, `decodeJsonInteger` (with an `IntegerRange`), `decodeJsonIntegerText` (decimal text, with an optional `BigIntRange`), `decodeJsonFloat` and `encodeJsonFloat`, and `refuseJsonValue`, which raises the refusal they all raise: `RUNTIME.DECODE_FAILED`, `<codecId> JSON value must be <what it takes>`, with `meta.codecId` and `meta.received`, the value it got as JSON text, cut to 100 characters. It also exports the ranges they take, `INT32_RANGE` and `SAFE_INTEGER_RANGE` (`IntegerRange`) and `INT64_RANGE` and `SAFE_INTEGER_BIGINT_RANGE` (`BigIntRange`), and `isNonFiniteText`, which says whether text is `NaN`, `Infinity` or `-Infinity`. The built-in codecs' refusals no longer say `database JSON value`.
- `@internal/utils/text` exports `counted`, which writes a count and its noun for a refusal, such as `3 characters`, and `withoutTrailing(text, character)`, which drops a trailing run of one character in time linear in the run's length.
- A codec descriptor adapted with `postgresCodec(descriptor, options)` or `sqliteCodec(descriptor, options)` may set `options.factory(descriptor, params)`, which builds its codec in place of the family descriptor's factory; the codec it builds is typed as the family descriptor's codec, so it is a subclass of it. The targets use it to add the column's own constraint to a family codec: on PostgreSQL, `sql/char@1` and `sql/varchar@1` check PostgreSQL's length rule and `sql/int@1` checks the int4 range; on SQLite, `sql/float@1` refuses NaN. A family codec checks only what every SQL target stores.
- `encodeLiteralDefault(codecLookup, codecRef, value, { table, column })` from `@internal/sql-relational-core/ast` turns a column's literal default into SQL NULL or the wire value to inline, reading it with the column's codec built with its type parameters, and raises `CONTRACT.DEFAULT_INVALID`, naming the column, for a default the codec refuses. A control adapter that renders DDL defaults can call it.

## `mongo-codec-requires-decode-json`

`mongoCodec` now requires `decodeJson` when the codec's application type is narrower than `JsonValue`, such as `string` or `number`; only a codec whose application type is exactly `JsonValue` may leave it out. A codec that leaves it out no longer compiles. Supply a `decodeJson` that refuses a JSON value of another kind with `RUNTIME.DECODE_FAILED`, such as `decodeJsonString` or another reader from `@internal/framework-components/codec`.

## `sql-float-json-helpers-removed`

Replace `sqlFloatEncodeJson(value)` with `encodeJsonFloat(value)` and `sqlFloatDecodeJson(json)` with `decodeJsonFloat(codecId, json)`, and import `isNonFiniteText` from `@internal/framework-components/codec` instead of `@internal/sql-relational-core/ast`. An import of `isNonFiniteText` that already names `@internal/framework-components/codec` needs no change.

## `sql-infer-psl-contract-takes-build-context`

The SQL family calls a target's `inferPslContract(schema, context, describedContracts?)` with the same `SqlPslBuildContext` it passes `buildPslContract`: the stack's authoring contributions, codec lookup and data types. `contract emit` reads the inferred schema with that stack, so a target reads a written type's codec and type parameters from `context.authoringContributions.type` and `context.codecLookup` instead of a table of its own. Add the parameter to the hook.

## `cli-error-from-caught`

`mapCaughtMigrationError(error)` returned a CLI error unchanged and `null` for anything else, which the caller wrapped as `CLI.UNEXPECTED`. `errorFromCaught(error, why)`, exported from the same place, does the whole job: it returns a CLI error unchanged, reports any other error with a structured `NAMESPACE.SUBCODE` code as itself, and reports anything else as `CLI.UNEXPECTED` with `why` given the error's message. Replace `mapCaughtMigrationError(error) ?? errorUnexpected(...)` with `errorFromCaught(error, (message) => ...)`.
