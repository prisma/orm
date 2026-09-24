# Design notes

Decisions with their reasons, and what was rejected. The spec states the outcome; this file states why, so nobody re-derives the alternatives.

## Principles

1. **`orm init` behaves like `git init`.** It sets up what Prisma 8 needs to operate in the project and stops. A database may not be reachable when init runs, so nothing in init requires one. Init is not "migrate me from an earlier Prisma".
2. **Nothing is silently reinterpreted.** A Prisma 7 schema is read as one only when the user said so, by flag or by answering a question. The flag names the dialect (`--from-prisma7-schema`) because init has to write `prisma7Schema(...)` rather than treat the file as Prisma 8 PSL.
3. **Prisma 7 inputs are defaults.** The config and schema answer init's own questions (which family, which file). Any flag given overrides them.
4. **Init owns only what it writes,** with one deliberate exception below.

## Decisions

### D1. The `prisma upgrade` orchestrator is dropped

Validation of the original spec showed it could not find its inputs reliably in arbitrary projects and that the parallel project solves the hard part better by reading `schema.prisma` directly. Init already does install, scaffold, and emit; the detection mode is the remaining gap.

### D2. Init never signs

Signing needs a database. Init's promise is "set up", not "working against your database". `db sign` is the first printed next step, the same way a fresh init hands off `db init`.

### D3. Side-by-side setup is part of init, with consent

Will's ruling (2026-09-14): when an earlier Prisma CLI is installed, init offers to install the Prisma 7 npm package and move the `prisma` CLI to version 8. Reason: init installs `prisma@latest`, which in an untouched Prisma 7 project replaces the Prisma 7 CLI; without the swap, `prisma migrate dev` would run Prisma 8 afterwards. The alternative, stopping and telling the user to do the guide's section 1 and re-run init, was rejected because nobody should have to run init twice.

Two consequences were decided by the orchestrator inside that ruling and are open to veto:

- **The same consent covers the config rename and the script rewrite.** The swap alone leaves `prisma.config.ts` occupied by Prisma 7's config, which init needs, and leaves scripts calling a `prisma` binary that is now Prisma 8. Both edits are the guide's own section 1 and are deterministic: rename to `prisma7.config.<ext>`, change the `prisma/config` import to `@prisma/prisma7/config`, replace `prisma ` with `prisma7 ` in script commands.
- **`@prisma/client` moves to the Prisma 7 CLI's version.** Prisma 7 requires CLI and client at the same version and `@prisma/prisma7` publishes one version. `prisma7 generate` is printed as a next step.

This is the one place init edits files it did not write. It is bounded to the guide's section 1 and happens only after the consent token.

### D4. The connection line is `process.env['DATABASE_URL']`

Evaluating the Prisma 7 config yields the resolved URL, which must not be written into a config file, and matching it back to an environment variable assumes it came from one. Copying the source expression needs a TypeScript rewrite. Both deferred; init writes what it writes today.

### D5. Layout is `src/prisma/`

`db.ts`, `contract.json`, and `contract.d.ts` go where a fresh init puts them, so an upgraded project ends up shaped like a new one. `prisma/` belongs to Prisma 7 and is deleted at cutover. The guide's `prisma8/` and the example app's `generated/prisma8/` were not adopted.

### D6. Mongo is its own slice and waits (superseded by D10)

Prisma 7 has no Mongo connector; the Mongo guide is a Prisma 6 port. The parallel project's slice 2 defines the Mongo source. Init does not refuse Mongo by name: it installs the chosen target package and uses its `prisma7Schema` when the package exports one (D10).

### D7. `"type": "module"` and tsconfig handling are unchanged

Will: leave init alone, it does what it does now. The docs brief in this directory covers the CommonJS guidance for the `prisma/web` guides.

## Rejected

- **Emitting a `contract.ts` module or any generated code beside `contract.json`.** The product emits a data artifact plus types (`docs/Architecture Overview.md`). Not to be re-proposed.
- **Signing inside init.** See D2.
- **Detecting a Prisma 7 config by its import text.** The engine already has the marker check; init reuses it.
- **Reading `datasource.url` and matching it to an environment variable.** See D4.
- **Stop-and-re-run after the user does section 1 by hand.** See D3.
- **A top-level `prisma upgrade` verb.** The unified CLI owns top-level names; `init` already exists and the grammar assigns detection to it.

## Open

- Whether `contract convert` should be named in init's next steps once it exists is the parallel project's call at its close-out.
- The `prisma/config` import (init writes `@prisma/cli-engine` today; the published `prisma` package re-exports it as `prisma/config`) is an orphan slice outside this project.

