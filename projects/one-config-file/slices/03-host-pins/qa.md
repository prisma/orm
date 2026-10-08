# Slice 3 manual QA: the `prisma` binary against orm-demo

Run on 2026-10-01 on macOS (Darwin 27, Node v26.8.1, bun 1.3.13, pnpm 10.27.0 outside the repo).

## Setup

- Host under test: prisma/prisma-cli branch `one-config-file/composer-0-26` at `2621f1c`, built with `pnpm build`. It pins `@prisma/composer-cli` and `@prisma/composer` to the pkg.pr.new preview of prisma/composer#331 (Composer 0.26.0 at `be95770`).
- Project under test: a copy of Composer's `examples/orm-demo` (branch `one-config-file/remove-binary`, `be95770`) in the session scratchpad, written below as `<qa>`. It is outside every workspace. Its `package.json` declares `@prisma/composer` and `@prisma/composer-prisma-cloud` as the `@331` preview URLs, `prisma` as `link:` to the branch's `packages/prisma`, and the example's other dependencies unchanged. Its own `pnpm-workspace.yaml` sets `blockExoticSubdeps: false` (the preview packages depend on `@prisma/composer` by URL) and allows the esbuild build script. `tsconfig.json` is standalone because the example's extends the Composer workspace's base config.
- The app was built with `pnpm build` (bun) before running `dev`.
- `PRISMA_DISABLE_TELEMETRY=1` throughout. No `PRISMA_SERVICE_TOKEN` was set in the environment, and none was used.
- stdout is not a TTY, so results print as JSON frames; steps 3 to 5 also show `--format human`.

## Summary

| Step | Expected | Observed |
| --- | --- | --- |
| 1 | `--version` 0; `deploy --help`, `dev --help` 0 with no `destroy` or `log`; root help lists `deploy` and `dev` | As expected. The only "log" in help output is the `--log-level` global flag and the `service` group's "Logs". |
| 2 | `prisma dev module.ts` starts against the `composer` section | First run failed with `DEPLOY.ALCHEMY_BIN_MISSING` (see finding). With `alchemy` added as a direct dev dependency: `status: ready`, endpoint `widgets` at `http://localhost:3019`, SIGINT gives exit 130 with an ok result. |
| 3 | old file restored: `CLI.CONFIG_SECTION_INVALID` + `CONFIG.FILE_RETIRED`, exit 2 | As expected. |
| 4 | `composer: { configPath: './x.ts' }`: `CONFIG.FIELD_RETIRED` | As expected, exit 2, `meta.field: "configPath"`. |
| 5 | `effect@4.0.0-rc.118` forced: `CLI.CONFIG_UNREADABLE` naming a missing `effect` module, exit 2; `--version` exits 0 | As expected. After removing the override and reinstalling, `dev` reached ready again. |
| 6 | no service token used | No token was present; the `deploy` path was not exercised against the cloud. |

## Findings

1. **`alchemy` bin not found in a plain pnpm project.** Composer resolves the `alchemy` executable from the nearest `node_modules/.bin`, walking up. pnpm links bins only for direct dependencies, and `alchemy` is a dependency of `@prisma/composer`, not of the app. A project set up with the install commands of Composer's getting-started guide therefore has no `node_modules/.bin/alchemy`, and `prisma dev` fails after the emulators start. This is not caused by this project (the lookup in `run-alchemy.ts` predates it) and the Composer workspace hides it because its `.npmrc` sets `node-linker=hoisted`, which puts every bin in the root `node_modules/.bin`. It is a Composer defect to raise separately; the QA continued with `alchemy@2.0.0-beta.78` added as a direct dev dependency.
2. **Emulators were already running.** The compute (`127.0.0.1:4303`) and postgres (`127.0.0.1:4304`) emulators answering this run were started on 2026-09-30 from the Composer workspace by another session; `dev` attached to them. They were left running. The converge itself (alchemy, the ORM migration and the service) ran from the copy.

## Transcript

### 1. Version and help

