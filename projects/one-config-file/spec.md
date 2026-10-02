# One config file for Composer

> Shaped 2026-09-30 with Will Madden. Every claim below was checked against `main` of prisma/composer (58e858b), prisma/prisma-cli (fee1624) and this repo on that date. Slice detail lives under `slices/`; this file holds only what is true at the project level.

## Purpose

Prisma 8 promises one command-line tool and one config file. A Composer user today has two of each: `prisma.config.ts` beside `prisma-composer.config.ts`, and `prisma` beside `prisma-composer`. The nightly getting-started test of 2026-09-28 showed what that costs: coding agents ran the standalone tool by file path, the standalone tool rejected the shared config because it did not know the `skills` section, and nothing explained how the two files relate.

This project makes `prisma.config.ts` the only file Composer reads and `prisma` the only tool anyone is told to run. It must ship before Prisma 8 general availability at the end of October 2026, the last point at which breaking changes are allowed. It is item 2 of the foundations stream of the GA plan.

## At a glance

A Composer project's whole configuration, after this project:

```ts
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
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

`prisma deploy module.ts` and `prisma dev module.ts` read the `composer` section. There is no `prisma-composer.config.ts` and no `prisma-composer` binary. A project that still has the old file gets:

```
CONFIG.FILE_RETIRED  prisma-composer.config.ts is no longer read.
Move its contents into the `composer` section of prisma.config.ts:

  composer: composer({ extensions: [...], state: ... })

