# ADR 305 — Prisma 8 has no `P2002`-style error codes

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 239 — Errors are structural envelopes with dotted namespace codes](ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)

---

## Decision

Never. Prisma 8 does not reproduce Prisma 7's numbered error codes, such as `P2002`. Use instead: branch on the dotted `code` of the error envelope ([ADR 239](ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)).

## Context

The GA plan's decisions record it as "Never. Prisma 8 error codes are better." ([Query features: decided](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md?plain=1#L139)). The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "`P2002`-style error codes" under Never.

## Consequences

Code that handles Prisma 7 errors by number is rewritten to match on the dotted code when it moves to Prisma 8. No revisit-if condition is recorded.
