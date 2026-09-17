A Prisma 7 project on Postgres looks like this:

```
prisma/schema.prisma      datasource db { provider = "postgresql" }, generator, models
prisma/migrations/
prisma.config.ts          import { defineConfig } from 'prisma/config'
package.json              devDependencies: prisma ^7.10.0
                          scripts: "migrate": "prisma migrate dev", "generate": "prisma generate"
```

With this PR its owner runs one command:

```bash
prisma orm init --from-prisma7-schema prisma/schema.prisma --confirm my-app
```

or just `prisma orm init`, which notices the Prisma 7 project and asks two questions: use `prisma/schema.prisma` as the Prisma 8 contract source, and keep Prisma 7 installed as `@prisma/prisma7` while `prisma` moves to Prisma 8. Afterwards:

```
prisma7.config.ts         the Prisma 7 config, renamed; its import now '@prisma/prisma7/config'
prisma.config.ts          Prisma 8's config: contract: prisma7Schema('prisma/schema.prisma'), output: 'src/prisma'
src/prisma/db.ts          the Prisma 8 client
src/prisma/contract.json  emitted from prisma/schema.prisma
src/prisma/contract.d.ts
package.json              devDependencies: prisma 8.x, @prisma/prisma7 7.x
                          scripts: "migrate": "prisma7 migrate dev", "generate": "prisma7 generate", "contract:emit": "prisma contract emit"
```

and init prints what to do next: set `DATABASE_URL`, run `prisma db sign`, move routes to the Prisma 8 client one at a time, re-run `prisma contract emit` and `prisma db sign` after each `prisma7 migrate dev`, and follow the upgrade guide's cutover section when the last route has moved. `prisma/`, `generated/`, and the database are untouched.

## The decision

The public guide [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) has two mechanical sections before the real work starts. Section 1 sets Prisma 7 aside: swap the `prisma` package for `@prisma/prisma7`, rename the config, change its import, rename the scripts. Section 2 adds Prisma 8: install it, write a config, produce a contract, emit. About fifteen edits, identical for every project.

This PR moves both sections into `orm init`, under one explicit consent, and stops there. Init does not sign the database and does not touch application code. It sets up what Prisma 8 needs to operate in the project, the way `git init` sets up a repository, and hands the database step to `prisma db sign`. A database may not even be reachable when init runs.

The contract source is the existing `schema.prisma`, read through `prisma7Schema` from `@prisma/orm-postgres/config` (#30287). There is no converted schema file to keep in sync; after each Prisma 7 migration the user re-emits and re-signs.

## How a run works

**Detection.** Init evaluates `prisma.config.ts` with the same loader every command uses. A Prisma 8 config carries a `$prismaConfig` marker; a Prisma 7 config does not, which is the check behind the existing `CONFIG.VERSION_MARKER_MISSING` error. From a Prisma 7 config init reads only `schema`, to default the schema path. The provider comes from the schema's `datasource` block, and the Prisma 7 CLI version from `package.json`.

**Asking, never assuming.** The Prisma 7 path is entered only by the `--from-prisma7-schema` flag or by a yes to the question. The question has no default, so `--yes` and non-interactive runs never take the path by accident. Prisma 7 inputs only fill defaults: `--target` overrides the provider, and combining the flag with `--schema-path` or `--authoring` is an error, since those mean "write a starter schema".

**Setting Prisma 7 aside.** Init installs `prisma@latest`, which in an untouched project would replace the Prisma 7 CLI and make `prisma migrate dev` run Prisma 8. So before installing, and only after the consent token, init renames `prisma.config.<ext>` to `prisma7.config.<ext>`, rewrites its import, rewrites every script that invokes the `prisma` binary to `prisma7` (including after `--`, `&&`, and environment assignments), and adds `@prisma/prisma7`. Prisma 7 since 7.10.0 looks for `prisma7.config.*` first, so it keeps working without `--config`. This is the one place init edits files it did not write; it is bounded to the guide's section 1 and planned before any write, and the rename is refused if the target file already exists.

**Scaffolding.** Everything else is init as it is today, with one different `contract:` line and no starter schema. `db.ts` and the emitted artifacts go under `src/prisma/`, the same layout a fresh init produces, so an upgraded project ends up shaped like a new one. Nothing is written under `prisma/`.

**Reporting.** The `--json` document gains `authoring: "prisma7"`, a `filesRenamed` list, and a `prisma7` block naming the renamed config, the rewritten scripts, and the packages moved. The human output shows the same. Six new error codes cover the refusals: flag conflict, Mongo or another unsupported provider, a schema without a `datasource` block, an unreadable config, and a config-name collision. Every refusal happens before anything is written.

## What init never does

- Connect to the database beyond the opt-in `--probe-db` version check, or sign it.
- Write under `prisma/`, replace the Prisma 7 schema, or touch `prisma/migrations` or the Prisma 7 client output.
- Read anything but `schema` from the Prisma 7 config, or carry its `datasource.url` expression into the new config. The new config uses `process.env['DATABASE_URL']`, as init writes today.
- Change `package.json#type` or tsconfig handling. Both keep init's existing behaviour.

## Proof

- `test/orm/init-prisma7.e2e.test.ts` copies a checked-in Prisma 7 fixture project, applies its Prisma 7 migration SQL to a dev database, runs init with the real spawned `contract emit`, and then runs `prisma db sign` and `prisma db verify` against that database: zero findings, marker written, `db` ref advanced, and `prisma/` holds only the schema and migrations. It caught one real defect during development: the template had pinned a pre-merge `prisma7Schema` signature, so artifacts landed under `prisma/` with exit 0.
- 90 unit and harness tests across detection, inputs, scaffold, install, and output, including the script-rewrite table and the refusals.
- Manual QA on 2026-09-15 against a project built from the guide with Prisma 7.10.0 from npm: the full run, the refusals, the interactive prompts, and Prisma 7 continuing to work afterwards all passed. Four findings were fixed here: the emit failure now reports the child's real error, the unreadable-config advice no longer proposes a rename that would overwrite `prisma7.config.ts`, no generic `README.md` is written on this path, and the missing-flags error names the new flag when a Prisma 7 project was detected. Recorded but not changed: `--confirm <token>` is not honoured when a TTY is present, and the TTY success path does not exit after printing Done (both pre-existing, engine-level); the tsconfig merge switches `module: nodenext` to `preserve` (existing behaviour).

## Not in this PR

Mongo. A `mongodb` provider is refused with `CLI.INIT_PRISMA7_MONGO_UNSUPPORTED` until `@prisma/orm-mongo/config` exports a Prisma 7 source.

## Alternatives considered

- **A separate `prisma upgrade` command** that automated the whole guide, including a schema converter and signing. Dropped: it could not find its inputs reliably in arbitrary projects (computed config values, multi-file schemas, monorepos, callers of `prisma migrate` in CI files it must not edit), and #30287 removed the need for a converter.
- **Stopping and telling the user to do section 1 by hand, then re-run init.** Rejected because nobody should have to run init twice; the four edits are deterministic, so init does them under consent instead.
- **Signing inside init** so the run ends with a working query. Rejected: it makes init a command that writes to the database, and the database may not be reachable.
- **Carrying the Prisma 7 `datasource.url` expression** into the new config, or matching its resolved value back to an environment variable. Deferred: the first needs a TypeScript rewrite of user code, the second assumes the URL came from an environment variable.
- **The guide's `prisma8/` layout or the example app's `generated/prisma8/`.** Not adopted; `src/prisma/` is what a fresh init produces.
