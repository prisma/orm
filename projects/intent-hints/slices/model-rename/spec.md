# Slice spec — The hint attribute, the contract section, and model renames

**Project:** `projects/intent-hints/` · **Slice 1** · **Linear:** [TML-3422](https://linear.app/prisma-company/issue/TML-3422) · **PR:** https://github.com/prisma/orm/pull/30570 · **Branch:** `tml-3422-intent-hints-model-rename` (stacked on the shaping branch `tml-3421-rename-hints`; retarget to `main` once prisma/orm#30557 merges)

## At a glance

```prisma
model User {
  id Int @id

  @@hint(was: "Profile")
}
```

`prisma migration plan` writes a migration whose `migration.ts` contains `...this.renameTable({ table: 'Profile', to: 'User' })` and whose `ops.json` renames the table and every constraint and index named after it, the same operations a hand-written migration produces. `prisma db update` does the same against a live database, with no consent prompt, because a rename is widening. Once the database has `User`, the hint matches nothing and both commands plan nothing for it; `migration plan` says which hints it applied so the user can delete them. An index, constraint, check or policy drop no longer counts as destructive anywhere.

## Chosen design

The whole design is [`../../design.md`](../../design.md). This slice implements the rules its section 12 assigns to slice 1:

- **Grammar:** R1.1 to R1.12 with the model spec carrying `was` and `deprecated` (no field spec, no `deleted` yet); R1.14 (`was` clauses only), R1.15 to R1.17, R1.19.
- **TypeScript authoring:** R2.1 (`was` arm only), R2.3, R2.4, R2.5 (model rules), R2.7.
- **Contract section:** all of section 3 except R3.10 items 3 and 5 (tombstone consistency) and the tombstone printing of R3.15.
- **Resolution:** R4, R5.0 to R5.2, R5.6 to R5.8 (table hints only; R5.4 and R5.5 are later slices).
- **Planning:** R6.0 to R6.10 for table renames on Postgres and SQLite, including the working schema shared with the facade, the destination-driven constraint names, the control-policy warning and the consumed-hint report.
- **Destructive classification:** R7.0.
- **Guard, reporting, non-changes:** R9, R10, R11.

Nothing in this slice reads a field hint, a `deleted` hint, or `statedIntent`.

## Coherence rationale

One reviewer can hold this because every piece serves one outcome, a model rename planned from a hint, and the pieces are the chain that outcome needs: the attribute produces a hint entry, the entry rides the contract, the planner resolves it against the origin, the rename is applied through the same working-schema code the facade uses, and the plan reports it. The reclassification of non-data drops (R7.0) is in the slice because without it a SQLite rename, which rebuilds indexes, would prompt for consent and the outcome would not hold.

## Scope

**In:** everything listed under Chosen design; the Postgres and SQLite planners and facades; the CLI's `migration plan` result and human output; the error reference, the CLI and contract-psl READMEs, the prisma-8 skill references; the upgrade fragment `intent-hints-model-rename/app`; the journeys.

**Out:** field hints (slice 2), the `migration plan` refusal (slice 3), tombstones and `statedIntent` (slice 4), Mongo, namespace moves, enum value renames, named-index renames.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Introspected origins always carry constraint names | R6.10 takes the target name from the destination contract; the origin's actual name only decides whether a rename is needed. |
| Hint on a table whose control policy is not `managed` | Ignored with the R6.7 warning; the old table's drop reaches consent as a normal destructive operation. |
| `db init` (additive-only policy) | The hint produces nothing (R5.2, R4.2). |
| `migration plan --to <ref>` | The destination is a snapshot and carries no hints (R3.14). |
| Origin has both the old and the new table | `MIGRATION.HINT_CONTRADICTED` through `MIGRATION.PLANNING_FAILED` (R5.6). |
| A `was` naming a table another contract space owns | `MIGRATION.HINT_FOREIGN_TABLE` (R4.3, R5.6). |
| Mongo, Prisma 7 and Prisma 6 schemas | Already rejected; tests pin it (R3.11). |
| A hand-written migration that calls `renameTable` | Produces the same ops as the planner for the same change; the facade shares the working schema (R6.2, R6.9). |

## Slice done conditions

- The project DoD journey in `spec.md`, restricted to a model rename: on Postgres and SQLite, `migration plan` then `migrate` renames a table with rows, a unique, a foreign key, an index, a check and (Postgres) a policy; rows and objects are present under the new names; a follow-up plan is empty; `db verify --schema-only` is clean; the same change through `db update` yields the same state with no prompt; a second `db update` plans nothing.
- The storage hash of the emitted contract is unchanged by the hint, and no snapshot or ledger row carries the section.
- `pnpm fixtures:check` passes with no artifact churn.
- Every rule listed under Chosen design has the test section 13 of `design.md` names for it.

## Open questions

None. The three open points in `design.md` section 15 that touch this slice (the arktype spelling of the three-arm union; where `collectHints` is called from) are the implementer's to settle by reading the code, and the dispatch report records the choice.

## References

- [`../../design.md`](../../design.md), [`../../spec.md`](../../spec.md), [`../../design-notes.md`](../../design-notes.md)
- prisma/orm#30331 (merged): `apply-table-rename.ts`, `table-rename-calls.ts`, `table-rename-constraint-renames.ts`, `index-and-check-renames.ts`, `rename-rls-references.ts`, `table-name-case-guard.ts`, and their tests, which this slice refactors onto the working schema.
