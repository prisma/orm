---
changes:
  - id: db-enums-members-hold-read-values
    summary: |
      `db.enums` now holds each enum member as a query returns it, where it used to hold the member as `contract.json` stores it. A member on `pg/int8@1` or `mongo/int64@1` is a bigint, not decimal text, and a member on a date or timestamp codec is a `Date` or Temporal value, not an ISO string. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member, such as a value read from the database, and no longer find the stored form. Members on text, integer, uuid and float codecs are unchanged. Remove any conversion your code applied to these members or to values before passing them to `has()`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benums\s*(?:\.|\[)'
  - id: contract-dts-enum-member-types
    summary: |
      An emitted `contract.d.ts` now gives every namespace that declares enums an `enumMemberTypes` entry, which types each member as `db.enums` holds it. Re-emit the contract. `contract.json`, every hash and migration snapshots are unchanged.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'readonly enum: \{'
---

## `db-enums-members-hold-read-values`

`db.enums` (`db.enums.<namespace>.<Enum>` on Postgres, `db.enums.<Enum>` on SQLite and Mongo) used to hold each member in the form `contract.json` stores it. Where a codec's stored form is not the value a query returns, a member and a value read from the database never matched:

```ts
// Level is @@type("pg/int8@1") with Low = "1"
db.enums.public.Level.members.Low; // was "1", now 1n
db.enums.public.Level.has(row.level); // was false for row.level === 1n, now true
```

The same holds for `mongo/int64@1` members (bigint), and for members on a date or timestamp codec such as `pg/timestamptz-temporal@1`, `pg/date-temporal@1`, `pg/timestamptz-date@1` or `mongo/date@1` (a `Date` or Temporal value, not an ISO string). `has()`, `nameOf()` and `ordinalOf()` compare a value as the codec stores it, so a date equal to a member matches although it is a different object. A value of another type, such as `"1"` for an int8 member or an ISO string for a date member, is no member.

1. Find the code that reads `db.enums`. The detection for this change looks for `enums.` and `enums[`; if you hold an enum accessor under another name, search for that name too.
2. For enums whose codec is listed above, remove any conversion that turned a member into the value a query returns, such as `BigInt(db.enums.public.Level.members.Low)` or `new Date(...)` around a member, and any conversion that turned a value back into the stored form before calling `has()`, `nameOf()` or `ordinalOf()`. Pass the value as a query returns it.
3. Code that compared a member with the stored form, for example `members.Low === '1'`, now compares with the value: `members.Low === 1n`.

## `contract-dts-enum-member-types`

Run `prisma contract emit`. Each namespace with enums gains an optional, type-only `enumMemberTypes` entry next to its `enum` entry. The `enum` entry still types each member as `contract.json` stores it; `db.enums` takes its member types from `enumMemberTypes`. Until you re-emit, `db.enums` keeps typing members in their stored form, which no longer matches what it holds.
