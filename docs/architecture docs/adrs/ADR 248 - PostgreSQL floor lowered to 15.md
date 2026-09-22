# ADR 248 — PostgreSQL floor lowered to 15

**Status:** Accepted
**Date:** 2026-08-11
**Amends:** [ADR 222 — Version support policy](ADR%20222%20-%20Version%20support%20policy.md)

---

## Decision

The minimum supported PostgreSQL server version is **15** (previously 17).

The policy in ADR 222 is unchanged: the floor is a hard floor, declared in `package.json#prismaNext.minServerVersion` on `@internal/target-postgres`, mirrored in the CLI's `MIN_SERVER_VERSION` constant, and guarded by a drift test. This ADR changes the value and corrects the record of how the floor is enforced.

## Context

The 17 floor was set during early access as "the latest GA release we test against" (ADR 222). Three facts argued for lowering it:

1. **Our code needs far less than 17.** A full audit of emitted SQL, introspection queries, and migration DDL found a feature-implied floor of **PostgreSQL 12**. The single binding feature is `ALTER TYPE ... ADD VALUE` executed inside the migration runner's transaction (allowed since 12). The next tier down is 10 (`pg_attribute.attidentity`, `pg_policies.permissive`, `CREATE POLICY ... AS PERMISSIVE|RESTRICTIVE`). Nothing we emit or read requires 13, 14, 15, 16, or 17. A user-authored `@default(dbgenerated("gen_random_uuid()"))` needs 13; a 15 floor keeps that safe.
2. **CI already tests 15, not 17.** Every Postgres service container in `.github/workflows/ci.yml` (Test, E2E, Integration, Coverage, CLI recording) runs `postgres:15`. ADR 222 stated the floor was enforced by the `docker-compose.yaml` image, but CI does not use docker-compose; the claim that 17 was "what CI exercises" was wrong. 15 is the version our test infrastructure actually proves.
3. **The migrating audience runs older servers.** Prisma 8's promise of incremental migration from v7 is contradicted by a floor that excludes Postgres 15 and 16 users (see `projects/prisma-8-rc1/design-notes.md`). One example (`examples/react-router-demo`) already told users "Any Postgres 15+".

### Market context (August 2026)

No public census breaks down Postgres deployments by major version; the [State of PostgreSQL survey](https://www.tigerdata.com/state-of-postgres/2024) does not publish one. The best available proxies:

- **Community support:** per the [community versioning policy](https://www.postgresql.org/support/versioning/), versions 14–18 are supported. 14 reaches end of life in November 2026; 15 is supported until November 2027. A 15 floor covers every community-supported major from December 2026 onward.
- **Cloud standard support:** AWS RDS standard support now starts at 14 ([13 exited standard support in February 2026](https://repost.aws/articles/ARRvHxJ_9sTDCGloBavca3kg/announcement-amazon-rds-postgresql-13-x-end-of-standard-support-is-february-28-2026); 11–13 are paid Extended Support only, per the [RDS PostgreSQL version calendar](https://endoflife.date/amazon-rds-postgresql)). [Azure](https://techcommunity.microsoft.com/blog/adforpostgresql/whats-new-with-postgres-at-microsoft-2026-edition/4526963) and [Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/db-versions) follow similar calendars, with 18 generally available on all three.
- **Overall adoption:** PostgreSQL is the most-used database in the [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/), at 55.6% developer usage. No public data breaks that usage down by major version, so the case for 15 rests on the support-calendar and cloud-support proxies above, not on any claimed version distribution.

## Why 15 and not lower

- 15 is the oldest version CI exercises today. Declaring 14 or lower would claim compatibility we do not test — the exact failure ADR 222's governing principle forbids.
- 14 dies in November 2026; adding test infrastructure for a three-month support window buys nothing.
- Going below 12 would require reworking the native-enum `ADD VALUE` migration operation to run outside the migration transaction.

## What 16 and 17 would offer (and why we are not requiring them)

Features we could only use by raising the floor again:

**PostgreSQL 16:**

- `ANY_VALUE()` — cleaner emission for grouped queries that carry functionally dependent columns; today we can add the column to `GROUP BY` or wrap it in `min()`.
- Standard SQL/JSON constructors (`JSON_OBJECT`, `JSON_ARRAY`, `JSON_ARRAYAGG`, `IS JSON`) — equivalent in power to the `json_build_object`/`json_agg` calls the renderer already emits; conformance, not capability.
- Planner improvements (parallel FULL/right outer hash joins, incremental sort for DISTINCT, faster window functions). These speed up our `ROW_NUMBER() OVER (...)`-based `.distinct()` — but they benefit any user running 16+ automatically and need no floor change.
- `pg_stat_io` — relevant only to a future observability extension.

**PostgreSQL 17:**

- `JSON_TABLE`, `JSON_EXISTS`, `JSON_VALUE`, `JSON_QUERY` — the architecturally interesting set: `JSON_TABLE` could flatten nested-read plans into a single relational pass.
- `MERGE ... RETURNING` — a `MERGE`-based upsert path that returns rows.

Already available at the 15 floor, for future use: plain `MERGE`, and `NULLS NOT DISTINCT` on unique constraints/indexes.

If any of these becomes worth emitting, the path is per-server capability gating in the Postgres adapter — emit the newer SQL when the connected server supports it — not raising the floor.

## Enforcement

- Source of truth: `packages/3-targets/3-targets/postgres/package.json` → `prismaNext.minServerVersion: "15"`.
- CLI mirror: `MIN_SERVER_VERSION.postgres` in `packages/1-framework/3-tooling/cli/src/commands/init/templates/env.ts`; the drift test in `tsconfig-env.test.ts` asserts the two match.
- CI proves the floor: the `postgres:15` service containers in `.github/workflows/ci.yml`. **When bumping the floor, update these image tags** — this replaces ADR 222's step 3, which pointed only at `docker-compose.yaml`.
- Local dev (`docker-compose.yaml`) also runs the floor version (`postgres:15-alpine`).
- Newer majors get incidental coverage: PGlite embeds Postgres 17.5 (via `@prisma/dev`) and 18.3 (driver devDependency); the Supabase contract fixture pins `supabase/postgres:17.6`.

## Consequences

- Postgres 15 and 16 users are supported. The scaffold's `.env.example` and generated `prisma-next.md` now state "Requires PostgreSQL >= 15".
- The `init --probe-db` warning threshold follows the mirror automatically.
- The floor and the tested version now coincide, restoring ADR 222's governing principle in fact as well as in intent.
