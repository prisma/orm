# Task: Skill — Connection & Configuration Routing ("Which URL Goes Where")

## Overview

Author a skill (or extend `prisma-database-setup`) in prisma/skills that answers the single
most common class of agent confusion in Prisma 7: which connection value goes into which slot,
per provider. Agents trained on Prisma ≤6 put URLs in the schema, expect `.env` auto-loading,
and pass pool parameters in URL query strings — all wrong in 7.

## Content outline

### The Prisma 7 configuration model

- There are **no database URLs in Prisma schema files**. Connection settings live in
  `prisma.config.ts` (`datasource.url` for CLI/migrate) and in the **driver adapter**
  constructed in application code (`new PrismaPg({ connectionString })`, etc.).
- **No automatic `.env` loading.** The config file must load env itself (e.g. `dotenv/config`
  import); document the canonical pattern.
- SQLite paths resolve **relative to the config file**, not the schema.
- `prisma+postgres://` URLs (Prisma Postgres / Accelerate) vs direct URLs: which commands and
  client options (`accelerateUrl`) accept which.

### Slot-by-slot routing table

- `datasource.url` (prisma.config.ts): used by CLI commands (migrate, db push, studio).
- Driver adapter constructor: used by the client at runtime. **These two can and often should
  differ** (e.g. pooled runtime URL vs direct CLI URL).
- `directUrl`: when a pooler (pgBouncer, Neon pooled endpoint) fronts the database and migrate
  needs a direct connection.
- `shadowDatabaseUrl`: `migrate dev` on cloud databases where the user cannot create databases.

### Per-provider examples (each a `references/` file)

- PostgreSQL (`adapter-pg`): connection string vs pool object, `ssl` options, pgBouncer.
- Neon (`adapter-neon`): pooled vs direct endpoints, websocket config.
- PlanetScale (`adapter-planetscale`): no shadow DB needs, relationMode.
- Cloudflare D1 (`adapter-d1`) and Turso/libSQL (`adapter-libsql`): binding/token patterns.
- SQL Server (`adapter-mssql`), MariaDB (`adapter-mariadb`), better-sqlite3.
- Prisma Postgres (`adapter-ppg` / `prisma+postgres://`).

### Prisma 6 → 7 delta box

Short contrast table (URL in schema → config; env auto-load → explicit; URL pool params →
adapter pool config) with a pointer to the `prisma-upgrade-v7` skill for the full migration.

## Scope

- prisma/skills: new skill directory or `prisma-database-setup` extension (decide with the
  skills repo maintainers; the repo's `AGENTS.md` naming and `references/{category}-{rule}.md`
  conventions apply).
- Cross-link from `prisma-cli` and `prisma-client-api`.

## Acceptance criteria

- An agent following only the skill can wire PostgreSQL + pgBouncer with correct `url`,
  `directUrl`, and adapter pool settings on the first attempt.
- Every provider example is copy-paste runnable against the documented adapter versions.
