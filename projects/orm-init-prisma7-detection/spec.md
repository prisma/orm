# `orm init` detects a Prisma 7 project

> Shaped 2026-09-14 with Will. Decisions and rejected alternatives are in `design-notes.md`. Claims about the CLI were checked against `packages/1-framework/3-tooling/cli/src/orm/init*.ts` on `main` at c04c4d46d9.

## Purpose

A Prisma 7 user can add Prisma 8 to their existing project by running the same command a new user runs, `prisma orm init`, and come out with Prisma 8 set up beside Prisma 7, reading their existing `schema.prisma` as the contract source. Today the public upgrade guide asks for about fifteen hand edits before the first Prisma 8 command works; every one of them is mechanical and identical across projects.

## At a glance

An untouched Prisma 7 project on Postgres:

```
prisma/schema.prisma        datasource provider = "postgresql"
prisma/migrations/
prisma.config.ts            defineConfig from 'prisma/config'
package.json                devDependencies: prisma ^7.x; scripts call `prisma migrate dev`, `prisma generate`
```

The user runs `prisma orm init` and answers two questions:

```
? prisma/schema.prisma is a Prisma 7 schema. Use it as the Prisma 8 contract source? (Y/n)
? Prisma 7 is installed as `prisma`. Keep it as @prisma/prisma7 (binary `prisma7`) and move `prisma` to Prisma 8? Type "my-app" to confirm.
```

Or non-interactively:

```bash
prisma orm init --from-prisma7-schema prisma/schema.prisma --confirm my-app
```

Afterwards:

```
prisma7.config.ts           the Prisma 7 config, renamed, importing from '@prisma/prisma7/config'
prisma.config.ts            contract: prisma7Schema('prisma/schema.prisma'), output: 'src/prisma'
src/prisma/db.ts            the Prisma 8 client
src/prisma/contract.json    emitted
src/prisma/contract.d.ts    emitted
package.json                @prisma/prisma7 added, prisma at 8, scripts prisma7 migrate dev / prisma7 generate, contract:emit added
```

and the printed next steps are: set `DATABASE_URL`, run `prisma db sign`, move routes to the Prisma 8 client one at a time, and re-run `prisma contract emit` and `prisma db sign` after each `prisma7 migrate dev`.

## Non-goals

- **Connecting to the database.** Init never signs, verifies, or probes beyond the existing opt-in `--probe-db`. `db sign` is the first printed next step. This is the `git init` boundary: init sets up what Prisma 8 needs to operate in the project and stops.
- **Rewriting application code.** Routes move by hand or through the upgrade skill.
- **Cutover.** `contract convert` and the switch to a Prisma 8 contract file belong to `projects/prisma7-contract-source/`.
- **Carrying the Prisma 7 connection expression.** The new config's `db.connection` is `process.env['DATABASE_URL']`, as init writes today. Reading `datasource.url` out of the Prisma 7 config is deferred.
- **Reading the Prisma 7 config for anything but `schema`.** Migrations path, seed, and everything else are Prisma 7's business.
- **Monorepo discovery.** Init works in the current directory, as it does today.
- **Prisma 6 SQL schemas, other ORMs, `_prisma_migrations`.** Unchanged from the parallel project's non-goals.
- **Changing what init does to `package.json#type` or `tsconfig.json`.** Init keeps its current merge behaviour in every mode.

## Place in the larger world

