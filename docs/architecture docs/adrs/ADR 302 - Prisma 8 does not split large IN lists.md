# ADR 302 — Prisma 8 does not split large `IN` lists

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 296 — Prisma 8 has no `relationLoadStrategy`](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)

---

## Decision

Never for the user's own filters. Prisma 8 does not split a large `in` list that the user writes into several queries; the database receives the list as written. To load related rows, use `.include(...)`, which the database joins where it can run the one-query include ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

Where the database cannot run the one-query include, the ORM client loads includes with one query per relation, filtered by the identity of the parent rows ([ADR 164](ADR%20164%20-%20Repository%20Layer.md)). Those key lists are the ORM client's own, not the user's, and it splits them into statements of at most 10 000 bound parameters and an estimated 1 MiB of key values, so a statement stays within the databases' bind-parameter limits and far below MySQL's and MariaDB's default packet size.

## Context

Prisma 7 splits a large `in` list into several queries. The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "splitting large `IN` lists" under Never. The GA plan's decisions record the reason, from Will Madden on 2026-09-30: "In Prisma 7 the problem came from joining in memory. Prisma 8 joins in the database, so it does not create large `IN` lists itself" ([Tasks to decide or fix before GA](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#tasks-to-decide-or-fix-before-ga)). The motivation is to do in the database whatever the database can do and to avoid the in-memory joins of Prisma 5 to 7.

## Consequences

No revisit-if condition is recorded.
