# Migration statements

Project folder for [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9), second attempt. The user states migration intent as statements on the `migration plan` and `db update` command line, in contract vocabulary, and the planner refuses data loss that no statement covers.

- [`spec.md`](./spec.md) — project spec: purpose, the statement vocabulary, non-goals, cross-cutting requirements, project DoD.
- [`design-notes.md`](./design-notes.md) — the design discussion of 2026-10-05: the verb and noun matrix, the scenarios that stress it, prior art, alternatives rejected, and what changed from the shelved first attempt.
- [`plan.md`](./plan.md) — slice plan.
- `slices/<slice>/` — per-slice spec, plan and reviews.

The first attempt, which stated intent in the contract source with `@@hint(was:)`, is shelved in prisma/orm#30557 and prisma/orm#30570 under `projects/intent-hints/` on those branches. Its planner substrate is reused here.

Everything in this folder is transient. At close-out the durable parts move to `docs/` and an ADR, and the folder is deleted.
