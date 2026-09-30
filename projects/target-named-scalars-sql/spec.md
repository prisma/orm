# Target-named scalars for Postgres and SQLite

## Summary

PostgreSQL and SQLite PSL scalar names and PostgreSQL TypeScript presets are renamed after each target's own storage types, following [ADR 257](../../docs/architecture%20docs/adrs/ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md): one token per type, taken from the unchanged codec id, on the PSL name, the TypeScript helper and the codec id. MongoDB already follows the rule. The project also makes `Json` refuse non-JSON values on PostgreSQL and SQLite as it does on MongoDB, and moves the rule that an enum's codec declares exactly one storage type into the framework, so SQL enums get it too. This project runs before general availability.

## Principle

See ADR 257 for the decision, its reasons, the `Json` exception, the deprecation path for renamed names, and the reserved mechanism for a codec id that must change. No codec id changes in this project.

## Postgres and SQLite names

### Postgres PSL names

Source: `postgresScalarAuthoringTypes` and `postgresNativeAuthoringTypes` in `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`.

| Token | Codec id (unchanged) | PSL name today | PSL name after | Note |
|---|---|---|---|---|
| `text` | `pg/text@1` | `String` | `Text` | |
| `bool` | `pg/bool@1` | `Boolean` | `Bool` | |
| `int4` | `pg/int4@1` | `Int` | `Int4` | |
| `int8` | `pg/int8@1` | `BigInt` | `Int8` | |
| `int2` | `pg/int2@1` | `SmallInt` | `Int2` | |
| `float8` | `pg/float8@1` | `Float` | `Float8` | |
| `float4` | `pg/float4@1` | `Real` | `Float4` | |
| `numeric` | `pg/numeric@1` | `Decimal` and `Numeric(p?, s?)` | `Numeric(p?, s?)` only | The two entries merge; `Decimal` is removed. |
| `timestamptz` | `pg/timestamptz-temporal@1` | `DateTime` and `Timestamptz(p?)` | `Timestamptz(p?)` only | Merge; `DateTime` removed. |
| `json` | `pg/json@1` | `Json` | `Json` | Unchanged; but see `Json` on Postgres and SQLite below. |
| `jsonb` | `pg/jsonb@1` | `Jsonb` | `Jsonb` | Unchanged. |
| `bytea` | `pg/bytea@1` | `Bytes` | `Bytea` | |
| `varchar` | `sql/varchar@1` | `VarChar(n?)` | `Varchar(n?)` | Capitalisation follows the token. |
| `char` | `sql/char@1` | `Char(n?)` | `Char(n?)` | Unchanged. |
| all others | | `Uuid`, `Inet`, `Date`, `DateString`, `Timestamp(p?)`, `Time(p?)`, `Timetz(p?)`, `TimestampString(p?)`, `TimestamptzJsDate(p?)`, `TimestamptzString(p?)`, `TimeString(p?)`, `BigIntNumber`, `UnboundedInt`, `pg.enum(...)`, `sql.String(n)` | unchanged | Already token-named (`BigIntNumber` and `UnboundedInt` are codec tokens `int8number` and `unboundedint`; they stay as they are). |

Renamed names (`String`, `Boolean`, `Int`, `BigInt`, `SmallInt`, `Float`, `Real`, `Decimal`, `DateTime`, `Bytes`, `VarChar`) stay for one release line as deprecated aliases of the new names, not a hard error. This is the decided behaviour, matching ADR 257 and the MongoDB renames: the scalar map entry carries `deprecated: { replacement }` and resolves to the same codec, and the interpreter reports `PSL_DEPRECATED_SCALAR_NAME` as a warning through the contract source's warning channel.

### Postgres TypeScript presets

Source: `packages/3-targets/3-targets/postgres/src/core/authoring.ts` field presets. The token rule renames the preset keys; `field.column(...)` descriptors are unchanged.

