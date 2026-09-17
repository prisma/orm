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

### D6. Mongo is its own slice and waits

Prisma 7 has no Mongo connector; the Mongo guide is a Prisma 6 port. The parallel project's slice 2 defines the Mongo source. Until it exports `prisma7Schema` from `@prisma/orm-mongo/config`, init refuses the Prisma 7 path for a `mongodb` provider.

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

### D8. Init checks the schema before it edits anything (added 2026-09-16)

Manual review after the end-to-end proof: init renamed the config, swapped `prisma`, and rewrote scripts before `contract emit` could report a construct the Prisma 7 source refuses. For a construct with no fix (a view, `Unsupported(...)`), the user's project was changed for nothing. The source's refusals are permanent for some constructs, so waiting for them to be lifted is not an option; init must find out first.

Checking needs the target package: the refusal rules ship only in `@prisma/orm-postgres`, and the CLI is family-blind, so it carries none of that code and reaches it only through an installed target package. Options: (1) install the target package into a temporary directory, check there, delete it, so a refused schema leaves the project untouched, at the cost of one extra download on success; with `--skip-install` the check is skipped with a warning; (2) install it into the project first, leaving one unused dependency on refusal; (3) bundle the source into the CLI, which breaks the family-blind CLI. Recommended: (1). **Awaiting Will's decision.**

### D9. The cutover step points at the Postgres README (added 2026-09-16)

The guide's cutover section describes `contract infer` plus hand edits, the workflow `prisma7Schema` replaces. Until `contract convert` exists, init's last next step points at the `prisma7Schema` section of the `@prisma/orm-postgres` README.

### D10. Init is target-agnostic (Will, 2026-09-16)

Will: "Our init command cannot be target specific." Slice 1 as built maps `datasource.provider` to a target, refuses Mongo by name, lists `postgresql` as supported, names the PostgreSQL guide in its next steps, and the schema check proposed in D8 imported `@prisma/orm-postgres`. All of it goes. The Prisma 7 source in each target package already refuses a schema whose provider does not match (`PRISMA7_PROVIDER_MISMATCH`), so init does not need the provider.

Shape: the target comes from `--target` or the existing target question; init installs the chosen target package as it already does, loads that package's `/config` entrypoint through the import-specifier resolver it already uses to write the config, and if the package exports `prisma7Schema` runs that source against the schema before any edit, stopping with the source's own diagnostics on refusal. A package without `prisma7Schema` gets one generic refusal. Next steps name only generic commands and point at the chosen package's README. Supersedes D6 (Mongo needs no init change once `@prisma/orm-mongo/config` exports `prisma7Schema`) and the install question in D8 (the check uses the package init installs anyway, loaded after install and before the edits).

Open: whether the 17 target branches init already has on `main` (starter schemas, facade package names, target labels, `--probe-db` driver) move behind the target packages in this project, or only this PR stops adding more. **Awaiting Will.**
