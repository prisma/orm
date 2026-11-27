# Manual QA: PostgreSQL's `_prisma` space and the schema rename

Run as a user would: the built command-line tool from this branch, an example application, and a real PostgreSQL database. The point is to see what a person upgrading from the last release candidate sees, which the automated tests reach only through fixtures.

## Setup

- **The new release:** this branch's build. Do not rebuild for QA; if the build is missing or stale, say so and stop.
- **The last release candidate:** installed from the registry into a scratch project under the gitignored `wip/qa/` folder, at the newest published `8.0.0-rc` version of the PostgreSQL package and the command-line tool. This is the only install, and it is one command.
- **A database:** a PostgreSQL server the repository's own tooling starts (the one the integration tests use), with a new empty database per scenario.
- **A project:** a small application with one model and two migrations. Use the same contract source for the release candidate and the new release, so the only thing that changes is the Prisma version.

Record for every step the exact command, its full output, and the result of the SQL checks. Nothing in this script plants a defect or needs a second build.

## Scenarios

1. **A new database.** `db init` with the new release. Check: schema `_prisma` exists with `marker`, `ledger` and `contract`; no `prisma_contract`; a `marker` row and a `ledger` row for space `_prisma`; the command's output says once that the records Prisma keeps for itself were brought up to date and does not list `_prisma` among the spaces. Then `db verify`, `migration status` and `migration log`: clean, and `_prisma` is not shown.
2. **A database set up by the release candidate.** With the release candidate: `db init`, then apply the first migration with `db migrate`. Record the tables and rows in `prisma_contract`. Then, with the new release and the second migration pending: `db migrate`. Check: the schema is `_prisma`; every row recorded before is still there, unchanged; the `_prisma` space's rows exist; the second migration was applied on top of the first, not planned from an empty database; the output says the records were brought up to date. Run `db migrate` again: nothing changes and the line is not printed.
3. **Commands that only read, before the upgrade.** On a release-candidate database, with the new release: `db verify`, `db verify --schema-only`, `migration status`, `migration log`, `db migrate --show` (or the dry run), `db init --dry-run`, `db update --dry-run`. Each must report `CONTRACT.PRISMA_SPACE_BEHIND`, name `prisma db migrate`, and leave the schema named `prisma_contract`. Read each message as a user: is it clear what happened and what to run?
4. **The application, before and after.** Start the example application with the new release against a release-candidate database: it logs one warning that names `prisma db migrate`, and its queries run. After `db migrate`: no warning.
5. **A role that does not own the old schema.** Create `prisma_contract` as one role (the release candidate's `db init`), then run the new `db migrate` as a second role that has full grants on the schema and its tables but does not own it. Check: the command stops before changing anything, the message says how to find the owner and how to give the migrating role ownership, and following that advice makes the next run succeed.
6. **Both schemas.** On an upgraded database, create an empty schema named `prisma_contract`. Run `db migrate`: it carries on, since `_prisma` is up to date. Then on a release-candidate database, create an empty schema `_prisma` and run `db migrate`: it stops and says what to do.
7. **A command the database's change policy refuses.** On a release-candidate database whose policy allows only `migrate`, run the new `db update`. Check: it is refused with the policy error, and the schema has been renamed. Read the output: does the user learn both things?
8. **The release candidate's tool against an upgraded database.** Run the release candidate's `db verify` and `db migrate` against a database the new release has brought up to date. Record exactly what happens, including whether it creates `prisma_contract`. This is behaviour we cannot change; the upgrade instructions must describe it truthfully, so compare with `upgrade-instructions/pending/prisma-tables-in-prisma-schema/app/instructions.md`.
9. **The upgrade instructions.** Follow `upgrade-instructions/pending/prisma-tables-in-prisma-schema/app/instructions.md` literally on the scratch project, as an agent upgrading an application would. Every search it tells you to run, run. Report each step that is unclear, wrong, or tells you to do something that does not work.

## Report

Written to `projects/prismas-own-tables/manual-qa-reports/`, one file named for the date. For each scenario: pass or fail, the evidence, and every message whose wording a user would stumble on, quoted. A failure is reported, not fixed.
