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

or just `prisma orm init`, which notices the Prisma 7 project and asks two questions: use `prisma/schema.prisma` as the Prisma 8 contract source, and keep Prisma 7 installed as `@prisma/prisma7` while `prisma` moves to Prisma 8. Between the two, init checks that Prisma 8 can read the schema. Afterwards:

```
prisma7.config.ts         the Prisma 7 config, renamed; its import now '@prisma/prisma7/config'
prisma.config.ts          Prisma 8's config: contract: prisma7Schema('prisma/schema.prisma'), output: 'src/prisma'
src/prisma/db.ts          the Prisma 8 client
src/prisma/contract.json  emitted from prisma/schema.prisma
src/prisma/contract.d.ts
package.json              devDependencies: prisma 8.x, @prisma/prisma7 7.x
                          scripts: "migrate": "prisma7 migrate dev", "generate": "prisma7 generate", "contract:emit": "prisma contract emit"
```

and init prints what to do next: set `DATABASE_URL`, run `prisma db sign`, move routes to the Prisma 8 client one at a time, and re-run `prisma contract emit` and `prisma db sign` after each `prisma7 migrate dev`. `prisma/`, `generated/`, and the database are untouched.

If the schema has something Prisma 8 cannot represent, such as a `view` block, init stops before changing anything. From the manual QA run, the error's summary, reason, and next actions:

```
CLI.INIT_PRISMA7_SCHEMA_REFUSED  Prisma 8 cannot read prisma/schema.prisma
Prisma 7 schema interpretation failed
  prisma/schema.prisma:26:1 PSL.PRISMA7_VIEW_UNSUPPORTED View "UserInfo" is not supported; Prisma 8 has no views. Remove the view or replace it with a model over the underlying table.
Edit prisma/schema.prisma as each finding says (see the Prisma 7 contract source section of the @prisma/orm-postgres README), or run `prisma orm init` without `--from-prisma7-schema`.
```

When the check installed a package the project did not declare, one more next action names it and the command that removes it, for example ``init added @prisma/orm-postgres to package.json before checking; remove it with `pnpm remove @prisma/orm-postgres`.``

## The decision

The public guide [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) has two mechanical sections before the real work starts. Section 1 sets Prisma 7 aside: swap the `prisma` package for `@prisma/prisma7`, rename the config, change its import, rename the scripts. Section 2 adds Prisma 8: install it, write a config, produce a contract, emit. About fifteen edits, identical for every project.

This PR moves both sections into `orm init`, under one explicit consent, and stops there. Init does not sign the database and does not touch application code. It sets up what Prisma 8 needs to operate in the project, the way `git init` sets up a repository, and hands the database step to `prisma db sign`. A database may not even be reachable when init runs.

Init finds out whether Prisma 8 can read the schema before it changes the project. The reader lives in the target package, so init installs that package first, runs its Prisma 7 source in memory, and only then asks for consent and makes the edits. A refused schema leaves the project unchanged apart from that install, and the error says how to undo it.

The contract source is the existing `schema.prisma`, read through `prisma7Schema` from the target package's `/config` entrypoint (#30287). There is no converted schema file to keep in sync; after each Prisma 7 migration the user re-emits and re-signs.

## How a run works

**Detection.** Init evaluates `prisma.config.ts` with the same loader every command uses. A Prisma 8 config carries a `$prismaConfig` marker; a Prisma 7 config does not, which is the check behind the existing `CONFIG.VERSION_MARKER_MISSING` error. From a Prisma 7 config init reads only `schema`, to default the schema path. The provider comes from the schema's `datasource` block, and the Prisma 7 CLI version from `package.json`.

**Asking, never assuming.** The Prisma 7 path is entered only by the `--from-prisma7-schema` flag or by a yes to the question. The question has no default, so `--yes` and non-interactive runs never take the path by accident. Combining the flag with `--schema-path` or `--authoring` is an error, since those mean "write a starter schema".