| Preset today | Preset after | Codec id |
|---|---|---|
| `field.text()` | `field.text()` | `pg/text@1` |
| `field.boolean()` | `field.bool()` | `pg/bool@1` |
| `field.int()` | `field.int4()` | `pg/int4@1` |
| `field.bigint()` | `field.int8()` | `pg/int8@1` |
| `field.float()` | `field.float8()` | `pg/float8@1` |
| `field.decimal()` | `field.numeric()` | `pg/numeric@1` |
| `field.dateTime()` | `field.timestamptz()` | `pg/timestamptz-temporal@1` |
| `field.json()` | `field.jsonb()` | `pg/jsonb@1` (today `field.json()` produces jsonb, which contradicts PSL `Json` = `pg/json@1`) |
| (none) | `field.json()` | `pg/json@1` (new preset so PSL `Json` and TS `field.json()` agree) |
| `field.bytes()` | `field.bytea()` | `pg/bytea@1` |
| `field.uuidNative()`, `field.uuidString()`, `field.id.*`, `field.temporal.*` | unchanged | |

### SQLite PSL names

Source: `sqliteScalarAuthoringTypes` in `packages/3-targets/6-adapters/sqlite/src/core/control-mutation-defaults.ts`. SQLite has no scalar TS presets (only `field.column(...)` and `temporal.*`); none are added.

| Token | Codec id | PSL name today | PSL name after | Note |
|---|---|---|---|---|
| `text` | `sqlite/text@1` | `String` | `Text` | |
| `integer` | `sqlite/integer@1` | `Int` | `Integer` | |
| `bigint` | `sqlite/bigint@1` | `BigInt` | `Bigint` | Token spelling; nativeType stays `integer`. |
| `real` | `sqlite/real@1` | `Float` | `Real` | |
| `decimal` | `sqlite/decimal@1` (new) | `Decimal` (today aliased to `sqlite/text@1`) | `Decimal` | A new codec: text storage, canonical decimal text application type with the same normalisation as `pg/numeric@1`, traits equality/order/numeric, so `Decimal` is no longer indistinguishable from `Text` in the contract. Existing contracts that used `Decimal` carry `sqlite/text@1` and keep it; new emits use the new codec. |
| `datetime` | `sqlite/datetime@1` | `DateTime` | `Datetime` | |
| `json` | `sqlite/json@1` | `Json` | `Json` | Unchanged. |
| `blob` | `sqlite/blob@1` | `Bytes` | `Blob` | |
| `bigintnumber` | `sqlite/bigintnumber@1` | `BigIntNumber` (type constructor) | unchanged | |

### Scope of the Postgres/SQLite project

