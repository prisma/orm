# ADR 304 — Prisma 8 has no automatic batching

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 003 — One Query One Statement](ADR%20003%20-%20One%20Query%20One%20Statement.md)

---

## Decision

Never. Prisma 8 does not combine separate lookups into one query on the user's behalf. Use instead: load related rows with `.include(...)`, which the database joins ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

## Context

Prisma 7 batches `findUnique` calls made at the same time into one query. The GA plan's first principle gives the reason: "Prisma 8 does not build implicit behavior that the user did not ask for. Automatic batching of lookups is the example." ([decisions, principle 1](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md?plain=1#L65)). The same document decides "Automatic batching of single-row lookups" as "Never", and the [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "automatic batching" under Never.

## Consequences

Each call runs the statements it describes. [ADR 003](ADR%20003%20-%20One%20Query%20One%20Statement.md) rejected auto-batching because it "re-introduces non-determinism and complicates budgets and lints". No revisit-if condition is recorded.