**Choosing the target.** The provider picks among the targets init knows: `postgresql` or `mongodb`. `--target` may only agree with it, or name the database when the provider is not a string literal. With `--from-prisma7-schema`, a mismatch (`CLI.INIT_PRISMA7_TARGET_MISMATCH`) and a provider with no target (`CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED`) are refused before anything is asked or installed. Without the flag, init does not ask its Prisma 7 question in those cases and runs as a fresh init. Init no longer refuses Mongo by name.

**Checking the schema first.** Before any consent question, init installs the target package and `dotenv` (both are installed by every init), loads the package's `/config` entrypoint from the project, and runs its `prisma7Schema` source through the new `loadContractSource`, the part of `contract emit` that builds the control stack and runs the source, without writing anything. The CLI carries no target code, so the installed package is the only one that can answer. Outcomes:

- The source reads the schema: init continues.
- The source refuses: `CLI.INIT_PRISMA7_SCHEMA_REFUSED` with each diagnostic as `<file>:<line>:<column> <code> <message>`, and the command that removes the packages the project did not declare before. Any later error, including the engine's own consent and cancellation errors, carries the same remove command.
- The package has no `prisma7Schema`: after a yes to the question init warns before its next question and runs as a fresh init, and the warning says when that replaces the Prisma 7 `prisma.config.ts` (after asking) and the Prisma 7 CLI; with the flag it stops with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`. When `@prisma/orm-mongo/config` exports `prisma7Schema`, the Mongo path works with no change to init.
- `--skip-install` and the package is not installed: a warning, and init continues.
- The install fails: exit 4 with nothing written.

**Setting Prisma 7 aside.** Init installs `prisma@latest`, which in an untouched project would replace the Prisma 7 CLI and make `prisma migrate dev` run Prisma 8. So after the check, and only after the consent token, init renames `prisma.config.<ext>` to `prisma7.config.<ext>`, rewrites its import, rewrites every script that invokes the `prisma` binary to `prisma7` (including after `--`, `&&`, and environment assignments), and adds `@prisma/prisma7`. Prisma 7 since 7.10.0 looks for `prisma7.config.*` first, so it keeps working without `--config`. This is the one place init edits files it did not write; it is bounded to the guide's section 1 and planned before any write, and the rename is refused if the target file already exists.

**Scaffolding.** Everything else is init as it is today, with one different `contract:` line and no starter schema. `db.ts` and the emitted artifacts go under `src/prisma/`, the same layout a fresh init produces, so an upgraded project ends up shaped like a new one. Nothing is written under `prisma/`. The later install skips the packages the check already installed.

**Reporting.** The `--json` document gains `authoring: "prisma7"`, a `filesRenamed` list, and a `prisma7` block naming the renamed config, the rewritten scripts, and the packages moved. The human output shows the same. New error codes cover the refusals: flag conflict, target mismatch, unsupported provider, a schema without a `datasource` block, an unreadable config, a config-name collision, a refused schema, and a target package without a Prisma 7 source. No refusal writes a file; the check's install is the only change before one.

## What init never does

- Connect to the database beyond the opt-in `--probe-db` version check, or sign it.
- Write under `prisma/`, replace the Prisma 7 schema, or touch `prisma/migrations` or the Prisma 7 client output.
- Read anything but `schema` from the Prisma 7 config, or carry its `datasource.url` expression into the new config. The new config uses `process.env['DATABASE_URL']`, as init writes today.
- Change `package.json#type` or tsconfig handling. Both keep init's existing behaviour.
- Print a cutover step. The next steps list only what the user runs right after init.

## Proof

