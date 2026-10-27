---
from: "8.0.0-rc.20"
to: "8.0.0-rc.21"
changes:
  - id: mongo-contract-target-option
    summary: |
      `mongoContract(schemaPath, options)` now requires `options.target`, the MongoDB target pack, which the contract records. Pass `{ target: mongoTargetPack }` with `mongoTargetPack` imported from `@prisma/orm-mongo/target/pack`, alongside any options you already pass. A config written with `defineConfig` from `@prisma/orm-mongo/config` needs no change.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      matches:
        - '(?<![\w$.])mongoContract\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,?\s*\)'
        - '(?<![\w$.])mongoContract\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*\{(?![^{}]*\btarget\b)[^{}]*\}\s*\)'
  - id: mongo-contract-input
    summary: |
      The MongoDB type for the object you pass to `defineContract`, `ContractDefinition`, is renamed `ContractInput`. It is the same type under SQL's name for it. `ContractDefinition` now names the plain-data definition every MongoDB contract source builds from, which takes no type parameters, so the detection flags an import from `@prisma/orm-family-mongo/contract-ts` only where the file writes `ContractDefinition<...>`. Import `ContractInput` from `@prisma/orm-mongo/contract-builder` where you imported `ContractDefinition`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-mongo/contract-builder[\x27"]'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bContractDefinition\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/contract-ts(?:/contract-builder)?[\x27"][\s\S]*\bContractDefinition<'
  - id: mongo-model-definition-removed
    summary: |
      `MongoModelDefinition` is removed. It was another name for `ContractModel<MongoModelStorage>`. Write `ContractModel<MongoModelStorage>` instead, with `ContractModel` from `@prisma/orm-mongo/contract/types` and `MongoModelStorage` from `@prisma/orm-mongo/family-contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])MongoModelDefinition(?![\w$])'
  - id: mongo-ts-polymorphism-rules
    summary: |
      `defineContract` now applies the MongoDB polymorphism rules that PSL applied. It refuses a discriminator that is optional, a list or not text, such as an `Int32` field (`CONTRACT.ARGUMENT_INVALID`); a variant value the discriminator field cannot hold or that is not a member of its enum; a variant listed in `discriminator.variants` that no model declares with that base; a variant stored in another collection than its base (`CONTRACT.COLLECTION_INVALID`); and, in TypeScript and PSL, a variant field stored under a name a field of its base is stored under, such as the discriminator (`CONTRACT.NAME_DUPLICATE`, `PSL_DUPLICATE_STORED_NAME`), which would overwrite that field; and, in TypeScript and PSL, a variant field that restates a base field with a different stored name, type, nullability or list shape (`CONTRACT.ARGUMENT_INVALID`, `PSL_VARIANT_FIELD_DIFFERS_FROM_BASE`), whose documents the collection's validator, written from the base, would refuse. Make the discriminator a required `field.string()` or a string enum, list only declared variants, leave a variant's `collection` out or set it to its base's, give each variant field a stored name its base does not use, and restate a base field on a variant exactly as the base declares it, or not at all.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bdiscriminator\s*:\s*\{'
  - id: mongo-index-shape-rules
    summary: |
      Every MongoDB contract source now refuses an index MongoDB would refuse (`CONTRACT.INDEX_INVALID` in TypeScript, `PSL_INVALID_INDEX` in PSL): a unique wildcard index, a wildcard with a hashed, 2d or 2dsphere key, a hashed index on several fields, a TTL wildcard index, a wildcard projection without a wildcard key, a collation without a locale, and a second text index in one collection. PSL also refuses an index that another model on the same collection, or the same model, already declares, such as `@unique` and `@@unique` on one field. Remove the index or change it to a shape MongoDB accepts; remove a duplicate.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma}"
      matches:
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*(?:\$\*\*|\bwildcardProjection\b|[\x27"]hashed[\x27"]|\bcollation\s*:)'
        - '\bwildcard\('
  - id: mongo-value-object-enum-check
    summary: |
      `defineContract` now refuses a value object field typed by an enum the contract does not declare (`CONTRACT.ENUM_UNKNOWN`), as it already did for a model field. Add the enum to `defineContract({ enums })`.
  - id: mongo-newly-accepted
    summary: |
      No action is needed. An optional field that a preset, a type alias, `@onCreate(...)`/`@onUpdate(...)` or `.onCreate(...)`/`.onUpdate(...)` fills is now accepted, as on SQL; a list that generates a value is still refused. A TypeScript variant may leave its `collection` out and is stored in its base's. The PSL preset-without-effect warning is no longer reported next to `@onCreate(...)` or `@onUpdate(...)`, which do fill the field, and is now reported even when the schema is refused. `defineContract` now reports the same case as the warning `PN_PRESET_WITHOUT_EFFECT`.
  - id: mongo-prisma6-merged-indexes
    summary: |
      A Prisma 6 schema read by `prisma6Schema()` in which one collection holds two identical indexes, such as `@unique` and `@@unique` on one field, or the same `@@index` on two models stored in one collection, now gives one index, as the database holds one. That contract's storage hash changes. Run `prisma contract emit`, then `prisma db sign` to record the new hash; the database itself needs no change.
  - id: removed-enum-value-questions
    summary: |
      On Postgres and SQLite, when the contract removes a member of an enum, or changes the value a member stores, `migration plan` and `db update` now rewrite the rows that hold the old stored value, and ask about it first. Before, Postgres failed at apply on the new check when a row held the old value, and SQLite planned nothing. If the member was renamed, say so with `--rename Status.ARCHIVED:Status.RETIRED`, which changes the stored value in every row and list that holds it. Answer with `--delete Status.ARCHIVED` to set it to NULL in optional columns and take it out of lists.
  - id: client-members-reject-instead-of-throwing
    summary: |
      A client member that returns a promise or a result no longer throws at the call when the client or the transaction is in a failed state. On `postgres()`, `sqlite()`, a `supabase()` role-bound client and a transaction, `query`, `execute`, `prepare`, `transaction`, ORM calls and a prepared statement's `query(target, params)` and `execute(target, params)` now report a closed client, a failed connection or an ended transaction through what they return: the promise rejects, and a result rejects when it is awaited or read. Error codes and messages do not change. Code that wraps such a call in `try`/`catch` without awaiting it no longer catches the error; add `await`, or handle it with `.catch(...)`. `db.runtime()` still throws at the call, and so does a mistake in the call itself, such as an ORM query the database's capabilities do not allow. The detection matches a file that imports an `@prisma/orm-*` package and has a `try` block, one line or many, nested or not, that calls one of these members or an ORM terminal (`all`, `first`, `create`, `update`, `delete`, `upsert`, …) without `await` directly before it, on a receiver shaped like a client: a name ending in `db`, `tx`, a name ending in `client`, `admin`, a prepared statement, or a chain through `.orm`; chains may span lines and take callbacks; leave a call whose result is awaited or returned to an awaiting caller as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*[\x27\x22]@prisma/orm-)[\s\S]*\btry\s*\{(?:(?!\}\s*(?:catch|finally)\b)[\s\S])*?(?<![\w$.])(?<!\bawait\s+)(?:this\s*\.\s*)?(?:[\w$]*(?:db|Db|DB)|tx|trx|[\w$]*[Cc]lient|admin|[\w$]*[Pp]repared[\w$]*|[\w$]+\s*\.\s*orm)(?:\s*\.\s*[\w$]+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*?\s*\.\s*(?:query|execute|prepare|transaction|all|first|firstOrThrow|create|createAll|createAndCount|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount|upsert|aggregate)\s*\('
  - id: close-ends-the-client-not-your-pool
    summary: |
      `close()` on a Postgres or Supabase client built on a pool or `pg.Client` you passed in now also closes its runtime, so a runtime you captured with `db.runtime()` before `close()` refuses new work. Your pool or `pg.Client` stays open, as before; end it yourself.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?:postgres|supabase)\(\s*\{[\s\S]*?\b(?:pg|binding|pool|client)\s*[:,}]'
  - id: sqlite-open-failure-is-a-connection-error
    summary: |
      A SQLite database file that cannot be opened (a missing directory, or a file that is not a database) is now a connection error (`SqlConnectionError`), not a query error (`SqlQueryError`), in the driver. Code that caught the query error to handle a bad database path catches the connection error instead.
  - id: verify-contract-spaces-marker-location
    summary: |
      `verifyContractSpaces` (from the `spaces` subpath of the migration tools) takes a required `markerLocation`, the name of the target's marker table or collection, which the remediation of an orphan marker names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])verifyContractSpaces\s*\('
  - id: psl-temporal-type-renames
    summary: |
      On PostgreSQL, the PSL types `Timestamptz`, `Timestamp` and `Interval` are renamed to `TimestamptzTemporal`, `TimestampTemporal` and `IntervalParts`, and the old names are errors. Rename each use in your `.prisma` files, keeping its arguments: `Timestamptz(3)` becomes `TimestamptzTemporal(3)`. Each new name reads the same value with the same codec, so the contract and its hashes do not change. `@db.Timestamp` and `@db.Timestamptz` in a Prisma 7 schema are not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w$.@"\x27`])(?:Timestamptz|Timestamp|Interval)(?![\w$])'
  - id: ts-temporal-type-helpers-renamed
    summary: |
      In a TypeScript contract, `type.Timestamptz(...)`, `type.Timestamp(...)` and `type.Interval(...)` are renamed to `type.TimestamptzTemporal(...)`, `type.TimestampTemporal(...)` and `type.IntervalParts(...)`, and the column helper `intervalColumn(...)` from `@prisma/orm-postgres/adapter/column-types` is renamed to `intervalPartsColumn(...)`. Rename each call; the arguments do not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:Timestamptz|Timestamp|Interval)\('
        - '(?<![\w$])intervalColumn(?![\w$])'
  - id: interval-with-precision-typed-as-parts
    summary: |
      An `IntervalParts(p)` column, an interval with a precision, is now typed as the `{ months, days, micros }` object its codec reads, as an interval without a precision already was, instead of a string. Type such a value as `PgInterval` from `@prisma/orm-postgres/target/codec-types`. Code that treated the value as a string was wrong at run time and now fails to type-check.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])Interval(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: branded-time-types-removed
    summary: |
      The string types `Timestamp`, `Timestamptz`, `Time` and `Interval` are no longer exported from `@prisma/orm-postgres/target/codec-types` (and `Interval` no longer from `@prisma/orm-postgres/contract-builder`). No column was typed by the first three. Remove each of these names from the import that names it, and delete the import if it names nothing else. A `contract.d.ts` written by an earlier release, such as one in a migration snapshot, imports them without using them, so removing them from its import is the only change it needs.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])(?:Timestamptz|Timestamp|Time|Interval)(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/(?:contract-builder|target/codec-types)[\x27"]'
  - id: temporal-types-from-temporal-spec
    summary: |
      Temporal fields are now typed with the `Temporal` types of the `temporal-spec` package rather than a global `Temporal` declaration, so they are typed even in a project without the polyfill's global types. The values are the same and assign to and from the global types. A type test that requires a field to be exactly `Temporal.Instant` (or another `Temporal` type) from the global declarations now fails: add `temporal-spec` (`1.0.1`) to your development dependencies and import the type with `import type { Temporal } from 'temporal-spec'` in that test.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*import\s+(?:type\s+)?\{[^}]*(?<![\w$])Temporal(?![\w$])(?!\s+as(?![\w$]))[^}]*\}\s*from\s*[\x27"]temporal-spec[\x27"])[\s\S]*toEqualTypeOf<\s*Temporal\.'
  - id: contract-types-list-new-aggregates
    summary: |
      Optional. An emitted `contract.d.ts` lists the aggregates of every codec in the stack, so `prisma contract emit` now adds rows for the three new codecs to it, and the contract itself does not change. Re-emit when you next change the contract; until then the existing `contract.d.ts` keeps working. A migration snapshot's `contract.d.ts` does not need the new rows; it needs only the import change `branded-time-types-removed` describes.
  - id: iso-string-date-time-values
    summary: |
      The PostgreSQL text date and time types (`TimestamptzString`, `TimestampString`, `DateString`, `TimeString`, `Timetz`) read and write ISO 8601, the form the contract stores, instead of the text PostgreSQL prints. A `timestamptz` reads as the instant in UTC whatever the session's time zone, as in `2024-01-01T00:00:00Z`. A literal default or enum member on these types must be written in that form.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:TimestamptzString|TimestampString|DateString|TimeString|Timetz)(?![\w$])'
        - '(?<![\w$])(?:timestamptzStringColumn|timestampStringColumn|dateStringColumn|timeStringColumn|timetzColumn|createdAtString|updatedAtString)(?![\w$])'
        - 'pg/(?:timestamptz-string|timestamp-string|date-string|time-string|timetz)@1'
  - id: date-style-iso-required
    summary: |
      The PostgreSQL driver ensures `DateStyle=ISO` on every connection it uses, including a `pg.Pool` or `pg.Client` the application passes to Prisma, which it sets with a statement. A statement in the application that sets a `DateStyle` other than `ISO`, or a pooler that drops the startup option, makes every read of a date or timestamp fail with `RUNTIME.DATE_STYLE_NOT_ISO`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - 'new\s+(?:pg\.)?(?:Pool|Client)\s*\('
  - id: prisma7-schema-now-default-writes-on-create
    summary: |
      A contract from `prisma7Schema(...)` now reads Prisma 7's `@default(now())` on a date or time field as both the database default `now()` and the client generator `now` on create, as Prisma 8 PSL reads `@default(now()) @onCreate(now())`. A create through Prisma 8 now writes the current UTC time, as Prisma 7's client did, instead of leaving the column to the database's clock in the session time zone. Re-emit the contract with `prisma contract emit` and commit it. Only the execution hash changes, so the database needs no migration and no `db sign`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\s*\('
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.21. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.20"'
---

# 8.0.0-rc.20 → 8.0.0-rc.21 — User upgrade instructions

## Order of the steps

Do the steps in this order, and skip a step that does not apply to the project:

1. Upgrade the Prisma packages.
2. Change a MongoDB contract source as the MongoDB entries below say: pass the target pack to `mongoContract` (`mongo-contract-target-option`), rename the contract types (`mongo-contract-input`, `mongo-model-definition-removed`), and fix any discriminator, index or enum the contract now refuses (`mongo-ts-polymorphism-rules`, `mongo-index-shape-rules`, `mongo-value-object-enum-check`).
3. Change a PostgreSQL contract source: rename the date and time types (`psl-temporal-type-renames`, `ts-temporal-type-helpers-renamed`), and write each literal default or enum member of a text date or time type in ISO 8601 (`iso-string-date-time-values`).
4. Run `prisma contract emit` (this also covers `contract-types-list-new-aggregates`, `prisma7-schema-now-default-writes-on-create` and `contract-artifacts-restamp`).
5. Run `prisma db sign` against every database when the project reads a Prisma 6 MongoDB schema whose storage hash changed (`mongo-prisma6-merged-indexes`).
6. On Postgres and SQLite, answer the question about a removed enum value the next time you run `migration plan` or `db update` (`removed-enum-value-questions`).
7. Change the application code: await client calls inside `try` blocks (`client-members-reject-instead-of-throwing`), stop using a runtime captured before `close()` (`close-ends-the-client-not-your-pool`), catch the connection error for a bad SQLite path (`sqlite-open-failure-is-a-connection-error`), and pass `markerLocation` to `verifyContractSpaces` (`verify-contract-spaces-marker-location`).
8. Change the code that uses PostgreSQL date and time values: remove the date and time types no longer exported from imports, including those in migration snapshots (`branded-time-types-removed`, `interval-with-precision-typed-as-parts`), import `Temporal` from `temporal-spec` in type tests (`temporal-types-from-temporal-spec`), read text date and time values as ISO 8601 (`iso-string-date-time-values`), and remove any statement that sets a `DateStyle` other than `ISO` (`date-style-iso-required`).

## `mongoContract` takes the target pack

The MongoDB PSL contract source now builds its contract through the same builder `defineContract` uses, and that builder records the stack's target and extension packs. The source reads them from its options.

### `mongo-contract-target-option`

Pass the MongoDB target pack as `target`:

```typescript
import { mongoContract } from '@prisma/orm-family-mongo/contract-psl/provider';
import mongoTargetPack from '@prisma/orm-mongo/target/pack';

const contract = mongoContract('./prisma/schema.prisma', { target: mongoTargetPack });
```

Keep any other options you pass, such as `output`, in the same object. A config that names its contract through `defineConfig({ contract: './prisma/schema.prisma' })` from `@prisma/orm-mongo/config` already passes the pack. An app that calls `mongoContract` itself imports it from `@prisma/orm-family-mongo/contract-psl/provider`, so it depends on `@prisma/orm-family-mongo` as well as `@prisma/orm-mongo`; `@prisma/orm-mongo` does not export `mongoContract`. A call without `target` is refused with `CONTRACT.ARGUMENT_INVALID` (`reason: 'target-pack-missing'`).

## MongoDB contract types take SQL's names

Two MongoDB type names change so that they match SQL's. The types themselves do not change.

### `mongo-contract-input`

The type of the object you pass to `defineContract` is now `ContractInput`, as it is in SQL. Rename the import and each use:

```typescript
import type { ContractInput } from '@prisma/orm-mongo/contract-builder';
```

### `mongo-model-definition-removed`

`MongoModelDefinition` was an alias for a model of a built contract. SQL has no such alias. Write the type it stood for:

```typescript
import type { ContractModel } from '@prisma/orm-mongo/contract/types';
import type { MongoModelStorage } from '@prisma/orm-mongo/family-contract';

function collectionOf(model: ContractModel<MongoModelStorage>): string | undefined {
  return model.storage.collection;
}
```

## MongoDB contract sources share one builder

Every MongoDB contract source, `defineContract`, Prisma 8 PSL and the Prisma 6 reader, now builds through one builder, so each MongoDB rule applies to every source in the same way. The entries below are where a source now refuses or accepts what it did not before. A contract that every source accepted before builds to the same `contract.json`.

### `mongo-ts-polymorphism-rules`

The detection matches a file that imports the MongoDB contract builder and declares a discriminator; an emitted `contract.d.ts` imports no builder, so it is not matched.

A discriminator must be a required text field, and each variant must be declared and stored in its base's collection:

```typescript
const Task = model('Task', {
  collection: 'tasks',
  fields: { _id: field.objectId(), type: field.string() },
  discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
});
const Bug = model('Bug', { base: Task, fields: { severity: field.int32() } });
```

### `mongo-index-shape-rules`

MongoDB refuses these indexes when it creates them, so the contract now refuses them first. A matched file uses a wildcard, a hashed key, a wildcard projection or a collation; check each such index against the list in the summary.

### `mongo-value-object-enum-check`

Declare every enum a value object field uses in `defineContract({ enums })`.

### `mongo-newly-accepted`

Nothing to change.

### `mongo-prisma6-merged-indexes`

Emit the contract again and sign the database, so `db verify` compares against the new storage hash.

## A removed enum value is asked about

### `removed-enum-value-questions`

If your contract removes a member of an enum, for example `ARCHIVED` from `Status`, the next `migration plan` or `db update` asks about it, as it asks about a model or field you remove: once, however many columns hold it.

If you renamed the member, give the rename, and the rows that held the old stored value hold the new one:

```bash
prisma db update --rename Status.ARCHIVED:Status.RETIRED
```

Otherwise the value is removed. A script that runs without a terminal fails with `CLI.CONSENT_REQUIRED`, naming the value. To let it go, add `--delete Status.ARCHIVED`: optional columns that hold it are set to NULL, and lists lose it. A required column cannot take NULL, so while rows of a required column hold the value, the apply fails with `MIGRATION.PRECHECK_FAILED`, changes nothing, counts the rows, and says how to keep them: rename the value to a new member, or keep that data by hand.

A member renamed with its stored value kept, for example with `RETIRED = "archived"`, changes nothing in the rows, and is not asked about. A member that keeps its name but stores a new value is asked about with `--delete` only, and so are two members that swap stored values; to keep the rows, the question names, for every column the enum types, the `this.removeStoredValue(...)` call to replace with `this.replaceStoredValue(...)` calls in the `migration.ts` that `migration plan` writes, and the `node` command that runs it. A swap goes through a temporary value. `db update` cannot keep that data in one run: its question says to plan the change with `migration plan --from <hash>`, or to rename the member to a new member and back in two runs of `db update`. For a swap only the plan works, and without migrations `db update` says it cannot keep the data.

Renames that shift stored values along, such as `Higher = 3` to `A = 4` while `Max = 4` becomes `B = 5`, are planned in one run, the last value first. Renames that move stored values in a cycle are refused; the refusal prints the `migration plan` command to write those rewrites by hand in, through a value no member stores.

Native Postgres enums (`pg.enum(...)`) are unchanged.

## A client reports failures through what its members return

### `client-members-reject-instead-of-throwing`

```ts
await db.close();

// Before: throws at the call, so .catch never runs
db.query(plan).toArray().catch(handle);

// After: the result rejects, so handle runs
db.query(plan).toArray().catch(handle);

// A synchronous try/catch around an unawaited call stops catching
try {
  db.transaction(work);
} catch (error) {
  handle(error);
}

// Await it instead
try {
  await db.transaction(work);
} catch (error) {
  handle(error);
}
```

## Postgres and SQLite errors are classified by code

### `close-ends-the-client-not-your-pool`

When you pass your own `pg.Pool` or `pg.Client` to `postgres()` or `supabase()`, `close()` on the Prisma client now also closes its runtime. Calls on `db` already failed after `close()`; what changes is a runtime you captured with `db.runtime()` before `close()`, which used to keep working and now refuses new work. Your pool or client is still yours: Prisma never ends it. If you used a captured runtime after `close()`, create a new Prisma client on the same pool instead:

```ts
await db.close();
const db2 = postgres({ contract, pg: pool });
```

A `pg.Client` you pass in may be connected or not: Prisma connects it if it has not started connecting. If its connection is lost, create a new `pg.Client`; a pg client cannot reconnect.

### `sqlite-open-failure-is-a-connection-error`

When the SQLite database file cannot be opened, the driver now raises a connection error (`SqlConnectionError`) instead of a query error (`SqlQueryError`).

## `verifyContractSpaces` names the marker location

### `verify-contract-spaces-marker-location`

A project that checks its contract spaces itself passes the marker location of its target to `verifyContractSpaces`, so the advice for an orphan marker names the right table:

```ts
// Before
verifyContractSpaces({ loadedSpaces, spaceDirsOnDisk, headRefsBySpace, markerRowsBySpace });

// After
verifyContractSpaces({
  loadedSpaces,
  spaceDirsOnDisk,
  headRefsBySpace,
  markerRowsBySpace,
  markerLocation: 'prisma_contract.marker',
});
```

The marker location is `prisma_contract.marker` on Postgres, `_prisma_marker` on SQLite and MySQL, and `_prisma_migrations` on MongoDB.

## Explicit date and time types carry the kind of value they read

On PostgreSQL, a column type that several codecs read now names the kind of value in its name. The `Temporal` types gain the suffix `Temporal`, and the interval type that reads `{ months, days, micros }` gains the suffix `Parts`:

| Before | After | Reads |
| --- | --- | --- |
| `Timestamptz(p?)` | `TimestamptzTemporal(p?)` | `Temporal.Instant` |
| `Timestamp(p?)` | `TimestampTemporal(p?)` | `Temporal.PlainDateTime` |
| `Interval(p?)` | `IntervalParts(p?)` | `{ months, days, micros }` |

This change leaves `DateTime`, `Date` and `Time` as they are, and adds `DateTemporal` and `TimeTemporal` as the explicit names of what `Date` and `Time` read today. A later release gives `DateTime`, `Date` and `Time` new meanings, as convenience date and time types, and brings its own instructions. To keep what a field reads today through that change, you can already write the explicit name: `TimestamptzTemporal` for `DateTime`, `DateTemporal` for `Date` and `TimeTemporal` for `Time`.

Three explicit types are new, and need no change to existing schemas: `TimestampJsDate(p?)`, a `timestamp` column read as a JavaScript `Date`; `TimestampInstant(p?)`, a `timestamp` column read as a `Temporal.Instant`; and `IntervalString(p?)`, an `interval` column read as an ISO 8601 duration such as `P1Y2M`. Both timestamp types read and write the stored date and time as UTC.

### `psl-temporal-type-renames`

Rename each field type in your `.prisma` files using the table above, keeping its arguments and its attributes:

```prisma
model Event {
  id    Int                    @id
  at    TimestamptzTemporal(3) // was Timestamptz(3)
  local TimestampTemporal      // was Timestamp
  span  IntervalParts          // was Interval
}
```

A type alias written with one of the names, such as `types { Stamp = Timestamp(3) }`, is renamed the same way. The detection can match one of the words in a comment or a model name; rename only a field type or an alias's type.

### `ts-temporal-type-helpers-renamed`

```ts
field.column(type.TimestamptzTemporal(3)); // was type.Timestamptz(3)
field.column(intervalPartsColumn(6)); // was intervalColumn(6)
```

### `interval-with-precision-typed-as-parts`

```ts
import type { PgInterval } from '@prisma/orm-postgres/target/codec-types';

const span: PgInterval = row.span; // an IntervalParts(6) column
```

### `branded-time-types-removed`

Remove the four names from the import, and leave the rest of the file as it is:

```ts
import type {
  CodecTypes as PgTypes,
  JsonValue,
} from '@prisma/orm-postgres/target/codec-types'; // was also importing Interval, Time, Timestamp and Timestamptz
```

### `temporal-types-from-temporal-spec`

```ts
import type { Temporal } from 'temporal-spec';

expectTypeOf<Row['createdAt']>().toEqualTypeOf<Temporal.Instant>();
```

If the test file also creates `Temporal` values, import the type under another name, such as `import type { Temporal as TemporalTypes } from 'temporal-spec'`, so the runtime `Temporal` stays in scope.

### `contract-types-list-new-aggregates`

No change is needed now. The next `prisma contract emit` adds rows for the three new codecs to `contract.d.ts`.

## Text date and time values are ISO 8601

### `iso-string-date-time-values`

A column of `TimestamptzString`, `TimestampString`, `DateString`, `TimeString` or `Timetz` used to read the text PostgreSQL prints, which depends on the session's `TimeZone` and `DateStyle`. It now reads ISO 8601, the same on every server:

| Type | Before | After |
| --- | --- | --- |
| `TimestamptzString` | `2024-01-01 01:00:00+01` on a server in `Europe/Berlin` | `2024-01-01T00:00:00Z` |
| `TimestampString` | `2024-01-01 12:34:56.5` | `2024-01-01T12:34:56.5` |
| `DateString`, 44 BC | `0044-03-15 BC` | `-000043-03-15` |
| `Timetz` | `12:34:56+02`, `12:34:56+00` | `12:34:56+02:00`, `12:34:56Z` |

The same text is read inside an `.include()`. `infinity` and `-infinity` are unchanged. The generated `now()` values of these columns, such as `temporal.updatedAtString()`, are written in the same form.

Change the code that reads these values:

- Code that parses the old text, for example by replacing the space with `T` or appending `Z` before `new Date(...)`, can pass the value to `new Date(...)` or `Temporal.Instant.from(...)` directly for a `TimestamptzString`. A `TimestampString` value has no offset; append `Z` to read it as UTC, as before.
- Code that compares a read value with text in the old form, in application code or in tests, compares with the ISO form.
- Code that shows a value to a user formats it for display, since the value is no longer in the session's time zone.

A value the application writes may still be in any form PostgreSQL reads, and it reads back in ISO 8601. A literal default or an enum member on these types must be written in the stored form, because Prisma compares it with the value a query returns:

```ts
// Before
scheduledAt: field.column(timestamptzStringColumn).default('2024-01-15 10:30:00+00'),

// After
scheduledAt: field.column(timestamptzStringColumn).default('2024-01-15T10:30:00Z'),
```

`contract emit` refuses a default in another form with `CONTRACT.DEFAULT_INVALID`, and the message shows the form to write. A PSL default written with a tag, such as `` @default(timestamptz`2024-01-15 10:30:00+00`) ``, is unchanged. An enum on `TimestampString`, `TimestamptzString` or `Timetz` is now allowed.

The `now()` value of a `TimestampString(p)` or `TimestamptzString(p)` column is now rounded down to the column's precision, as a time column's is, so the column stores the value generated. Emit the contract again: its execution hash changes where such a column has a `now()` generator.

### `date-style-iso-required`

The PostgreSQL driver now ensures `DateStyle=ISO` on every connection it uses. A connection Prisma opens from a URL starts with it as a startup option, after any `options` in the URL or `PGOPTIONS`. On a `pg.Pool` or `pg.Client` you pass to Prisma, the driver sets it with one statement on each connection before first use, and again after a connection held for a transaction, an ORM operation or a Supabase role scope is released. Nothing needs changing for either.

Remove any statement that sets a `DateStyle` other than `ISO` on a connection Prisma uses, such as a `SET DateStyle` in a pool's `connect` handler or in raw SQL: every date and time codec that reads a date or timestamp (text, `Temporal` or `Date`) refuses text in another style with `RUNTIME.DATE_STYLE_NOT_ISO`. Behind a connection pooler that refuses startup options, pass Prisma your own `pg.Pool` instead of a URL; behind one that runs each statement on another server connection, also run `ALTER ROLE <role> SET DateStyle = 'ISO'` (or set it on the database).

## A Prisma 7 `@default(now())` is written by the client on create

### `prisma7-schema-now-default-writes-on-create`

Prisma 7's client filled a `@default(now())` field itself on create, with the current time in UTC, and also wrote `now()` as the column default for inserts from outside Prisma. A contract from `prisma7Schema(...)` used to keep only the column default, so a create through Prisma 8 got the database's clock. On a `timestamp` column, that is the wall-clock time of the session's time zone, which differs from what Prisma 7 wrote unless the session runs in UTC.

The contract now keeps the column default and adds the `now` generator on create, chosen for the column's type:

```prisma
// Prisma 7 schema, read by prisma7Schema('prisma/schema.prisma')
model Post {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
}
```

reads as the Prisma 8 PSL field `createdAt TimestampString(3) @default(now()) @onCreate(now())`. A create that supplies `createdAt` still stores the supplied value. An `INSERT` from outside Prisma still gets the column default.

For each project whose `prisma.config.ts` uses `prisma7Schema(...)`, run `prisma contract emit` again and commit the new `contract.json` and `contract.d.ts`. If the schema has a `@default(now())` field, the generator's id is in the execution section of `contract.json`, so the execution hash changes. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`.

If the schema has no `@default(now())` field, the contract does not change and there is nothing to do.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.21`; any other difference in the emitted files comes from an earlier entry in this guide.
