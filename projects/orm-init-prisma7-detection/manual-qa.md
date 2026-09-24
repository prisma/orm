# Manual QA: `orm init` on a real Prisma 7 project

Audience: an end user with a Prisma 7 Postgres project who follows the public upgrade guide and runs `prisma orm init` from this branch instead of the guide's hand edits. Runs against the CLI built from this branch, real Prisma 7 packages from npm, and an in-process Postgres from `@prisma/dev`.

Known limitation to record, not a finding: the `latest` release of `@prisma/orm-postgres` (8.0.0-rc.11, published 2026-09-13) predates `prisma7Schema` (PR #30287, merged 2026-09-16). Init's schema check therefore finds no Prisma 7 source in the package it installs, and S4 expects `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`. S4b exercises the success path with the package's `dev` build installed beforehand and `--skip-install`.

## Setup

1. Build the CLI from this branch: `pnpm --filter @internal/config-loader build && pnpm --filter @internal/cli build`. The binary is `packages/1-framework/3-tooling/cli/dist/bin.mjs`; run it as `node <abs path> ...`.
2. Create `wip/qa/prisma7-app/` (not a workspace member; install with `pnpm install --ignore-workspace`) as the guide's starting project:
   - `package.json`: `"type": "module"`, scripts `dev: tsx src/index.ts`, `generate: prisma generate`, `migrate: prisma migrate dev`, `migrate:deploy: prisma migrate deploy`, `studio: prisma studio`, `db:start: tsx scripts/db-start.ts`; dependencies `@prisma/client ^7.10.0`, `@prisma/adapter-pg ^7.10.0`, `pg`, `dotenv`; devDependencies `prisma ^7.10.0`, `@prisma/dev` (version from the root `pnpm-workspace.yaml` catalog), `tsx`, `typescript`, `@types/node`, `@types/pg`.
   - `prisma.config.ts`: `import 'dotenv/config'; import { defineConfig } from 'prisma/config'; export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env['DATABASE_URL']! } });`
   - `prisma/schema.prisma`: `generator client { provider = "prisma-client"; output = "../generated/prisma" }`, `datasource db { provider = "postgresql" }`, the guide's `User` (id autoincrement, email unique, name optional, posts) and `Post` (id, title, content optional, published default false, author relation) models.
   - `src/index.ts`: constructs `PrismaClient` from `../generated/prisma/client` with `PrismaPg`, inserts one user if none exist, prints `user count: N`.
   - `scripts/db-start.ts`: copy `examples/prisma7-adoption/scripts/db-start.ts` from `main`. It imports `createDevDatabase` from `@repo/test-utils`, which is not installable outside the workspace; replace that call with `startPrismaDevServer` from `@prisma/dev`, as `test/utils/src/exports/index.ts` does. It starts an in-process Postgres and writes `DATABASE_URL` to `.env`.
   - `tsconfig.json`: `module: nodenext`, `moduleResolution: nodenext`, `strict`, `types: ["node"]`, include `src`, `scripts`, `prisma.config.ts`.
3. `pnpm install --ignore-workspace`. Start the database in the background (`pnpm db:start &`, keep it running for the whole QA), then `pnpm migrate --name init`, `pnpm generate`, `pnpm dev` (expect `user count: 1`).
4. `git init` inside the project and commit everything except `node_modules`, `generated`, `.env`, so `git status` shows exactly what init changes. Also record `find prisma -type f | sort | xargs shasum` to `wip/qa/prisma-before.txt`.

## Scenarios

Record for each: the exact command, exit code, stdout and stderr (save to `wip/qa/logs/<scenario>.log`), and a verdict: pass, finding, or note.

### S1. Non-interactive run without the flag

`node <bin> orm init --skip-install`. Expected: init behaves as today, refuses for missing `--target`/`--authoring` (exit 2), writes nothing (`git status` clean). It must not enter the Prisma 7 path silently.

### S2. Flag conflicts

`node <bin> orm init --from-prisma7-schema prisma/schema.prisma --authoring psl --skip-install` and the same with `--schema-path x.prisma`. Expected: `CLI.INIT_FLAG_CONFLICT`, exit 2, nothing written, message names both flags.

### S3. Consent declined

`node <bin> orm init --from-prisma7-schema prisma/schema.prisma --skip-install` with stdin closed (`< /dev/null`). Expected: the side-by-side consent cannot be answered, init aborts, nothing written, and the message tells the user to pass `--confirm prisma7-app`.

### S4. The real run, JSON

`node <bin> orm init --from-prisma7-schema prisma/schema.prisma --confirm prisma7-app --json`. This installs from npm and spawns the project's `prisma` for emit. Expected:

- With the `latest` `@prisma/orm-postgres`: exit 2, `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE` naming `@prisma/orm-postgres`; the project is unchanged apart from `@prisma/orm-postgres` and `dotenv` in `package.json`, and the printed remove command removes them. Stop S4 here and continue with S4b.

### S4b. The check passes, JSON

On a fresh pre-init copy, install the `dev` build of the target package first: `pnpm add @prisma/orm-postgres@dev dotenv --ignore-workspace`. Then `node <bin> orm init --from-prisma7-schema prisma/schema.prisma --confirm prisma7-app --skip-install --json`. Then install what init lists and run `pnpm prisma contract emit`. Expected:

- `prisma.config.ts` renamed to `prisma7.config.ts` with the import now `@prisma/prisma7/config`; the new `prisma.config.ts` has `contract: prisma7Schema('prisma/schema.prisma')` and `output: 'src/prisma'`.
- `package.json`: scripts `generate`, `migrate`, `migrate:deploy`, `studio` now call `prisma7`; `dev` and `db:start` untouched; `contract:emit` added.
- `src/prisma/db.ts`, `prisma-8.md`, `.env.example` written; `tsconfig.json` merged; `.gitignore` and `.gitattributes` merged.
- `prisma/` identical: `find prisma -type f | sort | xargs shasum` matches `wip/qa/prisma-before.txt`; `generated/` untouched.
- The JSON document: `authoring: "prisma7"`, `filesRenamed` lists the config, `prisma7` block filled, `nextSteps` in the transition order with no cutover step, no warning about an unchecked schema.
- After the installs, `contract emit` writes `src/prisma/contract.json` and `contract.d.ts`.

### S5. Prisma 7 still works after the run

`pnpm prisma7 --version`, `pnpm migrate:deploy` (rewritten script; expect "already in sync"), `pnpm generate`, `pnpm dev` (expect `user count: 1`), `pnpm prisma7 migrate status`. Prisma 7 must find `prisma7.config.ts` on its own, without `--config`.

### S6. Prisma 8 CLI state

`pnpm prisma --version` (expect 8.x), `pnpm prisma contract emit` (expect the same failure as in S4; record the message and judge it), `pnpm exec prisma orm init --help` (does the help mention the flag and the Prisma 7 behaviour clearly?).

### S7. Human output

Re-run S4b's command in a pseudo-terminal without `--json` on a fresh copy of the pre-init project (restore with `git stash` is forbidden; instead `git checkout -- . && git clean -fd -e node_modules -e generated -e .env` inside `wip/qa/prisma7-app`, which is the QA project's own throwaway repository, then re-run). Use `script -q /dev/null node <bin> orm init ...` so the CLI sees a TTY. Judge the prose: is every file written and renamed named, is the `db sign` step clear, is anything misleading.

