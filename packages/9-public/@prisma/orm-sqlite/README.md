# @prisma/orm-sqlite

The one package a SQLite application installs. It wires the framework, the SQL family, and the SQLite target into a single lazy client, and brings the rest of the stack along as exact-pinned dependencies:

```jsonc
// package.json
{ "dependencies": { "@prisma/orm-sqlite": "0.16.0" } }
```

```
@prisma/orm-sqlite
├── @prisma/orm-framework     contracts, components, runtime core
├── @prisma/orm-family-sql    SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-sqlite target descriptor + adapter + driver
└── @prisma/orm-toolchain     ORM command family for the `prisma` CLI, emitter, config loader
```

The driver is Node's built-in `node:sqlite`, so there is no native module to compile.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `sqlite(path)` — the lazy query client |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract` and SQLite contract authoring |
| `/migration`, `/control` | migration planning and the control client |

Generated contract files import their types from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-sqlite/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-sqlite/adapter` |

These forward; they do not copy. `@prisma/orm-sqlite/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
