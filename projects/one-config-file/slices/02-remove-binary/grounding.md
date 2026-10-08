# Slice 2 grounding: remove the `prisma-composer` binary and its name

> Read-only survey of `wip/composer` on branch `one-config-file/composer-section` (HEAD `e83bab65`, 21 commits ahead of `origin/main` `edaf7b27`), plus prisma/prisma-cli `main` at `4d254ff` (2026-09-30). Paths are relative to the prisma/composer checkout unless they start with `prisma-cli:`. `CLI` below means `packages/0-framework/3-tooling/cli`.

Slice 1 is already on this branch: `load-config.ts` and `check-effect-resolution.ts` are gone, `composer-config.ts` holds the section check, and `CONFIG.FILE_RETIRED` / `CONFIG.FIELD_RETIRED` exist.

## 1. Files that exist for the standalone binary

### Delete outright

| File | What it is | Only used by |
| --- | --- | --- |
| `CLI/src/bin.ts` (1-6) | shebang entry, `process.exitCode = await cli()` | tsdown `bin` entry, `node-compat.test.ts` |
| `CLI/src/cli.ts` (1-73) | `cli()`, `shippedVersion()`, `REPORT_HINT` naming `prisma-composer` | `bin.ts`, `exports/index.ts:5` |
| `CLI/src/family/engine-cli.ts` (1-104) | `BINARY_NAME = 'prisma-composer'` (31), `mountedTree` adds `destroy`/`log` (50-56), `foreignOrmSectionFamily` (65-71), `createComposerCli` (73-83), `runComposerCli` (96-104) | `cli.ts`, `exports/family.ts:12-13`, three test files |
| `CLI/src/family/runtime.ts` | `createRuntime` (Node `process` to engine `Runtime`, env-only credentials, cross-spawn child) | only `engine-cli.ts:29`; the host has its own runtime (`prisma-cli:packages/cli/src/runtime.ts`) |
| `CLI/src/family/commands/destroy.ts` (1-94) | `destroy <entry>` command | `engine-cli.ts:26`, `deploy-destroy.test.ts:25,79` |
| `CLI/src/family/commands/log.ts` (1-109) | `log <entry> [address]` session command | `engine-cli.ts:27` |
| `CLI/src/family/target.ts` (1-37) | `targetOf()`, source of `DEPLOY.TARGET_CONFLICT` / `DEPLOY.TARGET_MISSING` | only `commands/destroy.ts:14,54` |
| `CLI/src/__tests__/node-compat.test.ts` | spawns `node src/bin.ts`; asserts help names `prisma-composer` and lists `destroy <entry>` | CI `node-floor` step, `ci.yml:215-216` |
| `CLI/src/family/__tests__/host-adapter.test.ts` (1-198) | drives `runComposerCli` with a fake host | |
| `CLI/src/family/__tests__/runtime.test.ts` (1-294) | tests `createRuntime`, `detectPackageManager` | |

Test files that are only partly about the binary:

- `CLI/src/family/__tests__/engine-cli.test.ts` (360 lines).
  - `createComposerFamily()` block (61-89) stays. Its `realOperations.destroy` and `.log` asserts (76, 78) go if the seam drops them (see § 2).
  - `createComposerCli()` block (91-124) goes.
  - "composer's Runtime against a real engine run" (126-157) goes: it uses `createRuntime` and `name: 'prisma-composer'`.
  - The section-through-the-engine block (204-360) stays. Its `probeCli` (179-190) mounts `foreignOrmSectionFamily`. The test "a shared config's orm section is recognised and ignored" (342-353) exists only for that pass-through and goes with it.
  - The surviving tests belong in a file named for what they test (for example `section-engine.test.ts`). The name `engine-cli` no longer describes anything.
- `host-adapter.test.ts` 163-197 is the only end-to-end proof that a `prisma-composer.config.ts` beside the declaring file fails before the operation runs. `section.test.ts` 455-533 and `operations.test.ts` 451-500 cover the same rule in-process, so deleting the file loses no rule. Slice 3 covers the host's real loader.
- `CLI/src/family/__tests__/deploy-destroy.test.ts` (418 lines).
  - The header (1-15, 62-66) and the harness line `commands: { ...family.commands, destroy: createDestroyCommand(...) }` (79) change to use the family alone.
  - These destroy-only tests go: 115-122, 147-167, 194-201, the destroy row of the `--json` table (214), 248-255, the destroy signal cases around 317-331, and 395-418.
  - Deploy tests stay. Rename the file to `deploy.test.ts`.

### Shared with the family: keep, fix comments

