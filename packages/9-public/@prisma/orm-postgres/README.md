# @prisma/orm-postgres

The package a PostgreSQL application imports Prisma from. It wires the framework, the SQL family, and the Postgres target into a single lazy client.

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

This package is built from other Prisma packages, the platform packages, and your application lists them beside it in `package.json`. `prisma orm init` writes those lines for you. To add them by hand:

- Until release 8.0, give every `@prisma/orm-*` package the same exact version, such as `8.0.0-rc.25`.
- From release 8.0, use the command below. It is written for release 8.0. For a later release, such as 8.3, write `8.3.0` in place of `8.0.1`.

```sh
pnpm add "@prisma/orm-postgres@^8.0.1" "@prisma/orm-framework@^8.0.1" "@prisma/orm-family-sql@^8.0.1" "@prisma/orm-target-postgres@^8.0.1" "@prisma/orm-toolchain@^8.0.1"
pnpm add pg
pnpm add -D @types/pg
```

```
@prisma/orm-postgres
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-postgres target descriptor + adapter + driver
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the platform packages recognise a data-type value by which copy made it. A data-type value made by a second copy is refused with an error that does not name the cause, and TypeScript reports errors where the two copies' types meet. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-postgres` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

`pg` and `@types/pg` are peer dependencies: the driver is the application's, so a `pg.Pool` the application creates and the `pg` types Prisma 8 declares come from one copy. Prisma 8 supports `pg` 8.22.0 and later within major version 8.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands and the Vite plugin, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `postgres(url)` — the lazy query client |
| `/serverless` | the serverless runtime variant |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/contract-builder` | `defineContract`, Postgres enums, RLS authoring |
| `/target`, `/family` | the Postgres target pack and the SQL family pack |
| `/migration`, `/control` | migration planning and the control client |
| `/init` | the init contribution `prisma orm init` writes a project from |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-postgres/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-postgres/adapter` |

These forward; they do not copy. `@prisma/orm-postgres/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Decomposing

Every application lists the four platform packages, so an application that outgrows the default wiring already has them. It imports from them directly and recomposes them — for example replacing `@prisma/orm-target-postgres/adapter` with a pooled adapter of its own while keeping the target and driver — and drops this package. Because all of these packages come from one release, the decomposed application gets exactly what this package would have provided, minus the replaced part.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
