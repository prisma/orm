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

The Postgres control adapter's introspection leaves `_prisma_migrations` out of an application schema unless a contract passed to it declares a table of that name in that namespace. Every command that reads the live database goes through introspection, so all of them agree: `db verify` (lenient and strict), `db init`, `db update`, the check the runner makes after applying a migration, `db schema` and `contract infer`. The list is a fact about Postgres databases, so it lives in the Postgres adapter; the framework and the SQL family need no hook and name neither Postgres nor Prisma 7. Marker and ledger reads query `prisma_contract` directly and are unaffected. The Mongo adapter already leaves out its own `_prisma_migrations` collection the same way; there the collection is Prisma 8's own ledger, so it is left out always.

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
