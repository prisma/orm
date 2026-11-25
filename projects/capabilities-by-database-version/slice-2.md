# Slice 2: the client goes by the contract (PostgreSQL)

Delivers the second slice of [plan.md](plan.md). Read [spec.md](spec.md) sections 1, 3 and 4.4, scenario 13 in [design-notes.md](design-notes.md), and "Answers" in [plan.md](plan.md). It builds on slice 1, which is on this branch. This brief is our best effort: if the code shows a part of it is wrong, say so with the evidence instead of building it.

## Outcome

The client offers what the contract lists and nothing else. A stack that does not provide a capability the contract requires fails to type-check where the client is created, and is reported when the client is created. Interactive transactions are the first capability a connection provides: a contract that does not list them has no `db.transaction(...)`.

## What changes

1. **The runtime stops merging.** `createExecutionContext` (`packages/2-sql-family/5-runtime/src/sql-context.ts`) no longer merges the capabilities of the target, adapter, driver and extensions over the contract's. The contract's list is the list. The tests of the merge ("capability folding" in `5-runtime/test/sql-context.test.ts`) are replaced by tests that the contract's list is what the query builder and the ORM client see. For MySQL, MariaDB and SQLite this changes nothing for an emitted contract, because emit already wrote their adapter's flags into it; check the tests that build a contract by hand for those targets.
2. **The PostgreSQL driver declares interactive transactions.** `sql.interactiveTransactions: true` in the driver's set. It reaches the contract through the default `capabilities` list of slice 1. Update the test that pins the default connection list: this is the last change to it before `8.0`.
3. **`db.transaction(...)` exists only when the contract lists the flag.** In the PostgreSQL facade (`9-facade/src/runtime/postgres-members.ts`), for the client, the serverless connection and the nested transaction context. The Supabase client follows if it shares the members; if it has its own, give it the same condition.
4. **The stack is checked against the contract at compile time.** Where the facade creates a client, the contract's capabilities that are not the database's must be provided by the adapter's and the driver's sets, or it is a type error that names the missing capability. The database's flags are those in the target's table; signing answers for them, not the client. The facade's stack is fixed today, so make the check a type over (contract, table, adapter set, driver set), bound to the real ones in the public functions, and test it with a driver set that lacks interactive transactions, the way slice 1 tests the table.
5. **The same check runs when the client is created,** on the values in `contract.json`. A mismatch is reported the way a signature that does not match is reported: a warning through the runtime's log, once, with a code of its own, the missing capabilities, and what to do (state a `capabilities` list that matches the driver the application runs with, emit, and sign again). The setting that turns off the signature warning turns this one off too. It needs no database, so it runs at creation and not at first use. Decide where the set of the database's flags and the driver's set reach the check without changing `packages/1-framework`; a field on a type the SQL family owns is fine, a second meaning for an existing field is not.

## Not in this slice

- What the ORM client does about its own implicit transactions for a contract without the flag, and `connection().transaction()`. No driver without interactive transactions exists yet; this is decided with the first one.
- An option to pass another driver to the facade's client.
- The other targets' drivers declaring the flag (slice 4). Shared code must not start requiring the flag from them.
- Any check of the database; `orm init`; fixture regeneration (list what would need it); docs.

## Tests

Write each test before the code it covers.

- A contract with a flag its stack's descriptors used to add, and one without: the builder and the ORM client offer the feature only for the first.
- Type level: with the real stack, a contract from the default list has `db.transaction`; a contract whose list lacks the flag does not. With a test driver set lacking the flag, a contract that requires it is a type error at client creation.
- Runtime: the same two cases produce no warning and one warning with the code, and no warning when the setting is off.
- The pinned default connection list.

## Constraints

- Do not change anything under `packages/1-framework`. If the work needs it, stop and report.
- Do not run whole test suites. Run the test files your change touches, plus `pnpm typecheck` and lint for the packages you change. CI runs the rest.
- Follow the repository's `CLAUDE.md`, `AGENTS.md` and `.agents/rules/`. Commit as you go, with sign-offs as the repository requires. Do not push.
</content>
