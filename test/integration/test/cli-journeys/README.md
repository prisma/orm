# CLI Journey Tests

End-to-end tests organized by real-world user workflow, not by individual CLI command.
Each journey composes multiple CLI commands against evolving database state in a single `it()` block.

These tests are the primary regression suite for the Prisma 8 CLI's database lifecycle commands.

## Running

```bash
pnpm test:journeys
```

`init-journey.e2e.test.ts` (the 4-cell target × authoring pack+install matrix) is excluded from `pnpm test:journeys` and `pnpm test` unless `RUN_INIT_JOURNEY=1` is set; it runs nightly via `pnpm test:init-journey` (see `.github/workflows/integration-nightly.yml`).

## Test files

### Happy paths

| File | What it covers |
|---|---|
| `init-journey.e2e.test.ts` | **`prisma orm init` inner loop** across all four (target × authoring) cells: scaffold, pack + real install against workspace tarballs, emit, plan, self-emit, apply, run user code. Nightly-only — excluded from PR runs unless `RUN_INIT_JOURNEY=1` |
| `greenfield-setup.e2e.test.ts` | New project with empty database: emit a contract, dry-run init to preview operations, apply init, confirm idempotency on re-run, verify marker and schema (`db verify`, `db verify --schema-only`, `db verify --strict`), inspect the live schema with `db schema`, and check JSON output variants of full and schema-only verify |
| `composite-pk-greenfield.e2e.test.ts` | **Composite primary key greenfield**: emit a PSL contract for a junction table, dry-run and apply `db init`, inspect the live Postgres primary-key constraint order, verify duplicate inserts fail on that constraint, then round-trip through `contract infer` and schema verification |
| `db-schema-discovery.e2e.test.ts` | **Live schema discovery**: inspect an unmanaged database with `db schema`, apply manual DDL, inspect again with `db schema --json`, and confirm the command stays read-only throughout |
| `schema-evolution-migrations.e2e.test.ts` | **Migration lifecycle**: plan a migration, show its details, verify the planned directory, check status (offline + online), apply, confirm all applied, db verify. Also covers edge cases: apply when already up-to-date (noop), plan when contract is unchanged (noop), show by path and not-found. **Init-to-migrations transition**: initialize with `db init`, then switch to the migration workflow |
| `multi-step-migration.e2e.test.ts` | Planning two migrations (base → additive → v3) without applying either, then batch-applying both at once. Verifies pending/applied status reporting |
| `migration-plan-details.e2e.test.ts` | **Plan JSON envelope**: full `--json` output shape with operations, attestation round-trip (plan → verify). **Destructive planning**: drop-column migration produces destructive operation class |
| `migration-apply-edge-cases.e2e.test.ts` | **No path**: apply fails when contract changed without planning. **Resume**: partial failure (NOT NULL violation) leaves marker at last success, re-apply resumes. **Destructive apply**: single drop-column migration verifies column removed + marker updated. **Multi-step destructive**: three-migration batch (create → add → drop) in one apply |
| `db-update-workflows.e2e.test.ts` | **Direct update**: `db update` without migrations (additive-only, dry-run, noop). **Destructive update**: drops a column, tests `--no-interactive` rejection, `--json` error envelope, and `--json -y` auto-accept. **Re-init conflict**: `db init` on an already-initialized DB with a different contract fails; recovery via `db update` |
| `contract-infer-workflow.e2e.test.ts` | **PSL inference workflow**: refresh `contract.prisma` from the live database with `contract infer`, emit from the inferred PSL, verify the schema, and confirm a second infer is stable |
| `brownfield-adoption.e2e.test.ts` | **Adopt Prisma on existing DB**: infer a PSL contract from the live DB, emit matching artifacts, `db verify --schema-only`, sign, verify, and then evolve via `db update`. **Schema mismatch**: emit a contract that doesn't match the DB, observe sign / schema-only verify failures, fix contract, retry |

### Graph features and refs

