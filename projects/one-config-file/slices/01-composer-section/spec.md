# Slice 1: the `composer` section holds Composer's configuration

Repository: prisma/composer. One PR. Parent: [`../../spec.md`](../../spec.md). Grounding with file paths and line numbers: [`grounding.md`](./grounding.md), read against Composer `main` at edaf7b27 on 2026-09-30.

## At a glance

```ts
// examples/orm-demo/prisma.config.ts — the only config file
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as composer } from '@prisma/composer/config';
import { nodeBuild } from '@prisma/composer/node/control';
import { prismaCloud, prismaState } from '@prisma/composer-prisma-cloud/control';
import { defineConfig as orm } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  composer: composer({
    extensions: [prismaCloud(), nodeBuild()],
    state: prismaState(),
  }),
  orm: orm({ /* unchanged */ }),
});
```

`prisma-composer deploy module.ts` and the programmatic `deploy({ entry, stage, config })` both run against it. `examples/orm-demo/prisma-composer.config.ts` no longer exists. In the examples `definePrismaConfig` comes from `@prisma/cli-engine` because no example depends on the `prisma` host; the guides and skill write `prisma/config`, which is what a user's project has.

## Chosen design

**The section.** `family/section.ts` gets a hand-written `validate` that replaces the `configPath`-only one. It checks what `configShapeDiagnostics` in `load-config.ts` checks today: `extensions` is an array of objects with a string `id` and an object `nodes`, extension ids are unique, `state` is an object with a string `extension` and a function `create`. Descriptors pass through by reference, as the ORM section does. Unknown keys are errors, not warnings. `configPath` gets its own error that shows the section to write. The section's `merge` takes the nearest file's section whole, never key by key, so a section always has one declaring file. The header comment that explains the old split is replaced by one sentence saying the section is the configuration.

**Where the section's file path goes.** The generated stack files import the config file in the Alchemy child process. After this slice they import `prisma.config.ts` and read its `composer` export. The path is the section's provenance, which the engine gives the handler with the validated value. The pipelines therefore take `{ value: PrismaAppConfig, path: string }` in place of the request they build today from an entry path and an optional `configPath`.

**The programmatic operations take the config.** `deploy`, `destroy`, `dev` and `log` on `@prisma/composer/control` today find the config by walking up from the entry file. `@prisma/composer` must not import the engine, so they gain a required `config` input with the same `{ value, path }` shape, and the caller evaluates the file:

```ts
import prismaConfig from './prisma.config.ts';
import { deploy } from '@prisma/composer/control';

await deploy({ entry: './module.ts', stage: 'preview', config: { value: prismaConfig.composer, path: './prisma.config.ts' } });
```

This is a public API change. It lands with the matching guide and skill updates in this PR, per the repo's user-facing-surface rule, and the ADR records it.

**Refusing the old shape.** Three diagnostics, all under Composer's `CONFIG.` prefix and all naming `prisma-composer.config.ts` and showing the section:

- `configPath` present: a section validation error. The engine's headline is `CLI.CONFIG_SECTION_INVALID` with Composer's message attached; that is the engine's shape and is accepted.
- Section absent: the validator already receives an absent section today. It returns an error saying the `composer` section is missing and, when the config file's directory is known from provenance and holds `prisma-composer.config.*`, that the old file is no longer read. The implementer establishes what the engine passes for an absent section and writes the best message the engine allows.
- Section present and `prisma-composer.config.*` also present in the section's directory: the handler fails before the pipeline starts, code `CONFIG.FILE_RETIRED`. Only that directory is checked.

**Deletions.** `load-config.ts`, `check-effect-resolution.ts` and their tests; `executorLoadFailure`'s use of the effect check in `operations/shared.ts`; the `c12` dependency from the cli package, `@prisma/composer` and `@prisma/composer-cli`; `CONFIG_FILENAME` and the three user-facing messages that name the old file in `validate-coverage.ts`, `assemble-services.ts` and core `control/deploy.ts`; the header comments in `app-config.ts` that name it.

**The standalone binary keeps working.** `commands/destroy.ts` and `commands/log.ts` get the same change as `deploy` and `dev`. Nothing else in the binary changes; its removal is slice 2.

