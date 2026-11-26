# @prisma/orm-sqlite

The package a SQLite application imports Prisma from. It wires the framework, the SQL family, and the SQLite target into a single lazy client.

> **Maturity level: Early Access.** This package is published so that you can try it. It may have known failures, and any new version may change it. At each new release you edit the Prisma lines in your `package.json` by hand, and [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga) shows how. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes.

This package is built from other Prisma packages, the platform packages, and your application lists them beside it in `package.json`. `prisma orm init` writes those lines for you. To add them by hand:

- Until release 8.0, give every `@prisma/orm-*` package the same exact version, such as `8.0.0-rc.25`.
- From release 8.0, use the command below. It is written for release 8.0. For a later release, such as 8.3, write `8.3.0` in place of `8.0.1`.

```sh
pnpm add "@prisma/orm-sqlite@~8.0.1-ea.0" "@prisma/orm-framework@~8.0.1" "@prisma/orm-family-sql@~8.0.1" "@prisma/orm-target-sqlite@~8.0.1-ea.0" "@prisma/orm-toolchain@~8.0.1"
```

```
@prisma/orm-sqlite
├── @prisma/orm-framework     contracts, components, runtime core
├── @prisma/orm-family-sql    SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-sqlite target descriptor + adapter + driver
└── @prisma/orm-toolchain     ORM command family for the `prisma` CLI, emitter, config loader
```

Keep all of these lines, on the same release. Your code imports only from `@prisma/orm-sqlite` and from extensions, never from the other packages. If your package manager prints a peer dependency warning for a Prisma package, or refuses to install, the versions in these lines do not fit together: put them back on one release. [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) explains why they are listed.

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

The driver is Node's built-in `node:sqlite`, so there is no native module to compile.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `sqlite(path)` — the lazy query client |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/contract-builder` | `defineContract` and SQLite contract authoring |
| `/migration`, `/control` | migration planning and the control client |
| `/init` | the init contribution `prisma orm init --target @prisma/orm-sqlite` writes a project from |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-sqlite/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-sqlite/adapter` |

These forward; they do not copy. `@prisma/orm-sqlite/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