| File | Kept because | Stale text |
| --- | --- | --- |
| `CLI/src/family/family.ts` | it is the family | header 2-3 ("composer's own CLI or the `prisma` bin"); 20-23 ("remain first-class commands of composer's own bin, mounted on top of the family in engine-cli.ts") |
| `CLI/src/family/converge.ts` | used by `commands/deploy.ts` | 2 "What `deploy` and `destroy` share"; 98 |
| `CLI/src/family/translate-error.ts` | used by `converge.ts` | none |
| `CLI/src/family/workspace.ts` | used by `commands/deploy.ts` | none |
| `CLI/src/family/section.ts`, `commands/deploy.ts`, `commands/dev.ts` | the family | none found |
| `CLI/src/exports/family.ts` | the host imports `createComposerFamily` from it | remove lines 12-13 (`ComposerCliSpec`, `BINARY_NAME`, `createComposerCli`, `runComposerCli`); header 2-3 "and the thin CLI that mounts it" |
| `CLI/src/exports/index.ts` | nothing imports the `@internal/cli` root; only the alias at `tsconfig.depcruise.json:55` names it | line 5 exports `cli`, `shippedVersion`; header line 2 "`bin.ts` is the CLI entrypoint". The whole `.` entry could go |
| `CLI/src/family/__tests__/signal-listeners.test.ts` and `fixtures/signal-listeners.mjs` | they test an alchemy import, not the binary | none |

### Build config and manifests

- `CLI/tsdown.config.ts`: entry `bin: 'src/bin.ts'` (17). The `exports: { ...baseConfig.exports, bin: false }` override (23-26) and comment 3-7 ("@prisma/composer publishes the CLI", already wrong) exist only for the binary and go with it.
- `CLI/package.json:5` description "The `prisma-composer` deploy CLI." The `cross-spawn` dependency stays because `run-alchemy.ts:17` also uses it.
- `tsconfig.depcruise.json:48` alias `@internal/cli/bin` to `src/bin.ts`.
- `packages/9-public/composer-cli/package.json`:
  - The description (5) ends "and the `prisma-composer` CLI." The `bin` block is lines 6-8.
  - `exports` (9-13) has no bin entry already. `files` (14-17) is `["dist", "src"]` and does not involve the binary.
  - The dependencies `alchemy`, `cross-spawn`, `effect` and `esbuild` stay. The family's lazily imported executor chunks are inlined into this package's dist and import them.
- `packages/9-public/composer-cli/tsdown.config.ts`: the second config object (37-56) builds `dist/bin.mjs` from `../../0-framework/3-tooling/cli/dist/bin.mjs`. Delete it and unwrap the array. Comments 4-7 ("the bin must not be importable") and 26-33 go stale.
- `packages/9-public/composer/package.json:5` description ends "The `prisma-composer` CLI lives in @prisma/composer-cli."
- `packages/9-public/composer/tsdown.config.ts:7-8` says "The command family and the `prisma-composer` bin live in @prisma/composer-cli".
- Host constraint: `prisma-cli:packages/cli/tests/fixtures/startup-probe.mjs:37` matches the path `@prisma/composer-cli/dist/family.mjs`. Keep the `family` entry name.

### Scripts that run or reference the binary

| Script | How it uses the binary | Rework |
| --- | --- | --- |
| `scripts/check-cli-engine-pin.mjs` | `BIN = 'bin.mjs'` (66-67); requires the packed tarball to contain `dist/bin.mjs` (191-194) and requires that file to import the engine (183-190); header 14-16, 39-41 | delete the two bin checks and the constant. The whole-dist check (175-182) still proves the engine stays external, through `family.mjs` |
| `scripts/check-family-static-graph.mjs` | `CHECKS` entry for `dist/bin.mjs` (77-88); header 2-3; OK message 241 | delete the entry; fix the header and the message |
| `scripts/check-npm-effect-resolution.mjs` | `runCli` spawns `node_modules/.bin/prisma-composer` (226-237). `assertCliStarts` requires `--help` to list `deploy`, `destroy`, `dev` and `log <entry>` (244-263). The adversarial shape requires `--help` to survive a broken tree (380-392). Header 29-36 | replace both with a child `node` process that imports `@prisma/composer-cli/family`. In healthy trees it checks that `createComposerFamily().commands` is `deploy` and `dev`. In the broken tree it checks that the import still succeeds. That keeps the proof that start-up survives a broken tree, without a binary |
| `scripts/check-floor-imports.mjs` | comment only (7-12). It walks `exports`, which never had `bin` | fix the comment |
| `scripts/destroy-guard.sh` | `bun node_modules/.bin/prisma-composer destroy "$entry" --name "$stack_name" --production` (20) | `prisma` has no `destroy`, so this needs a programmatic replacement (see "What replaces the binary in CI") |
| `scripts/cold-start-canary.ts:214` | comment "`prisma-composer deploy --name`" | fix the comment |
| `scripts/skill-frontmatter.test.ts:12` | fixture `name: prisma-composer`, a skill name | leave it or rename it; it is not a command |

### Workflows and actions

