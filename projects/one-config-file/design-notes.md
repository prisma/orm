# Design notes: one config file for Composer

Decisions made with Will Madden on 2026-09-30, each with the alternatives rejected and why. Facts were read from `main` of prisma/composer, prisma/prisma-cli and this repo on that date, and from the npm registry.

## Principles

1. **One config file means one loader.** The engine loads `prisma.config.ts`; families own a section and its validator. A family that keeps a private loader for a private file has not consolidated.
2. **A section holds the configuration, not a pointer to it.** The reason given in Composer's section header for keeping only a path, that a validator loads at start-up and must be light, describes the engine wrongly: validators are loaded with the family but only run when a command needs config, and the ORM section already holds built descriptors with functions inside.
3. **Fail fast and loud on the old shape.** No fallback, no silent ignore, no codemod.
4. **No machinery with one consumer.** An engine extension point that only Composer would use is not worth its maintenance.

## The model

### The section

```ts
composer: composer({
  extensions: [prismaCloud(), nodeBuild()],
  state: prismaState(),
})
```

`composer` is `defineConfig` from `@prisma/composer/config`, today an identity function over `PrismaAppConfig` in `packages/0-framework/1-core/core/src/control/app-config.ts`. It stays light: the module imports no control-plane code. The section validator, replacing the `configPath`-only one in `packages/0-framework/3-tooling/cli/src/family/section.ts`, checks exactly what Composer's loader checks today in `configShapeDiagnostics`, and wraps each descriptor with the engine's `reference(...)` so commands receive the objects the config built. This is the ORM section's pattern in `packages/1-framework/3-tooling/config-loader/src/orm-section.ts` of this repo.

The deploy and dev pipelines, which today call Composer's loader through `resolveConfigFile` in `pipeline.ts`, instead read the validated section the engine hands the command. `deploy` and `dev` already declare a config need on the `composer` section, so the engine evaluates the file before either runs.

### Refusing the old shape

Two diagnostics, both under Composer's `CONFIG.` prefix:

- The section validator rejects `configPath` as an unknown field with a message that shows the section to write. Today unknown fields are only warnings; that changes to errors, because a config the user believes is in effect and is not is worse than a rejected config.
- Each Composer command, before its pipeline starts, looks for `prisma-composer.config.{ts,mts,mjs,js}` in the directory of the loaded `prisma.config.ts` and fails naming the file. The engine's section provenance gives that directory. Only that directory is checked; the old walk-up discovery is not reproduced.

### The `effect` version pre-flight is deleted

Composer's `check-effect-resolution.ts` compares the `effect` version Alchemy resolves against the exact version `@prisma/composer` pins, before Composer's loader evaluates the config file. It exists because Alchemy's `effect` peer range, `>=4.0.0-rc.115 || >=4.0.0`, accepts newer release candidates that remove modules Alchemy imports, and package managers hoist over peer ranges with only a warning. Verified on 2026-09-30: `alchemy@2.0.0-beta.78` or `beta.79` with `effect@4.0.0-rc.118` fails at import with a missing `effect/dist/unstable/http/FetchHttpClient.js`; with `rc.115` both import cleanly.

After the merge the engine evaluates the file. The Prisma Cloud control entry imports Alchemy at module load through its resource definitions in at least 18 files, so a broken tree throws during evaluation. The engine catches that and reports `CLI.CONFIG_UNREADABLE` with the first line of the error, exit code 2, for every command that reads config; commands that do not, such as `prisma --version`, are unaffected. Will's ruling: that is enough. The case is rare, catastrophic, and can only be fixed by the user and their package manager; failing hard and fast with the module error is correct. The pre-flight module and its two callers go, as does the standalone binary's start-up use of it.

**Rejected: an engine hook that lets a family veto config evaluation.** It would have produced Composer's friendlier message on ORM commands too. Nothing else would consume it, and the message quality gain does not justify a family-level extension point.

**Rejected: Composer's commands declaring no config need and loading the config themselves after the check.** Possible with the runtime's config loader, and what the standalone tool did, but it bypasses the engine's declarative config need for the sake of a message on a rare failure.

