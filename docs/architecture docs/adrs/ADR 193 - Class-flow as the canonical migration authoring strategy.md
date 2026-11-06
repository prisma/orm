# ADR 193 — Class-flow as the canonical migration authoring strategy

## Status

**Superseded in terminology, preserved in decision.** As of the postgres-class-flow-migrations project (which this ADR authorized for Postgres), descriptor-flow is fully deleted and class-flow is simply how migrations are authored. The phrase "class-flow" no longer carries a contrast and has been scrubbed from code, tests, and current docs; this ADR preserves the original terminology as a historical record of the decision.

## At a glance

A developer adds a `status` field with a unique index to their Mongo schema, runs `contract emit`, and then plans a migration:

```
prisma-next migration plan --name add-status-index
```

The CLI diffs the previous contract against the new one, runs the planner, and scaffolds a migration directory:

```
migrations/20250614T1030_add-status-index/
├── migration.ts        # editable TypeScript — the authoring surface
├── migration.json      # manifest: from/to hashes, migrationId
├── ops.json            # serialized operations (emitted inline)
├── contract.json       # destination contract snapshot
└── contract.d.ts       # TypeScript types for the contract
```

`migration.ts` is a class that *is* the plan:

```ts
#!/usr/bin/env node --experimental-strip-types
import { createIndex, dataTransform, placeholder } from '@internal/target-mongo/migration'
import { Migration } from '@internal/family-mongo/migration'

class M extends Migration {
  override describe() {
    return { from: 'abc', to: 'def' }
  }

  override get operations() {
    return [
      createIndex('users', [{ field: 'status', direction: 1 }], { unique: true }),
      dataTransform('backfill-status', {
        check: {
          source: () => placeholder('backfill-status:check.source'),
          expect: 'notExists',
        },
        run: () => placeholder('backfill-status:run'),
      }),
    ]
  }
}

export default M
Migration.run(import.meta.url, M)
```

The `createIndex` operation is fully specified by the planner — no user intervention needed. The `dataTransform` has two `placeholder(...)` slots that the planner can't fill because only the developer knows the query. When `migration plan` ran inline emit after scaffolding, the placeholder threw `PN-MIG-2001` and the CLI reported: "Unfilled migration placeholder: `backfill-status:check.source`." The developer opens the file, replaces the placeholders with real queries using the snapshotted contract for types, and re-runs the file directly:

```
./migration.ts
```

`Migration.run(...)` detects it is the main module, instantiates `M`, reads `operations`, and writes fully-attested `ops.json` + `migration.json` with a fresh content-addressed `migrationId` ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)). When happy, they run:

```
prisma-next migrate
```

The runner reads `ops.json` — never `migration.ts` — verifies the hash, and executes each operation's three-phase loop: precheck, execute, postcheck. Before the loop it runs the postchecks and skips an operation whose postchecks already hold ([ADR 038](ADR%20038%20-%20Operation%20idempotency%20classification%20&%20enforcement.md)).

## Decision

Class-flow is the canonical migration authoring strategy. Migrations are TypeScript classes that extend `Migration` (a framework base class that `implements MigrationPlan`) and override `operations` and `describe()`. The class *is* the plan — no separate data structure to shuttle between planner and scaffolder. The file is runnable (shebang + `Migration.run(...)`) for dev-time iteration and emittable in-process by the CLI. The emitted `ops.json` is the contract that gets applied ([ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)).

Descriptor-flow is the legacy design being replaced. Today, a transitional `migrationStrategy()` selector in the CLI returns `'descriptor'` for Postgres and `'class-based'` for Mongo. `migration plan` and `migration emit` branch on it. `migration new` is already unified via `planner.emptyMigration()`. The selector and all descriptor-flow branching disappear when Postgres adopts class-flow.

## The canonical pipeline

Each stage of the pipeline is detailed in its own ADR. The end-to-end flow is:

1. **Scaffold or plan.** Either `planner.plan(...)` diffs contracts, or `planner.emptyMigration(context)` creates a blank slate. Both return a `Migration` that satisfies `MigrationPlanWithAuthoringSurface` — the caller can read `operations` to get runnable ops, or call `renderTypeScript()` to get an editable file. See [ADR 194](ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md), [ADR 195](ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md).

2. **Render.** The CLI writes the artifacts: `migration.ts` via `plan.renderTypeScript()`, `ops.json` via serializing `plan.operations`, and the destination contract snapshot ([ADR 197](ADR%20197%20-%20Migration%20packages%20snapshot%20their%20own%20contract.md)). The framework attests the content-addressed `migrationId` ([ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md), [ADR 199](ADR%20199%20-%20Storage-only%20migration%20identity.md)). Unfilled slots use `placeholder(slot)`, which throws `PN-MIG-2001` ([ADR 200](ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)).

3. **Edit.** The developer opens `migration.ts`, replaces placeholders with real queries, and iterates by running the file directly (`./migration.ts`) — the file is self-emitting, re-writing `ops.json` and re-attesting `migrationId` on each run ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)).

4. **Apply.** `migrate` reads `ops.json`, verifies the hash, and executes via the runner's three-phase loop ([ADR 198](ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md)).

## Descriptor-flow deletion catalog

The descriptor-flow design introduced a parallel set of types, hooks, and CLI branches. When class-flow is the only strategy, the following symbols are deleted:

### Types

| Symbol | Location | Status |
|--------|----------|--------|
| `OperationDescriptor` | `framework-components/control-migration-types.ts` | Live — used by Postgres |
| `planWithDescriptors` method | `TargetMigrationsCapability` | Live — Postgres implements it |
| `resolveDescriptors` method | `TargetMigrationsCapability` | Live — Postgres implements it |
| `renderDescriptorTypeScript` method | `TargetMigrationsCapability` | Live — Postgres implements it |

