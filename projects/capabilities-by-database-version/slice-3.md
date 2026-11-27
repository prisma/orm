# Slice 3: signing checks the database (PostgreSQL)

Delivers the third slice of [plan.md](plan.md). Read [spec.md](spec.md) sections 1 and 4.3, scenarios 2, 3, 5 and 11 in [design-notes.md](design-notes.md), and "Answers" in [plan.md](plan.md). It builds on slices 1 and 2, which are on this branch. This brief is our best effort: if the code shows a part of it is wrong, say so with the evidence instead of building it.

## Outcome

`db verify`, `db sign` and the commands that sign after changing a database (`db migrate`, `db update`, `db init`) refuse a PostgreSQL database that does not provide a capability the contract requires of the database, and say why in versions:

> Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 15.4. Either upgrade the database, or state version 15 for your contract, which turns off the features that need 17. If its capabilities list turns one of them on (sql.mergeReturning), remove it there.

## What changes

1. **The target answers "what does this database lack".** A function in the PostgreSQL target takes the contract's capabilities, the table and the server version the adapter read, and returns the database flags the contract requires that this server's row does not have. Only flags in the table are the database's; the connection's flags are not checked here. A server older than the table's first version lacks every flag the contract requires of the database, and a contract always requires at least the first version. A server newer than the table's last version is treated as the last version. A server whose version could not be read is a failure that says so.
2. **The message is built from the table.** From the missing flags the target works out the oldest version whose row has them all, and the newest version the database's own version satisfies, and writes the sentence above. When the server is older than the first version there is no version to state, and the message says only that this release needs that version or later. No message names a capability key where a version says it.
3. **Verification carries it.** The check runs where the SQL family's `verifySchema` already calls the target (`diffPostgresSchema` in `packages/3-targets/postgres/1-target/src/core/migrations/diff-database-schema.ts`, which already receives the contract and the introspected database node with `pgVersion`). The failure is one issue on the result, with its own result code, never downgraded to a warning by a control policy. Everything that calls `verifySchema` then refuses: `db verify`, `db sign`, and the runner.
4. **The runner refuses before it changes anything.** The PostgreSQL runner (`packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`) runs the same check before it applies a plan, so `db migrate`, `db update` and `db init` do not apply and roll back.
5. **`POSTGRES_MIN_SERVER_VERSION` has one meaning:** the table's first version. Anything that compared against it separately uses the check or the constant derived from the table.

## A known gap in what the user sees

The CLI's list of next steps after a failed verification is framework code and always offers `db update`, which cannot upgrade a server. Changing that is waiting on the operator. Build the issue text and result code so that the message above is complete on its own, and report exactly what the CLI prints after it today.

## Not in this slice

- Other targets, and settings such as MySQL's `sql_mode`.
- `orm init`.
- Docs, beyond an error-reference entry if CI requires one for a new code.

## Tests

Write each test before the code it covers. The real table's rows are equal, so tests that need a difference use a table with differing rows, as slices 1 and 2 do.

- The function: a server at, above and below the contract's requirement; older than the first version; newer than the last; unreadable; a contract that lists connection flags the table does not hold.
- The message, compared whole, for each case.
- `verifySchema` through the SQL family with the PostgreSQL target: the issue and code are on the result, and an observing control policy does not turn it into a warning.
- The runner does not apply a plan when the check fails.

## Manual QA, for the orchestrator

Against real servers: sign a PostgreSQL 14 database (refused, with the message for a server older than the first version) and a PostgreSQL 15 database (signed). Say in your report how to start those servers with what the repository already has.

## Constraints

- Do not change anything under `packages/1-framework`. If the work needs it, stop and report.
- Do not run whole test suites. Run the test files your change touches, plus `pnpm typecheck` and lint for the packages you change. CI runs the rest.
- Follow the repository's `CLAUDE.md`, `AGENTS.md` and `.agents/rules/`. Commit as you go, with sign-offs as the repository requires. Do not push.