- `.github/workflows/ci.yml`
  - `node-floor` job: the step "CLI node-compat smoke test (spawns node at src/bin.ts)" (215-216) runs the deleted test. The step "Smoke the published CLI binary" (223-228) runs `packages/9-public/composer-cli/dist/bin.mjs --version` and `--help`. Both go. The floor job keeps `check:floor-imports` (236-237), which imports `./family` and `./testing` on Node 22.18.0.
  - The comment at 232-235 names `prisma-composer deploy`.
  - `platform-tests` (Windows): "Test installed CLI on Windows" (159-161) runs `pnpm --dir test/integration exec bun test`, which spawns the binary (see the next section).
- `.github/actions/deploy-verify-destroy/action.yml`:
  - The Deploy step (45-51) runs `bun node_modules/.bin/prisma-composer deploy module.ts --name ...`.
  - The Destroy step (60-66) calls `scripts/destroy-guard.sh`. The input description at line 15 names the binary.
  - `e2e-deploy.yml` (47, 70, 93, 162) and `cron-keep-awake-canary.yml` (41) use this action.
- `.github/workflows/deploy-docs.yml`:
  - Its Deploy step runs `bun node_modules/.bin/prisma-composer deploy module.ts` (80). The comment at 69 also names the binary.
  - **This workflow runs on every push to main that touches `docs/guides/**`.** Slice 2 edits the guides, so the merge commit itself runs it. It must be reworked in the same PR.
- `.github/ISSUE_TEMPLATE/bug_report.yml:19` "Which package (or the `prisma-composer` CLI)".

**What replaces the binary in CI.**

- `prisma deploy` exists. `prisma@8.0.0-rc.19` is `latest` on npm and has `deploy` and `dev`.
- The published `prisma` pins `@prisma/composer-cli@0.25.0` from npm. Run inside this workspace, it would deploy with the last release of the family, not the code under test. The only fix on that route is a root pnpm override that points `@prisma/composer-cli` at the workspace package.
- `destroy` has no `prisma` command. `destroy-guard.sh` must become a small script over `destroy` from `@prisma/composer/control`. The bare operation falls back to `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID` when no credentials are injected (`operations/shared.ts:40-51`).
- A repo-private script that calls `deploy` and `destroy` from `/control` for both steps avoids the override question entirely.

### Tests that spawn the binary (`test/integration`)

| File | How it uses the binary |
| --- | --- |
| `test/integration/test/spawn-composer.ts` (1-19) | `spawn.sync('prisma-composer', ...)` with `node_modules/.bin` on PATH |
| `test/integration/test/cli.engine-shell.test.ts` | the whole file tests the binary: `--version`, `--help` listing four commands, the name `prisma-composer` |
| `test/integration/test/cli.extension-config.test.ts` | `spawnComposer(['deploy', fixtureEntry])`, to prove real `/control` resolution (45-60) |
| `test/integration/test/local-dev-criteria-4-5.integration.ts` | `CLI_BIN = .../node_modules/.bin/prisma-composer` (46), spawns `dev` (189), `pgrep -f 'prisma-composer dev'` (382) |
| `test/integration/test/local-dev-store.integration.ts` | `CLI_BIN = examples/store/node_modules/.bin/prisma-composer` (99), spawns `dev` (311), `pgrep` (719) |

- `cli.extension-config.test.ts` and the two local-dev proofs test real behaviour, so they need a new driver. Options: the family mounted with `createTestCli` or `createCli` over the real operations, or the `/control` operations called directly.
- `cli.engine-shell.test.ts` has nothing left to prove and goes.
- `test/integration/package.json` already declares a `prisma` devDependency, pinned to **7.9.0** (Prisma 7). Using the `prisma` bin here means changing that pin, which may break whatever uses 7.9.0 today.

## 2. What stays as programmatic API

- `CLI/src/exports/control.ts` is published as `@prisma/composer/control` through `packages/9-public/composer/src/exports/control.ts:1`. These exports stay:
  - `destroy` and the types `DestroyEvent`, `DestroyInput` and `DestroyTarget` (23-28).
  - `log` and the types `LogAttached`, `LogEvent`, `LogInput` and `LogLine` (31-32).
  - The header comment (1-15) is accurate.
- `CLI/src/operations/destroy.ts`, `log.ts`, `execute-log.ts` and `execute-deploy-destroy.ts` stay. Their stale comments:
  - `operations/destroy.ts:3-4` and `operations/deploy.ts:3-4` say "The prisma-composer CLI (main.ts) is a thin renderer over it". `main.ts` does not exist.
  - `operations/deploy.ts:20` says "same contract as `prisma-composer deploy <entry>`".
- `OperationName` (`operations/shared.ts:118`) keeps `'destroy' | 'log'`.
- `ComposerOperations` (`family/family.ts:42-47`) and `realOperations` (49-54) are the family's injection seam, not the programmatic API.
  - Once the `destroy` and `log` commands are gone, nothing reads the `destroy` and `log` members.
  - The host imports only `createComposerFamily` (`prisma-cli:packages/cli/src/cli.ts:10`). It never imports `ComposerOperations`, `realOperations` or `/testing`.
  - Dropping the two members also drops `destroy` and `log` from the control double (`CLI/src/testing/control-double.ts:22-24, 31-33, 41-42, 57-67, 176-217`), which is published as `@prisma/composer-cli/testing`.
  - Recommendation: drop them, because nothing but the deleted commands used them. Keeping them does no harm, but it is dead code.

