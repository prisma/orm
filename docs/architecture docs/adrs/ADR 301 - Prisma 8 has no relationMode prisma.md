# ADR 301 — Prisma 8 has no `relationMode = "prisma"`

**Status:** Accepted
**Date:** 2026-10-22

---

## Decision

Never. Prisma 8 does not imitate foreign keys in the client. Use instead: foreign keys in the database.

## Context

With `relationMode = "prisma"`, Prisma 7 imitates foreign keys in the client. The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "`relationMode = "prisma"`" under Never. Will Madden decided it in the planning discussion of 2026-09-28 and 2026-09-29, which the GA plan's decisions record: "Never. Prisma 8 will not imitate foreign keys in the client. The upgrade guide tells those users to add foreign keys" ([Upgrade path](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#upgrade-path-what-prisma-8-must-describe)). The source gives no reason.

## Consequences

No revisit-if condition is recorded.
