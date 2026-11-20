# ADR 303 — Prisma 8 has no read replicas in the core

**Status:** Accepted
**Date:** 2026-10-22

---

## Decision

Never. Prisma 8 has no built-in primary and replica router. Use instead: create a separate `db` client for each data store and call the right one in application code ([`prisma-8` skill, runtime.md](../../../skills/prisma-8/references/runtime.md)).

## Context

The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "read replicas" under Never. The source gives no reason.

## Consequences

No revisit-if condition is recorded.