then delete prisma-composer.config.ts.
```

## Non-goals

- **No new commands in `prisma`.** `destroy` and `log` stay programmatic operations in `@prisma/composer/control`, which is where the public docs already send readers. What replaces them on the command line is command-grammar work under the consolidation plan's rules and is deferred; see § Deferred.
- **No renaming of `deploy` and `dev`.** Will ruled on 2026-09-30 that they stay as bare commands, as special cases of the noun-verb grammar. The consolidation plan is corrected to say so in this project's shaping PR.
- **No automatic migration of the old file.** A diagnostic that names the file and shows the section is the whole migration path. The change is moving one object literal, and the release-candidate audience is small.
- **No engine change.** The engine already turns a throw during config evaluation into a structured diagnostic. Composer's `effect` version pre-flight is deleted rather than re-homed; see design-notes.
- **No changes to Composer's design docs and ADRs** beyond the ADR this project adds and the amendment to ADR-0017. TML-3340 excludes `docs/design/` and this project keeps that boundary.
- **No change to what `deploy` and `dev` do.** Only where they read their configuration from.

## Place in the larger world

- **The engine.** `@prisma/cli-engine` (prisma/prisma-cli, `packages/cli-engine`) owns config loading. It evaluates `prisma.config.ts` with c12 lazily, only for commands that declare a config need, rejects unknown top-level sections with `CLI.CONFIG_UNKNOWN_SECTION`, runs each mounted family's section validator at load time, and reports a throwing config as `CLI.CONFIG_UNREADABLE` with exit code 2. Section validators return findings and never throw. Paths declared in a section resolve against the file that declared them. None of this changes.
- **The ORM section** is the model. Its validator (`packages/1-framework/3-tooling/config-loader/src/orm-section.ts` in this repo) checks only identifying fields, `kind`, `id`, `familyId`, `version`, `create`, and wraps each descriptor in `reference(...)` so the command receives the object the config built.
- **The Composer family** (`packages/0-framework/3-tooling/cli/src/family/` in prisma/composer) exposes `deploy` and `dev` and a `composer` section whose only field is `configPath`. The `prisma` host mounts the family and puts both commands at its root. A CI script in prisma/composer keeps the family's static import graph free of Alchemy and `effect`, and a host test proves an unrelated command never loads them. Both stay true; the family's static graph does not change.
- **Composer's own loader** (`load-config.ts` in the same package) walks up from the entry file for `prisma-composer.config.*`, loads it with c12, and validates it. It is called from the deploy and dev pipelines. It goes away.
- **The standalone binary** is `prisma-composer`, declared by `@prisma/composer-cli` (`packages/9-public/composer-cli`) and built from `bin.ts`, `cli.ts` and `family/engine-cli.ts` in the cli package. `engine-cli.ts` mounts the family plus `destroy` and `log` and a pass-through `orm` section. It goes away.
- **Control-plane boundary.** Composer's ADR-0017 makes the config file the only importer of `/control` entries, and guard tests in the node and nextjs authoring packages and the Prisma Cloud target prove application code never reaches them. The Prisma Cloud control entry imports Alchemy and `effect` at module load through its resource definitions; that is why evaluating the config file loads Alchemy.
- **Docs.** TML-3340 lists the guides, README, example README and skill in prisma/composer that name `prisma-composer`. The skill matters most because `prisma init` copies it into every new project. The public docs in prisma/web already tell readers to run `prisma deploy` and `prisma dev` and say the unified CLI has no `destroy` or `log`; two pages name the old config file.

## Cross-cutting requirements

1. **The `composer` section is written exactly like the ORM section.** `definePrismaConfig` from `prisma/config` wraps `composer({ extensions, state })` from `@prisma/composer/config`. The validator checks the identifying fields Composer's loader checks today, `extensions` an array of objects with a string `id` and an object `nodes`, `state` an object with a string `extension` and a function `create`, and passes every descriptor through as a reference. Unknown fields are errors.
2. **The old file and the old field are refused, loudly.** A `configPath` field fails section validation. A Composer command that finds `prisma-composer.config.{ts,mts,mjs,js}` in the directory of the loaded `prisma.config.ts` fails before doing anything else. Both diagnostics name the file and show the section to write. There is no fallback and no silent ignore.
3. **Nothing reads `prisma-composer.config.ts`.** Composer's loader, its walk-up discovery, its c12 dependency in the cli package, and its `configPath` handling are deleted, not bypassed.
4. **A broken `effect` tree fails fast with the engine's diagnostic.** The pre-flight that compared the `effect` version Alchemy resolves against Composer's pin is deleted with the loader. A tree that hoists an incompatible `effect` fails during config evaluation with `CLI.CONFIG_UNREADABLE` and the module error, exit code 2. Composer's exact pins on `effect` and its companion packages stay, and the CI script that installs the published tarballs with the real package manager keeps proving a clean install resolves one `effect` that Alchemy loads.
5. **The `prisma-composer` binary exists in no published package.** `@prisma/composer-cli` declares no `bin`. The publish scripts and the CI scripts that ran the binary are reworked or deleted, never left pointing at a file that no longer exists.
6. **Every example in prisma/composer is a Composer project with one config file.** All ten examples, the integration test project and the website config carry a `composer` section and no `prisma-composer.config.ts`. Their package scripts call `prisma`, not a binary path.
7. **The control-plane boundary holds.** The guard tests of ADR-0017 keep passing. Where a test or ADR names `prisma-composer.config.ts`, it now names `prisma.config.ts`.
8. **Nothing tells anyone to run `prisma-composer`.** No guide, README, example or skill in prisma/composer and no Composer page in prisma/web names `prisma-composer` as a command or names `prisma-composer.config.ts`. A CI check in prisma/composer fails on either string in those files. The docs name only commands that the released `prisma` binary has.
9. **The host mounting the family is the proof.** The end state is verified by running the `prisma` binary built from prisma/prisma-cli, with its pins bumped, against a migrated example, not only by Composer's unit tests.
10. **Repository rules apply in each repository.** prisma/composer and prisma/prisma-cli have their own agent instructions, rules and skills. Slices follow the ones of the repository they change.

## Transitional-shape constraints

- **Publish order.** The `prisma` host pins exact versions of `@prisma/composer-cli`. Composer's changes merge and publish first; the host bumps its pin afterwards. No host release may expect a family surface Composer has not published. Composer publishes from `main` automatically: a merge with the root version unchanged publishes a dev build, a merge that advances the root version publishes a release.
- **Between the config merge and the binary removal**, the standalone binary must still start. The slice that merges the config either keeps the binary working on the new section or lands in the same release as its removal. The plan chooses the same release.

## Contract impact

None. No contract entity, kind or artefact changes.

## Adapter impact

None.

## ADR pointer

Composer's ADR-0017 records that the config file is the only importer of control-plane code. This project adds a Composer ADR recording that Composer's configuration is the `composer` section of `prisma.config.ts`, validated by identifying fields with descriptors passed through as references, and that the standalone binary is retired. ADR-0017 is amended to name `prisma.config.ts`. Both land in the slice that merges the config.

## Failure-state section

No command in this project edits files it did not write. The migration path is a diagnostic; the user edits their own config.

## Project Definition of Done

- [ ] The orm-demo example in prisma/composer has one config file, `prisma.config.ts`, with a `composer` section, and `prisma deploy` and `prisma dev` run against it from the `prisma` binary built in prisma/prisma-cli with the bumped pins.
- [ ] A copy of that example with `prisma-composer.config.ts` restored gets the legacy-file diagnostic from `prisma deploy`, and a copy with `composer: { configPath }` gets the legacy-field diagnostic.
- [ ] A copy of that example with `effect@4.0.0-rc.118` installed over the pin fails `prisma deploy` with `CLI.CONFIG_UNREADABLE`, exit code 2, and `prisma --version` still exits 0.
- [ ] The packed tarball of `@prisma/composer-cli` from `main` declares no `bin`, and a search for `prisma-composer` over the packed tarballs of `@prisma/composer` and `@prisma/composer-cli` finds no command or config-file reference.
- [ ] The CI check in prisma/composer exists, fails on a planted `prisma-composer deploy` in a guide, and passes on `main`.
- [ ] TML-3340 is Done with a closing comment linking the PRs. The two prisma/web pages that name the old config file are updated.
- [ ] The consolidation plan in this repo says `deploy` and `dev` stay bare.
- [ ] Final retro run, the Composer ADR merged, and this folder deleted.

## Deferred

- **Command-line teardown and logs.** `destroy --stage X | --production` and `log` have no `prisma` equivalent. The consolidation plan maps them to `branch delete` and `service logs`; `--production` is not a concept in Composer's model or the plan's. This is its own project against the plan's grammar. Until then the programmatic operations in `@prisma/composer/control` are the documented path.
- **Dropping the `effect` pin and the package-resolution CI script.** Possible once `effect` 4.0.0 is stable or Alchemy pins its `effect` peer. Will raised this with Sam Goodwin, Alchemy's maintainer, on 2026-09-30.
- **The entry module in the config.** The consolidation plan discovers the deploy entry through `prisma.config.ts` instead of a positional argument. Not needed for one config file.

## References

- Brief that started this project: the GA plan on branch `planning/prisma-8-ga`, `planning/plan.md` foundations item 2, and `planning/context.md` § "One CLI and one config file: what was found".
- Linear: TML-3340, "Composer docs and the shipped agent skill tell users to run the standalone `prisma-composer` CLI instead of `prisma`".
- Earlier plan: [`projects/consolidate-clis/`](../consolidate-clis/), in particular `cli-consolidation-plan.md` § "Evaluating the config never errors" and the Composer row of the rename table.
- prisma/composer: `packages/0-framework/3-tooling/cli/src/{load-config.ts,check-effect-resolution.ts,bin.ts,cli.ts,family/}`, `packages/9-public/composer-cli/package.json`, `packages/0-framework/1-core/core/src/control/app-config.ts`, `docs/design/90-decisions/ADR-0017-control-plane-loads-through-the-app-config.md`, `scripts/check-npm-effect-resolution.mjs`, `scripts/check-family-static-graph.mjs`, `scripts/check-cli-engine-pin.mjs`.
- prisma/prisma-cli: `packages/cli-engine/src/{command-family.ts,config-section.ts,config-loader.ts,execution/needs.ts}`, `packages/cli/src/cli.ts`, `packages/cli/tests/composer-isolation.test.ts`, `docs/product/command-principles.md`.
- This repo: `packages/1-framework/3-tooling/config-loader/src/orm-section.ts`.
