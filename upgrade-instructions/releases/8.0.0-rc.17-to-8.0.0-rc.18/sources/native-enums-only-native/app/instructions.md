---
changes:
  - id: native-enums-leave-out-domain-enums
    summary: |
      On Postgres, `db.nativeEnums` now holds only native enum types (`native_enum` blocks and `nativeEnum()`). It used to also hold every domain enum (`enum` blocks and `enumType()`), with its values as stored, such as `['1', '10']` for an enum over `pg/int8`. Read a domain enum through `db.enums`, which holds its values as a query returns them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.nativeEnums\b'
---

## `native-enums-leave-out-domain-enums`

`db.nativeEnums.<namespace>` lists the native Postgres enum types of the namespace, keyed as before by the name in the schema. It no longer lists a domain enum, which is an `enum` block in PSL or an `enumType()` in TypeScript. `db.enums.<namespace>` holds each domain enum, with its values decoded as a query returns them.

For each `db.nativeEnums.<namespace>.<Name>` in the code, check whether `<Name>` is a native enum (`native_enum <Name>` in PSL, `nativeEnum('<Name>', …)` in TypeScript). If it is a domain enum, read it through `db.enums` instead:

```ts
// before
db.nativeEnums.public.Priority.values; // ['1', '10'], the stored text
// after
db.enums.public.Priority.values; // [1n, 10n], the values a query returns
```

A domain enum's values in `db.enums` are the values a query returns, which can differ from the stored text that `db.nativeEnums` held: a `pg/int8` member is a `bigint`, a `pg/timestamptz-temporal` member a `Temporal.Instant`. Change code that compared them with stored text. A member's name is its name in the enum, such as `Low`, where `db.nativeEnums` named each member by its value.