**Examples and fixtures.** All ten examples, `test/integration` and `website` get a `composer` section in `prisma.config.ts` and lose `prisma-composer.config.ts`. Examples that had no `prisma.config.ts` get one. Examples that do not yet depend on `@prisma/cli-engine` add it at the pinned version. `tsconfig.json` includes that name the old file are updated. Package scripts keep calling the standalone binary in this slice; slice 2 changes them.

**CI script.** `scripts/check-npm-effect-resolution.mjs` proves Alchemy loads by running the binary with no config; that path now stops at the engine before Alchemy is reached. Both healthy shapes and the adversarial shape switch to importing Alchemy directly from the installed tree, asserting success or the import error respectively.

**Docs in this slice.** The guides and the skill are updated only where this slice changes what a user observes: the config file, its section, and the programmatic `config` input. Command names stay as they are; slice 2 does that sweep.

**ADR.** A new ADR-0049 records: the configuration is the `composer` section of `prisma.config.ts`; identifying fields are validated and descriptors pass through as references; the old file is refused; programmatic operations take the config; the effect pre-flight is retired in favour of the engine's fail-fast diagnostic, with the verified reason. ADR-0017 is amended so its wording names `prisma.config.ts`; ADR-0043 is amended for the programmatic API.

## Coherence rationale

One reviewer can hold this: every change follows from one fact, the section is the configuration. The deletions, the new input, the diagnostics and the example migration are the consequences of that fact and cannot be reviewed apart from it. The binary removal and the command-name sweep are separable and are slice 2.

## Scope

**In:** everything under Chosen design.

**Deliberately out:** deleting the binary and `engine-cli.ts`; the `prisma-composer` command name in guides, README, skill and example scripts; the CI check for the name; the root version bump; the dependency-cruiser exclusion of `prisma.config` files (recorded as a deferred item); a real deploy of orm-demo to confirm that the ORM loader evaluating the shared file inside the Alchemy child is harmless (slice 3 manual QA).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| The engine merges a section across a config chain key by key | The section's `merge` takes the nearest file's section whole, so provenance is always one file. |
| `examples/store` has module-level `prisma.config.ts` files with only an `orm` section | The root `prisma.config.ts` gains the `composer` section; modules inherit it through the chain. A `prisma-composer deploy` from the store root must still work. |
| `test/integration` pins `prisma@7.9.0` and imports `definePrismaConfig` from `@prisma/cli-engine` | Keep `@prisma/cli-engine`; do not add the host. |
| The adversarial shape of the tarball script overrides to `effect@4.0.0-beta.93` | Keep that override; the assertion becomes that importing Alchemy throws. |
| `operations.test.ts` asserts `DEPS.EFFECT_VERSION_CONFLICT` from `executorLoadFailure` | That path is deleted with the check; the test goes with it. A failed executor import is reported as the import error. |

## Slice-specific done conditions

- From `examples/orm-demo`, `pnpm exec prisma-composer deploy --help` and a dry deploy that reaches the plan stage run against `prisma.config.ts` alone; with `prisma-composer.config.ts` restored, `CONFIG.FILE_RETIRED`; with `composer: { configPath: './x.ts' }`, the section error naming `configPath`.
- `pnpm exec check-family-static-graph` and `check-cli-engine-pin` pass unchanged; the control-import guard tests pass; `scripts/check-npm-effect-resolution.mjs` passes in its reworked form (it needs network and built tarballs; run it once and record the output in the PR).
- A search for `prisma-composer.config` over `packages/`, `examples/`, `test/`, `website/`, `docs/guides/` and `skills/` finds only the diagnostics that name the old file and the ADRs.

## Open questions

None.

## References

- Parent spec and design notes; `grounding.md` for every call site and signature.
- Composer rules: `user-facing-surface-changes.mdc`, `exports-entrypoints.mdc`, `commit-story.mdc`, `git-staging.mdc`, `no-bare-casts.mdc`, `test-import-patterns.mdc`.
- ORM section pattern in prisma/orm: `packages/1-framework/3-tooling/config-loader/src/orm-section.ts`.
