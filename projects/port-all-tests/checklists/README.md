# Porting checklists — the accounting ledger

One checkbox line per in-scope source test, enumerated up-front from the pinned checkouts (`prisma/prisma@a6d0155`, `prisma/prisma-engines@e922089`). See [`../spec.md`](../spec.md) § Accounting for the full protocol.

**Checkbox protocol:** boxes start `[ ]`. Only the Opus reviewer sub-agent checks `[x]`, and only once satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry (for the legacy secondary suites, (d) marked `covered-by` an already-ported functional test). Implementer sub-agents never check boxes. A box is unchecked again when its non-ported entry's reason stops holding; the line then ends `→ non-ported (not yet ported)` or `→ non-ported (needs re-examination)`, matching the status at the start of the entry (see [`test/integration/test/ports/README.md`](../../../test/integration/test/ports/README.md)).

| Checklist | Source segment | Tests |
| --- | --- | --- |
| [prisma-functional-0-l.md](./prisma-functional-0-l.md) | `packages/client/tests/functional/` suites 0–l | 730 |
| [prisma-functional-m-z.md](./prisma-functional-m-z.md) | `packages/client/tests/functional/` suites m–z | 540 |
| [prisma-functional-issues.md](./prisma-functional-issues.md) | `packages/client/tests/functional/issues/` regressions | 153 |
| [prisma-migrate-cli.md](./prisma-migrate-cli.md) | `packages/migrate` + `packages/cli` test suites | 596 |
| [prisma-legacy.md](./prisma-legacy.md) | `packages/integration-tests` + client legacy integration (secondary) | 840 |
| [engines-queries.md](./engines-queries.md) | query-engine `tests/queries/` | 873 |
| [engines-writes.md](./engines-writes.md) | query-engine `tests/writes/` | 638 |
| [engines-new-raw.md](./engines-new-raw.md) | query-engine `tests/new/` + `tests/raw/` | 323 |
| [engines-sql-migration.md](./engines-sql-migration.md) | `schema-engine/sql-migration-tests` | 831 |
| [engines-sql-introspection.md](./engines-sql-introspection.md) | `schema-engine/sql-introspection-tests` | 617 |
| [engines-mongo-schema.md](./engines-mongo-schema.md) | `schema-engine/connectors/mongodb-schema-connector` | 137 |
| [engines-schema-cli.md](./engines-schema-cli.md) | `schema-engine/cli` JSON-RPC black-box tests | 26 |
| **Total** | | **6,304** |

Line format: `` - [ ] `<test identifier>` — <what it verifies> [providers|connectors: <tags>] `` with optional markers (`[each]`, `[skipped]`, `[matrix: relation_link]`, …). Connector/provider tags are copied verbatim from source gating (`_matrix.ts`, `only(...)`/`exclude(...)`/`tags(...)`) and drive batch scoping — e.g. tests exclusive to unsupported databases go straight to `non-ported.md` with the tag as evidence.
