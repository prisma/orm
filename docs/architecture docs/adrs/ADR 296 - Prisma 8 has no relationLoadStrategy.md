# ADR 296 — Prisma 8 has no `relationLoadStrategy`

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)

---

## Decision

Never. Prisma 8 has no switch between loading relations with database joins and loading them in memory. The ORM client does in the database whatever the database can do. Where the database runs the one-query include correctly, an include is one statement and the database joins the relation. Where it cannot, which the ORM client reads from the contract's capabilities ([ADR 164](ADR%20164%20-%20Repository%20Layer.md)), the ORM client loads includes with one query per relation: still in SQL, including paging, `distinct` and aggregates, and only attaching each related row to its parent in memory. The user never chooses between the two. To see what a call ran, observe its activities with middleware ([ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)).

## Context

Prisma 7's `relationLoadStrategy: 'join' | 'query'` chooses between one statement with database joins and one query per relation. Will Madden decided on 2026-10-22: never. In his words: "relationLoadStrategy was a hack in old versions of prisma which performed in-memory joins and relationLoadStrategy was the feature flag to get newer behavior using DB joins. there's no use case to support it in prisma 8." The motivation is that the database does whatever it can do: joining, filtering, ordering, paging and aggregating. The ORM client attaches rows to their parents in memory only where the database cannot run the one-query include. With its default strategy, Prisma 7 fetched every related row and applied `skip`, `take`, cursors and `distinct` to each parent's rows in memory; Prisma 8 never does. The ORM client still sends several statements where it needs to: it "is a client, not a query builder, it orchestrates multiple queries. the middleware activity representation allows us to express this as a tree similar to otel."

## Consequences

No revisit-if condition is recorded.
