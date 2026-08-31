# @internal/target-sqlite

SQLite target pack for Prisma Next.

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
