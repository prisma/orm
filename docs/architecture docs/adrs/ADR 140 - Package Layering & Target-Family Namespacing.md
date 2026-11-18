# ADR 140 — Package Layering & Target-Family Namespacing

> **Directory layout amended by [ADR 278](./ADR%20278%20-%20Each%20database's%20packages%20live%20in%20one%20folder.md):** a database's target, adapter, driver and facade now live together in `packages/3-targets/<db>/`, and the SQL family folder is `packages/2-sql-family/`. The domains, layers, planes and naming rules below are unchanged.

> **Partially superseded by [ADR 204](./ADR%20204%20-%20Single-tier%20runtime.md):** the "Runtime Separation" portion of this ADR — which introduced a two-tier runtime model with a target-agnostic `runtime-executor` package and family runtimes composing it — has been collapsed into a single tier. `RuntimeCore` now lives in `@internal/framework-components` (exposed via the `/runtime` subpath) and is extended directly by family runtimes (`@internal/sql-runtime`, `@internal/mongo-runtime`). The package-layering, plane-boundary, domain/family-namespacing, and naming guidance in the rest of this ADR is unchanged.

## Context

- The repository currently mixes contract authoring DSLs, relational schema builders, query lanes, and ORM logic in `@internal/sql-query`. This makes changes risky and creates accidental coupling across unrelated features.
- The runtime implementation (`packages/runtime/src/runtime.ts`) binds directly to SQL types (`SqlContract`, `SqlStorage`, SQL drivers), preventing a truly target-family agnostic runtime as envisioned by ADR 005 (Thin Core, Fat Targets).
- We want the filesystem to reflect Clean Architecture layers organized by domains and planes so developers cannot accidentally introduce cyclic or upward dependencies.
- We also want a repeatable, discoverable structure for future target families (e.g., document/mongo) without touching existing SQL packages.

## Decision

Adopt a package layout that encodes Domains → Layers → Planes:

- **Domains**: Framework (target-agnostic) vs target families (SQL, document, etc.). Framework domain packages can be imported by any target family.
- **Layers**: Clean Architecture layers (`core/`, `authoring/`, `targets/`, `lanes/`, `runtime/`, `adapters/`). Within a domain, layers may depend laterally (same layer) and downward (toward core), never upward.
- **Planes**: Migration (authoring, tooling, targets) vs runtime (lanes, runtime, adapters). Migration plane must not import runtime plane code; runtime plane may consume artifacts (JSON/manifests) from migration, but not code imports.
- Group SQL-specific packages under a dedicated namespace (`packages/2-sql/**`) for family cohesion (contract types/emitter/ops, lanes, runtime, and adapters).
- Extract a target-agnostic runtime core (`packages/1-framework/4-runtime/runtime-executor`) that owns plan verification, plugin lifecycle, and the runtime SPI. Family-specific runtimes (e.g., `packages/2-sql/5-runtime`) implement the SPI and plug into core via context.
- Keep the emitter core target-agnostic with family hooks; SQL-specific validation and `.d.ts` generation live in the SQL family hook.
- Avoid transitional shims unless required internally; there are no external consumers.

## Details

### Directory Topology

```
packages/
  core/
    contract/            (contract types + plan metadata)
    plan/                (plan helpers, diagnostics, shared errors)
    operations/          (target-neutral op registry + capability helpers)
  authoring/
    contract-authoring/  (shared authoring descriptors/types)
    contract-ts/         (family-specific TS authoring surface, if split further)
    contract-psl/        (PSL parser + IR, future)
  targets/
    sql/
      contract-types/
      operations/
      emitter/
  lanes/
    relational-core/     (schema + column builders, operation attachment, AST types)
    sql-lane/            (relational DSL + raw lane)
    orm-lane/            (ORM builder, includes, relation filters)
    query-builder/       (query builder lane)
  runtime/
    core/                (target-agnostic runtime kernel: verification, plugins, SPI)
  sql/
    sql-runtime/         (SQL runtime implementation of the SPI)
  targets/
    postgres/            (Postgres target descriptor)
    postgres-adapter/    (Postgres adapter with multi-plane entrypoints)
    postgres-driver/     (Postgres driver)
    # mysql/, sqlite/ can mirror postgres/ structure
  extensions/
    pgvector/            (pgvector extension pack)
  document/
    # future document family mirrors sql/ layout
```

### Dependency Rules

`core → authoring → targets → lanes → runtime(core) → family-runtime → adapters`

**Within a domain:**
- Layers may depend laterally (same layer) and downward (toward core), never upward.
- Example: `@internal/sql-lane` and `@internal/sql-orm-lane` both live in the Lanes layer, so they may share helpers via `@internal/sql-relational-core`, but neither may depend on Runtime or Adapters.

**Cross-domain:**
- Cross-domain imports are forbidden except when importing framework packages.
- Example: SQL domain packages can import from framework domain packages, but not from other target families.

**Plane boundaries:**
- Migration plane (authoring, tooling, targets) must not import runtime plane code.
- Runtime plane may consume artifacts (JSON/manifests) from migration, but not code imports.
- Example: `@internal/sql-contract-ts` (migration plane) cannot import from `@internal/sql-lane` (runtime plane).

**Enforcement:**
- Enforce with data-driven configuration (`architecture.config.json`) and a CI import-graph check (`scripts/check-imports.mjs`).

### Runtime Separation

- `packages/1-framework/4-runtime/runtime-executor` exposes a target-agnostic SPI (verification, plugin lifecycle, telemetry), no direct imports from `targets/*`.
- `packages/2-sql/5-runtime` implements the SPI using SQL adapters and codecs from `packages/2-sql/1-core/contract/*`, `packages/2-sql/1-core/operations/*`, and `packages/3-targets/6-adapters/postgres/*`.
- This enables booting the runtime with a non-SQL family by swapping in another family-runtime package that implements the same SPI.

### Emitter Hooks

- Emitter remains target-agnostic with a hook registry keyed by `targetFamily`.
- SQL-specific validation and `.d.ts` generation are implemented by the SQL hook under `packages/2-sql/3-tooling/emitter`.

### Package Naming Conventions

- Package names use the `@internal/<name>` convention.
- Target families are encoded via prefixes (e.g., `sql-`), producing names like `@internal/sql-lane`, regardless of nested folders.
- Adapters/drivers retain conventional names (`@internal/adapter-postgres`, `@internal/driver-postgres`) and are located under `packages/3-targets/**` as separate packages (target, adapter, driver).
- Layers are for dependency direction, not naming; only `runtime-core` carries its layer in the name for clarity.
- See also: `docs/reference/Package Naming Conventions.md` for concrete path→package mappings.

## Consequences

### Positive

- Clear ownership and boundaries; reduced blast radius for changes.
- Prevents cyclic/upward dependencies via structure and lint rules.
- Readable, repeatable path for adding new target families without touching SQL.
- Paves the way for a truly target-agnostic runtime core.

### Trade-offs

- More packages to manage and release.
- Short-term migration effort moving files and updating imports.
- Some duplication across families (e.g., similar lane patterns) is expected and acceptable.

## Migration Plan (High-Level)

1) ✅  Scaffold the new folder skeleton; add import guardrails and CI checks.
2) ✅  Extract `contract-authoring` out of `@internal/sql-query` into `packages/1-framework/2-authoring/contract`.
3) ✅  Stand up `lanes/relational-core` and move schema/column builders and operation attachment there.
4) ✅  Split lanes into `sql-lane` and `orm-lane`; keep tests with their respective packages.
5) ✅ Restructure `sql-target` under `sql/tooling` and keep a curated entrypoint for adapters. **Complete**
6) ✅ Extract `framework/runtime-core` and move SQL-specific execution into `sql/sql-runtime`. **Complete**
7) ✅ Remove legacy re-exports; no external consumers means we can delete transitional shims once internal callsites are updated. **Complete** - `@internal/sql-query` removed in Slice 7.
8) ✅ Move pack assembly from framework CLI to family-provided helpers. **Complete** (Briefs 20 & 21, Decouple-Framework-CLI-from-SQL) - Generic assembly logic (looping over descriptors) lives in `packages/2-sql/3-tooling/family/src/core/assembly.ts`. Family-specific conversion delegated to `family.convertOperationManifest()`. Contract validation also decoupled via `family.validateContract()` hook. All CLI→SQL dependency exceptions removed. `@internal/sql-tooling-assembly` package removed.
9) ✅ Migrate Postgres adapter from SQL domain to Targets domain. **Complete** (Briefs: Separate-Dialect-Adapter-Driver, Migrate-Postgres-Adapter-to-Targets-Domain) - Adapter, target, and driver are now separate packages under `packages/3-targets/**` with multi-plane entrypoints.

## Alternatives Considered

- Keep current packages and rely solely on lint rules: Lower friction, but the filesystem continues to obscure boundaries and invites drift.
- One monolithic `sql` package with subfolders: Better grouping, but still intermixes layers (lanes, target, runtime) and weakens guardrails.
- Heavy use of transitional shims: Easier migration, but adds maintenance overhead with no external consumers to justify it.

## References

- ADR 005 — Thin Core, Fat Targets
- ADR 011 — Unified Plan Model
- ADR 016 — Adapter SPI for Lowering
- ADR 121 — Contract.d.ts structure and relation typing
- Brief: docs/briefs/12-Package-Layering.md
