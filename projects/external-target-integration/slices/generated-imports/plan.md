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
- **Amended 2026-11-17, during the dispatch:** the brief said nothing emitted would change. That is false for an application that loads an extension from its published package: the extension now states its published module, so the `package` string recorded beside its codec metadata in the emitted contract changes from `@internal/extension-<x>/...` to the published name. That is the design record's rule arriving here (a module name recorded in an emitted contract is the name the matching import line uses), so the regeneration is accepted in this dispatch, in its own commit. Import lines and hashes do not change. Dispatch 5 still decides whether the string is read at all and should be removed.

## 3. Contract types are emitted from `contract.typesModule`

- **Outcome:** the framework emitter and the SQL and MongoDB family emitters write one import line from the config's module; target and adapter descriptors declare names and aliases but no package; a missing member is a structured error; every in-repo config assembled by hand that emits names its module; the CLI no longer consults the manifest for contract types.
- **Builds on:** dispatch 2.
- **Hands on:** regenerated `contract.d.ts` files in their own commit, `pnpm fixtures:check` green, the planner golden manifest regenerated.

## 4. Migration files are rendered from `migrations.module`; the old mechanism is removed

- **Split 2026-11-17.** The operator approved replacing the translation function with the module name from the config. How a component's type declaration loses its package is still being decided, and that blocks dispatch 3. So this dispatch runs in two parts. **4a, now:** every target's migration renderer writes its imports from `migrations.module`, and a command that renders a migration with no module named stops with a structured error. The translation function stays alive for contract types only. **4b, after dispatch 3:** the function, the import-root modes and `project-import-root.ts` are deleted.

- **Outcome:** every target's migration renderer writes its imports from the config's module; `project-import-root.ts`, the import-root modes and the threaded resolver are gone; `init` still scaffolds Postgres and MongoDB as before.
- **Builds on:** dispatch 3.
- **Hands on:** no code path chooses an import name from the manifest; the shell table is read only by the build and the publish lint.

## 5. Module names recorded inside the emitted contract

- **Outcome:** the emitted contract no longer records where an extension's types are imported from. Research on 2026-11-17 found that nothing reads it: the only writer is `enrichContract` in the CLI's control API, it writes for extensions only, no validation schema looks inside `extensions`, and `extensions` is outside every hash. So the design record's rule for an unread value applies: remove it.
- **Order:** run before dispatch 3. It does not depend on it, and dispatch 3 is waiting on a decision.
- **Builds on:** dispatch 3.
- **Hands on:** no emitted artifact holds a private workspace name.

## 6. The packaging test

- **Outcome:** a test under `test/integration/test/packaging/` installs packed tarballs and a stand-in target package that is in no list in this repository, runs `contract emit` and `migration plan`, and typechecks the output.
- **Builds on:** dispatches 3 and 4.
- **Hands on:** the slice's done conditions.

## Orchestrator-written

The extension upgrade instructions entry, and the pull request description.
