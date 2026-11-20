# Task: Skill — Application & Database Query Performance

## Overview

A `prisma-performance` skill in prisma/skills: a router for "my Prisma app is slow" with
references for investigation and for the specific improvements agents should know to suggest.
Agents are eager to optimize but reach for Prisma-6-era or generic-ORM advice; this skill
gives them the Prisma-7-correct playbook.

## Content outline

### Investigation first

- Turn on query logging (`log: ['query']` with event listeners for durations), tracing via
  `@prisma/instrumentation`, and sqlcommenter tags to attribute SQL to call sites.
- `EXPLAIN (ANALYZE, BUFFERS)` the hot queries; how to extract the exact SQL + params from
  Prisma logs to feed it.
- Distinguish the three cost buckets: query plan shape (N+1, missing joins), database work
  (missing indexes), and JS-side work (in-memory processing, serialization, single-core limits).

### Suggesting indexes

- Map slow `where`/`orderBy` fields to `@@index` / `@unique` additions in the schema; remind
  that relation scalar fields (foreign keys) are **not** auto-indexed on PostgreSQL.
- Composite index column order vs the query's equality/range structure.
- `endsWith` / `contains` on string columns: these compile to infix/suffix `LIKE`, which
  cannot use a btree index. Options ladder: PostgreSQL `pg_trgm` GIN index (via
  `postgresqlExtensions` preview + raw DDL migration), generated/reversed columns for
  `endsWith`, or full-text search via TypedSQL (task 007) — with "measure first" framing.

### Query-shape improvements

- `relationJoins` preview: database-level JOINs for nested reads instead of multiple queries;
  when it helps (deep includes, high row counts) and when the default strategy wins.
- **Do the work in the database, not JS**: aggregates (`_count`, `aggregate`, `groupBy`)
  instead of fetch-and-reduce; `select` narrow projections; `orderBy` + `take` instead of
  sorting in JS; `distinct` caution — client-level `distinct` is applied **in memory**, use
  `nativeDistinct` preview where supported. Worked before/after query pairs for each.
- Detecting in-memory processing: in Prisma 7 the query plan is executed by the TS interpreter
  (`@prisma/client-engine-runtime`), so multi-query plans and in-memory joins/filters show up
  as multiple SQL statements in the query log for one client call (in Prisma 6 the equivalent
  work hid inside the native engine). Teach: one client call emitting several queries or
  post-processing large row sets is the signal to restructure the query or enable
  `relationJoins`.

### Scaling the process

- **Prisma 7 runs query compilation (Wasm) and interpretation (TS) on the application's JS
  thread** — unlike Prisma 6's native engine with its own thread pool, the client no longer
  uses extra cores implicitly. A saturated Node process needs horizontal scaling:
  `node:cluster`, PM2, or container replicas — with pool sizing recalculated per process
  (total connections = pool size × process count; cross-reference task 006's pooling
  reference).

## Scope

- prisma/skills only. Cross-links: troubleshooting (task 006) for logging setup, pitfalls
  (task 007) for preview-feature suggestions, TypedSQL (task 008).

## Acceptance criteria

- An agent investigating a slow endpoint produces: the offending SQL with timing, an EXPLAIN
  interpretation, and a ranked suggestion list (index / query shape / preview feature /
  process scaling) — not a generic "add caching" answer.
- The single-core note is stated plainly enough that agents stop recommending "Prisma will
  parallelize across cores".
