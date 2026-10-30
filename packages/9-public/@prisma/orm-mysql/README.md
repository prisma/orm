# @prisma/orm-mysql

The one package a MySQL application installs. It wires the framework, the SQL family, and the MySQL target together, and brings the rest of the stack along as exact-pinned dependencies:

```sh
pnpm add @prisma/orm-mysql
```

```
@prisma/orm-mysql
├── @prisma/orm-framework    contracts, components
├── @prisma/orm-family-sql   SQL contract and control plane
├── @prisma/orm-target-mysql target descriptor + adapter + driver
└── @prisma/orm-toolchain    ORM command family for the `prisma` CLI, emitter, config loader
```

MySQL support is early. Today the package covers contracts and migrations: `prisma contract emit`, `prisma migration plan`, `prisma db migrate`, `prisma db verify` and `prisma db sign`. The query client (`/runtime`) and the statically composed runtime (`/static`) have not landed yet.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract` and MySQL contract authoring |
| `/migration`, `/control` | migration planning and the control client |

Generated contract files import their types from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-mysql/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mysql/adapter` |

These forward; they do not copy. `@prisma/orm-mysql/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
