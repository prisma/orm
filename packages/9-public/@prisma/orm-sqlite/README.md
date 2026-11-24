# @prisma/orm-sqlite

The package a SQLite application installs for its database. It wires the framework, the SQL family, and the SQLite target into a single lazy client. It names the platform packages it is built on as peer dependencies, each at this package's own exact version, so the application lists them beside it, every `@prisma/orm-*` line naming the same version. `prisma orm init` writes that list, in the form the project's package manager writes a version it is given. To install them by hand, give every `@prisma/orm-*` package the same version, the release you want:

```sh
pnpm add @prisma/orm-sqlite@<version> @prisma/orm-framework@<version> @prisma/orm-family-sql@<version> @prisma/orm-target-sqlite@<version> @prisma/orm-toolchain@<version>
```

```
@prisma/orm-sqlite
├── @prisma/orm-framework     contracts, components, runtime core
├── @prisma/orm-family-sql    SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-sqlite target descriptor + adapter + driver
└── @prisma/orm-toolchain     ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the runtime keeps its registries of codecs and operations in them, and a second copy would not see what the first one registered. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-sqlite` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

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

These forward; they do not copy. `@prisma/orm-sqlite/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