These tests cover `destroy` and `log` without going through the commands. All of them stay:

- `CLI/src/operations/__tests__/operations.test.ts`:
  - `destroy()`, 769 to about 1050: target to locate, failure cause, teardown order, the `no-local-deploy-state` event.
  - The Windows refusal of `dev` and `log`, 1053-1070.
  - `log()`, 1471-1797: config refusal, merging, address filter, abort, back-pressure, stream failure.
  - "destroy is not reported", 2032.
- `CLI/src/exports/__tests__/control-import.test.ts`: importing `/control` loads no executor. The regex at 31 names `execute-deploy-destroy` and `execute-log`.
- `CLI/src/testing/__tests__/control-double.test.ts` 41 (destroy) and 89-130 (log), only if the double keeps those members.

## 3. `prisma-composer` as a command or config-file name

The search uses the pattern `(?<![.\w-])prisma-composer(?![-\w/])(?!\.map\.json)` over `git ls-files`, excluding `takeaways-for-prisma-composer.md`. It drops `prisma-composer-*` names, the `.prisma-composer/` state directory, directory paths and the map file. "cfg" counts occurrences followed by `.config`. "other" is everything else: almost all commands, with the exceptions noted below.

### In scope

| Area | Occurrences | Files |
| --- | --- | --- |
| `README.md` | 3 (lines 10, 20, 23) | 1 |
| `docs/guides/` | 44: `deploying.md` 22 (3 cfg), `running-locally.md` 12, `getting-started.md` 10 | 3 |
| `skills/` | 9: `prisma-composer-core-concepts/SKILL.md` 8 (2 cfg, at 241 and 245), `README.md` 1 (12) | 2 |
| `skills-contrib/` | 0 | 0 |
| `examples/` | 30: package.json scripts 19, the line-3 comment in 8 `prisma.config.ts` files, `store/README.md` 2 (80-81), `email/scripts/build.ts` 1 (7). No tsconfig hits | 19 |
| `website/` | 5: `package.json` 2 (13-14), `module.ts:6`, `prisma.config.ts:3`, `scripts/verify-deployed.ts:84` | 4 |
| `test/` | 28, in `integration/README.md:11`, `integration/prisma.config.ts:3` and the six `test/integration/test/*` files from § 1 | 9 |
| `packages/` | 71 (29 cfg); detail below | 34 |
| `.github/` | 6: `ISSUE_TEMPLATE/bug_report.yml:19`, `actions/deploy-verify-destroy/action.yml:15,51`, `workflows/ci.yml:235`, `workflows/deploy-docs.yml:69,80` | 4 |
| `scripts/` | 13, listed in § 1 (`skill-frontmatter.test.ts:12` is a skill name) | 6 |
| other root files | 14: `.gitignore:24`, `CONTRIBUTING.md:112`, `SECURITY.md:13,30`, `gotchas.md` 5, `open-chat-port-friction.md` 5 | 5 |
| `.agents/rules/` | 3: `runtime-tsdown-build-isolation.mdc:11`, `workspace-package-not-found.mdc:2,10` | 2 |
| `.drive/` | 14 (2 cfg) | 12 |

`packages/` detail:

- **Config-file mentions that must stay**, because they are the legacy diagnostic:
  - `CLI/src/composer-config.ts` 31, 40, 46, 64, 201.
  - The tests `section.test.ts` (14 hits), `operations.test.ts` 451-499 (6) and `engine-cli.test.ts:248`. `host-adapter.test.ts` 163-191 is deleted anyway.
- **In files being deleted:** `cli.ts` (3), `engine-cli.ts` (3), `node-compat.test.ts` (2), and `engine-cli.test.ts` 130, 146, 155.
- **User-facing messages to rewrite to `prisma`:**
  - The "Generated by `prisma-composer deploy`" header written into users' stack files: `CLI/src/generate-stack.ts:65` and `dev/generate-dev-stack.ts:80`.
  - "`prisma-composer dev` starts it" in `dev-emulators/src/client.ts:19`, asserted by `daemon.test.ts:326,332`.
  - "Set each in the shell you run `prisma-composer dev` from." in `target/src/local-target/preflight.ts:31`, asserted by `local-target-preflight.test.ts:135` and `test/integration/test/local-dev-criteria-4-5.integration.ts:343`.