### S8. Re-run on the initialised project

Run S4b's command again on the initialised project. Expected: re-init consent for init's own files only (never the Prisma 7 schema, never `prisma7.config.ts`), no second rename, no duplicate scripts, `prisma/` still identical.

### S9. Interactive question path

On a fresh pre-init copy with the `dev` target package installed as in S4b, in a pseudo-terminal, `script -q /dev/null node <bin> orm init --skip-install` and answer the prompts by hand through `expect` or by piping timed answers: yes to the Prisma 7 question, the consent token, no to `.env`. Expected: same files as S4b. If driving the prompts is not feasible in the time box, record that and skip.

### S10. A schema the source refuses

On a fresh pre-init copy with the `dev` target package installed as in S4b, add a `view UserInfo { id Int @unique  email String }` block to `prisma/schema.prisma` and commit it in the QA repository. Run it twice:

- `node <bin> orm init --from-prisma7-schema prisma/schema.prisma --confirm prisma7-app --skip-install`. The check runs against the installed `dev` package. Expected: `CLI.INIT_PRISMA7_SCHEMA_REFUSED` naming the view with its line and column; `prisma.config.ts` unchanged; scripts unchanged; no `prisma7.config.ts`; `package.json` unchanged.
- The same without `--skip-install`. Init installs the `latest` release over the `dev` one, so until a release carries `prisma7Schema` the expected result is `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`. Expected either way: the project unchanged apart from `@prisma/orm-postgres` and `dotenv` in `package.json`, and the printed remove command removes them.

### S11. A target with no Prisma 7 source

The S4 project with `--target mongodb`. Expected: `CLI.INIT_PRISMA7_TARGET_MISMATCH`, exit 2, before anything is installed. This replaces the brief's expectation of `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`, because Will ruled on 2026-09-24 that a mismatched `--target` fails early. To see the no-source outcome for a target, the Prisma 7 question path of S4 with the `latest` package is the case: answer yes, and init warns and runs as a fresh init.

### S12. Exit after "Done" in a real terminal

In a real terminal, not a pseudo-terminal, run the S4b command without `--json` on a fresh copy and record whether the process exits after printing "Done". Report the result to Will.

## Report

Write `projects/orm-init-prisma7-detection/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`: setup facts (versions installed, database), one section per scenario with command, exit code, verdict, and a plain-English description of anything surprising, then a findings list with severity (🛑 blocker, ⚠ should fix, ℹ note) and the log path for each. Do not fix anything in `packages/`; the report is the deliverable. Leave `wip/qa/` in place for the orchestrator to inspect; do not commit it.
