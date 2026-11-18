# ADR 150 — Family‑Agnostic CLI and Pack Entry Points

## Status
Accepted

## Context

We want a single, simple way for applications to declare their target family, target, adapter, and extensions in a config file that both emit (migration plane) and DB‑connected commands (runtime plane) can consume. The CLI must remain family‑agnostic and must not import family code or SQL‑specific types. Previously, CLI flags (`--adapter`, `--extensions`) and ad‑hoc discovery created ambiguity and friction.

## Decision

1. Config‑only input
- Apps declare everything in `prisma.config.ts`. The CLI imports only this config module; it never imports packs directly or reads JSON manifests from disk.

2. Explicit pack entrypoints
- Each pack exposes two entrypoints:
  - `/control`: default‑exports IR‑only descriptors for tooling and callable helpers; safe for emit.
  - `/runtime`: exports runtime factories/types; used only by DB‑connected commands or app runtime.

3. Family‑agnostic CLI + family‑provided helpers
- The config's `family` export includes:
  - `hook: TargetFamilyHook` (used by `@internal/emitter`)
  - `assembleOperationRegistry`, `extractCodecTypeImports`, `extractOperationTypeImports` (assembly helpers)
  - `validateContract` (validates and normalizes contract, returns Contract without mappings)
  - `stripMappings?` (optionally strips runtime-only mappings from contract)
- The CLI calls these helpers to assemble inputs for emit and validate contracts; manifests remain opaque to the CLI.

4. TargetFamilyHook validates operator registry
- The emitter passes `ctx.operationRegistry` and `ctx.extensionIds` to `TargetFamilyHook.validateTypes`.
- Family hooks validate operator signatures, lowering.targetFamily, arg/return kinds, and typeId namespaces.

5. Deterministic composition rules
- `extensionIds` order: `[adapter.id, target.id, ...extensions.map(e => e.id)]` (dedupe, stable order preserved).
- Type imports: merge and dedupe `types.codecTypes.import` and `types.operationTypes.import` across adapter/target/extensions.
- Operation manifests: union and convert to signatures; resolve conflicts deterministically (warn on overwrite).

6. Flags removed
- `--adapter` and `--extensions` are removed (may be deprecated briefly). No discovery; config is the single source of truth.

## Consequences

Positive
- CLI remains family‑agnostic; plane boundaries are respected.
- Config is deterministic, reviewable, and tree‑shakeable (/cli vs /runtime).
- Families own typing, assembly, and validation via TargetFamilyHook.

Trade‑offs
- Requires families to provide helper functions in their `/control` and `/runtime` exports.
- Slightly more structure in pack publishing (two entrypoints).

## Implementation Status

✅ **Completed** (Briefs 20 & 21, Decouple-Framework-CLI-from-SQL)

1) ✅ Config loader: `packages/1-framework/3-tooling/cli/src/config-loader.ts` loads TS module and returns config.
2) ✅ SQL pack assembly moved to `packages/2-sql-family/3-tooling/family/src/core/assembly.ts` and is used via `@internal/family-sql/control`.
3) ✅ Emit command updated to read helpers from `config.family`, assemble inputs, and call emitter with `family.hook`.
4) ✅ Flags removed: `--adapter` and `--extensions` flags removed; config-only model enforced.
5) ✅ Pack loading/assembly removed from framework CLI; family-provided helpers handle all assembly logic.
6) ✅ Contract validation decoupled: Framework CLI uses `family.validateContract()` instead of direct SQL imports.
7) ✅ Dependency boundaries enforced: All CLI→SQL exceptions removed from dependency-cruiser; framework CLI is fully family-agnostic.

## References
- ADR 005 — Thin Core, Fat Targets
- ADR 007 — Types Only Emission
- Package Layering Guide
- Project Brief — CLI Support for Extension Packs