- **Comments to rewrite to `prisma`:**
  - In the cli package: `CLI/package.json:5`, `operations/deploy.ts:4,20`, `operations/destroy.ts:4`, `family/__tests__/deploy-destroy.test.ts:12`.
  - Elsewhere: `core/src/control/deploy.ts:226`, `lowering/src/compute/artifact.ts:270`, `lowering/src/state/legacy-resources.ts:13`, `target/src/compute.ts:49`, `control/extension.ts:277`, `control/pointer-timestamps.ts:30,67`, `descriptors/compute.ts:366`, `descriptors/shared.ts:87`, `local-target/emulators.ts:10`, `auth/src/auth-options.ts:64` and `email/README.md:151`.
- **Not commands; leave them:** `auth/src/execution/local-schema.ts:94`, a header string in a generated file, and `streams/src/execution/streams-entrypoint.ts:74`, a placeholder account id with the value `'prisma-composer'`.
- **Public package manifests and build config:** `packages/9-public/composer-cli/package.json` 5 and 7, `packages/9-public/composer/package.json:5`, `packages/9-public/composer/tsdown.config.ts:8`.

### Out of scope, counted: `docs/design/`

82 occurrences (27 cfg) in 19 files. The largest are `10-domains/deploy-cli.md` 18, `10-domains/core-model.md` 12, `10-domains/local-dev.md` 9, `ADR-0003` 7, `90-decisions/README.md` 6, `ADR-0024` 5 and `ADR-0041` 4. ADR-0049, this project's ADR, has 3 cfg mentions, all describing the retired file.

### Example package scripts, verbatim

Every example except `bucket` has `deploy` and `destroy` scripts. `env-param` also has `destroy:stage`. `website` has both.

```
examples/auth/package.json:11  "deploy": "pnpm turbo run build --filter @prisma/example-auth... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${AUTH_STACK_NAME:+--name \"$AUTH_STACK_NAME\"} )",
examples/auth/package.json:12  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${AUTH_STACK_NAME:+--name \"$AUTH_STACK_NAME\"} )"
examples/cron/package.json:12  "deploy": "pnpm turbo run build --filter @prisma/example-cron... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${CRON_STACK_NAME:+--name \"$CRON_STACK_NAME\"} )",
examples/cron/package.json:13  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${CRON_STACK_NAME:+--name \"$CRON_STACK_NAME\"} )"
examples/email/package.json:11  "deploy": "pnpm turbo run build --filter @prisma/example-email... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${EMAIL_STACK_NAME:+--name \"$EMAIL_STACK_NAME\"} )",
examples/email/package.json:12  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${EMAIL_STACK_NAME:+--name \"$EMAIL_STACK_NAME\"} )"
examples/env-param/package.json:11  "deploy": "pnpm turbo run build --filter @prisma/example-env-param... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${ENV_PARAM_STACK_NAME:+--name \"$ENV_PARAM_STACK_NAME\"} ${ENV_PARAM_STAGE:+--stage \"$ENV_PARAM_STAGE\"} )",
examples/env-param/package.json:12  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${ENV_PARAM_STACK_NAME:+--name \"$ENV_PARAM_STACK_NAME\"} )",
examples/env-param/package.json:13  "destroy:stage": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --stage \"${ENV_PARAM_STAGE:?ENV_PARAM_STAGE is required}\" ${ENV_PARAM_STACK_NAME:+--name \"$ENV_PARAM_STACK_NAME\"} )"
examples/orm-demo/package.json:9  "deploy": "pnpm turbo run build --filter @prisma/example-orm-demo... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${ORM_DEMO_STACK_NAME:+--name \"$ORM_DEMO_STACK_NAME\"} )",
examples/orm-demo/package.json:10  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${ORM_DEMO_STACK_NAME:+--name \"$ORM_DEMO_STACK_NAME\"} )"
examples/storage/package.json:10  "deploy": "pnpm turbo run build --filter @prisma/example-storage... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${STORAGE_STACK_NAME:+--name \"$STORAGE_STACK_NAME\"} )",
examples/storage/package.json:11  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${STORAGE_STACK_NAME:+--name \"$STORAGE_STACK_NAME\"} )"
examples/store/package.json:10  "deploy": "pnpm turbo run build --filter @prisma/example-store... && ( set -a; . ../../.env; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${STORE_STACK_NAME:+--name \"$STORE_STACK_NAME\"} )",
examples/store/package.json:11  "destroy": "( set -a; . ../../.env; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${STORE_STACK_NAME:+--name \"$STORE_STACK_NAME\"} )"
examples/storefront-auth/package.json:9  "deploy": "pnpm turbo run build --filter @prisma/example-storefront-auth... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${STOREFRONT_STACK_NAME:+--name \"$STOREFRONT_STACK_NAME\"} )",
examples/storefront-auth/package.json:10  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${STOREFRONT_STACK_NAME:+--name \"$STOREFRONT_STACK_NAME\"} )",
examples/streams/package.json:11  "deploy": "pnpm turbo run build --filter @prisma/example-streams... && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${STREAMS_STACK_NAME:+--name \"$STREAMS_STACK_NAME\"} )",
examples/streams/package.json:12  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts --production ${STREAMS_STACK_NAME:+--name \"$STREAMS_STACK_NAME\"} )"
website/package.json:13  "deploy": "pnpm turbo run build --filter composer-docs-website && ( set -a; . \"${PRISMA_DEPLOY_ENV:-../.env}\"; set +a; bun node_modules/.bin/prisma-composer deploy module.ts ${DOCS_STAGE:+--stage \"$DOCS_STAGE\"} )",
website/package.json:14  "destroy": "( set -a; . \"${PRISMA_DEPLOY_ENV:-../.env}\"; set +a; bun node_modules/.bin/prisma-composer destroy module.ts ${DOCS_STAGE:+--stage \"$DOCS_STAGE\"} ${DOCS_STAGE:---production} )"
```

