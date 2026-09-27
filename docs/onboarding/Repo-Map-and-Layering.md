# Repo Map & Layering

- See `architecture.config.json` for domain/layer/plane mapping.
- Import rules: `.cursor/rules/import-validation.mdc` and `scripts/check-imports.mjs`.
- Legacy packages: marked in `architecture.config.json` with notes; avoid adding new deps to legacy.

## Planes and target package layout

Planes (`migration` / `runtime` / `shared`) cut across the directory hierarchy and are enforced by `dependency-cruiser` against the globs in `architecture.config.json`. Cross-plane rules: `migration → runtime` is **forbidden**; `runtime → migration` is allowed for artifacts only (e.g. compiled query plans, contract IR); `shared → *` is allowed.

Target packages (`@internal/target-*`) split their `src/core/` along this boundary:

- `src/core/migrations/**` — migration plane. Planner, emitter, operation factories, resolver, TS rendering. Executed at `node migration.ts` time and at `migration plan` / `migrate`.
- `src/core/*.ts` (the files directly in `src/core/`) — shared plane. Files used from both migration and runtime entrypoints (`authoring.ts`, `descriptor-meta.ts`, `types.ts`, …).
- `src/exports/control.ts` — migration-plane export.
- `src/exports/runtime.ts` — runtime-plane export.
- `src/exports/pack.ts` — shared-plane export.

The intent is that target migration code is **plainly control-plane** and should not be allowed to import from runtime-plane packages (e.g. `@internal/sql-runtime`, family runtime adapters). Putting migration code under a shared- or unregistered glob hides plane violations from CI; explicit migration-plane registration surfaces them.

### Glob resolution

`dependency-cruiser.config.mjs` does not resolve overlapping globs: a file that matches two globs belongs to both module groups, and every rule for either group applies to it. A target that registered both `src/core/**` (shared) and `src/core/migrations/**` (migration) would put its migration files in the shared group too, and each import between two migration files would then count as shared → migration and fail. Register globs that do not overlap: `src/core/*.ts` matches only the files directly in `src/core/`.

### When adding a new target package

1. Register `src/exports/runtime.ts` as `plane: runtime`.
2. Register `src/exports/control.ts` as `plane: migration` (and `pack.ts` as `plane: shared` if the target has one).
3. Register `src/core/*.ts` as `plane: shared`.
4. Register `src/core/migrations/**` as `plane: migration` *even if the directory does not exist yet* — keeps target registrations symmetric and prevents code added later from inheriting the shared registration by accident.
