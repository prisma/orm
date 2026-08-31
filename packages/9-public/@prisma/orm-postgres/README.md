# @prisma/orm-postgres

The one package a PostgreSQL application installs. It wires the framework, the SQL family, and the Postgres target into a single lazy client, and brings the rest of the stack along as exact-pinned dependencies:

```jsonc
// package.json
{ "dependencies": { "@prisma/orm-postgres": "0.16.0" } }
```

```
@prisma/orm-postgres
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-postgres target descriptor + adapter + pg driver
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `postgres(url)` — the lazy query client |
| `/serverless` | the serverless runtime variant |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract`, Postgres enums, RLS authoring |
| `/target`, `/family` | the Postgres target pack and the SQL family pack |
| `/migration`, `/control` | migration planning and the control client |

Generated contract files import their types from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-postgres/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-postgres/adapter` |

These forward; they do not copy. `@prisma/orm-postgres/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Decomposing

An application that outgrows the default wiring installs the four platform packages directly and recomposes them — for example replacing `@prisma/orm-target-postgres/adapter` with a pooled adapter of its own while keeping the target and driver. Because everything is pinned to one lockstep version, the decomposed install reproduces exactly what the facade would have provided, minus the replaced part.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