### D8. Init checks the schema before it edits anything (added 2026-09-16, resolved by D10)

Manual review after the end-to-end proof: init renamed the config, swapped `prisma`, and rewrote scripts before `contract emit` could report a construct the Prisma 7 source refuses. For a construct with no fix (a view, `Unsupported(...)`), the user's project was changed for nothing. The source's refusals are permanent for some constructs, so waiting for them to be lifted is not an option; init must find out first.

Checking needs the target package: the refusal rules ship only in `@prisma/orm-postgres`, and the CLI is family-blind, so it carries none of that code and reaches it only through an installed target package. Options: (1) install the target package into a temporary directory, check there, delete it, so a refused schema leaves the project untouched, at the cost of one extra download on success; with `--skip-install` the check is skipped with a warning; (2) install it into the project first, leaving one unused dependency on refusal; (3) bundle the source into the CLI, which breaks the family-blind CLI. Recommended: (1). Will chose option (2), because init installs the target package anyway (D10, answer 3).

### D9. No cutover step (added 2026-09-16, superseded by D10)

The guide's cutover section describes `contract infer` plus hand edits, the workflow `prisma7Schema` replaces. Init prints no cutover step (D10, answer 6).

### D10. Init selects among known targets and checks the schema before any edit (Will, 2026-09-16 to 2026-09-24)

Will's ruling on 2026-09-16 was that init cannot be target-specific. On 2026-09-23 he clarified what that means: init must not be coupled to one database, but selecting between the targets it knows is fine. The answers to the open questions:

1. **Target branches on `main` stay.** Init already picks starter schemas, package names, labels, and the `--probe-db` driver per known target. That is selection among known targets, so it stays. Only the target coupling this project added goes: the Mongo-by-name refusal and the PostgreSQL guide in the next steps.
2. **The target comes from the schema's `datasource` provider; `--target` may only agree with it.** A provider with no known target keeps `CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED`, which now lists every known provider. A `--target` that disagrees with the provider is refused before anything is installed or asked, with `CLI.INIT_PRISMA7_TARGET_MISMATCH` (Will: "fail early on invalid options"). Without the flag, the Prisma 7 question is not asked when the target cannot be resolved, so a yes can never end in these refusals.
3. **The check runs from the target package installed in the project.** Will asked whether bundling the target packages into the CLI would be simpler. It is not: both target packages depend on the CLI package, so bundling creates a dependency cycle, and `pnpm lint:deps` forbids framework packages from importing target packages. Init installs the target package anyway, so the check only moves that install earlier. On the Prisma 7 path, after the target is known and before any consent question, init installs the target package and `dotenv`, loads the package's `/config` entrypoint from the project, and runs its `prisma7Schema` source in memory, writing nothing. A refused schema stops init with `CLI.INIT_PRISMA7_SCHEMA_REFUSED` and the source's diagnostics; the project is unchanged apart from the two packages, and the error prints the command that removes them.
4. **A target package without `prisma7Schema` means the Prisma 7 project is ignored** (Will: init "should function fine and just ignore the presence of prisma 7 config"). When the user entered the path by answering yes to the question, init warns before its next question and continues as a fresh init for that target. The warning says what a fresh init does to the Prisma 7 setup: it asks before replacing the Prisma 7 `prisma.config.ts`, and its install of `prisma@latest` replaces the Prisma 7 CLI. Whether a yes should instead stop init is open for Will. When the user passed `--from-prisma7-schema`, init cannot honour the flag and stops with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`: a fresh init needs `--authoring`, which cannot be combined with the flag. This split is the implementer's call, open to veto. When `@prisma/orm-mongo/config` exports `prisma7Schema`, the Prisma 7 path works for Mongo with no change to init. The same applies to releases: the `latest` `@prisma/orm-postgres` (8.0.0-rc.11) was published before `prisma7Schema` merged, so until the next release the check finds no source and the Prisma 7 path refuses the flag or falls back to a fresh init.
5. **The terminal problems found in manual QA are out of scope.** `--confirm` being ignored in an interactive session is caused by `consent` in `@prisma/cli-engine` checking `--confirm` values only when the session is non-interactive. The process that does not exit after "Done" is unconfirmed outside a pseudo-terminal. A brief for an agent in the engine repository covers both; manual QA scenario S12 checks the second in a real terminal.
6. **The cutover step is removed** (Will: too much instruction for a command modelled on `git init`). The next steps list only what the user runs right after init.

Supersedes D6 and D9. D8 is resolved by answer 3.
