# ADR 302 — Prisma 8 does not split large `IN` lists

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 296 — Prisma 8 has no `relationLoadStrategy`](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)

---

## Decision

This ADR is about the `in` lists a user writes. Prisma 8 never splits one into several queries; the database receives the list as written. To load related rows, use `.include(...)`, which the database joins where it can run the one-query include ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

Where the database cannot run the one-query include, the ORM client loads includes with one query per relation, filtered by the identity of the parent rows ([ADR 164](ADR%20164%20-%20Repository%20Layer.md)). Those key lists are the ORM client's own, not the user's, and it splits them into statements of at most 10 000 bound parameters and an estimated 1 MiB of key values, so a statement stays within the databases' bind-parameter limits and far below MySQL's and MariaDB's default packet size.

## Context

Prisma 7 splits a large `in` list into several queries. The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md#never) lists "splitting large `IN` lists" under Never. The GA plan's decisions record the reason, from Will Madden on 2026-09-30: "In Prisma 7 the problem came from joining in memory. Prisma 8 joins in the database, so it does not create large `IN` lists itself" ([Tasks to decide or fix before GA](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/decisions.md#tasks-to-decide-or-fix-before-ga)). That holds where the database runs the one-query include. Where it cannot, the ORM client builds key lists of its own to load includes one query per relation, and splits them as the Decision says. The motivation is to do in the database whatever the database can do ([ADR 296](ADR%20296%20-%20Prisma%208%20has%20no%20relationLoadStrategy.md)).

## The databases' limits

The most bound parameters one statement may carry differs by database: 65,535 for a MySQL prepared statement, 2,100 on SQL Server, and 999 on SQLite builds before 3.32. Prisma 7 split its lists at 32,766 parameters on PostgreSQL, 65,535 on MySQL, 999 on SQLite and 2,098 on SQL Server. Prisma 8 runs SQLite through `node:sqlite`, whose bundled SQLite is newer than 3.32 and allows 32,766, so the ORM client's 10,000 stays under every limit Prisma 8's targets have. The MySQL and MariaDB drivers prepare no statement: the `mariadb` package writes each value into the statement text, so no parameter limit applies there, and the limit is the server's `max_allowed_packet` (64 MiB by default on MySQL 8.4 and 16 MiB on MariaDB 10.11), which the 1 MiB estimate keeps far below.

MariaDB rewrites an `IN` list of 1,000 items or more into a subquery over a temporary table (`in_predicate_conversion_threshold`). Some MariaDB versions then returned empty nested relations, with no error, for statements sent as prepared statements ([MDEV-28064](https://jira.mariadb.org/browse/MDEV-28064)). Prisma 8 does not prepare statements on MariaDB, and in one probe on MariaDB 10.11, `IN` lists of 10,000 and 100,000 keys sent through its driver returned correct results; no test guards this. Anyone who makes the MariaDB driver prepare statements must test key lists of 1,000 items or more again.

## Consequences

No revisit-if condition is recorded.
