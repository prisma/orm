# Target-named scalars for Postgres and SQLite

## Summary

PostgreSQL and SQLite PSL scalar names and PostgreSQL TypeScript presets are renamed after each target's own storage types, following [ADR 257](../../docs/architecture%20docs/adrs/ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md): one token per type, taken from the unchanged codec id, on the PSL name, the TypeScript helper and the codec id. MongoDB already follows the rule. This project runs before general availability.

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

Everything the MongoDB rename touched has a Postgres and SQLite counterpart (the adapter scalar maps and their tests, every `.prisma` fixture and example, the Prisma 7 reader's diagnostics that suggest a Prisma 8 name, the codec authoring guide, the subsystem docs, the `prisma-8` skill references and package READMEs), plus: the Prisma 7 reader's diagnostics that name Prisma 8 types; the contract printer (`prisma contract print`) prints the new names; the language server's completion list and hover text; every SQL fixture `.prisma` and example (`examples/prisma-8-demo`, `prisma-8-demo-sqlite`, `prisma-8-postgis-demo`, `supabase`, `react-router-demo`, `prisma-8-cloudflare-worker`, `prisma7-adoption`); `docs/reference/*`, the `prisma-8` skill references, package READMEs; `app` and `extension` upgrade fragments with the exact rewrite tables above. ``contract.json` files stay byte-identical except where the new `sqlite/decimal@1` codec is adopted by a re-emit. This project runs before general availability.

## `Json` on Postgres and SQLite

No value-level change. `pg/json@1`, `pg/jsonb@1`, and `sqlite/json@1` hold JSON only; `JsonValue` is exact. The only change is the Postgres TS preset split in the Postgres TypeScript presets table so that PSL `Json` and TS `field.json()` both mean `pg/json@1`, and `field.jsonb()` means `pg/jsonb@1`.

## Upgrade fragments

Per `skills-contrib/record-upgrade-instructions/SKILL.md`, this project ships its own `app` and `extension` fragments with the tables above as rewrite instructions. The `app` change for each target uses the same field-line detection as the MongoDB rename, one pattern per renamed name, for example `^\s*[A-Za-z_][A-Za-z0-9_]*\s+(Int|BigInt|Float|Boolean|DateTime|Decimal|Bytes)(\[\])?\??(\s|$)` over `**/*.prisma`. The pattern also matches MongoDB schemas, so the instruction says to apply each table only in a schema whose config uses that target's facade (`@prisma/orm-postgres` or `@prisma/orm-sqlite`), then re-emit; `contract.json` does not change except where a re-emit adopts the new `sqlite/decimal@1` codec. The PostgreSQL TypeScript preset renames get their own `app` change with a table and a detection pattern per renamed preset (`field.boolean()`, `field.int()`, `field.bigint()`, `field.float()`, `field.decimal()`, `field.dateTime()`, `field.json()`, `field.bytes()`).

## Documentation

[`docs/reference/scalar-types.md`](../../docs/reference/scalar-types.md) holds one table per target (PSL name, TS helper, codec id, storage type, application type) and the cross-target concept table with the Prisma 6/7 names. Its MongoDB table is complete; this project updates the PostgreSQL and SQLite tables and the concept table to the new names. Every other doc that lists scalars links there instead of repeating the list.
