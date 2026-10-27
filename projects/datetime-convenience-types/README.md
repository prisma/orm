# Convenience date and time types

Project folder for [Convenience date and time types](https://linear.app/prisma-company/project/convenience-date-and-time-types-6a969ca1c76e). PSL gets `DateTime`, `Date`, `Time` and `Duration`, one type per concept in the application, each choosing one of PostgreSQL's explicit date and time types from its `as:` and `storage:` arguments, with defaults that need no Temporal polyfill.

- [`spec.md`](./spec.md) — purpose, settled decisions, non-goals, cross-cutting requirements, project DoD.
- [`design-notes.md`](./design-notes.md) — the design discussion of 2026-10-21 and 2026-10-22, with the alternatives rejected.
- [`plan.md`](./plan.md) — slice plan.
- `slices/<slice>/` — per-slice spec, plan and reviews.

The decision record is [ADR 279](../../docs/architecture%20docs/adrs/ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md).

Everything in this folder is transient. At close-out the durable parts move to `docs/` and the ADR, and the folder is deleted.
