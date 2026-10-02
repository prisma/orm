# Project plan: row locking clauses on a select

Spec: [spec.md](spec.md). Design: [design.md](design.md). Linear: P-TML-1148.

## Slices

### Slice 1: typed SQL builder (TML-3402)

Outcome: `db.sql.<ns>.<table>.select(...).forUpdate({ skipLocked: true }).build()` renders `... FOR UPDATE SKIP LOCKED` on Postgres, the four methods and three option keys exist only under their flags, and a SQLite contract has none of them.

Builds on: nothing. Hands to: `LockingClause` and `SelectAst.locking` exported from `@internal/sql-relational-core/ast`; the seven flags reported by the Postgres adapter and documented; the Postgres renderer printing the clause and refusing unreported ones; `withLocking` on `SelectAst`.

Slice spec and plan: [slices/1-sql-builder/](slices/1-sql-builder/spec.md).

### Slice 2: ORM client (Linear ticket in P-TML-1148, blocked by TML-3402)

Outcome: `db.orm.<ns>.<Model>.where(...).forUpdate({ skipLocked: true }).first()` renders the clause `OF` the model's table, and the refusals in the design's table hold.

Builds on: slice 1's hand-off. Hands to: nothing further in this project.

### Slice 3, only if asked: `include` with a lock, and locked subqueries

Not planned. Recorded under "Delivery" in [design.md](design.md).

## Sequence

Stack: slice 1, then slice 2. Slice 2 needs slice 1's node and flags.

## Open items

- Slice 2 must add a test that `bindSelectAst` in `packages/3-extensions/sql-orm-client/src/where-binding.ts` carries `locking` through; D1 of slice 1 added the field there without a test because the ORM has no way to set it yet.

- `AdapterProfile.capabilities` in `packages/2-sql/4-lanes/relational-core/src/ast/adapter-types.ts` is typed `Record<string, unknown>`, so the Postgres runtime adapter passes its capability constant to the renderer rather than `this.profile.capabilities`. Typing the profile field as `CapabilityMatrix` touches every adapter and is a follow-up ticket to file after slice 2.
- Mapping SQLSTATE `55P03` to a structured error code is a follow-up ticket to file after slice 2.
- Porting the Prisma 7 test "high concurrency with SET FOR UPDATE" waits on a real Postgres server in the integration suite.

## Close-out

- [ ] Verify the definition of done in [spec.md](spec.md).
- [ ] Move [design.md](design.md) to `docs/architecture docs/adrs/` as an ADR and update its status.
- [ ] Strip repo-wide references to `projects/select-row-locking/`.
- [ ] Delete `projects/select-row-locking/`.
