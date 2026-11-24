# @internal/publish-surface

> **Private, and never published.** This package describes what the published surface *is*; it is not part of it. It is `"private": true` and belongs to no shell, so nothing outside this repository can depend on it.

The canonical map from internal workspace packages to the published `@prisma/orm-*` entrypoints of [ADR 242](../../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), and the lookup the build of the published packages uses to name each internal specifier.

## Responsibilities

- **`./shells`** — the mapping table. Every internal package belongs to exactly one published shell and becomes a subpath entrypoint of it: `@internal/<pkg>/<sub>` → `@prisma/<shell>/<entry>/<sub>`. Facades additionally republish sibling surfaces, because application code imports only from its facade and its extensions, never from a platform shell, even though the application lists the platform shells ([ADR 329](../../../docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)): everything it names — its generated files, its query code, its migration scripts — has to have a name under the facade. Republished entries keep the name the platform shell gives the same package, except where the facade's own wiring already owns it (`family-runtime` for the family's runtime, `family-contract` for its contract, since `runtime` and `contract` are the facade's own).
- **`./levels`** — each published package's maturity level, or the first version of a package numbered on its own, and each package's kind ([ADR 330](../../../docs/architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)).
- **`./release-plan`** — `planRelease`, the one function that turns the levels, the kinds and the root version into each published package's version, dist-tag and the ranges it writes on ours; and `parseVersion`, the one version parser the release scripts use.
- **`./platform-entrypoints`** — `platformEntrypointOf` turns an internal specifier into its published entrypoint and the shell that owns it, for the shell build: an import that stays inside the shell being built is bundled rather than externalized. `buildOwnerIndex` refuses a package mapped to two shells.

The shell build (`@repo/tsdown/shell-build`) and the publish checks read this table, and nothing copies it.

Nothing that emits or scaffolds a file reads it. A generated `contract.d.ts` imports from the module the config names in `contract.typesModule`, and a written `migration.ts` from `migrations.module`; a target package's `defineConfig` sets both. `prisma orm init` names the target package it installs.

## Loaded from source by the release scripts

`set-version`, `determine-version` and the other release scripts run before the workspace is built, so they load `src/shells.ts`, `src/levels.ts` and `src/release-plan.ts` directly, and Node runs them by removing their types. Those three files may therefore import only types. `test/source-imports.test.ts` fails if one of them gains a run-time import. These imports are outside the graph `lint:deps` checks.

## Why the name is declared, not read from disk

`ShellPackageMapping` carries both `dir` and `name`. Declaring it keeps the table self-contained, so it can be read without the workspace on disk. `test/shells.test.ts` asserts each declared name matches the manifest at `dir`, so the two cannot drift.
