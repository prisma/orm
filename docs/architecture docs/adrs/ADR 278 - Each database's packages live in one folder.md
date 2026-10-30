# ADR 278 — Each database's packages live in one folder

**Status:** Accepted
**Date:** 2026-10-22
**Domain:** Repository layout, Adapters / Targets
**Amends:** [ADR 140 — Package Layering & Target-Family Namespacing](ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md)
**Amended by:** [ADR 311 — Code shared by several targets' type implementations lives in one package](ADR%20311%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md) (2026-10-30): `packages/3-targets/` also holds `0-shared/`, for packages several databases' packages share. The ordering check skips it.

---

## At a glance

Everything one database needs sits in one folder:

```text
packages/
  2-sql-family/                SQL family
  2-mongo-family/              Mongo family
  3-targets/
    postgres/
      1-target/                @internal/target-postgres
      2-adapter/               @internal/adapter-postgres
      3-driver/                @internal/driver-postgres
      4-codec-testkit/         @internal/postgres-codec-testkit
      9-facade/                @internal/postgres
    sqlite/                    the same five
    mongo/
      1-target/                @internal/target-mongo
      2-adapter/               @internal/adapter-mongo
      3-driver/                @internal/driver-mongo
      9-facade/                @internal/mongo
  3-extensions/                extension packs
```

A new database adds one folder under `3-targets/`.

## Decision

1. **A database's target, adapter, driver, codec testkit and facade live in `packages/3-targets/<db>/`.** Each is its own package, as before.
2. **Folders inside a database folder are numbered by dependency order.** A package may depend only on lower-numbered packages in its own folder, and never on another database's packages: the adapter imports the target, the facade imports the target, adapter and driver, and the driver imports none of them. `scripts/lint-target-layering.mjs`, run by `pnpm lint:deps`, walks every database folder and checks this, so a new database is covered without a new check. A database that has no codec testkit skips `4-`.
3. **Family folders are named `2-<family>-family`.** `2-sql` became `2-sql-family`, matching `2-mongo-family`.
4. **Extension packs stay in `packages/3-extensions/`,** including packs that only work with one database, such as pgvector.
5. **Every package under `3-targets/<db>/` registers the same globs in `architecture.config.json`,** the recipe in `docs/onboarding/Repo-Map-and-Layering.md`, and `pnpm lint:deps` fails when a source file matches no glob or more than one.

Package names did not change, so no import, published name or emitted file changed.

## Why

### The role folders checked nothing

Before this ADR, SQL targets were split by role: `3-targets/3-targets/<db>`, `3-targets/6-adapters/<db>` and `3-targets/7-drivers/<db>`, with the facade in `3-extensions/<db>`. The numbers 3, 6 and 7 looked like layers. They were not checked: `pnpm lint:deps` takes each file's domain, layer and plane from globs in `architecture.config.json`, and that file defines no layer order for the `targets` and `extensions` domains. The folders only spread one database across four places. The numbers inside a database folder are checked, by the check in decision 2.

### Mongo had already grouped by database, without a recorded reason

The Mongo target was first placed in the role folders and moved the same day to `packages/3-mongo-target/{1-mongo-target,2-mongo-adapter,3-mongo-driver}`. That kept a database together but added a top-level folder per database and repeated the database's name in every folder. This ADR keeps the grouping and drops the extra top-level folder.

### The facade is one database's wiring

A facade composes one database's target, adapter and driver into the client an application installs. It belongs with them. An extension pack, by contrast, uses the same extension points a third-party pack would; keeping first-party packs in `3-extensions/` keeps that visible.

## Consequences

- A developer working on one database opens one folder.
- Adding MySQL and MariaDB adds `3-targets/mysql/` and `3-targets/mariadb/`. The ordering check and the upgrade-coverage check (a facade counts as extension code) pick up a new folder without changes; `architecture.config.json`, `shells.ts` and `coverage.config.json` still need its entries.
- Folder paths also appear in package scripts, tests and fixtures, which use relative paths; moving a package means recomputing them (`.agents/rules/moving-packages.mdc`).
- The registration does not yet match the folder: the target pack and facade are in the `extensions` domain and the adapter and driver in the `targets` domain. And `pnpm lint:deps` does not yet see imports between workspace packages, only imports inside one. Both are known gaps to close; until then, the ordering check is what checks the folder numbers.

## Alternatives considered

- **Keep the role folders.** Rejected: they enforce nothing and spread each database across four folders.
- **Copy Mongo's layout for every database** (`packages/3-<db>-target/1-<db>-target/...`). Rejected: a top-level folder per database, and the name repeated in every folder.
- **Move single-database extension packs under their database** (`3-targets/postgres/extensions/pgvector`). Rejected: it hides that they are ordinary packs.
