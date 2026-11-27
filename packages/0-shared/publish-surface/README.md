# @internal/publish-surface

> **Private, and never published.** This package describes what the published surface *is*; it is not part of it. It is `"private": true` and belongs to no shell, so nothing outside this repository can depend on it.

The canonical map from internal workspace packages to the published `@prisma/orm-*` entrypoints of [ADR 242](../../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), and the lookup the build of the published packages uses to name each internal specifier.

## Responsibilities

- **`./shells`** — the mapping table. Every internal package belongs to exactly one published shell and becomes a subpath entrypoint of it: `@internal/<pkg>/<sub>` → `@prisma/<shell>/<entry>/<sub>`. Facades additionally republish sibling surfaces, because application code imports only from its facade and its extensions, never from a platform shell, even though the application lists the platform shells ([ADR 329](../../../docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)): everything it names — its generated files, its query code, its migration scripts — has to have a name under the facade. Republished entries keep the name the platform shell gives the same package, except where the facade's own wiring already owns it (`family-runtime` for the family's runtime, `family-contract` for its contract, since `runtime` and `contract` are the facade's own).
- **`./levels`** — each published package's maturity level and its kind (facade, platform package, extension or library integration). For a package with version numbers of its own, it holds the first version in place of a level. See [ADR 330](../../../docs/architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md).
- **`./release-plan`** — `planRelease`, the one function that works out each published package's version, its npm tag, and the range it puts on each other package of ours, from the levels, the kinds and the root version. Also `parseVersion`, the one version parser the release scripts use.
- **`./platform-entrypoints`** — `platformEntrypointOf` turns an internal specifier into its published entrypoint and the shell that owns it, for the shell build: an import that stays inside the shell being built is bundled rather than externalized. `buildOwnerIndex` refuses a package mapped to two shells.

The shell build (`@repo/tsdown/shell-build`) and the publish checks read this table, and nothing copies it.

Nothing that emits or scaffolds a file reads it. A generated `contract.d.ts` imports from the module the config names in `contract.typesModule`, and a written `migration.ts` from `migrations.module`; a facade's `defineConfig` sets both. `prisma orm init` names the facade it installs.

## Loaded from source by the release scripts

`set-version`, `determine-version` and the other release scripts run before the workspace is built. So they load `src/shells.ts`, `src/levels.ts` and `src/release-plan.ts` directly from source, and Node runs them by stripping their types. For that to work, those three files may import types only. `test/source-imports.test.ts` fails if one of them gains an import that exists at run time. `lint:deps` does not check these imports.

## Why the name is declared, not read from disk

`ShellPackageMapping` carries both `dir` and `name`. Declaring it keeps the table self-contained, so it can be read without the workspace on disk. `test/shells.test.ts` asserts each declared name matches the manifest at `dir`, so the two cannot drift.
