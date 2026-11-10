# ADR 299 — Prisma 8 has no `Prisma.skip`

**Status:** Accepted
**Date:** 2026-10-22

---

## Decision

Never. Prisma 8 has no `Prisma.skip`. No document names what to use instead.

## Context

The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "`Prisma.skip`" under Never. Will Madden decided it in the planning discussion of 2026-09-28 and 2026-09-29. The GA plan's decisions record the reason: "Never. It only made sense for Prisma 7's object-style queries" ([Query features: decided](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#query-features-decided)).

## Consequences

No revisit-if condition is recorded.
