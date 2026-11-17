# @internal/publish-surface

> **Private, and never published.** This package describes what the published surface *is*; it is not part of it. It is `"private": true` and belongs to no shell, so nothing outside this repository can depend on it.

The canonical map from internal workspace packages to the published `@prisma/orm-*` entrypoints of [ADR 242](../../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), and the lookup the build of the published packages uses to name each internal specifier.

## Responsibilities

- **`./shells`** — the mapping table. Every internal package belongs to exactly one published shell and becomes a subpath entrypoint of it: `@internal/<pkg>/<sub>` → `@prisma/<shell>/<entry>/<sub>`. Facades additionally republish sibling surfaces, because an application depends on one facade and nothing else: everything it names — its generated files, its query code, its migration scripts — has to have a name under the facade. Republished entries keep the name the platform shell gives the same package, except where the facade's own wiring already owns it (`family-runtime` for the family's runtime, `family-contract` for its contract, since `runtime` and `contract` are the facade's own).
- **`./platform-entrypoints`** — `platformEntrypointOf` turns an internal specifier into its published entrypoint and the shell that owns it, for the shell build: an import that stays inside the shell being built is bundled rather than externalized. `buildOwnerIndex` refuses a package mapped to two shells.

The shell build (`@repo/tsdown/shell-build`) and the publish checks read this table, and nothing copies it.

Nothing that emits or scaffolds a file reads it. A generated `contract.d.ts` imports from the module the config names in `contract.typesModule`, and a written `migration.ts` from `migrations.module`; a target package's `defineConfig` sets both. `prisma orm init` names the target package it installs.

## Why the name is declared, not read from disk

`ShellPackageMapping` carries both `dir` and `name`. Declaring it keeps the table self-contained, so it can be read without the workspace on disk. `test/shells.test.ts` asserts each declared name matches the manifest at `dir`, so the two cannot drift.
