# ADR 298 — Prisma 8 has no fluent relation API

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 296 — Prisma 8 has no `relationLoadStrategy`](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)

---

## Decision

Never. Prisma 8 has no fluent relation API such as `findUnique(...).posts()`. Use instead: load the related rows with `.include(...)`, and the database joins them ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

## Context

The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "the fluent relation API" under Never. Will Madden decided it in the planning discussion of 2026-09-28 and 2026-09-29. The GA plan's decisions record the reason: "Never. It belongs to the Prisma 7 query style" ([Query features: decided](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#query-features-decided)).


## Consequences

No revisit-if condition is recorded.