```
$ prisma --version
{"kind":"result","envelope":{"ok":true,"commandId":"version","result":{"version":"8.0.0-rc.19"},"exitCode":0,"diagnostics":[],"nextActions":[]},"commandId":"version","timestamp":"2026-10-01T05:43:04.622Z"}
exit=0
$ prisma deploy --help
prisma deploy → Deploy the application whose root node is <entry>'s default export.

│  Usage
│    $ prisma deploy [options] <entry>
│
│  Arguments
│  entry  The file whose default export is the application root module, built with module(...).
│
│  Options
│      --name <name>    Override the root node's name — the deploy's application name.
│      --stage <stage>  Deploy scope to target; omit for production.
│      --report <path>  Write the deploy's outcome as JSON to this path — resources, preview URLs, and the failure cause. Also settable as PRISMA_COMPOSER_REPORT_FILE.
│      --build-id <id>  Join the deploy record your CI already created rather than letting the target create one. Each target also reads its own environment variable for this; the flag wins.
│
│  Global options also apply: --format, --json, --log-level, --verbose,
│  --quiet, --yes, --confirm, --interactive, --color, --config. Run 'prisma
│  --help' for details.
│
│  Examples
│    $ prisma deploy module.ts
│    $ prisma deploy module.ts --stage feat-auth
│
│  Docs  https://www.prisma.io/docs/cli/error-reference/

Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=0
$ prisma dev --help
prisma dev → Bring up the application whose root node is <entry>'s default export, entirely on this machine.

│  Usage
│    $ prisma dev [options] <entry>
│
│  Runs credential-free and watches the app for changes, reconverging on every
│  edit.
│
│  Arguments
│  entry  The file whose default export is the application root module, built with module(...).
│
│  Options
│      --name <name>  Override the root node's name — the dev instance's application name.
│      --fresh        Destroy the dev stack and wipe the dev state directory before starting.
│
│  Global options also apply: --format, --json, --log-level, --verbose,
│  --quiet, --yes, --confirm, --interactive, --color, --config. Run 'prisma
│  --help' for details.
│
│  Examples
│    $ prisma dev module.ts
│    $ prisma dev module.ts --fresh
│
│  Docs  https://www.prisma.io/docs/cli/error-reference/

Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=0
$ prisma --help   (command list excerpt)
│  auth                Manage authentication for the Prisma Platform. Sign in and out, inspect identity, switch workspaces
│  service             Manage deployed services. Logs, versions, promote and rollback releases, custom domains
│  deploy <entry>      Deploy the application whose root node is <entry>'s default export.
│  dev <entry>         Bring up the application whose root node is <entry>'s default export, entirely on this machine.
│  init                Prepare this repository for Prisma: config file, dev dependency, AI-agent skills
│  skills              Manage Prisma skills for AI coding agents. Sync and list the instruction files
exit=0
```

### 2. `prisma dev module.ts`

First attempt, before adding `alchemy` as a direct dependency:

```
[+2.8s] stdout: [dev] compute emulator ready at http://127.0.0.1:4303
[+2.8s] stdout: [dev] postgres emulator ready at http://127.0.0.1:4304
[+2.8s] stdout: {"kind":"result","envelope":{"ok":false,"commandId":"dev","error":{"code":"DEPLOY.ALCHEMY_BIN_MISSING","severity":"error","summary":"Could not find an installed `alchemy` bin above \"<qa>\".","nextActions":[{"kind":"user-choice","label":"Add \"alchemy\" as a dependency of your app."}],"docsUrl":"https://www.prisma.io/docs/cli/error-reference/DEPLOY.ALCHEMY_BIN_MISSING"},"diagnostics":[],"nextActions":[{"kind":"user-choice","label":"Add \"alchemy\" as a dependency of your app."}]},"commandId":"dev","timestamp":"2026-10-01T05:43:29.632Z"}
[+2.8s] QA: ready seen, sending SIGINT
[+2.8s] stderr: Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
[+2.9s] QA: exit code=2 signal=null
```

With `alchemy@2.0.0-beta.78` in `devDependencies` (the QA script sends SIGINT 3 seconds after the first ready signal; the first line it matched was the emulator line):

