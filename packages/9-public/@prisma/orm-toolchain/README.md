# @prisma/orm-toolchain

Prisma 8's development and build tooling: the ORM command family the unified `prisma` CLI mounts, the contract emitter, the config loader, the language server, CLI telemetry, and the Vite plugin. This package ships no bin.

Applications get it as an exact-pinned dependency of their database facade (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mongo`); app developers install the facade, not this package. It is separate from `@prisma/orm-framework` so deployed applications never trace a compiler, formatter, or language server into their runtime bundle.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/cli` | The `orm` command family (`ormCommandFamily`, `ormConfigSection`) and CLI programmatic surface |
| `/emitter` | contract emitter |
| `/config-loader` | `prisma.config.ts` loading |
| `/language-server` | PSL language server |
| `/migration-tools` | migration graph, packages, refs, IO |
| `/cli-telemetry` | CLI telemetry |
| `/vite-plugin-contract-emit` | Vite plugin for contract emission |

## Responsibilities

Everything that runs at development or build time: emitting contracts, loading config, planning and packaging migrations, editor support, and the CLI itself. Nothing here is needed by a deployed application at runtime.