**Rejected: running the check at import time inside `@prisma/composer/config`.** Depends on import order in the user's file. An import sorter puts `@prisma/composer-prisma-cloud/control` before `@prisma/composer/config`, because a hyphen sorts before a slash, so the sorted file crashes before the check runs.

**Rejected: making the control-plane entries import Alchemy lazily.** That is a refactor of Composer's lowering layer, not something to do before GA.

What stays: the exact pins on `effect` and its companions, and the CI script `scripts/check-npm-effect-resolution.mjs` that installs the published tarballs with the real package manager and proves a clean install resolves one `effect` that Alchemy loads. Its adversarial shape currently runs the standalone binary to assert the friendly error; it changes to assert that importing Alchemy from the broken tree throws.

### The standalone binary

`prisma-composer` is declared by `@prisma/composer-cli`, not `@prisma/composer` as two stale comments say. Its entry `bin.ts`, `cli.ts`, `family/engine-cli.ts`, and the pass-through `orm` section family that `engine-cli.ts` mounts so a shared config loads, are deleted. `destroy` and `log` remain as operations on `@prisma/composer/control`, where the public docs already send readers, but no command mounts them, and the family's internal operations seam (`ComposerOperations` and its test double) narrows to `deploy` and `dev`, since nothing else reads it. Inside the repository the examples and CI run the published `prisma` host with a root `pnpm.overrides` entry pointing `@prisma/composer-cli` at the workspace; the hoisted linker means example scripts call the bin by a repo-relative path and CI teardown is a repo-private script over the programmatic `destroy`.

### Docs and the skill

TML-3340 counted 55 command mentions across seven files at commit `c29ae43`. A full count on `main` finds 176 mentions of `prisma-composer` in prisma/composer: 138 as the command and 38 as the config file name, spread over the guides, README, skill, all ten examples' package scripts and tsconfig includes, and design docs. The design docs are out of scope, as the ticket says. Everything else changes in this project. The CI check is a script under `scripts/` that fails on `prisma-composer` as a command or config-file name in `README.md`, `docs/guides/`, `skills/`, `examples/`, and is wired into the existing lint job.

In prisma/web, no page tells the reader to run a `prisma-composer` command; the getting-started and porting pages name the config file, and the deploying and local-development pages already say the unified CLI has no `destroy` or `log`. Two one-line fixes.

### Commands

Nothing new is mounted. Will's ruling on 2026-09-30: `deploy` and `dev` stay as bare commands, special cases of the noun-verb grammar in `docs/product/command-principles.md` of prisma/prisma-cli and the consolidation plan's invariants. The consolidation plan's statement that bare deploy does not survive is corrected in this project's shaping PR.

**Rejected: mounting `destroy` in the host.** `destroy` is not a verb in the CLI's language, `delete` is, and `--production` is not a concept in Composer's model or the plan's. The plan maps stage teardown to `branch delete` with a plan and a guarded confirm. That is a command-grammar project, not a config-file one.

**Rejected: renaming `deploy` and `dev` to `project deploy` and `project dev`.** Will ruled they stay.

## Alternatives considered at the project level

- **Keep the pointer section and only fix the docs.** That is TML-3340 alone. It leaves two config files, which the GA plan names as a must-fix before GA.
- **Automatic migration of `prisma-composer.config.ts`.** More code than the feature: the migration is moving one object literal, and the release-candidate audience is small.

## Open questions

None. Every question in the original brief was settled on 2026-09-30.

## References

- Consolidation plan: [`projects/consolidate-clis/cli-consolidation-plan.md`](../consolidate-clis/cli-consolidation-plan.md), § "Evaluating the config never errors" and the Composer rows of the rename table.
- prisma/prisma-cli: `docs/product/command-principles.md`; `packages/cli-engine/src/config-loader.ts` (evaluation and `CLI.CONFIG_UNREADABLE`); `packages/cli-engine/src/execution/needs.ts` (lazy loading and section validation).
- prisma/composer: `packages/0-framework/3-tooling/cli/src/check-effect-resolution.ts` (header comment records the field failure on Composer 0.6.0); `docs/design/90-decisions/ADR-0017-control-plane-loads-through-the-app-config.md`.
