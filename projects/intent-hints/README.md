# intent-hints

The migration planner refuses destructive operations by default. A `@@hint(...)` / `@hint(...)` attribute in the contract source states the intent the diff cannot infer, so the planner can act without a hand-written migration: `was` for a rename, `deleted` for a removal the user confirms, and later `deprecated` for an object the application no longer needs but the database may keep.

- [`spec.md`](./spec.md) — purpose, settled decisions, cross-cutting requirements, project DoD.
- [`design.md`](./design.md) — the implementation specification: numbered rules for syntax, the contract section, resolution, planning, consent, reporting and tests. Slices cite its rules.
- [`plan.md`](./plan.md) — slice sequencing.
- [`design-notes.md`](./design-notes.md) — the reasoning behind each decision, the recovered design it builds on, and the alternatives rejected.
- **Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9) · plan issue [TML-3421](https://linear.app/prisma-company/issue/TML-3421) · **Branch:** `tml-3421-rename-hints` (named before the project widened from renames to intent)

Transient project artifact. Deletes at close-out; the durable decisions land as an ADR and in the Data Contract and Migration System subsystem docs.