### CLI internals

| Symbol | Location | Status |
|--------|----------|--------|
| `migrationStrategy()` selector | `cli/src/lib/migration-strategy.ts` | Transitional — collapses when single-flow |
| `emitDescriptorFlow()` helper | `cli/src/lib/migration-emit.ts` | Live — called for descriptor targets |
| `emitMigration()` helper | `cli/src/lib/migration-emit.ts` | Transitional — bridge for descriptor-flow CLI emit; collapses to a thin attestation pass once class-flow `Migration.run` is the only emit path |
| `evaluateMigrationTs()` | `migration-tools/src/migration-ts.ts` | Live — evaluates descriptor-flow `export default () => [...]` files |
| `hasMigrationTs()` | `migration-tools/src/migration-ts.ts` | Shared by both flows — survives |
| Descriptor-flow branch in `migration plan` | `cli/src/commands/migration-plan.ts` | Live — the `if (strategy === 'descriptor')` block |

### Already removed in this work

| Symbol | Notes |
|--------|-------|
| `MigrationScaffoldingCapability` interface | Replaced by `MigrationPlanWithAuthoringSurface.renderTypeScript()` ([ADR 194](ADR%20194%20-%20Plans%20carry%20their%20own%20authoring%20surface.md)) |
| `MigrationPlannerSuccessResult.needsDataMigration` field | Replaced by `placeholder()` structured errors ([ADR 200](ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md)) |

### Pending removal once descriptor-flow is gone

| Symbol | Notes |
|--------|-------|
| `migration emit` CLI command | A descriptor-flow artifact: descriptor files have no way to self-emit, so the CLI must drive evaluation and write `ops.json` for them. Class-flow `migration.ts` is self-emitting via `Migration.run(...)` ([ADR 196](ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md)) — running the file directly produces fully-attested artifacts. `migration plan` covers the post-scaffold case via inline emit, and apply-time staleness verification ([ADR 192](ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)) catches drift. The command disappears entirely once descriptor flow is removed. |
| `TargetMigrationsCapability.emit` capability | Exists to give the CLI a class-flow dispatch path during the descriptor-flow bridge. Without `migration emit`, and with `Migration.run` as the only sanctioned emit driver, the capability is unused and removed alongside the CLI command. |

## Transitional state

The `migrationStrategy(migrations, targetId)` function probes the target's `TargetMigrationsCapability` to determine the active flow: it returns `'descriptor'` when `resolveDescriptors` is present, `'class-based'` when `emit` is present. Three CLI commands branch on it:

- **`migration plan`** — descriptor flow calls `planWithDescriptors` + `renderDescriptorTypeScript`; class flow calls `planner.plan(...)` + `plan.renderTypeScript()`, then runs inline emit.
- **`migration emit`** — descriptor flow calls `evaluateMigrationTs` + `resolveDescriptors`; class flow delegates to `migrations.emit(...)`.
- **`migration new`** — already unified via `planner.emptyMigration(context)`, no strategy branching.

The planning strategy is not persisted in the manifest (it was previously carried in the now-removed `hints` field); `ops.json` is format-agnostic and the runner never needs to inspect it.

When Postgres adopts class-flow, `migrationStrategy` becomes a constant, the descriptor-flow branches are dead code, and the entire catalog above can be deleted in a single pass.

## Alternatives considered

### Keep both strategies permanently

Each target picks its preferred authoring style — Postgres stays on descriptors, Mongo uses classes. The framework supports both indefinitely.

Rejected because:

- **Double the CLI surface.** Every migration command carries two branches — `if descriptor … else if class-based …` — with different evaluation, serialization, and error-handling paths. This is a maintenance multiplier.
- **Descriptor flow can't support data transforms.** Descriptor-flow files are `export default () => [...]` — a pure-data array with no place for query-builder calls. Data transforms need typed builders, contract imports, and runtime evaluation. Class-flow files are full TypeScript with imports, types, and method bodies — they handle DDL and DML uniformly.
- **Intermediate representations leak through public APIs.** Descriptor-flow requires the CLI to shuttle `OperationDescriptor[]` between `planWithDescriptors`, `evaluateMigrationTs`, `resolveDescriptors`, and `renderDescriptorTypeScript` — four capability methods and an intermediate IR that the CLI must thread through multiple processing rounds. In class-flow, the planner returns a `Migration` directly. The CLI calls `plan.renderTypeScript()` and `plan.operations` — one object, no intermediate IR visible to callers, no extra rounds of resolution.

### Make descriptor-flow the canonical one

Extend the descriptor format to support data transforms and make all targets emit `export default () => [...]`.

Rejected because:

- **Descriptors are opaque data.** They can't carry query-builder calls, typed contract imports, or runtime logic. Encoding data transforms as descriptors would require inventing a serialized query representation at the framework level — duplicating what the query AST already provides.
- **No in-process evaluation.** Descriptor-flow files are evaluated by `evaluateMigrationTs`, which calls the default export and expects a plain array. Class-flow files are evaluated by the target's `emit` capability, which understands the class structure and can invoke `operations` with full runtime context. In-process evaluation is what makes `placeholder()` errors, `Migration.run(...)`, and dev-time iteration work.
- **No self-contained runnable files.** A descriptor-flow file has no shebang, no `run()` guard, and no way to produce `ops.json` when executed directly. The developer must always go through `migration emit`.
