# Generated files import from the module the target package names

Linear: [TML-3830](https://linear.app/prisma-company/issue/TML-3830). Also closes [TML-3143](https://linear.app/prisma-company/issue/TML-3143).
Design record: [../../adrs/generated-files-import-from-the-target-package.md](../../adrs/generated-files-import-from-the-target-package.md). It is approved; this spec does not restate its reasoning.

## At a glance

`prisma contract emit` for an application on `@prisma/orm-postgres` writes:

```ts
import type {
  CodecTypes as PgTypes,
  Contract as ContractType,
  ContractWithTypeMaps,
  TypeMaps as TypeMapsType,
} from '@prisma/orm-postgres/generated-types';
```

because the config that package's `defineConfig` returned names that module. The same holds for a target package this repository has never heard of. The CLI no longer reads `package.json` to choose the name.

## Chosen design

1. **Two config members.** `contract.typesModule` and `migrations.module`, both optional strings, in the existing `contract` and `migrations` sections of the config type in `packages/1-framework/1-core/config`.
2. **A package knows its own name through a build-time constant.** The workspace build fills in the workspace package name; the build that produces a published package fills in the published name. Target packages and extensions use it to state their modules.
3. **Each target package** (Postgres, MongoDB, SQLite, MySQL, MariaDB) gains a `generated-types` entrypoint that re-exports the framework contract types, its family's contract types and its target's codec and operation types, and names both modules in the config its `defineConfig` returns.
4. **The contract-types emitters** (framework, SQL family, MongoDB family) write their imports from `contract.typesModule`. Framework, family, target and adapter imports merge into one import line. A target or adapter descriptor still declares which names it needs and under which alias; it declares no package.
5. **An extension** states the module its types come from as its own published name, and keeps its own import line.
6. **The migration renderers** of every target write their imports from `migrations.module`.
7. **A missing member is an error.** A command that needs a module the config does not name stops with a structured error naming the member. No default, no lookup.
8. **Removed:** `packages/1-framework/3-tooling/cli/src/utils/project-import-root.ts`, the import-root modes and the resolver function threaded through the emitters and renderers. The table in `packages/0-shared/publish-surface/src/shells.ts` stays, as configuration for the build of the published packages and the publish lint only.
9. **Any module name recorded inside an emitted contract** is the name the matching import line uses. If nothing reads the `package` string in codec metadata, it is removed from the emitted contract instead.

## Coherence

One reviewer can hold this: it replaces one mechanism (import names chosen by the CLI from the manifest) with another (import names stated in the config), end to end, with no period where both exist. The regenerated files are in their own commit, so the reviewed diff is the mechanism.

## Scope

In: everything in "Chosen design"; every in-repo config that is assembled by hand and emits now names its modules; regeneration of every committed generated file; a packaging test with a stand-in target package; the extension upgrade instructions.

Deliberately out:

- `prisma orm init`. It keeps scaffolding Postgres and MongoDB exactly as it does now. Its templates may name their target package directly, since the `init` work moves them into the target packages next.
- Re-rendering existing migration files. Their content is hashed. The modules they import stay exported.
- Removing the granular entrypoints target packages already publish.

## Edge cases already known

| Case | Required behaviour |
| --- | --- |
| A generated file committed in the repo uses syntax the change removes | Regenerate it in the same pull request, before the removal lands on `main` |
| The same type reachable through two `export type *` lines (`JsonValue`) | It is one type re-exported; confirm the module still exports it and nothing is silently dropped |
| A committed contract fixture changes | The planner golden manifest is regenerated with it |
| A test asserts the manifest-driven behaviour (`project-import-root.test.ts`, `migration-new-import-root.e2e.test.ts`, the per-emitter `import-roots.test.ts` files) | Replace with a test of the new behaviour; do not keep the old one alive behind a shim |
| An example or extension changes | The upgrade coverage check needs a pending upgrade-instructions entry, compared against this pull request's base |
| The two-copies packaging test and the shell test kit use the shell table | They keep working; the table is still the build's configuration |

## Done when

- A packaging test installs packed tarballs plus a stand-in target package that appears in no list in this repository, runs `contract emit` and `migration plan`, and typechecks the output. No generated file names an `@internal/` module.
- `git grep -n "project-import-root\|importRootForDependencies"` returns nothing under `packages/`.
- `pnpm fixtures:check` passes.

## References

- Research notes on every place a generated file gets an import name: `wip/pr-31008/` is not committed; the facts are in the design record and in TML-3830.
- Decision records: the public npm packages record (one target package per application, one copy of each module), the family-agnostic CLI record (config is the only input).
