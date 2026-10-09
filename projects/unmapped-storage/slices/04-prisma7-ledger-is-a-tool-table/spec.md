# Slice 4: Prisma 7's ledger is a tool table

_Parent project: `projects/unmapped-storage/`. Linear: TML-3453. Independent of slices 2 and 3. Outcome: after Prisma 8 takes over migrations from a Prisma 7 project, `db verify --strict` reports nothing unclaimed, and `contract infer` does not print Prisma 7's ledger as a model._

## At a glance

```bash
prisma db verify --strict --json
# before: exit 4, "unclaimed": ["_prisma_migrations"]
# after:  exit 0, "unclaimed": []
```

## Chosen design

Prisma 7 records applied migrations in a table `_prisma_migrations` in the schema it migrates (`public` by default). It is the earlier tool's bookkeeping, not the application's schema: Prisma 7's own `db pull` never introspects it. Prisma 8 keeps its own bookkeeping in the `prisma_contract` schema, which no contract declares and no verify reports.

The Postgres target names the tables in an application schema that belong to a migration tool, not to the application: `_prisma_migrations`. This is a fact about Postgres databases the target owns, so it lives on the target (its control adapter or descriptor), not in the framework or the SQL family, and the framework and family read it through an existing or new target hook. Two consumers leave such tables alone:

- **`db verify`.** A tool table that no contract declares is never an unclaimed element and never a schema issue, in lenient or strict mode. If a contract does declare a table of that name, it is treated like any declared table.
- **`contract infer`.** A tool table is not printed as a model.

The planner needs nothing: it already never drops a table that no contract declares unless asked, and a tool table is never in a contract. Check that `db update` does not propose dropping it, and leave it out of the plan if it does.

Rejected: declaring the ledger in the contract. It puts a table with no model into every Prisma 7 contract, changes every Prisma 7 project's storage hash, and makes `contract print` refuse every Prisma 7 contract at cutover (no syntax declares a table with no model yet). See `projects/unmapped-storage/design-notes.md`.

## Scope

In: the Postgres target and the verify and infer paths that read the tool-table list; the handover test in `examples/prisma7-adoption` (tighten `verifyOnlyLedgerUnclaimed` to nothing unclaimed, and the README lines that describe it); the integration tests that list `_prisma_migrations` as an expected extra; the error reference or CLI docs if they describe it.

Out: SQLite and MongoDB (Prisma 7 SQLite is not a side-by-side target; Mongo's `_prisma_migrations` is Prisma 8's own ledger collection and unrelated).

## Slice-specific done conditions

- The handover test asserts `db verify --strict` exits 0 with nothing unclaimed on the database Prisma 7 built, after each edit.
- `contract infer` on a database with `_prisma_migrations` prints no model for it (test).
- A contract that declares a table named `_prisma_migrations` is verified like any other declared table (test).

## References

- `projects/prisma7-contract-source/spec.md`, "Infer and verify should ignore `_prisma_migrations`".
- `packages/1-framework/3-tooling/migration/src/aggregate/unclaimed-elements.ts`, `packages/1-framework/3-tooling/cli/src/utils/combine-verify-results.ts`, `packages/2-sql/9-family/src/core/diff/schema-verify.ts`.