Everything the MongoDB rename touched has a Postgres and SQLite counterpart (the adapter scalar maps and their tests, every `.prisma` fixture and example, the Prisma 7 reader's diagnostics that suggest a Prisma 8 name, the codec authoring guide, the subsystem docs, the `prisma-8` skill references and package READMEs), plus: the contract printer (`prisma contract print`) prints the new names; the language server's completion list and hover text; every SQL fixture `.prisma` and example (`examples/prisma-8-demo`, `prisma-8-demo-sqlite`, `prisma-8-postgis-demo`, `supabase`, `react-router-demo`, `prisma-8-cloudflare-worker`, `prisma7-adoption`); `docs/reference/*`; `app` and `extension` upgrade fragments with the exact rewrite tables above. Two value-level changes are also in scope, described in their own sections below: the SQL `Json` codecs refuse non-JSON values through one framework check that MongoDB's `Json` also uses, and the enum rule that a codec must declare exactly one storage type moves into the framework enum path both families use. `contract.json` files stay byte-identical except where the new `sqlite/decimal@1` codec is adopted by a re-emit. This project runs before general availability.

## `Json` on Postgres and SQLite

ADR 257 says `Json` means a JSON value, no more, on every target. MongoDB enforces this: `mongo/json@1` refuses any value that is not plain JSON, at any depth, naming its path. PostgreSQL and SQLite do not yet. `pg/json@1` and `pg/jsonb@1` encode with `pgJsonEncode` / `pgJsonbEncode` (`packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`) and `sqlite/json@1` with `SqliteJsonCodec.encode` (`packages/3-targets/3-targets/sqlite/src/core/codecs.ts`), all of which are `JSON.stringify(value)`. So a write that is not JSON is changed instead of refused:

| Value written (at any depth) | What `JSON.stringify` stores today |
|---|---|
| `Date` | its ISO-8601 text, which reads back as a `string` |
| `undefined` as an object member | the member is dropped |
| `undefined` as an array element, a function, a `symbol` | `null` |
| `NaN`, `Infinity`, `-Infinity` | `null` |
| `Map`, `Set`, a class instance without `toJSON` | `{}`, or its own enumerable properties |
| `bigint` | a `TypeError` from `JSON.stringify` with no field or path |
| a circular structure | a `TypeError` from `JSON.stringify` with no field or path |

This project makes `Json` refuse those values on PostgreSQL and SQLite as it does on MongoDB.

- **One plain-JSON check, in the framework.** The check in `packages/3-mongo-target/1-mongo-target/src/core/json-codec-helpers.ts` (`describeNonJson` and `assertJsonValue`) does not depend on a target except for how it names a non-plain object. It moves next to `JsonValue` in `@internal/contract` as an exported function that takes the value and a target-supplied describer, `(value: object) => string | undefined`, which returns the name to report for an object the target recognises (MongoDB reports a BSON class by its `_bsontype` tag) or `undefined` to fall back to the constructor name. The function walks plain objects and arrays, tracks the objects it is inside, and returns the first refusal as `{ received, path }`, or nothing. The refusal rules are the ones `mongo/json@1` applies today: `undefined`, `bigint`, `symbol`, functions, `Date`, non-finite numbers, sparse array holes, circular references and any object whose prototype is not `Object.prototype`, `null` or `Array.prototype` are refused; the path is dot notation with array indices as segments, and `the root` at the root. The framework function carries no BSON or SQL vocabulary.
- **MongoDB adopts it without a behaviour change.** `mongo/json@1` encode calls the framework function with a describer that reads `_bsontype`, and keeps its own message and `meta` (`codecId`, `received`, `valuePath`). Its tests stay as they are and must pass unchanged.
- **PostgreSQL and SQLite adopt it.** `pg/json@1`, `pg/jsonb@1` and `sqlite/json@1` call the check before `JSON.stringify` and refuse with `RUNTIME.ENCODE_FAILED`, message `<codec id> value must be a JSON value; received <describe> at <path>`, and `meta` `{ codecId, received, valuePath }`, the same shape as MongoDB. Their describer returns `undefined` for every object, so a non-plain object is named by its constructor (`Map`, `Buffer`, a class name). The Postgres encode helpers also accept a `string` today (`string | JsonValue`); a string is a JSON value and passes the check unchanged.
- **Decode is unchanged.** The PostgreSQL driver returns parsed JSON and SQLite stores the text `JSON.stringify` produced, so a stored value is always JSON; the codecs keep decoding as they do.
- **JSON form is unchanged** (identity), and no validator or storage type changes, so no `contract.json` or `storageHash` changes from this section.
- **Tests required.** For each of `pg/json@1`, `pg/jsonb@1` and `sqlite/json@1`: encode refusal for every refused kind nested at `outer.items.1.value` with the exact message, a sparse hole, a circular reference, and `the root`; a plain JSON value with `$`- and `.`-containing keys and a null-prototype object passes unchanged. For the framework function: the same kinds with a describer that names a test class, and that the describer's `undefined` falls back to the constructor name. MongoDB's `codecs.json.test.ts` passes unchanged. End to end on each SQL target: an ORM write of a `Json` column holding a nested `Date` fails with `RUNTIME.ENCODE_FAILED` naming the column and the path, and nothing is written.
- **Docs and upgrade.** ADR 257's `Json` section says PostgreSQL and SQLite refuse non-JSON values as MongoDB does; `docs/reference/scalar-types.md`, the codec authoring guide and the error reference describe the refusal for the SQL codecs. The `app` upgrade fragment gets a change for this: a write that used to store a `Date` as text, drop `undefined` members, or store `null` for `NaN` now fails, and the instruction tells users to convert such values before writing (for example `date.toISOString()`), or to store them in a column of the matching type.

The only other `Json` change is the Postgres TS preset split in the Postgres TypeScript presets table, so that PSL `Json` and TS `field.json()` both mean `pg/json@1`, and `field.jsonb()` means `pg/jsonb@1`.

## Enums over a codec without exactly one storage type

An enum stores all its members as one storage type. The SQL enum entity factory (`sqlFamilyEnumEntityDescriptor` in `packages/2-sql/9-family/src/core/authoring-entity-types.ts`) reads `ctx.codecLookup?.targetTypesFor(codecId)?.[0]` and uses it as that type, with no check on the list:

- A codec that declares several target types would have its enum members stored as the first type, silently.
- A codec that declares none is reported as `enum "<name>" @@type references unknown codec "<id>"`, which is wrong: the codec is known.

No SQL codec declares several target types today, so nothing a user writes misbehaves yet; the first codec that does would. The MongoDB enum factory already refuses both cases at the `@@type` argument with `enum "<name>" @@type codec "<id>" declares <n> BSON types; an enum needs exactly one` (PR #30439).

- **One rule for both families.** The check moves into the framework enum path both families call (`resolveEnumCodecId` and its neighbours in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`), as a function that returns the single target type or a diagnostic. It reports a codec that is not in the lookup as unknown, and a codec whose `targetTypes` has zero or several entries as `enum "<name>" @@type codec "<id>" declares <n> <types noun>; an enum needs exactly one`, at the `@@type` argument. The family supplies the noun ("BSON types" on MongoDB, "storage types" on SQL), so the framework carries no family vocabulary. Both family factories call it; the MongoDB message stays byte-identical.
- **Tests required.** Framework unit tests for zero, one and two target types and an unknown codec, asserting the message and the span of the `@@type` argument. A SQL interpreter test with a test codec that declares two types and one that declares none, each refused with the message at the `@@type` argument. The existing MongoDB enum tests (`authoring-entity-types.enum.test.ts`, `enum-storage-type.test.ts`) pass unchanged.
- No contract, fixture or upgrade fragment changes: no shipped SQL codec is affected.

## Upgrade fragments

Per `skills-contrib/record-upgrade-instructions/SKILL.md`, this project ships its own `app` and `extension` fragments with the tables above as rewrite instructions. The `app` change for each target uses the same field-line detection as the MongoDB rename, one pattern per renamed name, for example `^\s*[A-Za-z_][A-Za-z0-9_]*\s+(Int|BigInt|Float|Boolean|DateTime|Decimal|Bytes)(\[\])?\??(\s|$)` over `**/*.prisma`. The pattern also matches MongoDB schemas, so the instruction says to apply each table only in a schema whose config uses that target's facade (`@prisma/orm-postgres` or `@prisma/orm-sqlite`), then re-emit; `contract.json` does not change except where a re-emit adopts the new `sqlite/decimal@1` codec. The `Json` refusal gets its own `app` change, with no detection pattern (which writes carry non-JSON values depends on the data), as described in the `Json` section. The PostgreSQL TypeScript preset renames get their own `app` change with a table and a detection pattern per renamed preset (`field.boolean()`, `field.int()`, `field.bigint()`, `field.float()`, `field.decimal()`, `field.dateTime()`, `field.json()`, `field.bytes()`).

## Documentation

[`docs/reference/scalar-types.md`](../../docs/reference/scalar-types.md) holds one table per target (PSL name, TS helper, codec id, storage type, application type) and the cross-target concept table with the Prisma 6/7 names. Its MongoDB table is complete; this project updates the PostgreSQL and SQLite tables and the concept table to the new names. Every other doc that lists scalars links there instead of repeating the list.