```
[+3.5s] stdout: [dev] compute emulator ready at http://127.0.0.1:4303
[+3.5s] stdout: [dev] postgres emulator ready at http://127.0.0.1:4304
[+3.5s] QA: ready seen, sending SIGINT
[+6.5s] stderr: alchemy 2.0.0-beta.79 is available (you're on 2.0.0-beta.78). Run `pnpm add alchemy@2.0.0-beta.79` to upgrade.
[+6.5s] stderr: [07:44:10.154] INFO (#1): Deploy · dev
[+6.5s] stderr: [07:44:10.154] INFO (#1): Importing stack module
[... alchemy plan and create lines elided ...]
[+17.9s] stdout: {"kind":"status","subject":"dev","status":"ready","commandId":"dev","timestamp":"2026-10-01T05:44:21.583Z"}
[+17.9s] stdout: {"kind":"endpoint","name":"widgets","url":"http://localhost:3019","commandId":"dev","timestamp":"2026-10-01T05:44:21.583Z"}
[+17.9s] stdout: {"kind":"step-started","step":"Stopping the app's services — emulators and data stay up","id":"dev-stop","commandId":"dev","timestamp":"2026-10-01T05:44:21.598Z"}
[+17.9s] stdout: {"kind":"step-finished","step":"Stopping the app's services — emulators and data stay up","id":"dev-stop","outcome":"ok","commandId":"dev","timestamp":"2026-10-01T05:44:21.613Z"}
[+17.9s] stdout: {"kind":"result","envelope":{"ok":true,"commandId":"dev","result":null,"exitCode":130,"diagnostics":[],"nextActions":[]},"commandId":"dev","timestamp":"2026-10-01T05:44:21.613Z"}
[+18.0s] stderr: Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
[+18.0s] QA: exit code=130 signal=null
```

### 3. `prisma-composer.config.ts` restored from Composer `origin/main`

The file restored is `examples/orm-demo/prisma-composer.config.ts` from `origin/main` (`edaf7b27`), beside `<qa>/prisma.config.ts`. Removed afterwards.

```
$ prisma dev module.ts
{"kind":"result","envelope":{"ok":false,"commandId":"dev","error":{"code":"CLI.CONFIG_SECTION_INVALID","severity":"error","summary":"The 'composer' section of <qa>/prisma.config.ts is invalid.","nextActions":[{"kind":"user-choice","label":"Fix the reported problems in that section, then run the command again."}],"docsUrl":"https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID"},"diagnostics":[{"code":"CONFIG.FILE_RETIRED","severity":"error","summary":"<qa>/prisma-composer.config.ts is no longer read.","why":"Composer reads its configuration only from the `composer` section of prisma.config.ts.","nextActions":[{"kind":"edit-file","label":"Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file."}],"where":{"path":"<qa>/prisma-composer.config.ts"},"docsUrl":"https://www.prisma.io/docs/cli/error-reference/CONFIG.FILE_RETIRED"}],"nextActions":[{"kind":"user-choice","label":"Fix the reported problems in that section, then run the command again."}]},"commandId":"dev","timestamp":"2026-10-01T05:44:50.154Z"}
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
$ prisma dev module.ts --format human
✘ [CLI.CONFIG_SECTION_INVALID] The 'composer' section of <qa>/prisma.config.ts is invalid.
→ Fix the reported problems in that section, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID

✘ [CONFIG.FILE_RETIRED] <qa>/prisma-composer.config.ts is no longer read.
  why: Composer reads its configuration only from the `composer` section of prisma.config.ts.
→ Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file.
  docs: https://www.prisma.io/docs/cli/error-reference/CONFIG.FILE_RETIRED
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
```

### 4. `composer: { configPath: './x.ts' }` in place of the section

`prisma.config.ts` restored afterwards and checked identical to the example's.

```
$ prisma dev module.ts
{"kind":"result","envelope":{"ok":false,"commandId":"dev","error":{"code":"CLI.CONFIG_SECTION_INVALID","severity":"error","summary":"The 'composer' section of <qa>/prisma.config.ts is invalid.","nextActions":[{"kind":"user-choice","label":"Fix the reported problems in that section, then run the command again."}],"docsUrl":"https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID"},"diagnostics":[{"code":"CONFIG.FIELD_RETIRED","severity":"error","summary":"`composer.configPath` is no longer supported: prisma-composer.config.ts is no longer read.","why":"Composer reads its configuration only from the `composer` section of prisma.config.ts.","nextActions":[{"kind":"edit-file","label":"Replace `configPath` with the section itself. Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file."}],"where":{"path":"<qa>/prisma.config.ts"},"meta":{"field":"configPath"},"docsUrl":"https://www.prisma.io/docs/cli/error-reference/CONFIG.FIELD_RETIRED"}],"nextActions":[{"kind":"user-choice","label":"Fix the reported problems in that section, then run the command again."}]},"commandId":"dev","timestamp":"2026-10-01T05:45:06.404Z"}
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
$ prisma dev module.ts --format human
✘ [CLI.CONFIG_SECTION_INVALID] The 'composer' section of <qa>/prisma.config.ts is invalid.
→ Fix the reported problems in that section, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID

✘ [CONFIG.FIELD_RETIRED] `composer.configPath` is no longer supported: prisma-composer.config.ts is no longer read.
  why: Composer reads its configuration only from the `composer` section of prisma.config.ts.
→ Replace `configPath` with the section itself. Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file.
  docs: https://www.prisma.io/docs/cli/error-reference/CONFIG.FIELD_RETIRED
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
```

