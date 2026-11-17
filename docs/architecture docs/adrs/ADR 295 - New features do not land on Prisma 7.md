# ADR 295 — New features do not land on Prisma 7

**Status:** Accepted; amended 2026-10-23
**Date:** 2026-10-22
**Builds on:** [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)

---

> **Amended (2026-10-23).** The team does no new feature work on Prisma 7, but a feature contributed by the community may be accepted when it is in line with Prisma 7's design direction and meets the project's quality standards; a maintainer decides whether it does. Will Madden calls this a clarification of the policy, not a change. [Versioning](../../oss/versioning.md#supported-versions) states the policy as it stands. The rest of this document is the original decision, kept for the record.

## Decision

Prisma 7 receives bug fixes and security updates for eighteen months after `8.0.0` final, and nothing else. Use instead: propose the feature against `main`, for Prisma 8. Move the application to Prisma 8 incrementally; Prisma 8 can read the Prisma 7 schema as its contract source ([ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)).

## Context

Contributors open pull requests that add features to Prisma 7, against the `v7` or `7.9.x` branch. The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#goal) records the policy: "Prisma ORM 7 gets bug fixes and security updates for 18 months from the day of GA." Will Madden confirmed the eighteen months on 2026-10-22. The source gives no reason.

## Consequences

Features go to Prisma 8 only. No revisit-if condition is recorded.
