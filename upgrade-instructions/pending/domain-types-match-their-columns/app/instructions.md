---
changes:
  - id: domain-types-match-their-columns
    summary: |
      The domain half of an emitted SQL contract now carries the type parameters and enum value sets the schema declares: on fields typed by a named type, on enum list fields, and on composite type members. In `contract.d.ts`, a composite type member with type parameters now has the parameterized output type. Re-emit the contract. The storage half, every hash and migration snapshots are unchanged.
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
      The built-in SQL, PostgreSQL and SQLite codecs now refuse a JSON value that is not a stored form of their type, including one its type parameters rule out, where they used to pass it through: a TypeScript literal default of that kind is now refused when the contract is built, and one in a `contract.json` that an earlier version emitted, or that was edited by hand, stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`. Emit the contract again, and correct the default if emit refuses it.
    detection:
      glob: "**/contract.json"
      matches:
        - '"kind"\s*:\s*"literal"'
  - id: char-reads-drop-only-padding
    summary: |
      A `char(n)` column now reads the same through `.include()` as through a flat read: without the trailing spaces that pad it, where an include used to return them, and keeping a trailing tab or newline, which both reads used to drop. Compare `char` values without their padding.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"(?:sql|pg)/char@1"'
  - id: sqlite-nan-parameters-refused
    summary: |
      On SQLite, NaN written to a float column, used as a filter value, or given as a TypeScript `.default()`, now throws `RUNTIME.ENCODE_FAILED` naming the codec, where SQLite stored NULL or matched nothing. Write `null` for no value.
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

- A single value object takes a JSON object, and a list of them a JSON array: `` homes Address[] @default(json`{"street": "x"}`) `` is refused; write `@default([])` or `` @default(json`[{"street": "x"}]`) ``. JSON `null` is taken when the field is optional. `PSL_DEFAULT_TYPE_INCOMPATIBLE`.
- A key that is not a member is refused, and so is a missing member that is not optional, and `null` for a member that is not optional. `PSL_DEFAULT_TYPE_INCOMPATIBLE`.
- The default holds each member in the form its codec stores, so the member's codec must read the value. A `Decimal`, `Numeric(p, s)` or `BigInt` member takes a decimal string, `"1.5"`, and a number is refused; a `String` member takes a JSON string, so `"street": 1` is refused; a `DateTime` member takes a date and time string; a `Json` member takes any JSON value. `PSL_INVALID_DEFAULT_LITERAL`, with the codec's message.
- A member typed by an enum takes only the enum's values: `PSL_INVALID_DEFAULT_LITERAL`, `Expected one of:` the values.
- Nested value objects are checked the same way.

Correct the value the diagnostic names.

## `codecs-check-stored-json`

A codec's `decodeJson` reads a value in the stored JSON form of its type: a column's literal default in `contract.json`, a member of a value-object default, and a value inside the JSON the database returns for an included relation. The text codecs (`pg/text@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sqlite/text@1`, `pg/enum@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/tsquery@1`, `pg/timetz@1`, `pg/text-array@1` and the date and time codecs), the integer codecs `pg/int4@1`, `pg/int2@1` and `sql/int@1`, and `pg/bool@1` used to pass any JSON value through. Each now refuses a value of another kind with `RUNTIME.DECODE_FAILED`, naming the codec: a text codec takes a JSON string, `pg/int4@1` a JSON integer from -2147483648 to 2147483647, `pg/int2@1` one from -32768 to 32767, `sql/int@1` a safe integer, or on PostgreSQL, where its column is an int4, an integer from -2147483648 to 2147483647, `pg/bool@1` `true` or `false`, `pg/uuid@1` a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and a bit string only `0` and `1`. `pg/vector@1` refuses JSON that is not an array of the column's number of finite numbers with the same shape, as in `pg/vector@1 JSON value must be an array of 3 finite numbers`, where it said `Vector length mismatch` or `Vector value must contain only numbers`. `pg/int8@1` and `sqlite/bigint@1` take decimal text in the signed 64-bit range. `pg/timestamptz-date@1` refused a bad string with a plain `RangeError`; it now raises `RUNTIME.DECODE_FAILED` like the others. Every form PostgreSQL and SQLite write for a value the application type holds is still read. Two stored values the application type cannot hold now throw instead of reading wrong: a two-dimensional `text[]` value, which `pg/text-array@1` read as the text `"a,b"`, and, on SQLite, an INTEGER past 2^53 or a REAL stored in an INTEGER column, which `sql/int@1` read rounded or with a fraction.

`pg/text-array@1` reads a `text[]` column's NULL elements as `null`, so its application type is `readonly (string | null)[]` where it was `readonly string[]`. Code typed by a contract-free `textArray()` column, or by `min` or `max` over one, sees `string | null` elements; handle the `null`.

The float codecs `pg/float8@1`, `pg/float4@1`, `pg/float@1`, `sql/float@1` and `sqlite/real@1` take a finite JSON number or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which PostgreSQL writes for those values in JSON, and `encodeJson` writes that text for them. SQLite writes an infinity in JSON as `9.0e+999`, so on SQLite the float codecs' JSON projection writes the text instead. `sql/float@1`, `pg/float@1` and `sqlite/real@1` used to refuse NaN and the infinities, so an `.include()` of a row holding one failed with `RUNTIME.DECODE_FAILED`; it now reads the value. SQLite cannot store NaN, so on SQLite `sqlite/real@1` and `sql/float@1` refuse it; see `sqlite-nan-parameters-refused`. No change is needed.

On PostgreSQL the codecs also check what the column stores. `VarChar(n)` and `Char(n)` (`sql/varchar@1`, `sql/char@1`, `pg/varchar@1`, `pg/char@1`) take at most n characters, counted as PostgreSQL counts them, by code point, and a `Char` value's trailing spaces do not count. A `Char` without a length is `character(1)`, so it takes one character. `Bit(n)` takes exactly n bits and `VarBit(n)` at most n, and a `pg/bit@1` column without a length is `bit(1)`, so it takes exactly one bit. `Numeric(p, s)` takes a value it stores without rounding, and `pg/numeric@1` takes only decimal text without an exponent or a leading `+`. `sql/int@1`, and `pg/int@1`, the codec of an enum whose members are integers, store an int4, so each takes an integer from -2147483648 to 2147483647. `pg/float4@1` takes a finite number only if float4 holds it, neither overflowing to an infinity nor becoming 0. A default that breaks one of these, such as `VarChar(3) @default("toolong")`, used to load, and the migration planned and ran; the first insert that used the default then failed, or, in a `bit` column without a length, stored only the default's first bit. It is now refused when the contract is emitted, with `PSL_INVALID_DEFAULT_LITERAL`, or `PSL_EXTENSION_INVALID_VALUE` for an enum member, and a TypeScript `.default()` when the contract is built, with `CONTRACT.DEFAULT_INVALID`. Shorten or correct the value. SQLite does not enforce a declared length, so on SQLite the char and varchar codecs take text of any length.

A TypeScript `.default()` given a value its column's type does not take is now refused when the contract is built, with `CONTRACT.DEFAULT_INVALID` naming the model and field. A `contract.json` with such a default, emitted by an earlier version or edited by hand, still loads, and `db init`, `db update` and `migration plan` now stop with `CONTRACT.DEFAULT_INVALID`, which names the table, the column, the codec and the value, where they used to fail with `CLI.UNEXPECTED`. Emit the contract again with this version. If emit refuses the default, correct it in the contract source. A PSL schema is refused earlier, when it is emitted; see `psl-values-checked-by-codecs`. A `null` literal default is written as `DEFAULT NULL`, as before.

## `char-reads-drop-only-padding`

PostgreSQL pads a `char(n)` value with spaces to its length: `'a'` in a `char(3)` column is stored as `'a  '`. A flat read dropped every trailing whitespace character, so a stored `'a\t'` also read as `"a"`, while `.include()` returned the padded text, `"a  "`. Both reads now return the value without the padding and nothing more: `"a"` for `'a'`, and `"a\t"` for `'a\t'`. On SQLite, which does not pad, both reads drop trailing spaces, as a flat read did. Code that compared an included `char` value with its padding, or relied on a flat read dropping a trailing tab or newline, compares the value without its padding.

## `sqlite-nan-parameters-refused`

SQLite cannot store NaN: bound as a parameter, it becomes NULL. So `create({ value: 0 / 0 })` on an optional `Float` column stored NULL, and `where((p) => p.value.eq(Number.NaN))` matched nothing. On SQLite, `sqlite/real@1` and `sql/float@1` now refuse NaN with `RUNTIME.ENCODE_FAILED`, `<codecId> value must be a number other than NaN, which SQLite cannot store`, with `meta.codecId` and `meta.received`: when they encode a value to write or filter by, and when they encode a TypeScript `.default()`, which is then refused when the contract is built with `CONTRACT.DEFAULT_INVALID`. Their `decodeJson` refuses the text `"NaN"`. A NaN parameter no codec encoded, such as one in raw SQL, is refused by the SQLite driver with the same code: `Parameter 2 is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`, with `meta.paramIndex`, counted from 0. On a required column SQLite already refused the NULL, so only the error changes. Where a computed value can be NaN, write `null` for no value, and filter with `isNull()` for rows that have none. Infinity and -Infinity are stored and read back as before.

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

Give each enum member a value its codec takes, and each default a value its column's type holds unchanged. A `Uuid` default may be written in any form PostgreSQL reads: either case, with or without a hyphen after any group of four digits, and optionally in braces. The contract stores it as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12, and so does a TypeScript `.default()` on a `pg/uuid@1` column, so the applied default verifies against the database without a difference. A default written in another form used to be stored as written, and `db verify` then reported it as different from the database. Emit the contract again: the stored default, and with it the storage hash, change.

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
