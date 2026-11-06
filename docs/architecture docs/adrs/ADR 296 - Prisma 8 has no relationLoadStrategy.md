# ADR 296 — Prisma 8 has no `relationLoadStrategy`

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)

---

## Decision

Never. Prisma 8 does not need the switch: include the relation, and the database joins it. The ORM client may run several statements for one call, as a tree of activities. To see what a call ran, observe its activities with middleware ([ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)).

## Context

Prisma 7's `relationLoadStrategy: 'join' | 'query'` chooses between one statement with database joins and one query per relation. Will Madden decided on 2026-10-22: never. In his words: "relationLoadStrategy was a hack in old versions of prisma which performed in-memory joins and relationLoadStrategy was the feature flag to get newer behavior using DB joins. there's no use case to support it in prisma 8." Where the ORM client runs several queries for one call, it does so as a client that orchestrates queries: "one query is one SQL statement but the ORM is a client, not a query builder, it orchestrates multiple queries. the middleware activity representation allows us to express this as a tree similar to otel."

## Consequences

No revisit-if condition is recorded.
