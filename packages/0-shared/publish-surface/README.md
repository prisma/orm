# @internal/publish-surface

> **Private, and never published.** This package describes what the published surface *is*; it is not part of it. It is `"private": true` and belongs to no shell, so nothing outside this repository can depend on it.

The canonical map from internal workspace packages to the published `@prisma/orm-*` entrypoints of [ADR 242](../../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), and the import-root modes that emission resolves generated import specifiers through.

## Responsibilities

- **`./shells`** — the mapping table. Every internal package belongs to exactly one published shell and becomes a subpath entrypoint of it: `@internal/<pkg>/<sub>` → `@prisma/<shell>/<entry>/<sub>`. Facades additionally republish sibling surfaces, because an application depends on one facade and nothing else: everything it names — its generated files, its query code, its migration scripts — has to have a name under the facade. Republished entries keep the name the platform shell gives the same package, except where the facade's own wiring already owns it (`family-runtime` for the family's runtime, `family-contract` for its contract, since `runtime` and `contract` are the facade's own).
- **`./import-roots`** — turns an internal specifier into the name generated code should carry, given how the application installed Prisma 8:

  | Root | `@internal/sql-contract/types` becomes |
  |---|---|
  | `internal` (default) | `@internal/sql-contract/types` |
  | `facade` | `@prisma/orm-postgres/family-contract/types` |
  | `platform` | `@prisma/orm-family-sql/contract/types` |

  Resolution refuses to produce a name the application does not depend on **directly**. A package manager puts a package's own dependencies in that package's `node_modules`, so a generated file importing a transitively installed package fails to resolve at run time even though the files are on disk. `resolveImportSpecifier` throws rather than emit one.

  `importRootForDependencies` picks the root from a project's own dependency names.

Two consumers read this table and nothing copies it: the shell build (`@repo/tsdown/shell-build`), which turns each mapping into a generated entrypoint, and `prisma orm init`, which names the facade a scaffolded project imports from.

Emission does **not** read it. A generated `contract.d.ts` imports from the module the config names in `contract.typesModule`, and a written `migration.ts` from `migrations.module`; a target package's `defineConfig` sets both. `prisma orm init` receives an opaque `ImportSpecifierResolver` — a `(specifier) => string` declared in `@internal/framework-components/emission` — and never learns what the published names are. That keeps `packages/1-framework` free of family and target vocabulary, and keeps this package out of every published bundle.

## Why the name is declared, not read from disk

`ShellPackageMapping` carries both `dir` and `name`. The build reads package manifests off disk anyway, but emission runs inside a published bundle where the workspace does not exist — so the name has to be data. `test/shells.test.ts` asserts each declared name matches the manifest at `dir`, so the two cannot drift.
