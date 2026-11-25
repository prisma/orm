# Slice 1: the database version selects the contract's capabilities (PostgreSQL)

Delivers the first slice of [plan.md](plan.md), for PostgreSQL. Read [spec.md](spec.md) sections 1, 3 and 4.1, and the answers recorded in [plan.md](plan.md) under "Before the first slice". This brief is our best effort: if the code shows a part of it is wrong, say so with the evidence instead of building it.

## Outcome

A PostgreSQL project states its database version where its contract is written. The emitted `contract.json` lists the capabilities that version provides, plus those of the connection, and nothing else. A contract for a version without a capability does not type-check a feature that needs it.

## What changes

1. **The target holds the table.** `packages/3-targets/postgres/1-target` gains the table of which PostgreSQL version provides which capability, for versions 15, 16, 17 and 18, and a function that resolves a version value to that row. The database flags move there from the adapter's list. No flag differs between 15 and 18 today, so the four rows are equal; the table is typed so that a row's flags are known at type level (`as const`). The supported version values are the table's keys (`15 | 16 | 17 | 18`); a value outside them is a type error and, for JavaScript callers, an error at load that names the supported versions. `POSTGRES_MIN_SERVER_VERSION` is derived from the table's first row.
2. **The facade resolves the capabilities once.** It looks up the version's row, merges the `capabilities` list over it in order, keeps the flags that are on, and hands the result to the contract source. Every control descriptor declares no capabilities, so the framework's merges at emit add nothing. Nothing in `packages/1-framework` changes. See "Answers" in [plan.md](plan.md) for why this replaced a target descriptor that carries the row.
3. **The connection's capabilities are a list the facade fills in.** The contract's capabilities are the target's row for the version, plus a `capabilities` list: an array of capability sets, each the nested object a component declares (`{ sql: { … } }`), merged in order. By default the facade fills it with the capabilities of the adapter and the driver its client uses at runtime: `[adapter.capabilities, driver.capabilities]`. A project on another driver or adapter writes the list, which replaces the default. Extensions keep contributing through the `extensions` input and config entry, as today. The list is the only path by which the adapter and the driver reach the contract: the config's control adapter and driver are the stack that migrates, not the stack the application runs on, so they add nothing at emit. Each flag is declared by the component that knows the fact. The database facts move to the target's table. What stays on the runtime adapter is what it can write as a query, and on the driver what the connection provides; if no PostgreSQL flag is of those kinds yet, their sets are empty and the list still exists and is tested with sets that are not.
4. **Flags nothing reads are removed:** `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `postgres.returning`, `sql.enums`, and the extension flags `pgvector.cosine`, `postgis.geometry` and `paradedb/bm25`. Before removing `postgres.returning`, check the ORM client's search for `returning` in every namespace (`packages/3-extensions/sql-orm-client/src/collection-contract.ts`) still finds `sql.returning`. Search for any other reader by key, including computed keys, before removing each.
5. **A contract written in TypeScript** states the version in the facade's `defineContract` (`packages/3-targets/postgres/9-facade/src/contract/define-contract.ts`): a required `version` input, and the optional `capabilities` list of point 3. The facade binds the target for that version. The type-level capabilities (`DerivedCapabilities`) follow the version's row.
6. **A contract written in the Prisma schema language** takes the version in the facade config's contract entry: `contract: { path: './prisma/contract.prisma', version: 17, capabilities?: [driver.capabilities, …] }`. A bare string `.prisma` path is refused at load with a message that says to state the version. A bare `.ts` path stays valid, since that contract states its own version; a `version` in the config for a `.ts` contract is refused, so the version is stated in one place. The PSL provider receives one capability list and never a version.
7. **Examples and test fixtures** that author contracts are updated to state version 18 (the newest), so their capability lists change only by the removed flags.

## Not in this slice

- `orm init` writing the version. It needs a change to the framework's init templates, which is waiting on the operator. Leave init and its tests alone.
- The profile hash covering capabilities. It is being settled with the pull request that fixes the hash rules (prisma/orm#31203). Do not change `computeProfileHash` callers.
- Regenerating committed fixtures, examples' emitted contracts and snapshots. That waits for #31203 to merge. Write the code and the tests; list what would need regenerating.
- The runtime merge in `packages/2-sql-family/5-runtime/src/sql-context.ts`, and any check of the stack or the database.

## Tests

Write each test before the code it covers.

- The table and its resolution: each supported version resolves to its row; an unsupported value is refused with the supported list.
- Emit, through both authoring routes: a contract for a version lists that row's flags and the connection's, and none of the removed ones.
- Type level, with `expectTypeOf`: using a table that has a flag only from 17 (built in the test with the same types and resolution as the real one), a contract for 16 does not offer the feature behind that flag and a contract for 17 does. Name in the test why it uses its own table: no PostgreSQL feature Prisma supports needs a version above 15 today.
- The config: a `.prisma` path without a version is refused with the message; a `.ts` contract with a version in the config is refused.

## Constraints

- Do not change anything under `packages/1-framework`. If the work needs it, stop and report.
- Do not run whole test suites. Run the test files your change touches, plus `pnpm typecheck` and lint for the packages you change. CI runs the rest.
- Follow the repository's `CLAUDE.md`, `AGENTS.md` and `.agents/rules/`. Commit as you go, with sign-offs as the repository requires. Do not push.
</content>
</invoke>
