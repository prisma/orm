# Package Naming Conventions

This document defines the relationship between the repository directory layout, workspace package names, and the published npm surface. The published surface itself is decided in [ADR 242](../architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md); this page records the conventions that implement it.

## Three scopes

Every workspace package belongs to exactly one scope, and the scope tells you its audience:

| Scope | Audience | Published? | Where |
|---|---|---|---|
| `@prisma/*` | Users. The supported public API. | Yes — the only published scope | `packages/9-public/@prisma/*` |
| `@internal/*` | This repository. ORM implementation packages. | No — `private: true`; code reaches npm only bundled inside published packages | `packages/{0-shared,1-framework,2-*,3-*}/**` |
| `@repo/*` | This repository. Build/tooling config consumed by other workspace packages (tsconfig, tsdown presets). | No | `packages/0-config/*` |

One thing intentionally falls outside the scopes: the private example/app/test packages, which use bare directory names. (The unscoped bin shim is gone — the unified `prisma` CLI is the only user-facing binary; see the supersession note in [ADR 211](../architecture%20docs/adrs/ADR%20211%20-%20prisma-next%20bin-only%20distribution.md).)

## The published surface

Every published package has the same first two version numbers, such as `8.3`. That pair is the release number. The rest of each version depends on the package's maturity level. Which versions of the other packages a package accepts depends on its kind and on their levels ([Versions and support](../oss/versioning.md#version-numbers)). `@prisma/orm-extension-paradedb` is the one exception: it has version numbers of its own.