**Dependencies.**

- No example, `website/` or `test/integration` declares `prisma` 8.x or `@prisma/cli`.
- Each declares `@prisma/composer-cli`, which carries the binary today. Each also declares `@prisma/cli-engine@0.6.2`, as a dependency or devDependency.
- `test/integration` declares `prisma@7.9.0`.
- For `prisma deploy` to work in a script, the example needs `prisma@8.0.0-rc.19`: package `prisma`, bin `prisma`. `@prisma/cli` is a different package whose bin is `prisma-cli`.

Two problems follow:

1. The published `prisma` depends on exactly `@prisma/composer-cli@0.25.0` (`prisma-cli:packages/prisma/package.json`). Inside the workspace it would mount the npm release of the family, not the workspace one, unless a root `pnpm.overrides` entry redirects it.
2. `destroy` and `destroy:stage` have no `prisma` equivalent. They must either be deleted or become package scripts over `destroy` from `@prisma/composer/control`. The spec's rule is that docs name only commands the released `prisma` has. Under that rule a package script named `destroy` that calls a private script is allowed, but the docs must not present it as a `prisma` command.

Every script runs the binary under Bun (`bun node_modules/.bin/prisma-composer ...`). The action's comment (`action.yml:47-48`) explains why: Load imports service modules that use Bun APIs. The `prisma` bin has a `#!/usr/bin/env node` shebang (`prisma-cli:packages/prisma/src/bin.ts:1`), so the scripts must keep the `bun` prefix (`bun node_modules/.bin/prisma deploy module.ts`). A bare `prisma deploy` would load the entry under Node.

## 4. Guide and skill wording about `destroy` and `log`

prisma/composer has **no** wording saying the unified CLI lacks destroy or log. `rg -i unified` over `docs/guides`, `skills`, `README.md` and `website` finds nothing. That wording exists only in prisma/web, per the spec. The guides and the skill today present `destroy` and `log` as first-class `prisma-composer` commands:

- `docs/guides/deploying.md`:
  - The opening (3-7) says "One CLI, two commands", including "`prisma-composer destroy` tears an environment down".
  - Table rows 14-15 show `destroy --stage` and `destroy --production`.
  - "## Destroying" (161-176) says `destroy` requires `--stage` or `--production` and explains what each does to deploy state.
  - "## CI" (178-185) shows the per-PR pattern with `deploy` and `destroy --stage`.
  - Line 350 names `prisma-composer dev --fresh`.
- `docs/guides/deploying.md` "## Driving deploys from code" (366 to about 450) already documents the programmatic operations:
  - "`@prisma/composer/control`: typed `deploy`, `destroy`, `dev`, and `log` operations" (367-369), followed by "The `prisma-composer` commands are thin renderers over these same operations" (370-371).
  - A `deploy` example (373-392).
  - Bullets on `config: { value, file }` (396-409), on "`destroy` takes a discriminated target — `{ kind: 'production' }` or `{ kind: 'stage', stage }`" (410-412), on the result shape (413-426), on the `dev` session (436-440), and on `log` resolving to `{ appName, services, lines }` (441 onward).
  - This is the section the sweep should point `destroy` and `log` readers at, after adding a `destroy` example and a `log` example.
- `docs/guides/running-locally.md`: the opening (5-7) says "A second command, `prisma-composer log`". Table rows 11-15 include three `log` rows. "## Logs" (70-98) covers `log module.ts`, one service and `--tail`.
- `docs/guides/getting-started.md`:
  - `dev` at 290.
  - Sample output at 300 includes `[dev] logs: prisma-composer log module.ts`. The current `dev` command never prints this: `family/commands/dev.ts` has no such text and reports `status: ready`. The sample is stale whatever the command name.
  - `log` at 311-312; `pnpm exec prisma-composer deploy` at 356 and 398; `destroy --stage demo` at 399; links at 458-459.
