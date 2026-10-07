---
changes:
  - id: db-enums-members-hold-read-values
    summary: |
      `db.enums` now holds each enum member as a query returns it, where it used to hold the member as `contract.json` stores it. A member changes wherever its codec's stored JSON form is not the application value: bigint codecs, codecs that read decimal text as a number, date, time, timestamp and interval codecs, byte codecs, and non-finite float members, written as "NaN", "Infinity" or "-Infinity". `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member, such as a value read from the database, and no longer find the stored form. Remove any conversion your code applied to these members or to values before passing them to `has()`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benums\s*(?:\.|\[)'
  - id: float-enum-columns-type-non-finite-members-as-number
    summary: |
      On Postgres, a column typed by a float enum (`pg/float4@1`, `pg/float8@1`, `pg/float@1`) that has a NaN, Infinity or -Infinity member is now typed `number` in `contract.d.ts`, where it was a union of the strings "NaN", "Infinity" and "-Infinity". Re-emit the contract and write those members as numbers.
    detection:
      glob: "**/contract.json"
      matches:
        - '"codecId"\s*:\s*"pg/float(?:4|8)?@1"[\s\S]*"(?:NaN|-?Infinity)"'
  - id: mongo-psl-enum-codecs-refused
    summary: |
      A Mongo PSL enum whose codec stores a BSON type that has no JSON value, such as `mongo/int64@1`, `mongo/int64Number@1`, `mongo/date@1`, `mongo/objectId@1`, `mongo/decimal128@1`, `mongo/binary@1` or `mongo/vector@1`, is now refused at `contract emit` with `PSL_EXTENSION_INVALID_VALUE`, and so is a `mongo/double@1` member written as "NaN", "Infinity" or "-Infinity". The collection validator listed such members in their JSON forms and refused every write of those fields. Change the enum to a codec whose BSON type is string, int, double, bool, object or array, or author the enum in a TypeScript contract, which has no collection validator.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"mongo/(?:int64|int64Number|date|objectId|decimal128|binary|vector)@1"'
        - '@@type\(\s*"mongo/double@1"\s*\)[^}]*"(?:NaN|-?Infinity)"'
  - id: mongo-orm-takes-enum-accessors
    summary: |
      `mongoOrm()` and `createMongoCollection()` from `@prisma/orm-mongo/orm` now require the contract's enum accessors, which they check a written enum value against. Build them with `buildMongoEnums(contract, context.codecs)` from `@prisma/orm-mongo/family-runtime` and pass them as `enums`: `mongoOrm({ contract, executor, enums })`, and `createMongoCollection(contract, model, executor, enums, mutationDefaults)`, whose accessors come before the optional `mutationDefaults`. Clients built with `mongo()` need no change.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:mongoOrm|createMongoCollection)\s*(?:<[^>]*>)?\s*\('
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

The rule: a member changes when its codec's stored JSON form is not the application value. That covers:

- bigint codecs: `pg/int8@1`, `pg/unboundedint@1`, `sqlite/bigint@1`, `mongo/int64@1` (a bigint, where it was decimal text);
- codecs that read decimal text as a number: `pg/int8number@1`, `sqlite/bigintnumber@1`, `mongo/int64Number@1` (a number, where it was text);
- date, time, timestamp and interval codecs: `pg/timestamptz-date@1`, `pg/date-temporal@1`, `pg/time-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/interval@1`, `sqlite/datetime@1`, `mongo/date@1` (a `Date`, a Temporal value or an interval object, where it was text);
- byte codecs, `sqlite/blob@1` and `mongo/binary@1` (a `Uint8Array`, where it was JSON). An enum can no longer use `pg/bytea@1`; see `ts-enum-string-timestamp-codecs-refused`;
- float members written "NaN", "Infinity" or "-Infinity" on `pg/float4@1`, `pg/float8@1`, `pg/float@1` or `mongo/double@1`, and members written "Infinity" or "-Infinity" on `sqlite/real@1`, which refuses NaN (a number, where it was text).

