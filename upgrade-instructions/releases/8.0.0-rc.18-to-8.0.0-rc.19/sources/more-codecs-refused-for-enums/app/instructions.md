---
changes:
  - id: more-codecs-refused-for-enums
    summary: |
      An enum typed by `pg/jsonb@1`, `pg/timetz@1`, `pg/enum@1`, `arktype/json@1`, `pg/vector@1` or `pg/geometry@1` is now refused: `defineContract` from the Postgres package refuses its `enumType` with `CONTRACT.ENUM_INVALID`, and PSL refuses its `@@type` with `PSL_EXTENSION_INVALID_VALUE`. A jsonb enum's CHECK constraint failed to apply: it lists a string member as text PostgreSQL reads as JSON, and a number member as a number it cannot compare with `jsonb`. A query reads a timetz value as the text PostgreSQL prints, such as "12:34:56+02", so a value read back did not equal a member stored as "12:34:56+02:00". A `pg/enum@1` codec types a native enum's column; declare a native enum instead. Replace any other refused enum with a text enum.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"(?:pg/(?:jsonb|timetz|enum|vector|geometry)|arktype/json)@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"`](?:pg/(?:jsonb|timetz|enum|vector|geometry)|arktype/json)@1[''"`]|\b(?:timetzColumn|jsonbColumn|arktypeJson|geometryColumn)\b|\b(?:vector|geometry)\()'
  - id: psl-enum-members-read-by-the-cast-rule
    summary: |
      A PSL enum member is now read as a written value of the enum codec's data type, as a `@default` is. A quoted member is text, so it is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` on a codec whose data type has no cast from text, such as `pg/numeric@1`, `pg/int8@1`, the float, date and time codecs, `sqlite/bigint@1`, `sqlite/datetime@1` and `sqlite/json@1`; the message says what to write, worded as the same value refused as a `@default`. Write a number unquoted (`Half = 0.5`, `Low = 1`, `Nan = NaN`, `Infinite = Infinity`), a date or time with its tag (`` Launch = date`2024-01-01` ``, `` Launch = timestamptz`2024-01-01T00:00:00Z` ``), and a `sqlite/json@1` member with the `json` tag (`` Low = json`"low"` ``). A member refused for its type now reports `PSL_VALUE_TYPE_INCOMPATIBLE` instead of `PSL_EXTENSION_INVALID_VALUE`: `Low = 1` under `pg/text@1` keeps its message, `Expected a quoted string`, and `Low = "low"` under `pg/int4@1` now says `Expected a number` in place of the codec's own reason. The stored members do not change, so the contract does not either. A member written in TypeScript, an application value, is unchanged, and so is MongoDB PSL.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^}]*@@type\(\s*"(?!(?:pg/(?:text|char|varchar|uuid|inet|bit|varbit)|sql/(?:text|char|varchar)|sqlite/text|mongo/[\w-]+)@1")[^"]+"\s*\))[^}]*=\s*"'
  - id: enum-members-compare-by-their-data-type
    summary: |
      An enum typed by `pg/numeric@1`, `pg/interval@1` or `mongo/decimal128@1` now compares values as its data type does, as PostgreSQL's CHECK constraint already did: `db.enums.<Enum>.has()`, `nameOf()` and `ordinalOf()` find `0.50` as the numeric member `0.5`, and `PT24H` as the interval member `P1D`. Two members that are one value in different forms, such as `0.5` and `0.50`, or `P1D` and `PT24H`, are now refused as duplicates: `CONTRACT.ENUM_INVALID` from `defineContract`, and `PSL_ENUM_DUPLICATE_MEMBER_VALUE` from PSL. Such an enum's members, and a column typed by it, are typed as the codec's type, such as `string` for `pg/numeric@1`, because a read can return a member in another form. This holds both in the emitted `contract.d.ts` and in the types `defineContract` infers. A `mongo/decimal128@1` enum is refused when the contract is built, because a collection validator cannot list BSON decimals, so for it only the types changed.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"(?:pg/(?:numeric|interval)|mongo/decimal128)@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"`](?:pg/(?:numeric|interval)|mongo/decimal128)@1[''"`]|\b(?:numericColumn|intervalColumn)\()'
  - id: enum-columns-typed-by-member-literals
    summary: |
      A column typed by an enum whose codec is `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/date-string@1`, `pg/time-string@1`, `sql/char@1`, `sql/varchar@1`, `sql/text@1`, `sql/int@1` or `sql/float@1` on Postgres, or `sqlite/text@1`, `sqlite/integer@1`, `sqlite/real@1`, `sqlite/bigint@1`, `sqlite/json@1`, `sql/char@1`, `sql/varchar@1`, `sql/int@1` or `sql/float@1` on SQLite, is now typed in the emitted `contract.d.ts` as the union of its members' values, as a `pg/text@1` or `pg/int4@1` enum column already was, instead of the codec's whole type. Re-emit the contract. Code that writes a value that is not a member to such a column, or compares a value read from it with one, no longer typechecks; use a member, such as `client.enums.Host.members.Loopback`.