- **Database facades** — `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-mongo` (see [Facade](../glossary.md#facade) in the glossary). A facade glues the framework, family, target, adapter and driver together in one function. It is not a target package. An application depends on one, and lists beside it every platform package the facade names as a peer dependency; `prisma orm init` writes that list. Application code imports only from the facade and the extensions. No published package brings its own copy of another: each names the others it uses as peer dependencies, so the application's list is the only place a copy comes from, and one application holds one copy of each. A monorepo whose applications are on different Prisma versions can still get two copies under npm workspaces and Bun's hoisted linker; keep such applications on one version, or use pnpm, Yarn or Bun's isolated linker. See [ADR 329](../architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md#consequences).
- **Extension packages** — `@prisma/orm-extension-{postgis,pgvector,paradedb,supabase,arktype-json,middleware-cache}` and `@prisma/orm-postgres-contrib`. Each lists, as peer dependencies, exactly the platform packages its code uses. A PostgreSQL extension whose code uses the PostgreSQL target package lists `@prisma/orm-target-postgres`. Two extensions do not use it and so do not list it: ParadeDB registers its index type with the SQL family, and the cache middleware works on any database. A third-party Postgres extension gets a package of its own. The trusted PostgreSQL contrib modules share one package, `@prisma/orm-postgres-contrib`, with one group of entrypoints for each module (`/citext/control`, …), which is why its name has no `orm-extension-` prefix ([ADR 313](../architecture%20docs/adrs/ADR%20313%20-%20Postgres%20extension%20packs%20are%20published%20by%20tier.md)).
- **Library integrations** — `@prisma/orm-better-auth`, which connects an outside library to an application's Prisma 8 client. A package that integrates an outside library is named `@prisma/orm-<library>` when Prisma publishes it ([ADR 242](../architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)). When someone else publishes it, it is named as any community package is: `prisma-orm-<library>`, or `@scope/prisma-orm-<library>` under the publisher's own scope ([ADR 308](../architecture%20docs/adrs/ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)). The name carries no word for the kind of package, such as "adapter" or "integration": the library's name already says what it connects to, and "adapter" means the database adapter in this repository. Unlike the other published packages, `@prisma/orm-better-auth` is hand-written, not a shell: it builds only on published entrypoints, so it can move out of this repository, which is planned for when Prisma 8 reaches general availability, and holds `@prisma/orm-framework`, `@prisma/orm-family-sql` and `@prisma/orm-toolchain` as peer dependencies. [ADR 328](../architecture%20docs/adrs/ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md) records why.
- **Platform packages** — `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-sql`, `@prisma/orm-family-mongo`, and the target packages `@prisma/orm-target-{postgres,sqlite,mysql,mariadb,mongo}`. These are shells: each bundles a set of `@internal/*` packages and re-exposes them as subpath entrypoints (e.g. `packages/2-sql-family/5-runtime` → `@prisma/orm-family-sql/runtime`).

**Publishability is a directory property.** Everything under `packages/9-public/` is publishable and nothing else is; `pnpm lint:publishability` enforces both directions. One module lives in exactly one published package — shells re-export, never copy — so `instanceof` checks, and data-type values that only the copy that made them can read, hold across package boundaries.

The canonical internal-package → shell-entrypoint mapping is code, not prose: [`packages/0-shared/publish-surface/src/shells.ts`](../../packages/0-shared/publish-surface/src/shells.ts). The build of the published packages and the publish checks read it; do not hand-maintain a copy of that table here or anywhere else. Nothing that emits or scaffolds a file reads it: a generated file imports from the modules its config names, and `prisma orm init` names the facade it installs.

## Directory structure

The repository uses numbered prefixes in directory names to reflect the architecture hierarchy:

```text
packages/
  0-config/              # @repo/* build config (tsconfig, tsdown)
  0-shared/              # Cross-cutting internal packages (publish-surface, extension-author-tools)
  1-framework/           # Domain 1: Framework (target-agnostic)
    0-foundation/        # Layer 0: Foundation
    1-core/              # Layer 1: Core
    2-authoring/         # Layer 2: Authoring
    3-tooling/           # Layer 3: Tooling
  2-mongo-family/        # Domain 2: Mongo family
  2-sql-family/          # Domain 2: SQL family
  3-extensions/          # Domain 3: Extensions (internal sources of the extension packs)
  3-targets/             # Domain 3: Targets, one folder per database (ADR 278)
    <db>/                # postgres, sqlite, mysql, mongo
      1-target/          # Target pack: descriptor, codecs, data types, migrations
      2-adapter/         # Adapter: lowering, control adapter
      3-driver/          # Driver: connection and transport
      4-codec-testkit/   # Codec test harness (SQL databases)
      9-facade/          # Facade: the package an application installs for the database
  9-public/              # The published surface — every publishable package, nothing else
    @prisma/*            # The 22 @prisma packages (22 dirs) …
```

The numbered prefixes serve two purposes:

1. **Visual hierarchy**: domain/layer relationships are clear at a glance.
2. **Dependency direction**: lower numbers can be imported by higher numbers, never the reverse.

Planes are a conceptual grouping recorded in `architecture.config.json` and do not appear as directories.

## Naming rules for internal packages

- Use the workspace package name as the only import specifier. The directory layout is for humans and guardrails.
- Encode target family with a family prefix such as `sql-` or `mongo-` for discoverability (`@internal/sql-runtime`, `@internal/mongo-orm`).
- Collapse nested dirs to hyphenated names; no slashes after the scope.
- Keep conventional names for adapters/drivers (`@internal/adapter-postgres`, `@internal/driver-postgres`) even when nested under `packages/3-targets/<db>/`.
- Layers (core/authoring/tooling/lanes/runtime/adapters) constrain dependency direction and generally do not appear in package names.
- The retired legacy scope (the pre-ADR-242 published name) must not reappear anywhere; `pnpm lint:legacy-name` enforces zero occurrences outside allowlisted historical documents.

## Path → package name examples

A representative sample (the source of truth is each directory's `package.json`; all `@internal/*` and `@repo/*` rows are `private: true`):

| Directory | Package name |
|-----------|--------------|
| `packages/0-config/tsdown/` | `@repo/tsdown` |
| `packages/0-shared/publish-surface/` | `@internal/publish-surface` |
| `packages/1-framework/0-foundation/contract/` | `@internal/contract` |
| `packages/1-framework/1-core/framework-components/` | `@internal/framework-components` |
| `packages/1-framework/2-authoring/contract/` | `@internal/contract-authoring` |
| `packages/1-framework/3-tooling/cli/` | `@internal/cli` |
| `packages/2-sql-family/1-core/contract/` | `@internal/sql-contract` |
| `packages/2-sql-family/5-runtime/` | `@internal/sql-runtime` |
| `packages/2-sql-family/9-family/` | `@internal/family-sql` |
| `packages/2-mongo-family/5-query-builders/orm/` | `@internal/mongo-orm` |
| `packages/3-targets/postgres/9-facade/` | `@internal/postgres` (source of the `@prisma/orm-postgres` facade) |
| `packages/3-extensions/pgvector/` | `@internal/extension-pgvector` (source of `@prisma/orm-extension-pgvector`) |
| `packages/3-extensions/citext/` | `@internal/extension-citext` (source of `@prisma/orm-postgres-contrib/citext/*`) |
| `packages/3-targets/postgres/2-adapter/` | `@internal/adapter-postgres` |
| `packages/9-public/@prisma/orm-postgres/` | `@prisma/orm-postgres` |

## Workspace dependencies

Every import from another workspace package requires an explicit dependency in `package.json`. An internal package lists another as `workspace:*`. A published package lists another published package with the version or range the release plan gives it, behind the `workspace:` prefix: `workspace:8.0.0-rc.N` until release 8.0, and a range such as `workspace:~8.1.0` after it. `pnpm publish` removes the prefix when it packs a package. That is why only `pnpm publish` may pack these packages, never another tool that talks to the registry directly.

```bash
# From the package directory
pnpm add @internal/some-package@workspace:*
```

Then run `pnpm install` from the repository root to update the lockfile.

### Subpath exports

Packages expose specific entrypoints via the `exports` field. Import from these subpaths, not internal file paths:

```typescript
// Correct — uses subpath export
import { createRuntime } from '@internal/adapter-postgres/runtime';

// Incorrect — imports internal path
import { createRuntime } from '@internal/adapter-postgres/dist/exports/runtime';
```

## Workspace globs (pnpm)

```yaml
packages:
  - packages/**
  - examples/*
  - apps/*
  - test/**
  - '!**/dist-*'
```

## Enforcement

Every convention above has a check; run them locally before relying on CI:

- `pnpm lint:deps` — dependency direction and domain/layer/plane rules (dependency-cruiser + `architecture.config.json`), framework/target import rules, single-import-root rule for consumer projects.
- `pnpm lint:publishability` — publishability matches the directory layout, both directions.
- `pnpm lint:manifests` — every publishable package declares `license: Apache-2.0`, the canonical `repository` object (npm provenance verification rejects tarballs without it), and the TypeScript optional peer.
- `pnpm lint:legacy-name` — zero occurrences of the retired name outside allowlisted historical documents.
- `pnpm check:publish-deps` — packed tarballs leak no `workspace:`/`catalog:` specifiers, no un-pinned internal names, no undeclared declaration-file dependencies.