### 5. `effect@4.0.0-rc.118` forced with `"pnpm": { "overrides": { "effect": "4.0.0-rc.118" } }`

```
$ prisma dev module.ts --format human
✘ [CLI.CONFIG_UNREADABLE] <qa>/prisma.config.ts could not be evaluated: Cannot find module '<qa>/node_modules/.pnpm/alchemy@2.0.0-beta.78_@effect+platform-bun@4.0.0-rc.115_effect@4.0.0-rc.118__@effect+pl_5d4a1a38375990aceac4de393ff3908a/node_modules/effect/dist/unstable/http/FetchHttpClient.js'
→ Fix the error in the file, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_UNREADABLE
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
$ prisma dev module.ts
{"kind":"result","envelope":{"ok":false,"commandId":"dev","error":{"code":"CLI.CONFIG_UNREADABLE","severity":"error","summary":"<qa>/prisma.config.ts could not be evaluated: Cannot find module '<qa>/node_modules/.pnpm/alchemy@2.0.0-beta.78_@effect+platform-bun@4.0.0-rc.115_effect@4.0.0-rc.118__@effect+pl_5d4a1a38375990aceac4de393ff3908a/node_modules/effect/dist/unstable/http/FetchHttpClient.js'","nextActions":[{"kind":"user-choice","label":"Fix the error in the file, then run the command again."}],"where":{"path":"<qa>/prisma.config.ts"},"docsUrl":"https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_UNREADABLE"},"diagnostics":[],"nextActions":[{"kind":"user-choice","label":"Fix the error in the file, then run the command again."}]},"commandId":"dev","timestamp":"2026-10-01T05:45:58.220Z"}
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
$ prisma --version
{"kind":"result","envelope":{"ok":true,"commandId":"version","result":{"version":"8.0.0-rc.19"},"exitCode":0,"diagnostics":[],"nextActions":[]},"commandId":"version","timestamp":"2026-10-01T05:46:01.661Z"}
exit=0
```

Override removed, `pnpm install` again (the lockfile no longer mentions `rc.118`; alchemy links `effect@4.0.0-rc.115`), then `prisma dev module.ts`:

```
[+3.6s] stdout: [dev] compute emulator ready at http://127.0.0.1:4303
[+3.6s] stdout: [dev] postgres emulator ready at http://127.0.0.1:4304
[+5.9s] stderr: alchemy 2.0.0-beta.79 is available (you're on 2.0.0-beta.78). Run `pnpm add alchemy@2.0.0-beta.79` to upgrade.
[+5.9s] stderr: [07:46:39.248] INFO (#1): Deploy · dev
[+5.9s] stderr: [07:46:39.249] INFO (#1): Importing stack module
[+7.7s] stderr: [07:46:40.982] INFO (#1): Resolving stack services
[+8.1s] stderr: [07:46:41.364] INFO (#1): Loading stack state
[+8.1s] stderr: [07:46:41.395] INFO (#1): Computing plan
[+8.2s] stderr: [07:46:41.465] INFO (#1): Plan ready (2.2s)
[+8.2s] stderr: [07:46:41.474] INFO (#1): Plan: no changes
[+8.2s] stderr: [07:46:41.476] INFO (#1): [COMPOSER_WIDGETS_DB_URL-var] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [COMPOSER_WIDGETS_ORIGIN-var] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [COMPOSER_WIDGETS_PORT-var] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [database-conn] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [database-db] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [database-migrate] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [database-warm] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [widgets-deploy] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): [widgets-svc] noop
[+8.2s] stderr: [07:46:41.477] INFO (#1): 
[+8.2s] stderr: [07:46:41.505] INFO (#1): 
[+8.2s] stderr: [07:46:41.505] INFO (#1): Done: 0 succeeded (27ms)
[+8.6s] stdout: {"kind":"status","subject":"dev","status":"ready","commandId":"dev","timestamp":"2026-10-01T05:46:41.924Z"}
[+8.6s] stdout: {"kind":"endpoint","name":"widgets","url":"http://localhost:3019","commandId":"dev","timestamp":"2026-10-01T05:46:41.924Z"}
[+8.6s] QA: ready seen, sending SIGINT
[+11.6s] stdout: {"kind":"step-started","step":"Stopping the app's services — emulators and data stay up","id":"dev-stop","commandId":"dev","timestamp":"2026-10-01T05:46:44.944Z"}
[+11.7s] stdout: {"kind":"step-finished","step":"Stopping the app's services — emulators and data stay up","id":"dev-stop","outcome":"ok","commandId":"dev","timestamp":"2026-10-01T05:46:44.968Z"}
[+11.7s] stdout: {"kind":"result","envelope":{"ok":true,"commandId":"dev","result":null,"exitCode":130,"diagnostics":[],"nextActions":[]},"commandId":"dev","timestamp":"2026-10-01T05:46:44.968Z"}
[+11.7s] stderr: Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
[+11.7s] QA: exit code=130 signal=null
```