- `test/orm/init-prisma7.e2e.test.ts` copies a checked-in Prisma 7 fixture project, applies its Prisma 7 migration SQL to a dev database, runs init with the real check and the real spawned `contract emit`, and then runs `prisma db sign` and `prisma db verify` against that database: zero findings, marker written, `db` ref advanced, and `prisma/` holds only the schema and migrations. A second case runs init on a copy whose schema has a `view` block, with the real `@prisma/orm-postgres`: `CLI.INIT_PRISMA7_SCHEMA_REFUSED` with the view diagnostic, `prisma.config.ts` and `package.json` byte-identical, no `prisma7.config.ts`, and one install call.
- Harness tests in `test/orm/init-prisma7-check.test.ts` inject the module loader instead of mocking modules: a refused schema, a package without `prisma7Schema` under the flag and under the question, `--skip-install` with the package missing, a project that already declares `dotenv`, and a schema the source reads. Input-level tests pin that the check runs before any consent and that a declined consent names the installed packages.
- `loadContractSource` has its own tests, and every existing emit test passes unchanged.
- Each new test was checked to fail without its implementation; the notes are in the PR conversation.
- Manual QA on 2026-09-24 (`manual-qa-reports/2026-09-24-opus.md`) against a Prisma 7.10.0 project, scenarios S1 to S12. It found two bugs, both fixed here: the remove command named a `dotenv` the project already declared, and a re-run replaced init's own `prisma.config.ts` without naming it in the consent. It also found that the process stays alive after "Done" only when a prompt was answered, in a real terminal or a pseudo-terminal alike; that and `--confirm` being ignored in an interactive session are engine issues, briefed separately.
- An independent review of the diff found three more problems, fixed here: the remove command was missing from the engine's consent and cancellation errors, the Prisma 7 question was asked when a `--target` mismatch made a yes pointless, and the fresh-init fallback did not say before its questions what it would replace.

## Known limitation

The `latest` `@prisma/orm-postgres` on npm (8.0.0-rc.11) was published before `prisma7Schema` merged. Until the next release, the check finds no Prisma 7 source in the package init installs: the flag stops with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`, and a yes to the question runs a fresh init. The check runs with the CLI that invoked init, so an older CLI against a newer target package can refuse a valid schema; published releases pin the two to the same version.

## Alternatives considered

- **A separate `prisma upgrade` command** that automated the whole guide, including a schema converter and signing. Dropped: it could not find its inputs reliably in arbitrary projects (computed config values, multi-file schemas, monorepos, callers of `prisma migrate` in CI files it must not edit), and #30287 removed the need for a converter.
- **Making changes first and printing undo instructions when emit refuses the schema.** Rejected: a schema with a construct that has no fix, such as a view, left the project renamed and rewired for nothing.
- **Installing the target package into a temporary directory for the check,** so a refusal leaves `package.json` untouched. Not chosen: it downloads the package twice on success, and init installs the package into the project anyway.
- **Bundling the target packages into the CLI** so the check needs no install. Rejected: both target packages depend on the CLI package, so bundling creates a dependency cycle, and the layering rules forbid framework code from importing target packages.
- **Taking the target only from `--target` or the "What database are you using?" question,** never from the schema's provider. Rejected: choosing among the targets init knows is fine, and the schema already says which database it is for. A `--target` that disagrees is refused instead.
- **Refusing a `mongodb` provider by name** until the Mongo source exists. Replaced by the check, so Mongo needs no init change when its source ships.
- **Stopping and telling the user to do section 1 by hand, then re-run init.** Rejected because nobody should have to run init twice; the four edits are deterministic, so init does them under consent instead.
- **Signing inside init** so the run ends with a working query. Rejected: it makes init a command that writes to the database, and the database may not be reachable.
- **Carrying the Prisma 7 `datasource.url` expression** into the new config, or matching its resolved value back to an environment variable. Deferred: the first needs a TypeScript rewrite of user code, the second assumes the URL came from an environment variable.
- **The guide's `prisma8/` layout or the example app's `generated/prisma8/`.** Not adopted; `src/prisma/` is what a fresh init produces.
- **A cutover step pointing at the guide** or at the Postgres README. Removed: the guide's cutover describes the workflow `prisma7Schema` replaces, and a command modelled on `git init` should not carry that much instruction.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
