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

17 packages publish, all in lockstep at the workspace version:

- **3 database facades** — `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mongo`. An application depends on exactly one; everything else arrives as its exact-pinned dependencies.
- **6 extension packs** — `@prisma/orm-extension-{postgis,pgvector,paradedb,supabase,arktype-json,middleware-cache}`, peer-depending on their target package.
- **7 platform packages** — `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-sql`, `@prisma/orm-family-mongo`, `@prisma/orm-target-{postgres,sqlite,mongo}`. These are shells: each bundles a set of `@internal/*` packages and re-exposes them as subpath entrypoints (e.g. `packages/2-sql/5-runtime` → `@prisma/orm-family-sql/runtime`).

**Publishability is a directory property.** Everything under `packages/9-public/` is publishable and nothing else is; `pnpm lint:publishability` enforces both directions. One module lives in exactly one published package — shells re-export, never copy — so `instanceof` and shared-registry identity hold across package boundaries.

The canonical internal-package → shell-entrypoint mapping is code, not prose: [`packages/0-shared/publish-surface/src/shells.ts`](../../packages/0-shared/publish-surface/src/shells.ts). Emitters and generators resolve published import specifiers through it; do not hand-maintain a copy of that table here or anywhere else.

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
  2-sql/                 # Domain 2: SQL family
  3-extensions/          # Domain 3: Extensions (internal sources of the extension packs)
  3-mongo-target/        # Domain 3: Mongo target packages
  3-targets/             # Domain 3: SQL targets (descriptors, adapters, drivers)
  9-public/              # The published surface — every publishable package, nothing else
    @prisma/*            # The 17 @prisma packages (16 dirs) …
```

The numbered prefixes serve two purposes:

1. **Visual hierarchy**: domain/layer relationships are clear at a glance.
2. **Dependency direction**: lower numbers can be imported by higher numbers, never the reverse.

Planes are a conceptual grouping recorded in `architecture.config.json` and do not appear as directories.

## Naming rules for internal packages

- Use the workspace package name as the only import specifier. The directory layout is for humans and guardrails.
- Encode target family with a family prefix such as `sql-` or `mongo-` for discoverability (`@internal/sql-runtime`, `@internal/mongo-orm`).
- Collapse nested dirs to hyphenated names; no slashes after the scope.
- Keep conventional names for adapters/drivers (`@internal/adapter-postgres`, `@internal/driver-postgres`) even when nested under `packages/3-targets/**`.
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
| `packages/2-sql/1-core/contract/` | `@internal/sql-contract` |
| `packages/2-sql/5-runtime/` | `@internal/sql-runtime` |
| `packages/2-sql/9-family/` | `@internal/family-sql` |
| `packages/2-mongo-family/5-query-builders/orm/` | `@internal/mongo-orm` |
| `packages/3-extensions/postgres/` | `@internal/postgres` (source of the `@prisma/orm-postgres` facade) |
| `packages/3-extensions/pgvector/` | `@internal/extension-pgvector` (source of `@prisma/orm-extension-pgvector`) |
| `packages/3-targets/6-adapters/postgres/` | `@internal/adapter-postgres` |
| `packages/9-public/@prisma/orm-postgres/` | `@prisma/orm-postgres` |

## Workspace dependencies

Every import from another workspace package requires an explicit dependency in `package.json`. Internal consumers use `workspace:*`; published packages pin exact lockstep versions (`workspace:<version>`), which `pnpm publish` rewrites to the literal version — the reason only `pnpm publish` (never a raw registry client) may pack these packages.

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
