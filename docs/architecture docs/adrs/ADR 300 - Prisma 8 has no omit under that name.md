# ADR 300 — Prisma 8 has no `omit` under that name

**Status:** Accepted
**Date:** 2026-10-22

---

## Decision

Never under that name. Prisma 8 gets its own way to leave fields out of a result. Use instead, until it ships: name the fields you want with `select(...)`.

## Context

The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "`omit` under that name" under Never. Will Madden decided it in the planning discussion of 2026-09-28 and 2026-09-29, which the GA plan's decisions record: "Never under that name. Prisma 8 gets its own way to leave fields out." ([Query features: decided](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#query-features-decided)). The source gives no reason. The plan marked the design of the replacement done on 2026-10-07 ([plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md?plain=1#L90)).

## Consequences

No revisit-if condition is recorded.
