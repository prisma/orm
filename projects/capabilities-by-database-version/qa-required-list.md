# Manual QA: the required capabilities list

What a user does, on real PostgreSQL servers, for the pull request that makes a PostgreSQL contract list the capabilities it requires. Tests cover each piece in isolation. This checks that the pieces work together as a user meets them, and that each message is one a user can act on.

For each step, record the commands, the output as printed, and a judgement: did it behave as [the decision record](../../docs/architecture%20docs/adrs/ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md) says, and can a user who does not know what a capability is act on the message? A step that cannot be run is reported as not run, with the reason. It is never skipped silently.

## Setup

- Servers: Homebrew has PostgreSQL 15 and 17 (`/opt/homebrew/opt/postgresql@15/bin`, `/opt/homebrew/opt/postgresql@17/bin`). Create a cluster for each with `initdb` under `wip/qa/`, and start each with `pg_ctl` on its own port (for example 54315 and 54317). Stop both at the end. No PostgreSQL 14 is installed, so a server older than the supported range cannot be shown; record that.
- Projects: each step works in its own folder under `wip/qa/`, using the repository's built packages the way the repository's own `init` end-to-end tests do (`test/integration/test/cli.init*.e2e.test.ts` shows how). Read those tests to find the cheapest way; do not invent a packaging mechanism.

## Steps

1. **A new project.** Run `prisma orm init` for PostgreSQL with a Prisma schema contract. Check the written `prisma.config.ts`: it lists `requiredCapabilities: [...postgres18, ...postgresDriver]` with its imports, and the project type-checks. Emit the contract. Run `db init` against PostgreSQL 17 and then `db sign`. Repeat with a TypeScript contract.
2. **A project that keeps its Prisma 7 schema.** Run `init` with `--from-prisma7-schema` on a small Prisma 7 schema. The check before writing passes, and the written config calls `prisma7Schema(path, { requiredCapabilities: [...] })` and type-checks.
3. **The list is missing, empty or malformed.** In a TypeScript contract and in a config entry: leave `requiredCapabilities` out, pass `[]`, and pass an old capability-set object. Record the type error and the refusal at emit.
4. **A feature the contract declares no dependency on.** Leave `sql.interactiveTransactions` out of the list, emit, and call `transaction()`. Record the type error, then the refusal at run time (reach it the way a JavaScript user would, without types). Then leave out `sql.insertOnConflictTarget` and call `upsert()` on a model with a second unique key that the create values could collide on; record the refusal at run time (it is not a type error).
5. **A connection that lacks a required capability.** Every shipped PostgreSQL client uses one driver, which provides `sql.interactiveTransactions`, so add a capability no component provides (such as `sql.pipelining`) to the contract's list, and create a client with `log` set. Record the type error and the warning logged when the client starts.
6. **Signing a database of another version.** Sign the PostgreSQL 15 database with a contract built from `postgres18`. Today all four version lists are equal, so it is signed; record that. The refusal for a missing database capability cannot be produced on a real server while the lists are equal; record that and name the test that covers it.
7. **Starting against a database that was never signed, and one signed for another contract.** Start the client against the PostgreSQL 15 database before signing it, and after signing it for a different contract. Record each message.
8. **The upgrade instructions.** Take one example app's config and contract as they were before this project (`git show 0b1b23915c:<path>`, the branch's merge base), copy them into a folder, and follow `upgrade-instructions/pending/capabilities-by-database-version/` for an application exactly as written. Record any step that is unclear, wrong or missing.

## Report

Write the results to `reviews/required-list-manual-qa.md` beside this file: one section per step, with commands, output and judgement. List every defect found, with the step that shows it.
