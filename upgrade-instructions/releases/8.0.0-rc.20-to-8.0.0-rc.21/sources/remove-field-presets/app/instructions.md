---
changes:
  - id: psl-field-presets-removed
    summary: |
      PSL field presets are removed. A field typed with a preset call, such as `id.uuidv4String()`, `nanoid({ size: 12 })`, `temporal.createdAt()` or `temporal.time(3, onUpdate: now)`, is refused with `PSL_UNRESOLVED_REFERENCE`, and the message gives the exact replacement. Rewrite each call as the tables in this guide say: a type constructor or a contributed alias, plus `@id`, `@onCreate(...)` and `@onUpdate(...)`. The contract does not change, so there is nothing to re-emit, sign or migrate. The detection matches schema files that type a field with a preset call.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*\w+[ \t]+(?:temporal|id)\.[a-z]\w*[ \t]*\('
        - '(?:^|\n)[ \t]*\w+[ \t]+(?:text|int|bigint|float|decimal|boolean|json|bytes|dateTime|uuidString|uuidNative|ulid|nanoid|cuid2|ksuid)[ \t]*\('
  - id: ts-field-presets-removed
    summary: |
      The TypeScript contract builders have no field presets. `field.text()`, `field.uuidString()`, `field.json()` (on Postgres) and the other scalar presets, every `field.id.*` and every `field.temporal.*` no longer exist. TypeScript reports a missing property, and `prisma contract emit` on a contract that was not type-checked fails with `CONTRACT.FIELD_HELPER_UNKNOWN`, which names the rewrite. Rewrite each call as `field.column(type.X(...))` with `.id()`, `.onCreate(gen.fn())` and `.onUpdate(gen.fn())`, as the tables in this guide say, including the fields of query fragments. The contract does not change. MongoDB's `field.date()`, `field.string()`, `field.json()` and the other codec helpers are not presets and stay. The detection matches TypeScript files that call a preset; it matches a `field.json()` call only in a file that names `@prisma/orm-postgres`, so a Postgres file that imports its builder through a local module is not matched.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$.])field\.(?:id|temporal)\.'
        - '(?<![\w$.])field\.(?:text|int|bigint|float|decimal|boolean|bytes|dateTime|uuidString|uuidNative|ulid|nanoid|cuid2|ksuid)\('
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-postgres)[\s\S]*(?<![\w$.])field\.json\('
  - id: ts-field-generated-removed
    summary: |
      `field.generated(...)` and the spec helpers `uuidv4()`, `uuidv7()`, `ulid()`, `nanoid()`, `cuid2()` and `ksuid()` from `@prisma/orm-framework/ids` are removed. Write the identifier's type alias with `.onCreate(gen.fn())` instead, such as `field.column(type.Ulid()).onCreate(gen.ulid())`, as the table in this guide says, and remove the import. The contract does not change. The detection matches TypeScript files that call `field.generated` or import one of those helpers.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$.])field\.generated\('
        - 'import\s*(?:type\s*)?\{[^}]*(?<![\w$])(?:uuidv4|uuidv7|ulid|nanoid|cuid2|ksuid)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-framework/ids[\x27"]'
  - id: postgres-contract-builder-exports-type
    summary: |
      No action is needed. `@prisma/orm-postgres/contract-builder` now exports `type` beside `field` and `gen`, the same type constructors and aliases the `defineContract` callback receives, so a query fragment declares a field as `field.column(type.TimestamptzTemporal())`.
  - id: sqlite-sql-char
    summary: |
      No action is needed. Every SQL target now has the type constructor `sql.Char(n)` in PSL and `type.sql.Char(n)` in TypeScript, which stores a fixed-length text column of `n` characters. On SQLite it is the only way to write a fixed-length text column, such as the column of a nanoid of another size.
  - id: identifier-type-aliases
    summary: |
      No action is needed. Every SQL target now has a type alias for the column of each identifier format the client generates: `sql.UuidString`, `sql.Ulid`, `sql.Nanoid`, `sql.Cuid2` and `sql.Ksuid` in PSL, and `type.sql.Ulid()` and the others in TypeScript. Postgres also names them at the top level, as `Ulid` and `type.Ulid()`. Each stores the same column as `Char(n)` of its length, so the identifier presets are rewritten with them.
---

# Field presets are removed

This guide replaces two pieces of advice from the 8.0.0-rc.19 upgrade guide. That guide said that `field.generated(...)` keeps working for now, and that a field preset keeps its `number`, `option` and `object` arguments. Neither holds any more: this release removes `field.generated(...)` and every field preset, in PSL and in TypeScript, and the tables below give what to write instead.

A field preset was a call in a field's type position that set the column, the identity and the generated values at once, such as `id.uuidv4String()` or `temporal.createdAt()`. Each is now written with what the rest of a contract uses: a type constructor or a contributed alias, such as `Ulid` or `temporal.CreatedAt`, plus `@id`, `@onCreate(...)` and `@onUpdate(...)` in PSL, or `.id()`, `.onCreate(gen.fn())` and `.onUpdate(gen.fn())` in TypeScript. Every replacement stores the same contract as its preset, with the same storage and execution hashes. So after the rewrite nothing is re-emitted, signed or migrated: `prisma contract emit` writes the `contract.json` you have. Rewrite the calls where your project's comments and documentation show them too, such as a README, in PSL and in TypeScript; the detections look only at `.prisma` and TypeScript files.

```prisma
// Before
model Event {
  id        id.uuidv4String()
  code      nanoid({ size: 12 })
  seenAt    temporal.time(3, onUpdate: now)
  createdAt temporal.createdAt()
  payload   json()
}

// After
model Event {
  id        UuidString         @id @onCreate(uuid())
  code      Char(12)
  seenAt    Time(3)            @onUpdate(now())
  createdAt temporal.CreatedAt
  payload   Jsonb
}
```

```ts
// Before
({ field, model }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.id.uuidv4String(),
        code: field.nanoid({ size: 12 }),
        seenAt: field.temporal.time(3, undefined, 'now'),
        createdAt: field.temporal.createdAt(),
        payload: field.json(),
        slug: field.generated(nanoid({ size: 16 })),
      },
    }),
  },
})

// After
({ field, model, gen, type }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.UuidString()).id().onCreate(gen.uuid()),
        code: field.column(type.Char(12)),
        seenAt: field.column(type.Time(3)).onUpdate(gen.now()),
        createdAt: field.column(type.temporal.CreatedAt()),
        payload: field.column(type.Jsonb()),
        slug: field.column(type.Char(16)).onCreate(gen.nanoid(16)),
      },
    }),
  },
})
```

## The replacement of each preset

In the tables, a PSL preset is written as in a schema. Its TypeScript form is the same call on `field`: `id.uuidv4String()` is `field.id.uuidv4String()`, and `temporal.createdAt()` is `field.temporal.createdAt()`.

### SQL family presets, on Postgres and SQLite

Each identifier preset is replaced by the type alias for its column: `UuidString`, `Ulid`, `Nanoid`, `Cuid2` or `Ksuid`. The field writes `@id` and `@onCreate(...)` itself where the preset set them. On Postgres, write the alias as a top-level name, `Ulid` in PSL and `type.Ulid()` in TypeScript, as the table does. On SQLite, write it in the `sql` namespace, `sql.Ulid` and `type.sql.Ulid()`. Both forms store the same column as `Char(26)`. A nanoid of another size has no alias, so its column is written out: `Char(n)` on Postgres, `sql.Char(n)` on SQLite.

| Preset | Stores | PSL replacement | TypeScript replacement |
|---|---|---|---|
| `uuidString()` | `sql/char@1`, `{ length: 36 }` | `UuidString` | `field.column(type.UuidString())` |
| `ulid()` | `sql/char@1`, `{ length: 26 }` | `Ulid` | `field.column(type.Ulid())` |
| `nanoid()` | `sql/char@1`, `{ length: 21 }` | `Nanoid` | `field.column(type.Nanoid())` |
| `nanoid({ size: n })` | `sql/char@1`, `{ length: n }` | `Char(n)` | `field.column(type.Char(n))` |
| `cuid2()` | `sql/char@1`, `{ length: 24 }` | `Cuid2` | `field.column(type.Cuid2())` |
| `ksuid()` | `sql/char@1`, `{ length: 27 }` | `Ksuid` | `field.column(type.Ksuid())` |
| `id.uuidv4String()` | as `uuidString()`, `@id`, `uuidv4` on create | `UuidString @id @onCreate(uuid())` | `field.column(type.UuidString()).id().onCreate(gen.uuid())` |
| `id.uuidv7String()` | as above, `uuidv7` | `UuidString @id @onCreate(uuid(7))` | `field.column(type.UuidString()).id().onCreate(gen.uuid(7))` |
| `id.ulid()` | `{ length: 26 }`, `@id`, `ulid` | `Ulid @id @onCreate(ulid())` | `field.column(type.Ulid()).id().onCreate(gen.ulid())` |
| `id.nanoid()` | `{ length: 21 }`, `@id`, `nanoid` | `Nanoid @id @onCreate(nanoid())` | `field.column(type.Nanoid()).id().onCreate(gen.nanoid())` |
| `id.nanoid({ size: n })` | `{ length: n }`, `@id`, `nanoid` of size `n` | `Char(n) @id @onCreate(nanoid(n))` | `field.column(type.Char(n)).id().onCreate(gen.nanoid(n))` |
| `id.cuid2()` | `{ length: 24 }`, `@id`, `cuid2` | `Cuid2 @id @onCreate(cuid(2))` | `field.column(type.Cuid2()).id().onCreate(gen.cuid(2))` |
| `id.ksuid()` | `{ length: 27 }`, `@id`, `ksuid` | `Ksuid @id @onCreate(ksuid())` | `field.column(type.Ksuid()).id().onCreate(gen.ksuid())` |

A foreign key that holds one of these identifiers uses the alias alone, as in `authorId Ulid`, because its value is copied from the row it points at.

A model, composite type or type alias your schema declares with an alias's name, such as `model Ulid`, hides the top-level alias: `Ulid` then names your declaration. Write `sql.Ulid` in that schema instead; it names the same column.

To write a generated id once, declare a mixin and include it with `+` in each model:

```prisma
model mixin UlidId {
  id Ulid @id @onCreate(ulid())
}

model Post {
  +UlidId
  authorId Ulid
  author   User @relation(fields: [authorId], references: [id])
}
```

In TypeScript, declare the field once and use it in each model. Declare it inside the `defineContract` callback, or with the `field`, `type` and `gen` that `@prisma/orm-postgres/contract-builder` exports:

```ts
const UlidId = field.column(type.Ulid()).id().onCreate(gen.ulid());
```

On Postgres, the native `Uuid` column stores a UUID in 16 bytes and is a better choice for a new schema, written `Uuid @id @onCreate(uuid(7))`. Moving an existing column from `UuidString` to `Uuid` changes the contract and needs a migration, so it is not part of this upgrade.

A TypeScript `id` preset's trailing `{ name }`, as in `field.id.uuidv4String({ name: 'user_pk' })`, moves to `.id({ name: 'user_pk' })`.

### Postgres presets

| Preset | Stores | PSL replacement | TypeScript replacement |
|---|---|---|---|
| `text()` | `pg/text@1` | `String` | `field.column(type.String())` |
| `int()` | `pg/int4@1` | `Int` | `field.column(type.Int())` |
| `bigint()` | `pg/int8@1` | `BigInt` | `field.column(type.BigInt())` |
| `float()` | `pg/float8@1` | `Float` | `field.column(type.Float())` |
| `decimal()` | `pg/numeric@1`, no parameters | `Decimal` | `field.column(type.Decimal())` |
| `boolean()` | `pg/bool@1` | `Boolean` | `field.column(type.Boolean())` |
| `json()` | `pg/jsonb@1` | `Jsonb` (not `Json`, which is `pg/json@1`) | `field.column(type.Jsonb())` |
| `bytes()` | `pg/bytea@1` | `Bytes` | `field.column(type.Bytes())` |
| `dateTime()` | `pg/timestamptz-temporal@1` | `DateTime` | `field.column(type.DateTime())` |
| `uuidNative()` | `pg/uuid@1` | `Uuid` | `field.column(type.Uuid())` |
| `id.uuidv4Native()` | `pg/uuid@1`, `@id`, `uuidv4` | `Uuid @id @onCreate(uuid())` | `field.column(type.Uuid()).id().onCreate(gen.uuid())` |
| `id.uuidv7Native()` | `pg/uuid@1`, `@id`, `uuidv7` | `Uuid @id @onCreate(uuid(7))` | `field.column(type.Uuid()).id().onCreate(gen.uuid(7))` |
| `temporal.createdAt()` | `pg/timestamptz-temporal@1`, now on create | `temporal.CreatedAt` | `field.column(type.temporal.CreatedAt())` |
| `temporal.updatedAt()` | the same, on create and update | `temporal.UpdatedAt` | `field.column(type.temporal.UpdatedAt())` |
| `temporal.createdAtString()`, `temporal.updatedAtString()` | `pg/timestamptz-string@1` | `temporal.CreatedAtString`, `temporal.UpdatedAtString` | `field.column(type.temporal.CreatedAtString())`, `field.column(type.temporal.UpdatedAtString())` |
| `temporal.createdAtJsDate()`, `temporal.updatedAtJsDate()` | `pg/timestamptz-date@1` | `temporal.CreatedAtJsDate`, `temporal.UpdatedAtJsDate` | `field.column(type.temporal.CreatedAtJsDate())`, `field.column(type.temporal.UpdatedAtJsDate())` |
| `temporal.timestamp(p, onCreate: now, onUpdate: now)` | `pg/timestamp-temporal@1`, `{ precision: p }` | `TimestampTemporal(p) @onCreate(now()) @onUpdate(now())` | `field.column(type.TimestampTemporal(p)).onCreate(gen.now()).onUpdate(gen.now())` |
| `temporal.timestamptz(...)` | `pg/timestamptz-temporal@1` | `TimestamptzTemporal(p)` and the attributes | `field.column(type.TimestamptzTemporal(p))` and the calls |
| `temporal.timestampString(...)` | `pg/timestamp-string@1` | `TimestampString(p)` and the attributes | `field.column(type.TimestampString(p))` and the calls |
| `temporal.timestamptzString(...)` | `pg/timestamptz-string@1` | `TimestamptzString(p)` and the attributes | `field.column(type.TimestamptzString(p))` and the calls |
| `temporal.timestamptzJsDate(...)` | `pg/timestamptz-date@1` | `TimestamptzJsDate(p)` and the attributes | `field.column(type.TimestamptzJsDate(p))` and the calls |
| `temporal.date(onCreate: now, onUpdate: now)` | `pg/date-temporal@1` | `Date` and the attributes | `field.column(type.Date())` and the calls |
| `temporal.dateString(...)` | `pg/date-string@1` | `DateString` and the attributes | `field.column(type.DateString())` and the calls |
| `temporal.time(p, ...)` | `pg/time-temporal@1` | `Time(p)` and the attributes | `field.column(type.Time(p))` and the calls |
| `temporal.timeString(p, ...)` | `pg/time-string@1` | `TimeString(p)` and the attributes | `field.column(type.TimeString(p))` and the calls |
| `temporal.timetz(p, ...)` | `pg/timetz@1` | `Timetz(p)` and the attributes | `field.column(type.Timetz(p))` and the calls |

The `temporal.<type>(...)` presets take an optional precision `p` (the first argument, or `precision: p`) and the phases `onCreate: now` and `onUpdate: now`. Write the precision as the constructor's argument, and leave it out when the preset left it out: `temporal.timestamptz()` is `TimestamptzTemporal`. Write each phase the preset set as its attribute, `@onCreate(now())` or `@onUpdate(now())`, and leave out a phase it did not set: `temporal.time(3, onUpdate: now)` is `Time(3) @onUpdate(now())`. A preset with no phase is the bare constructor.

In TypeScript the precision and the phases are positional, and a phase is `'now'` or `undefined`: `field.temporal.timestamp(3, 'now', 'now')` is `field.column(type.TimestampTemporal(3)).onCreate(gen.now()).onUpdate(gen.now())`, `field.temporal.time(3, undefined, 'now')` is `field.column(type.Time(3)).onUpdate(gen.now())`, and `field.temporal.date('now')` is `field.column(type.Date()).onCreate(gen.now())`.

Attributes and calls written after the preset stay after the replacement: `temporal.updatedAt() @map("updated_at")` is `temporal.UpdatedAt @map("updated_at")`, `field.temporal.createdAt().optional()` is `field.column(type.temporal.CreatedAt()).optional()`, and `temporal.timestamptz(onUpdate: now) @onCreate(now())` is `TimestamptzTemporal @onCreate(now()) @onUpdate(now())`.

### SQLite presets

| Preset | Stores | PSL replacement | TypeScript replacement |
|---|---|---|---|
| `temporal.createdAt()`, `temporal.updatedAt()` | `sqlite/datetime@1`, now on create, and on update for `updatedAt` | `temporal.CreatedAt`, `temporal.UpdatedAt` | `field.column(type.temporal.CreatedAt())`, `field.column(type.temporal.UpdatedAt())` |
| `temporal.datetime(onCreate: now, onUpdate: now)` | `sqlite/datetime@1` | `DateTime @onCreate(now()) @onUpdate(now())` | `field.column(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now())` |

The SQL family presets in the first table also existed on SQLite. Their replacements use the `sql.` aliases, such as `sql.Ulid` and `type.sql.Ulid()`, and `sql.Char(n)` and `type.sql.Char(n)` for a nanoid of another size.

### MongoDB presets

| Preset | Stores | PSL replacement | TypeScript replacement |
|---|---|---|---|
| `temporal.createdAt()` | `mongo/date@1`, now on create | `temporal.CreatedAt` | `field.date().onCreate(gen.now())` |
| `temporal.updatedAt()` | the same, on create and update | `temporal.UpdatedAt` | `field.date().onCreate(gen.now()).onUpdate(gen.now())` |
| `temporal.timestamp(onCreate: now, onUpdate: now)` | `mongo/date@1` | `Date @onCreate(now()) @onUpdate(now())` | `field.date().onCreate(gen.now()).onUpdate(gen.now())` |

The MongoDB TypeScript builder has no `type` helpers, so its replacements use `field.date()`.

### `field.generated(...)`, in the SQL TypeScript builder

| Before | After |
|---|---|
| `field.generated(uuidv4())` | `field.column(type.UuidString()).onCreate(gen.uuid())` |
| `field.generated(uuidv7())` | `field.column(type.UuidString()).onCreate(gen.uuid(7))` |
| `field.generated(ulid())` | `field.column(type.Ulid()).onCreate(gen.ulid())` |
| `field.generated(nanoid())` | `field.column(type.Nanoid()).onCreate(gen.nanoid())` |
| `field.generated(nanoid({ size: n }))` | `field.column(type.Char(n)).onCreate(gen.nanoid(n))` |
| `field.generated(cuid2())` | `field.column(type.Cuid2()).onCreate(gen.cuid(2))` |
| `field.generated(ksuid())` | `field.column(type.Ksuid()).onCreate(gen.ksuid())` |

On SQLite write the `sql.` forms, such as `type.sql.Ulid()` and `type.sql.Char(n)`. A `.id()` after `field.generated(...)` stays `.id()` on the replacement.

## `psl-field-presets-removed`

Rewrite every preset call in your Prisma 8 schema files as the tables say. `prisma contract emit` refuses each one with `PSL_UNRESOLVED_REFERENCE` and the exact rewrite, one diagnostic per field:

```text
PSL_UNRESOLVED_REFERENCE: id.uuidv4String() was a field preset, and Prisma 8 removed field presets. Write UuidString @id @onCreate(uuid()).
PSL_UNRESOLVED_REFERENCE: temporal.time(3, onUpdate: now) was a field preset, and Prisma 8 removed field presets. Write Time(3) @onUpdate(now()).
```

The message writes the alias as the schema's target names it: `UuidString` on Postgres and `sql.UuidString` on SQLite. On Postgres you may write `sql.UuidString` too; both store the same column. If a preset was called with an argument it did not take, the message gives the type and tells you which attributes to add.
Run `prisma contract emit`. It writes the same `contract.json` and `contract.d.ts`, with the same hashes.

## `ts-field-presets-removed`

Rewrite every preset call in your TypeScript contract and query fragments as the tables say.

In a `defineContract` callback, take `type` and `gen` from the callback's argument where the rewritten fields use them. Add each missing name at the end of the destructuring, `gen` before `type`: `({ field, model })` becomes `({ field, model, gen, type })`, and `({ field, model, type })` becomes `({ field, model, type, gen })`. If you rename the callback's `field`, as in `({ field: f })`, a preset call is written `f.id.uuidv4String()`; the detection does not see it, so search for it yourself.

On Postgres, use the constructors in the Postgres table and the top-level aliases, such as `type.Ulid()`, for the SQL family presets. On SQLite, use the `sql.` aliases, such as `type.sql.Ulid()`. Code that does not know its target can write `type.sql.Ulid()` and `type.sql.Char(n)`, which every SQL target has.

If the file already has a binding named `type`, such as `import { type } from 'arktype'`, the callback's `type` hides it inside the callback. Rename one of them, as in `({ field, model, gen, type: t })`, if the callback uses both.

A contract that calls the `field` imported from a facade's `contract-builder` outside a callback needs `type` too. `@prisma/orm-postgres/contract-builder` exports it. The other facades do not, so move the models into the `defineContract` callback, `defineContract({}, ({ field, model, gen, type }) => ({ models: { ... } }))`, and remove `field` from the import.

A query fragment that declares its fields with the `field` exported by `@prisma/orm-postgres/contract-builder` imports `type` from the same entry:

```ts
// Before
import { field } from '@prisma/orm-postgres/contract-builder';

export const createdSince = (since: Temporal.Instant) =>
  db.orm.fragment({ createdAt: field.temporal.timestamptz() }, (rows) =>
    rows.where((row) => row.createdAt.gte(since)),
  );

// After
import { field, type } from '@prisma/orm-postgres/contract-builder';

export const createdSince = (since: Temporal.Instant) =>
  db.orm.fragment({ createdAt: field.column(type.TimestamptzTemporal()) }, (rows) =>
    rows.where((row) => row.createdAt.gte(since)),
  );
```

A fragment field matches a column by its codec and nullability, so the replacement matches the same models the preset did.

In MongoDB contracts, `field.temporal.*` is the only preset. Take `gen` from the callback and write `field.date()` with `.onCreate(gen.now())` and `.onUpdate(gen.now())`. Leave `field.json()`, `field.date()`, `field.string()` and the other MongoDB field helpers alone; they are not presets.

Then type-check the project and run `prisma contract emit`. The contract does not change.

## `ts-field-generated-removed`

Replace each `field.generated(...)` as the table says, and remove `uuidv4`, `uuidv7`, `ulid`, `nanoid`, `cuid2` and `ksuid` from your imports of `@prisma/orm-framework/ids`. Remove the import if nothing is left in it. Take `gen` and `type` from the callback, as for `ts-field-presets-removed`. The contract does not change.

## `postgres-contract-builder-exports-type`

There is nothing to change. `@prisma/orm-postgres/contract-builder` exports `type` beside `field` and `gen`. Use it to declare the fields of a query fragment, as shown above.

## `sqlite-sql-char`

There is nothing to change. `sql.Char(n)` in PSL and `type.sql.Char(n)` in TypeScript are new on every SQL target and store `sql/char@1` with `{ length: n }`. A SQLite contract emitted from a nanoid preset of another size already stores this column, so rewriting the preset as `sql.Char(n)` keeps the contract.

## `identifier-type-aliases`

There is nothing to change. The identifier aliases are new: `sql.UuidString`, `sql.Ulid`, `sql.Nanoid`, `sql.Cuid2` and `sql.Ksuid` on every SQL target, and `UuidString`, `Ulid`, `Nanoid`, `Cuid2` and `Ksuid` on Postgres. Each stores `sql/char@1` with the length of its format, so `Ulid` and `Char(26)` store the same column with the same hashes. A schema that already writes `Char(26)` can keep it or switch to `Ulid`.