- `skills/prisma-composer-core-concepts/SKILL.md`:
  - Line 12: the description's triggers include "the `prisma-composer` CLI".
  - Lines 18-27: the intro says an app is "handed to the `prisma-composer` CLI" and "Commands named here belong to the `prisma-composer` CLI itself; a host CLI that embeds Composer may not carry every verb".
  - Line 90: the `.js` import mapping is credited to the `prisma-composer` CLI. `load-entry.ts` does the mapping, so it is also true under `prisma`.
  - Lines 305-314: "**Destroy** always requires an explicit target" reads as a command.
  - Line 322: "Deploy and destroy write ... stack file".
  - Lines 364-377: "**Driving deploys from code**" covers the programmatic operations with the same facts as the guide, but no example.
  - Lines 391-393: item 3 of "## Local development" says "`log` is a separate, read-only command".
  - Line 469: failure mode 1 starts "Every `prisma-composer` command stops with `CLI.CONFIG_UNREADABLE`".
  - Lines 525-527: item 1 of "What Composer doesn't do yet" says "No interactive auth in the `prisma-composer` CLI ... there is no `login` flow". Line 296 in the credentials paragraph says "There is no interactive login." Both are false for `prisma`, which has auth commands (`prisma-cli:packages/cli/src/commands/auth/`).
- `skills/README.md:12` says "deploying (`prisma-composer deploy`, stages, destroy)".
- `README.md:162`, a table row, says "Stages, destroy, CI".

## 5. Releasing

- The root version on this branch and on `origin/main` is **0.25.0** (last line of `package.json`). On npm, `@prisma/composer-cli` has `latest` 0.25.0 and `dev` 0.25.0-dev.3.
- `pnpm bump-minor` (`scripts/bump-minor.ts`):
  - It reads the root version at `HEAD` with `git show HEAD:package.json` (30-44) and computes the next minor, 0.25.0 to 0.26.0.
  - It then runs `scripts/set-version.ts <next>` (55-59) and `pnpm install --lockfile-only` (61-66).
  - Because it reads `HEAD`, run it after everything else is committed.
- `scripts/set-version.ts`:
  - It writes the version into **every** package that `pnpm list -r --json` lists: the workspace root and every private and public package (45-61). It also rewrites internal `workspace:` specifiers (`rewriteWorkspaceDeps`).
  - It stamps `metadata.library_version` into every `skills/*/SKILL.md` (63-78).
  - On this branch, 41 of the 46 tracked `package.json` files carry 0.25.0. The other 5 are samples under `docs/design/04-inspirations/**`, outside the workspace.
  - So a bump touches 41 manifests, `pnpm-lock.yaml` and `SKILL.md`.
- `publish.yml` runs on every push to `main` (20-22):
  - `scripts/determine-version.ts` compares the root version with the one at the commit before the push (header 11-21). If it changed, the version is `<base>` with dist-tag `latest`, plus a `devVersion` follow-up. If not, the version is `<base>-dev.N` with tag `dev`.
  - Then it runs `set-version.ts`, `pnpm build`, `check:publish-deps`, `check:cli-engine-pin`, `check:skill-packaging`, `check:family-static-graph` and `check:npm-effect-resolution` (82-115).
  - Then `publish-packages.mjs` (127-131) and, for `latest`, a GitHub Release (153-173).
  - Finally "Notify prisma-cli" (175-189) sends a `product-published` repository dispatch naming `@prisma/composer-cli` and the version. It is skipped when `DEPLOY_GITHUB_TOKEN` is not set.
  - The publish job runs the same pin, static-graph and effect-resolution scripts that § 1 rewrites. A missed `bin.mjs` reference therefore fails the release, not only CI.
- The maintainer procedure is `skills-contrib/publish-npm-version/SKILL.md` together with `docs/oss/versioning.md`. It puts the bump in its own `chore(release): v<version>` PR. Slice 2 folds the bump into the feature PR instead. The mechanism allows that, because it only compares root versions.

## 6. Existing source-text checks and where a new one fits

- The closest model is `scripts/lint-framework-vocabulary.mjs` (136 lines) with `scripts/lint-framework-vocabulary.test.mjs` (96 lines).
  - The script exports a pure `findVocabularyViolations(baseDir, table)`. It walks directories with an extension allowlist and a list of excluded directories.
  - It prints `file:line: term: text` for each violation and exits 1.
  - It takes an optional root argument for tests, and runs `main()` only when invoked directly.
  - The test uses `node:test` and a temporary fixture tree, and also spawns the script.
- Wiring:
  - The root `package.json` script `lint:deps` chains `depcruise ... && node scripts/lint-architecture-coverage.mjs && node scripts/lint-publishable-location.mjs && node scripts/lint-framework-vocabulary.mjs && node scripts/lint-orm-pins.mjs && node scripts/lint-contract-snapshots.mjs`.
  - CI runs it in job `lint` ("Lint"), step "Lint (dependency-cruiser — domain/layer/plane boundaries, ADR-0028)" (`ci.yml:28-29`).
  - Script tests run through `test:scripts` (`node --test scripts/*.test.mjs scripts/*.test.ts`), in job `test`, step "Test scripts (cast-ratchet unit tests)" (`ci.yml:107-108`), and in `node-floor` (219-220).