---

## `more-codecs-refused-for-enums`

`defineContract` refuses an enum typed by one of these codecs, for example:

```text
CONTRACT.ENUM_INVALID: enumType("Payload"): an enum cannot use the codec pg/jsonb@1. A CHECK lists a string member as SQL text, which PostgreSQL reads as the JSON text of a document rather than as a string, and a number member as a number, which PostgreSQL cannot compare with jsonb, so no CHECK can compare a value with the members. No enum can use a jsonb codec; use a text enum instead.
```

PSL refuses an enum block with `@@type` naming one of these codecs with the same reason, as `PSL_EXTENSION_INVALID_VALUE`.

1. For a `pg/enum@1` enum, declare a native enum: a `native_enum` block in PSL, or `nativeEnum` in TypeScript.
2. For any other refused enum, type it with `pg/text@1`: change the `@@type` in PSL, or pass `{ codecId: 'pg/text@1' }` (or `textColumn`) to `enumType` in TypeScript. Write each member as text.
3. Re-emit the contract. The enum's columns change type, and with them the storage hash. Plan and apply a migration, which changes each column's type.

The TypeScript detection matches a file that calls `enumType(` and names one of these codecs or their column helpers anywhere, even on a column that is not an enum. Check only the enums.

## `psl-enum-members-read-by-the-cast-rule`

`contract emit` refuses a quoted member on a codec whose data type has no cast from text:

```text
enum "Ratio" member "Half": Expected a number; write 0.5
```

Rewrite each refused member as the message says, then emit the contract again. The stored members are the same, so the storage hash does not change and no migration is needed.

```prisma
// before
enum Ratio {
  @@type("pg/numeric@1")
  Half  = "0.5"
  Whole = "1.50"
}

// after
enum Ratio {
  @@type("pg/numeric@1")
  Half  = 0.5
  Whole = 1.50
}
```

## `enum-members-compare-by-their-data-type`

1. If the contract build refuses two members as one value, such as `enum "Ratio": members "Half" and "Halves" store "0.5" and "0.50", which the database holds equal`, remove one of them. The database already held them equal, so a row could never tell them apart.
2. Re-emit the contract.
3. Typecheck the project. Code that reads such an enum column as a member literal type, such as `'0.5' | '1.50'`, now reads the codec's type; compare the value with a member through `db.enums.<Enum>.has()` or `nameOf()`, which find `0.50` as `0.5`.

The TypeScript detection matches a file that calls `enumType(` and names one of these codecs or `numericColumn(` or `intervalColumn(` anywhere, even on a column that is not an enum. Check only the enums.

## `enum-columns-typed-by-member-literals`

Re-emit the contract. Then typecheck the project. Where a write to an enum column, or a comparison with a value read from one, no longer typechecks, the value is not a member; use a member instead. A test that writes a non-member on purpose, to see the CHECK constraint refuse it, can write that value `as never`.