### 6. Credentials

`PRISMA_SERVICE_TOKEN` was not set in the environment. `prisma deploy` checks credentials before it evaluates the config, so the deploy path was not exercised against Prisma Cloud; the `effect` case is proven through `dev` only.


## Against the published 0.26.0 (2026-10-05)

### Setup

- Host under test: prisma/prisma-cli `one-config-file/composer-0-26` at `3e711a9` (rebased onto `origin/main`), pinning `@prisma/composer-cli` and `@prisma/composer` at `0.26.0` from the registry, built with `pnpm build`.
- Project under test: a fresh copy of `examples/orm-demo` at `<qa>` (the session scratchpad, outside every workspace; the earlier `qa-orm-demo` copy was in use by another task, so this is a new one). `@prisma/composer` and `@prisma/composer-prisma-cloud` at `0.26.0` from the registry, `prisma` as `link:` to the branch's `packages/prisma`, other dependencies as before. Its `pnpm-workspace.yaml` only allows the esbuild build script; no URL-dependency setting is needed any more. `prisma.config.ts` is identical to the example's.
- `PRISMA_DISABLE_TELEMETRY=1`; no service token in the environment.

### Summary

| Step | Observed |
| --- | --- |
| 1. help | `--version` 8.0.0-rc.19, exit 0. `deploy --help` and `dev --help` exit 0 and list no `destroy` or `log` command. Root help lists `deploy <entry>` and `dev <entry>`. |
| dev to ready | Without `alchemy` as a direct dependency: `DEPLOY.ALCHEMY_BIN_MISSING`, exit 2, as before (Composer's fix is not in 0.26.0). With `alchemy@2.0.0-beta.78` added: `status: ready`, endpoint `widgets` at `http://localhost:3019`, SIGINT gives exit 130 with an ok result. The emulators on 4303/4304 were already running from other sessions and were reused. |
| 3. retired file | `CLI.CONFIG_SECTION_INVALID` with `CONFIG.FILE_RETIRED` naming `<qa>/prisma-composer.config.ts`, exit 2. The file came from Composer `edaf7b27` (it is gone from `main`). |
| 4. retired field | `CLI.CONFIG_SECTION_INVALID` with `CONFIG.FIELD_RETIRED`, exit 2. |
| 5. broken `effect` | `CLI.CONFIG_UNREADABLE` naming the missing `effect/dist/unstable/http/FetchHttpClient.js`, exit 2; `--version` exit 0. Override removed and reinstalled afterwards (the lockfile no longer mentions `rc.118`). |

### Transcript

```
$ prisma --version
{"kind":"result","envelope":{"ok":true,"commandId":"version","result":{"version":"8.0.0-rc.19"},"exitCode":0,"diagnostics":[],"nextActions":[]},"commandId":"version","timestamp":"2026-10-05T13:44:53.441Z"}
exit=0
$ prisma deploy --help
exit=0
lines naming destroy or log as commands: 0
$ prisma dev --help
exit=0
lines naming destroy or log as commands: 0
$ prisma --help | grep deploy/dev
│  deploy <entry>      Deploy the application whose root node is <entry>'s default export.
│  dev <entry>         Bring up the application whose root node is <entry>'s default export, entirely on this machine.
exit=0
```

`prisma dev module.ts` without `alchemy` as a direct dependency:

```
[+1.3s] stdout: [dev] compute emulator ready at http://127.0.0.1:4303
[+1.3s] stdout: [dev] postgres emulator ready at http://127.0.0.1:4304
[+1.3s] stdout: {"kind":"result","envelope":{"ok":false,"commandId":"dev","error":{"code":"DEPLOY.ALCHEMY_BIN_MISSING","severity":"error","summary":"Could not find an installed `alchemy` bin above \"<qa>\".","nextActions":[{"kind":"user-choice","label":"Add \"alchemy\" as a dependency of your app."}…
[+1.3s] QA: exit code=2 signal=null
```

With `alchemy@2.0.0-beta.78` in `devDependencies`:

```
[+5.0s] stdout: {"kind":"status","subject":"dev","status":"ready","commandId":"dev","timestamp":"2026-10-05T13:45:24.048Z"}
[+5.0s] stdout: {"kind":"endpoint","name":"widgets","url":"http://localhost:3019","commandId":"dev","timestamp":"2026-10-05T13:45:24.048Z"}
[+5.0s] QA: ready seen, sending SIGINT
[+8.0s] stdout: {"kind":"result","envelope":{"ok":true,"commandId":"dev","result":null,"exitCode":130,"diagnostics":[],"nextActions":[]},"commandId":"dev","timestamp":"2026-10-05T13:45:27.123Z"}
[+8.1s] QA: exit code=130 signal=null
```

```
$ prisma dev module.ts --format human   (prisma-composer.config.ts from Composer edaf7b27 beside the config)
✘ [CLI.CONFIG_SECTION_INVALID] The 'composer' section of <qa>/prisma.config.ts is invalid.
→ Fix the reported problems in that section, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID

✘ [CONFIG.FILE_RETIRED] <qa>/prisma-composer.config.ts is no longer read.
  why: Composer reads its configuration only from the `composer` section of prisma.config.ts.
→ Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file.
  docs: https://www.prisma.io/docs/cli/error-reference/CONFIG.FILE_RETIRED
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
```

```
$ prisma dev module.ts --format human   (composer: { configPath: './x.ts' })
✘ [CLI.CONFIG_SECTION_INVALID] The 'composer' section of <qa>/prisma.config.ts is invalid.
→ Fix the reported problems in that section, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_SECTION_INVALID

✘ [CONFIG.FIELD_RETIRED] `composer.configPath` is no longer supported: prisma-composer.config.ts is no longer read.
  why: Composer reads its configuration only from the `composer` section of prisma.config.ts.
→ Replace `configPath` with the section itself. Write `composer: composer({ extensions: [...], state: ... })` in prisma.config.ts, with `import { defineConfig as composer } from '@prisma/composer/config'`. If the project has a prisma-composer.config.ts, move its extensions and state into that section and delete the file.
  docs: https://www.prisma.io/docs/cli/error-reference/CONFIG.FIELD_RETIRED
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
```

```
$ prisma dev module.ts --format human   (effect 4.0.0-rc.118 forced by override)
✘ [CLI.CONFIG_UNREADABLE] <qa>/prisma.config.ts could not be evaluated: Cannot find module '<qa>/node_modules/.pnpm/alchemy@2.0.0-beta.78_@effect+platform-bun@4.0.0-rc.115_effect@4.0.0-rc.118__@effect+pl_f8625b128387684846574b9244c214b6/node_modules/effect/dist/unstable/http/FetchHttpClient.js'
→ Fix the error in the file, then run the command again.
  docs: https://www.prisma.io/docs/cli/error-reference/CLI.CONFIG_UNREADABLE
Prisma agent skills are out of date (installed @prisma/orm-postgres 8.0.0-rc.13, synced none). Run: prisma skills sync
exit=2
$ prisma --version
{"kind":"result","envelope":{"ok":true,"commandId":"version","result":{"version":"8.0.0-rc.19"},"exitCode":0,"diagnostics":[],"nextActions":[]},"commandId":"version","timestamp":"2026-10-05T13:45:45.188Z"}
exit=0
```