- **The transition story** is `projects/prisma-8-rc1/parallel-install.md` and the public guide [Prisma ORM 7 to 8 (PostgreSQL)](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql). This project automates the guide's section 1 (set Prisma 7 aside) and section 2 (add Prisma 8) inside `orm init`; sections 3 to 5 stay as they are.
- **The contract source** is `prisma7Schema` from `@prisma/orm-postgres/config`, built by `projects/prisma7-contract-source/` slice 1 and merged in [PR #30287](https://github.com/prisma/orm/pull/30287). Init writes the config line and, before changing the project, runs that source from the installed target package to check the schema (requirement 8). It does not parse the schema itself beyond finding the `datasource` block and its provider.
- **The unified CLI grammar** (`projects/consolidate-clis/cli-consolidation-plan.md` § Prisma 8 and classic Prisma) already says init detects a classic setup and offers a migration path, and that nothing is silently reinterpreted. This project is that paragraph, delivered.
- **`db sign` sets the `db` ref** since [PR #30251](https://github.com/prisma/prisma/pull/30251), so the next-steps text names one command for adoption.
- **Prisma 7 since 7.10.0 discovers `prisma7.config.*` before `prisma.config.*`** (prisma/prisma#30020), and `@prisma/prisma7` publishes the Prisma 7 CLI under the `prisma7` binary. Both are what make the side-by-side setup a rename and a package swap rather than a fork.

## Cross-cutting requirements

1. **Detection is explicit, never silent.** Init enters the Prisma 7 path only through `--from-prisma7-schema <path>` or a yes to one interactive question. The question is asked when init finds a Prisma 7 config, or a `.prisma` file (or directory) at the Prisma 7 default path with a `datasource` block. A no runs init exactly as today. A non-interactive run without the flag runs init as today.
2. **A Prisma 7 config is recognised by the engine's own check.** Init evaluates `prisma.config.ts` (or, after the rename, `prisma7.config.*`) with the same loader the CLI uses and treats a default export without the `$prismaConfig` marker as a Prisma 7 config, which is what `CONFIG.VERSION_MARKER_MISSING` already means. From it init reads `schema` and nothing else. A config that fails to evaluate is reported and init falls back to the default schema path.
3. **Prisma 7 inputs fill defaults only.** The schema path comes from the flag, else the Prisma 7 config's `schema`, else `prisma/schema.prisma`. The target comes from the schema's `datasource.provider`, choosing among the known targets. `--target` may only agree with the provider, or name the database when the provider is not a string literal; with `--from-prisma7-schema` a mismatch is refused before anything is asked or installed, and without it the Prisma 7 question is not asked. `--from-prisma7-schema` together with `--schema-path` or `--authoring` is an error, because those two mean "write a starter schema".
4. **Side-by-side setup happens with consent, in one run.** When the project declares `prisma` at a major below 8, init offers, under the existing `--confirm <token>` consent: add `@prisma/prisma7` (the published Prisma 7 CLI, pinned to its one version), move `prisma` to Prisma 8, move `@prisma/client` to the same Prisma 7 version because Prisma 7 requires CLI and client to match, rename the Prisma 7 config to `prisma7.config.<same extension>` and change its `prisma/config` import to `@prisma/prisma7/config`, and rewrite scripts whose command invokes `prisma` so they invoke `prisma7`. Declined consent stops init before any write. The only change before it is the check's install (requirement 8): any error after the check, including a consent that cannot be given, names the packages the check added and the command that removes them. A project already on `@prisma/prisma7` skips the offer.
5. **Nothing Prisma 7 owns is replaced or deleted.** The Prisma 7 schema is never in init's replace list, `prisma/` is never written to, `prisma/migrations` is never touched, and the Prisma 7 client output is never removed. Init's own files go under `src/prisma/`.
6. **Everything else is init as today.** Same `prisma.config.ts` shape with one different `contract:` line and no starter schema, same `db.ts` beside the emitted artifacts, same tsconfig, gitignore, gitattributes, and `package.json` merges, same install of the target package and `prisma@latest`, same spawned `contract emit`, same re-init consent for files init wrote before. The result document and the human output name every file written and every package changed.
7. **Next steps are the transition routine.** Set `DATABASE_URL`; `prisma db sign`; move routes one at a time; after each `prisma7 migrate dev`, `prisma contract emit` then `prisma db sign`. `prisma7 generate` is listed when `@prisma/client` was moved. There is no cutover step: init lists only what the user runs right after it.
8. **Init checks the schema before it changes the project.** Once the target is known and before any consent question, init installs the target package and `dotenv`, loads the package's `/config` entrypoint from the project, and runs its `prisma7Schema` source without writing. A refusal stops init with the source's diagnostics; the project is unchanged apart from those two packages, and the error names the command that removes them. A target package without `prisma7Schema` turns a run entered through the question into a fresh init, announced by a warning before the next question, and refuses a run given `--from-prisma7-schema`.

## Transitional-shape constraints

- **Postgres lands first.** Only `@prisma/orm-postgres/config` exports `prisma7Schema` today. For a `mongodb` provider, the check finds no source (requirement 8). Once `@prisma/orm-mongo/config` exports `prisma7Schema` (parallel project slice 2), the path works for Mongo with no change to init's logic; the Prisma 7 quick reference `prisma-8.md` still shows Postgres examples and needs a Mongo variant then. Providers with no known target are refused with the list of supported ones.
- **The command stays `orm init`.** The unified CLI mounts it as `init`; no new command is added.
- **Nothing in this project may depend on `prisma`, `@prisma/prisma7`, `@prisma/client`, or `@prisma/get-dmmf`.** Detection reads text and evaluates the user's config; the Prisma 7 packages are only ever named as install targets. The CLI carries no target code: the schema check loads the target package the project installed.

## Contract impact

None.

## Adapter impact

None. The Postgres and Mongo extensions are consumed through their published `/config` entrypoints only.

## ADR pointer

None expected. The `git init` boundary for `orm init` is recorded in `design-notes.md` and should be lifted into the CLI README's init section at close-out.

## Project definition of done

Inherits `drive/calibration/dod.md`. Project-specific:

- [ ] A checked-in Prisma 7 fixture project (schema, `prisma.config.ts` with the `prisma/config` import, `package.json` declaring `prisma` and `@prisma/client` at a 7.x below 7.10.0, scripts calling `prisma migrate dev` and `prisma generate`, `prisma/migrations/`) run through `orm init --from-prisma7-schema prisma/schema.prisma --confirm <dir>` produces the files and `package.json` listed in § At a glance, emits `contract.json` and `contract.d.ts`, and leaves `prisma/` byte-identical.
- [ ] Against a database built from that fixture's Prisma 7 migration SQL, `prisma db sign` then succeeds with zero findings, proving the config init wrote is the one the parallel project's end-to-end proof uses.
- [ ] The interactive run reaches the same result through the two questions; a no to the first question runs init as today; a declined consent to the second writes nothing.
- [ ] A Prisma 7 config that fails to evaluate, a `--target` that disagrees with the provider, an unsupported provider, and a `--from-prisma7-schema` path with no `datasource` block each produce a structured error naming the fix, with nothing written.
- [ ] A schema the target package's source refuses (a `view` block) stops init with the source's diagnostics, and the project is unchanged apart from the target package and `dotenv`.
- [ ] Re-running init on the initialised project asks the usual re-init consent for init's own files and never lists the Prisma 7 schema among them.
- [ ] `packages/1-framework/3-tooling/cli/README.md` documents the Prisma 7 path of `orm init`, including the `git init` boundary, and the docs brief in `docs-brief-module-settings.md` has been handed to the `prisma/web` docs owner.

## Open questions

None; the questions raised on 2026-09-16 are answered in `design-notes.md` D10. Two points were decided by the orchestrator within Will's "generalise the side-by-side setup" ruling and are flagged for veto in `design-notes.md`: the consent also covers the config rename and the script rewrite, and `@prisma/client` is moved to the Prisma 7 CLI's version.

## References

- `docs-brief-module-settings.md` in this directory.
- `projects/prisma7-contract-source/` (worktree `prisma-schema-contract-converter-04eaed`, PR #30287): `spec.md`, `slices/01-postgres-source/spec.md`, `slices/04-prisma7-adoption-example/spec.md`, `examples/prisma7-adoption/`.
- `projects/consolidate-clis/cli-consolidation-plan.md` § Prisma 8 and classic Prisma.
- `packages/1-framework/3-tooling/config-loader/src/load.ts` (marker check), `packages/1-framework/3-tooling/cli/src/orm/init-inputs.ts`, `init-scaffold.ts`, `init-emit.ts`, `commands/init/hygiene-package-scripts.ts`, `commands/init/templates/code-templates.ts`.