Text, integer, uuid, numeric, boolean and JSON members are unchanged. A mutable member, such as a `Date` or a `Uint8Array`, is a fresh copy on every read, so changing one does not change the enum. An enum's members are decoded when the enum is first read, so a client whose contract has a Temporal enum builds in a runtime without `Temporal` and fails only when that enum is read.

`has()`, `nameOf()` and `ordinalOf()` find a value equal to a member. A string, number or bigint must be the member itself; an object must be of the member's kind and stored as the member is, so a date equal to a member matches although it is a different object. A value of another type, such as `"1"` for an int8 member or an ISO string for a date member, is no member.

1. Find the code that reads `db.enums`. The detection for this change looks for `enums.` and `enums[`; if you hold an enum accessor under another name, search for that name too.
2. For enums whose codec is listed above, remove any conversion that turned a member into the value a query returns, such as `BigInt(db.enums.public.Level.members.Low)` or `new Date(...)` around a member, and any conversion that turned a value back into the stored form before calling `has()`, `nameOf()` or `ordinalOf()`. Pass the value as a query returns it.
3. Code that compared a member with the stored form, for example `members.Low === '1'`, now compares with the value: `members.Low === 1n`. Compare object members by value, for example `members.Launch.getTime() === row.at.getTime()`, not with `===`.

## `float-enum-columns-type-non-finite-members-as-number`

Re-emit the contract. A float enum column that has a NaN or infinite member is typed `number` in `contract.d.ts`, because those members are numbers. Where code wrote the strings `"NaN"`, `"Infinity"` or `"-Infinity"` to such a column, write `NaN`, `Infinity` or `-Infinity`, or the enum's member, such as `db.enums.public.Special.members.Nan`.

## `mongo-psl-enum-codecs-refused`

A Mongo PSL contract derives a collection validator whose `$jsonSchema` lists each enum's members as JSON. A BSON long, date, ObjectId, decimal, binary or vector value is never equal to its JSON form, so the validator refused every write of a field typed by such an enum. `prisma contract emit` now reports the enum at its `@@type` argument, or a double member written as text at the member, instead of emitting a contract no write can satisfy.

For each enum reported, do one of these:

- Store the enum through a codec the validator can list, for example a `mongo/string@1` enum whose members are the values' text, and convert at the application boundary.
- Author the enum and the models that use it in a TypeScript contract (`@internal/mongo/contract-builder`), which carries no collection validator; the ORM checks enum membership on write there.

## `mongo-orm-takes-enum-accessors`

Code that builds the Mongo ORM itself, rather than through `mongo()`, passes the contract's enum accessors, the same ones `db.enums` holds. Built without them, the ORM compared a written enum value with the enum's stored forms and refused every value of an enum whose stored form is not the value, such as a bigint or a date member; it is now a type error.

```ts
import {
  buildMongoEnums,
  createMongoExecutionContext,
  createMongoRuntime,
} from '@prisma/orm-mongo/family-runtime';

const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, driver });
const orm = mongoOrm({ contract, executor: runtime, enums: buildMongoEnums(contract, context.codecs) });
```

`buildMongoEnums` refuses a contract whose enum codec the context lacks with `RUNTIME.CODEC_DESCRIPTOR_MISSING`. `createMongoCollection()` takes the accessors as its fourth argument, before the optional `mutationDefaults`: change `createMongoCollection(contract, 'User', executor, mutationDefaults)` to `createMongoCollection(contract, 'User', executor, enums, mutationDefaults)`. A write of an enum field whose accessor is missing from `enums` is refused with `ORM.ARGUMENT_INVALID`.

## `contract-dts-enum-member-types`

Run `prisma contract emit`. Each namespace with enums gains an optional, type-only `enumMemberTypes` entry next to its `enum` entry. The `enum` entry still types each member as `contract.json` stores it; `db.enums` takes its member types from `enumMemberTypes`. Until you re-emit, `db.enums` keeps typing members in their stored form, which no longer matches what it holds.
