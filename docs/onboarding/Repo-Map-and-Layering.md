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

### Code several targets share

`packages/3-targets/0-shared/` holds packages that several databases' packages share, beside the database folders. `@internal/type-implementations` there holds value logic that more than one target's codecs, data types and `now()` generators use and that depends on no database and no family ([ADR 311](../architecture%20docs/adrs/ADR%20311%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md)). Register such a package in the `targets` domain, so the adapters as well as the target packs can import it. The ordering check below skips `0-shared/`. Do not put such code in the framework, which holds only the affordances targets fill in. The top-level `packages/0-shared/` is a different folder, for repository tooling.

### When adding a new target package

A database's packages live together in `packages/3-targets/<db>/`: `1-target`, `2-adapter`, `3-driver`, `4-codec-testkit` and `9-facade` ([ADR 278](../architecture%20docs/adrs/ADR%20278%20-%20Each%20database's%20packages%20live%20in%20one%20folder.md)). Register each of them:

1. Register `src/exports/runtime.ts` as `plane: runtime`.
2. Register `src/exports/control.ts` as `plane: migration` (and `pack.ts` as `plane: shared` if the target has one).
3. Register `src/core/*.ts` as `plane: shared`.
4. Register `src/core/migrations/**` as `plane: migration` and `src/core/runtime/**` as `plane: runtime` *even if the directories do not exist yet* — keeps target registrations symmetric and prevents code added later from inheriting the shared registration by accident. Put control-only code in `migrations/` and runtime-only code in `runtime/`.
5. Register any other entry point (each extra file in `src/exports/`, loose files directly in `src/`) with its own plane. `pnpm lint:deps` fails when a source file matches no glob or more than one (`scripts/lint-architecture-registration.mjs`).

No new test is needed for dependency order: `scripts/lint-target-layering.mjs`, run by `pnpm lint:deps`, checks every database folder and fails when a package depends on a sibling that is not numbered lower, or on another database's packages.
