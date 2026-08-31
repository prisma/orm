# @prisma/orm-mongo

The one package a MongoDB application installs. It wires the framework, the Mongo family, and the Mongo target into a single lazy client, and brings the rest of the stack along as exact-pinned dependencies:

```jsonc
// package.json
{ "dependencies": { "@prisma/orm-mongo": "0.16.0", "mongodb": "^7.0.0" } }
```

```
@prisma/orm-mongo
├── @prisma/orm-framework      contracts, components, runtime core
├── @prisma/orm-family-mongo   Mongo contract, query builders, runtime
├── @prisma/orm-target-mongo   target descriptor + adapter + driver
└── @prisma/orm-toolchain      ORM command family for the `prisma` CLI, emitter, config loader
```

`mongodb` is a peer dependency: the driver is the application's, so a single connection pool and a single BSON implementation serve both Prisma Next and any direct `mongodb` use in the same process.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `mongo(url)` — the lazy query client |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract` and Mongo contract authoring |
| `/bson` | BSON value helpers (`ObjectId`, `Decimal128`, …) |
| `/target`, `/family` | the Mongo target pack and the Mongo family pack |
| `/control` | the control client |

Generated contract files import their types from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-mongo/contract` |
| `/target/*` | `@prisma/orm-target-mongo/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mongo/adapter` |

These forward; they do not copy. `@prisma/orm-mongo/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
