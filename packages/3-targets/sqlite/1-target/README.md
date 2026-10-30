# @internal/target-sqlite

SQLite target pack for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (runtime, authoring)

## Purpose

Provides the SQLite target descriptor for runtime use and pack refs for contract authoring. The control-plane entry point (migration planner/runner) is not yet implemented.

## Responsibilities

- **Runtime Target Descriptor**: Exports `SqlRuntimeTargetDescriptor<'sqlite'>` with codec registry and factory
- **Pack Ref Export**: Exports `TargetPackRef<'sql', 'sqlite'>` for `defineContract().target(sqlitePack)` contract authoring
- **Descriptor Metadata**: Defines target identity (`familyId: 'sql'`, `targetId: 'sqlite'`, `id: 'sqlite'`) and version
- **Datetime and JSON types**: `sqlite/datetime` and `sqlite/json` are data types stored as `sqlite/text` ([ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#sqlites-types)), declared in `src/core/data-types.ts`. Each owns its value: a datetime is the instant in UTC with three fraction digits, the text `toISOString()` writes for every row (`sqliteDatetimeText`), and a JSON value is the document's JSON text with sorted keys. PSL writes them with the `datetime` and `json` tags. DDL writes a datetime default as the text the codec writes for every row, through `encodeSqliteDatetime` in `src/core/codecs.ts`, so a default compares equal to an application-written value for the same instant.
- **Date and time types**: `sqlite/datetime`, `sqlite/date`, `sqlite/time` and `sqlite/duration` are stored as text in one form for each value: `2024-01-01T00:00:00.000Z`, `2024-02-29`, `09:30:00.000` (always three fraction digits) and an ISO 8601 duration as written ([ADR 312](../../../../docs/architecture%20docs/adrs/ADR%20312%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md)). The explicit types `DatetimeJsDate` (`sqlite/datetime@1`), `DatetimeTemporal`, `DatetimeString`, `DateString`, `DateTemporal`, `TimeString`, `TimeTemporal` and `DurationString` name one codec each (`src/core/date-time-codecs.ts`); the convenience types `DateTime`, `Date`, `Time` and `Duration` choose one of them with `as:` (`src/core/type-constructors.ts`, ADR 279). A write refuses digits below a millisecond rather than rounding them. A duration is read in the ISO 8601 forms `Temporal.Duration#toString()` writes, such as `-P1D` and `P1W`, and with a sign on each component. The database-agnostic logic (finding `Temporal`, the `now()` values, ISO text) comes from `@internal/type-implementations`. Only the control entry sets the `Temporal` fallback; the contract builder takes `sqliteCreateNamespace` from `./types`, which loads no `temporal-polyfill`. Without a global `Temporal` and with no control entry loaded, the Temporal codecs, when they decode, and the `instantNow`, `plainDateNow` and `plainTimeNow` generators raise `RUNTIME.TEMPORAL_UNAVAILABLE`; the other codecs and generators need no `Temporal`. PSL writes defaults with the `date`, `time` and `duration` tags. `@default(now())` renders `date('now')` on a date, `strftime('%H:%M:%f','now')` on a time and the current instant on a datetime or text column, and the default normalizer names each by that expression, so changing a field between `DateTime`, `Date` and `Time` is a change the planner and `db verify` see. A migration refuses `now()` on a column whose data type holds no current date or time, such as `sqlite/duration` or `sqlite/integer`, with `CONTRACT.DEFAULT_INVALID`.

**Non-goals:**
- Migration planner/runner (future milestone)
- Schema introspection (future milestone)
- Control-plane target descriptor (future milestone)

This package spans multiple planes:
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code
- **Authoring pack ref** (`src/exports/pack.ts`): Pure data surface for contract builder workflows

## Usage

### Pack refs for TypeScript contract authoring

```typescript
import sqlitePack from '@internal/target-sqlite/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';

export const contract = defineContract()
  .target(sqlitePack)
  .build();
```

Pack refs are pure JSON-friendly objects that make TypeScript contract authoring work in both emit and no-emit workflows without requiring separate manifest files.

## Codec descriptor authoring

SQLite-bound codecs use the public `SqliteCodecDescriptor` protocol, `sqliteCodec(...)` adapter, and `defineSqliteCodecs(...)` tuple helper exported from `@internal/target-sqlite/codec-descriptor`. See the [codec authoring guide](../../../../docs/reference/codec-authoring-guide.md#target-owned-sql-codec-descriptors) for subclassing, generic adaptation, stack contribution, structural validation, SQLite's scalar-only contract, and the current renderer transition.

## Architecture

This package provides a runtime entry point for the SQLite target. All declarative fields (version, capabilities) are defined directly on the descriptor. The `./pack` entry point provides a pure pack ref for contract authoring.

## Related Subsystems

- **[Adapters & Targets](../../../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)**: Target specification

## Related ADRs

- [ADR 005 -- Thin Core Fat Targets](../../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 112 -- Target Extension Packs](../../../../docs/architecture%20docs/adrs/ADR%20112%20-%20Target%20Extension%20Packs.md)

## Exports

- `./runtime`: Runtime entry point for `SqlRuntimeTargetDescriptor<'sqlite'>`
- `./pack`: Pure pack ref for `defineContract().target(sqlitePack)`
- `./types`: The storage namespace classes, `SqliteUnboundDatabase` and `sqliteCreateNamespace`, for contract authoring without the control plane
- `./control`: The control-plane target descriptor, which sets the fallback `Temporal` when it is loaded