| File | What it covers |
|---|---|
| `rollback-cycle.e2e.test.ts` | **Rollback cycle (P-2)**: C1→C2→C1 creates a cycle. `findLeaf` fails with `NO_TARGET`. Plan with `--from` bypasses cycle, apply recovers |
| `divergence-and-refs.e2e.test.ts` | **Same-base divergence (P-4)**: two edges from C1 (C1→C2, C1→C3). Status without `--ref` fails with `AMBIGUOUS_TARGET`. Ref-based resolution routes apply to the correct branch |
| `adopt-migrations.e2e.test.ts` | **Adopting migrations (P-9)**: DB managed via `db update` (at C2). Baseline migration EMPTY→C2 is no-op. Incremental C2→C3 applies normally. Status shows both migrations applied |
| `data-transform-strategies.e2e.test.ts` | **Planner-assisted dataTransform strategies**: one scenario per Postgres call strategy (NOT NULL backfill, nullable tightening, text→int4 type change). Planner emits placeholder stubs, the test fills them in, re-emits in-process, applies, and asserts data + column shape |
| `diamond-convergence.e2e.test.ts` | **Diamond convergence**: Two environments (staging, production) diverge from C1 via independent branches (C1→C2→C3 and C1→C4), then converge to C5. Uses two PGlite instances with separate configs sharing the same migration graph on disk. Verifies both DBs reach C5 via their respective merge migrations and status shows 0 pending for both refs |
| `interleaved-db-update.e2e.test.ts` | **Interleaved db update + migrations**: User on migrations (∅→C1→C2) runs `db update` to C3 instead of `migration plan`. Retroactive `migration plan` creates the C2→C3 edge, `migration apply` is a noop (DB already at C3). Future migrations (C3→C4) resume normally. Documents that `migration plan` is offline (uses latest migration target, not DB marker) |

### Drift detection and recovery

| File | What it covers |
|---|---|
| `drift-schema.e2e.test.ts` | **Manual schema change with unchanged marker**: a DBA drops a column; `db verify` now fails by default because it runs schema verification, while `db verify --marker-only` reproduces marker-only verification. **Extra column drift**: DBA adds a column via manual DDL; tolerant `db verify` / `db verify --schema-only` pass, strict `db verify` fails; recover by expanding the contract and running `db update` |
| `drift-marker.e2e.test.ts` | **Missing marker**: contract emitted but `db init` never run — `db verify` fails, `db verify --schema-only` shows the schema mismatch, init recovers. **Stale marker**: contract changed without updating DB — verify fails, schema-only verify shows the missing column, `db update` recovers. **Mixed-mode evolution**: iterate through multiple contract versions using `db update` (no migration files). **Corrupt marker**: marker row overwritten with garbage — verify fails, `db verify --schema-only` passes (schema intact), `db sign` recovers |
| `drift-migration-dag.e2e.test.ts` | **Chain breakage**: after building a migration history, a migration directory is deleted from disk. `migration apply` fails (no path to destination), recovery by re-planning the missing edge |

### Error scenarios (no database needed)

| File | What it covers |
|---|---|
| `config-errors.e2e.test.ts` | `contract emit` fails gracefully for: missing config file, explicit nonexistent path, invalid TypeScript syntax, config missing the contract field |
| `connection-and-contract-errors.e2e.test.ts` | **Missing connection**: `db verify` without a database connection configured. **No contract yet**: db init/verify fail when contract.json hasn't been generated. **Target mismatch**: contract.json tampered to say "mysql" while config targets postgres. **Unmanaged DB**: `db init` on a database with pre-existing tables created via raw SQL |
| `help-and-flags.e2e.test.ts` | Global CLI flags: `--no-color` suppresses ANSI codes, `-q` reduces output, `-v` increases output |

## Design principles

- **Single `it()` per journey**: Steps run sequentially within one test, identified by assertion labels (e.g., `expect(exitCode, 'A.03: db init').toBe(0)`). This avoids test-ordering fragility and keeps each test self-contained.
- **Database isolation**: Each journey (`describe` block) gets its own PGlite instance via `beforeAll`/`afterAll`. Journeys within a file share no database state.
- **Parallel at file level**: Vitest parallelizes across files (4 workers). Steps within a journey are sequential.
- **Behavior over flags**: Assertions target exit codes, JSON shape keys, and state transitions — not exact flag names or output strings.
