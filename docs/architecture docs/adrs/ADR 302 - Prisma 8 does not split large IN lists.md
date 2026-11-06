# ADR 302 — Prisma 8 does not split large `IN` lists

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 296 — Prisma 8 has no `relationLoadStrategy`](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)

---

## Decision

Never. Prisma 8 does not split a large `IN` list into several queries. Use instead: load related rows with `.include(...)`, which the database joins, so Prisma 8 does not create large `IN` lists itself ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

## Context

Prisma 7 splits a large `in` list into several queries. The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "splitting large `IN` lists" under Never. The GA plan's decisions record the reason, from Will Madden on 2026-09-30: "In Prisma 7 the problem came from joining in memory. Prisma 8 joins in the database, so it does not create large `IN` lists itself" ([Tasks to decide or fix before GA](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#tasks-to-decide-or-fix-before-ga)).

## Consequences

No revisit-if condition is recorded.
