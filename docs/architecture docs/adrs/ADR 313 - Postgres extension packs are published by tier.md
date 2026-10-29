# ADR 313 — Postgres extension packs are published by tier

**Status:** Accepted
**Date:** 2026-10-29

## Decision

A project that uses `citext` installs the package that holds every pack for a trusted PostgreSQL contrib module, and adds the module's pack to its config:

```ts
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import citext from '@prisma/orm-postgres-contrib/citext/control';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/schema.prisma',
    extensions: [citext],
  }),
});
```

Where a Postgres extension's pack is published depends on which of three tiers the extension belongs to:

| Tier | Published as | Examples |
| --- | --- | --- |
| A contrib module PostgreSQL marks trusted | one entrypoint group of `@prisma/orm-postgres-contrib`: `/citext/control`, `/citext/runtime`, … | `citext`, `hstore`, `ltree`, `pg_trgm` |
| Any other contrib module | one entrypoint group of a second package for those modules, created when the first one gets a pack | `postgres_fdw`, `pg_stat_statements` |
| A third-party extension | a package of its own | `@prisma/orm-extension-pgvector`, `-postgis`, `-paradedb` |

Each pack keeps its own internal package under `packages/3-extensions/`; the tier decides only where it reaches npm.

## Why

PostgreSQL ships 50 contrib modules with its own source, and its documentation marks 20 of them trusted: any user with `CREATE` privilege on a database may install them, and they generally give no access to anything outside the database. Those 20 are a fixed list that only a PostgreSQL release changes, and they are the ones a managed host or a CI database lets an application owner install. One package for them stays bounded: the existing packs are 45 to 101 KB each, so packs for all 20 would be about 1.5 MB, paid only by projects that install the package.

The other 30 contrib modules need a superuser or server configuration, and most are tools an ORM does not model, such as `amcheck` or `pageinspect`. Keeping them apart keeps a package whose modules every database owner can install separate from one whose modules may need an administrator.

A third-party extension has its own release cycle, and each host decides whether it offers it. A package of its own lets it be versioned, documented and installed on those terms. Third-party extensions are unbounded in number, so bundling them would grow one package without limit.

Putting the trusted contrib packs on the `@prisma/orm-postgres` facade was considered. Every Postgres project would then download them whether it uses them or not, and the cost grows with each pack. A separate package keeps the facade the same size and leaves extensions something a project opts into.

## Consequences

- A contrib pack is added as a new entrypoint group, with no new published package, until the first untrusted module gets a pack.
- A module's tier is the one PostgreSQL's documentation gives it when its pack is first published. A pack never moves to another package afterwards, so a later PostgreSQL release that changes whether a module is trusted changes no import path.
- [ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)'s packaging rule holds: each pack's code is published from exactly one package, as re-exported entrypoints. The public surface grows by one package for the trusted contrib tier.
- The contrib package is named after what it holds, `orm-postgres-contrib`, without the `orm-extension-` prefix of the packages that hold one extension each. The name says it is Postgres's contrib, which no single-extension name could. Each pack's internal package keeps the `@internal/extension-<name>` name [ADR 153](ADR%20153%20-%20Extension%20Package%20Naming%20Convention.md) requires, so `@internal/extension-citext` is the source of `@prisma/orm-postgres-contrib/citext/*`. A search of published names for `extension-` no longer finds every extension; the contrib package's README lists the modules it holds.
- A pack for a contrib module declares its extension in its own contract, as pgvector's does, so `db sign` adopts a database that already has the extension and a database built from `migrations/` alone gets it before any column uses it ([ADR 312](ADR%20312%20-%20A%20Postgres%20extension%20is%20a%20contract%20entity%2C%20and%20db%20sign%20refuses%20a%20space%20with%20unmet%20invariants.md)).

## Alternatives considered

- **Every extension in a package of its own.** One published package per module would make the trusted contrib tier alone 20 packages, each with the same peer dependencies and release steps.
- **Every Postgres extension in one package.** Third-party extensions are unbounded, so the package would have no size limit, and each extension's own release cycle would be tied to the package's.
- **Contrib packs as entrypoints of the facade.** Measured above: no new install for users, but every Postgres project downloads every pack.
- **`citext` as a data type of the Postgres target.** It is not built into PostgreSQL. The target would have a type whose columns fail on a database where nothing created the extension, and nothing in Prisma 8 would create it.
