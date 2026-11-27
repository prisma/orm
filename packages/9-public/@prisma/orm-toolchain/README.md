# @prisma/orm-toolchain

Prisma 8's development and build tooling: the ORM command family the unified `prisma` CLI mounts, the contract emitter, the config loader, the language server, CLI telemetry, and the Vite plugin. This package ships no bin.

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

Every application lists this package beside its database package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-mongo`). The database package requires it as a peer dependency and says which versions it accepts, and `prisma orm init` writes the line for you. Application code does not import it. It is separate from `@prisma/orm-framework` so deployed applications never trace a compiler, formatter, or language server into their runtime bundle.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/cli` | The `orm` command family (`ormCommandFamily`, `ormConfigSection`) and CLI programmatic surface |
| `/cli/init-contribution` | the `InitContribution` type, imported as a type only; a database package's own `/init` entrypoint default-exports an object of that type |
| `/emitter` | contract emitter |
| `/config-loader` | `prisma.config.ts` loading |
| `/language-server` | PSL language server |
| `/migration-tools` | migration graph, packages, refs, IO |
| `/cli-telemetry` | CLI telemetry |
| `/vite-plugin-contract-emit` | Vite plugin for contract emission |

## Responsibilities

Everything that runs at development or build time: emitting contracts, loading config, planning and packaging migrations, editor support, and the CLI itself. Nothing here is needed by a deployed application at runtime.
