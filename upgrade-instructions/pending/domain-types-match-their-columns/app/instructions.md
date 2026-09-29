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
      The built-in SQL, PostgreSQL and SQLite codecs now refuse a JSON value that is not the stored form of their type, where they used to pass it through: a literal column default of the wrong JSON kind now fails when a migration is planned. Correct the default.
    detection:
      glob: "**/contract.json"
      matches:
        - '"kind"\s*:\s*"literal"'
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

A codec's `decodeJson` reads a value in the stored JSON form of its type: a column's literal default in `contract.json`, a member of a value-object default, and a value inside the JSON the database returns for an included relation. The text codecs (`pg/text@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `sqlite/text@1`, `pg/enum@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/tsquery@1`, `pg/timetz@1`, `pg/text-array@1` and the date and time codecs), the integer codecs `pg/int4@1`, `pg/int2@1` and `sql/int@1`, and `pg/bool@1` used to pass any JSON value through. Each now refuses a value of another kind with `RUNTIME.DECODE_FAILED`, naming the codec: a text codec takes a JSON string, `pg/int4@1` a JSON integer from -2147483648 to 2147483647, `pg/int2@1` one from -32768 to 32767, `sql/int@1` a safe integer, `pg/bool@1` `true` or `false`, `pg/uuid@1` a hyphenated UUID, and a bit string only `0` and `1`. Every form PostgreSQL and SQLite produce is still read, so query results are unchanged.

The float codecs `pg/float8@1`, `pg/float4@1`, `pg/float@1`, `sql/float@1` and `sqlite/real@1` take a JSON number or the text `"NaN"`, `"Infinity"` or `"-Infinity"`, which PostgreSQL writes for those values in JSON, and `encodeJson` writes that text for them. `sql/float@1`, `pg/float@1` and `sqlite/real@1` used to refuse NaN and the infinities, so an `.include()` of a row holding one failed with `RUNTIME.DECODE_FAILED`; it now reads the value. SQLite cannot store NaN, so `sqlite/real@1` still refuses it. No change is needed.

Only a hand-edited `contract.json`, or a TypeScript `.default()` given a value its column's type does not take, can hold such a default, and it now fails when a migration is planned. Correct the default in the contract source and emit it again. A `null` literal default is written as `DEFAULT NULL`, as before.

## `composite-type-attributes-refused`

An attribute inside a `type` block was ignored: `street String @default("x")` stored no default, and `@@map` mapped nothing. Each is now refused, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` on a member and `PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE` on the type. Remove the attribute. To give a value object a default, write it on the model field as a whole value, such as `` home Address @default(json`{"street": "x"}`) ``.
