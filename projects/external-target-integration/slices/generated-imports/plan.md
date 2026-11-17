# Dispatch plan: generated imports

Spec: [spec.md](spec.md). Branch: `tml-3830-generated-imports`. Every dispatch runs on Opus.

Checks every dispatch runs before reporting: `pnpm build`, `pnpm typecheck`, `pnpm --filter <pkg> lint` and `pnpm --filter <pkg> test` for each package it touched, `pnpm lint:deps`. Dispatches that change emitted output also run `pnpm fixtures:check`. Integration tests are run by file, with no `--` before the path.

Known failure modes to check in every dispatch: destructive git operations are forbidden without the orchestrator's approval; a stale `dist` makes a red check look like a broken base, so rebuild before judging; lint is a separate CI job from typecheck.

## 1. The mechanism, on Postgres

- **Outcome:** the config type has `contract.typesModule` and `migrations.module`; a package can state its own name through a build-time constant; `@internal/postgres` has a `generated-types` entrypoint and its `defineConfig` names both modules, such that the workspace package yields `@internal/postgres/...` and the built published package yields `@prisma/orm-postgres/...`.
- **Property it preserves:** the framework config type gains two optional strings in existing sections and nothing else; no new descriptor field, registry or runtime interface.
- **Builds on:** the design record.
- **Hands on:** the constant mechanism, the two members, and one target package using both, with a test of each build's value. Nothing reads the members yet.
- **Design judgment in this dispatch:** how the constant is defined in both builds. It is made here, in one place, so the next dispatch only repeats it.

## 2. Every other target package, and extensions

- **Outcome:** MongoDB, SQLite, MySQL and MariaDB target packages each have a `generated-types` entrypoint and name both modules; every extension states the module for its types through the same constant.
- **Builds on:** dispatch 1's mechanism, unchanged.
- **Hands on:** every config built by a target package names both modules.

## 3. Contract types are emitted from `contract.typesModule`

- **Outcome:** the framework emitter and the SQL and MongoDB family emitters write one import line from the config's module; target and adapter descriptors declare names and aliases but no package; a missing member is a structured error; every in-repo config assembled by hand that emits names its module; the CLI no longer consults the manifest for contract types.
- **Builds on:** dispatch 2.
- **Hands on:** regenerated `contract.d.ts` files in their own commit, `pnpm fixtures:check` green, the planner golden manifest regenerated.

## 4. Migration files are rendered from `migrations.module`; the old mechanism is removed

- **Outcome:** every target's migration renderer writes its imports from the config's module; `project-import-root.ts`, the import-root modes and the threaded resolver are gone; `init` still scaffolds Postgres and MongoDB as before.
- **Builds on:** dispatch 3.
- **Hands on:** no code path chooses an import name from the manifest; the shell table is read only by the build and the publish lint.

## 5. Module names recorded inside the emitted contract

- **Outcome:** the `package` string in codec metadata either is gone from the emitted contract (if nothing reads it) or holds the module the matching import line names. The dispatch reports which, with the evidence.
- **Builds on:** dispatch 3.
- **Hands on:** no emitted artifact holds a private workspace name.

## 6. The packaging test

- **Outcome:** a test under `test/integration/test/packaging/` installs packed tarballs and a stand-in target package that is in no list in this repository, runs `contract emit` and `migration plan`, and typechecks the output.
- **Builds on:** dispatches 3 and 4.
- **Hands on:** the slice's done conditions.

## Orchestrator-written

The extension upgrade instructions entry, and the pull request description.