- Other checks:
  - `check-skill-packaging.mjs` packs `@prisma/composer` and compares the packed skill with `skills/` byte for byte. It runs in job `cli-engine-pin` (`ci.yml:304-305`) and in `publish.yml:103-104`.
  - `lint-casts.mjs` runs in job `cast-ratchet`.
  - `check-orm-pins.mjs` checks that ORM-family version pins agree.
- The house style fits a new `scripts/lint-no-standalone-cli.mjs` (name open) with a `.test.mjs`, appended to `lint:deps`.
  - Its scope, from the spec: `README.md`, `docs/guides/**`, `skills/**` and `examples/**` (READMEs, package.json scripts, sources and comments). Arguably `website/**` too.
  - It must allow the legacy-diagnostic text. `docs/guides/deploying.md` 63, 70 and 404 and `SKILL.md` 241 and 245 name `prisma-composer.config.ts` on purpose, to tell users the file is retired.
  - Two options: the check allows the config-file name on specific lines or in a migration section, or those passages describe the file without its literal name. Spec requirement 8 says the check "fails on either string in those files", so this decision needs to be recorded.

## 7. Editing the shipped skill

- `skills/README.md:62-90` sets the rules:
  - Verify every claim while drafting, against a `packages/9-public/*` export map or the CLI source. If ripgrep finds nothing, list the item under "What Composer doesn't do yet".
  - Stay self-contained: no link may resolve outside `skills/prisma-composer-core-concepts/`, and repo docs are named in prose only.
  - Teach concepts, not procedures.
  - Leave `metadata.library` and `metadata.library_version` alone.
  - The folder name must equal the frontmatter `name`.
  - Maintainer skills live in `skills-contrib/`.
- `.agents/rules/user-facing-surface-changes.mdc` (alwaysApply) requires a user-facing change to update `docs/guides/` **and** the skill in the same PR. The guides are canonical and the skill mirrors them. Editing a guide redeploys the docs site through `deploy-docs.yml` (see § 1).
- `packages/9-public/composer/skills/` is a staged copy. Do not edit or commit it.
  - It is **gitignored** (`.gitignore:61-64`).
  - `prepack` (`node ../../../scripts/stage-skills.mjs`, package.json:31) rebuilds it from scratch on every `pnpm pack` or `pnpm publish`, taking the skills whose `metadata.library` is `@prisma/composer`.
  - `check:skill-packaging` proves the packed copy matches `skills/`.

## 8. The prisma-cli host (`main` at `4d254ff`)

- The host's published bin is the package `prisma` (`packages/prisma/package.json`): version 8.0.0-rc.19, bin `prisma` pointing at `./dist/prisma.js`, and an `./config` export. `packages/cli` is `@prisma/cli`, whose bin is `prisma-cli`. Both depend on exactly `@prisma/composer-cli: "0.25.0"`. `packages/cli` also has `@prisma/composer: "0.25.0"` as a devDependency.
- The host source imports one thing from Composer: `import { createComposerFamily } from "@prisma/composer-cli/family"` (`packages/cli/src/cli.ts:10`).
  - It becomes `composerCommandFamily` (141), is mounted at the root as `deploy` and `dev` (415-416), and is listed in `commandFamilies` (460).
  - The host never imports `/testing`, `ComposerOperations`, `realOperations`, `composerSection`, `toEngineError`, `BINARY_NAME`, `createComposerCli` or `runComposerCli`.
- Other Composer references in the host:
  - `packages/cli/scripts/conformance.ts:62,68,111,114` and `tests/v8-conformance.test.ts:76` require the specifier `@prisma/composer-cli/family`.
  - `tests/fixtures/startup-probe.mjs:29` imports `@prisma/composer/deploy`, and line 37 matches the path `@prisma/composer-cli/dist/family.mjs`.
  - `src/lib/skills/allowlist.ts:20` lists `@prisma/composer` for skill sync.
- `configPath` in the host:
  - `tests/fixtures/config/composer-section.config.ts` contains `composer: { configPath: "./named-by-the-section.config.ts" }`.
  - `tests/bin.test.ts` 36-42 and 506-588 ("hands the composer section of prisma.config.ts to the composer family") expect `CONFIG.FILE_MISSING`.
  - Those tests break on the slice-1 release whether or not slice 2 lands. Slice 3 owns them.
  - Every other `configPath` hit in `packages/cli` is the engine's `--config` path or telemetry, unrelated to Composer.
- `destroy` and `log`: no Composer-related hits. The matches are the platform's own `service delete`, `service logs` and `project delete` commands.
- `prisma-composer`: only `tests/skills-sync.test.ts:179-189, 844-854`, a fixture skill named `prisma-composer`, unrelated to the binary.
- Conclusion: slice 2 deletes nothing the host imports, as long as `./family` keeps exporting `createComposerFamily` and the built file stays `dist/family.mjs`.
