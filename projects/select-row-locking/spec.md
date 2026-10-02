# Project spec: row locking clauses on a select

Linear project: P-TML-1148. Design: [design.md](design.md), published as prisma/orm#30542. Tracks prisma/orm#30531.

## Purpose

Applications that must serialise two transactions on the same row, and work queues that claim jobs with `SKIP LOCKED`, can write the locking clause through the typed SQL builder and the ORM client instead of raw SQL, on any target whose adapter reports the capability.

## Scope

In: everything under "The decision" and "Delivery" in [design.md](design.md). Out: everything under "Out of scope" there.

## Cross-cutting requirements

- Every method and option exists in the types only when its capability flag is reported, and is refused at run time without it, as `distinctOn` is today.
- The syntax tree node is target-neutral. Renderers own the syntax. A renderer never drops a lock silently.
- Names are the SQL names in camel case, and one name serves the tree, the builder and the ORM.

## Definition of done

- Slice 1 (TML-3402) and slice 2 merged, each with the tests and documents the design lists for it.
- `packages/2-sql/4-lanes/sql-builder/STATUS.md` lists row locking as supported.
- `docs/reference/capabilities.md` documents the seven flags.
- The Asks ask `01a0f2b5-d0cf-77ab-8bac-e058743af0a3` is satisfied and Emie's X thread has been answered.
- `design.md` has moved to `docs/architecture docs/adrs/` as an ADR and this folder is deleted.
