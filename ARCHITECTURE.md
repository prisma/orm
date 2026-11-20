# ARCHITECTURE.md

## This file's purpose

This document describes the repository's high-level architecture and provides practical guidance and workflows for contributors. It explains how to generate dependency graphs, how the DMMF (Data Model Meta Format) relates to the Prisma Client, and step-by-step instructions for debugging and upgrading the engines used by the project.

## High-Level Overview

Prisma is organized as a pnpm/Turborepo monorepo. The repository is grouped into logical layers that separate concerns and make it easier for contributors to find and modify code.

| Layer                         | Key Packages                                                                                                                     | Purpose                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **User-facing**               | `packages/cli`, `packages/client`, `packages/migrate`                                                                            | CLI, runtime client, and schema migration tooling — what end users interact with directly                 |
| **Code generation**           | `packages/client-generator-js`, `packages/client-generator-ts`, `packages/ts-builders`                                           | Generators and helpers that emit the Prisma Client and TypeScript types                                   |
| **Execution & Engines**       | `packages/client-engine-runtime`, `packages/engines`, `packages/fetch-engine`, `packages/get-platform`, `packages/json-protocol` | Query execution, engine binary management, platform detection, and engine protocol glue                   |
| **Database connectivity**     | `packages/driver-adapter-utils`, `packages/adapter-*`, `packages/bundled-js-drivers`                                             | Driver abstractions and adapter implementations for PostgreSQL, MySQL, SQLite, serverless providers, etc. |
| **Configuration & Utilities** | `packages/config`, `packages/internals`, `packages/schema-files-loader`, `helpers/`                                              | Config loaders, shared helpers, and schema/file utilities used throughout the repo                        |
| **Extensions & integrations** | `packages/sqlcommenter*`, `packages/query-plan-executor`, `packages/instrumentation`                                             | Plugins, monitoring, telemetry, and optional runtime integrations                                         |
| **Testing & CI**              | `packages/integration-tests`, `docker/`, `scripts/`, `test/`                                                                     | End-to-end suites, Docker test environments, and CI automation                                            |

Short notes:

- The repository favors single-purpose packages (many `packages/*`) so changes are localized and discoverable.
- Most development flows start in `packages/` and use `pnpm` scripts defined at the repo root; CI and test orchestration live under `scripts/` and `docker/`.
- Visual diagrams (in `graphs/`) provide a quick entry-point for new contributors — see the "Architecture Diagrams" section for generation steps.

## Repository layout (high level)

This repo is a pnpm/Turborepo monorepo. Most of the product code lives in `packages/`, with supporting tooling and fixtures at the repo root.

### Root folders

| Folder                    | Purpose                                       | Key Contents                                                                                  |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **`packages/`**           | Monorepo packages containing all product code | CLI, client, engines, migrate, adapters, generators, tests, utilities                         |
| **`scripts/`**            | Automation and maintenance                    | `ci/publish.ts` (build orchestration), `bump-engines.ts`, `bench.ts`, `graph-dependencies.ts` |
| **`helpers/`**            | Shared build/test utilities                   | `compile/` (build configs), `blaze/` (utility functions), `test/` (test helpers)              |
| **`docker/`**             | Database test environments                    | `docker-compose.yml`, PostgreSQL, MongoDB, MariaDB, MSSQL containers                          |
| **`graphs/`**             | Generated architecture diagrams               | GraphViz `.dot` files and rendered `.png` outputs (build artifacts)                           |
| **`examples/`**           | Example projects and templates                | Sample apps demonstrating Prisma usage patterns                                               |
| **`sandbox/`**            | Development and debugging helpers             | DMMF explorer, basic setups for quick testing                                                 |
| **`eslint-local-rules/`** | Custom ESLint rules for this repo             | Type safety checks, import conventions                                                        |

### Notable packages

#### Core User-Facing Packages

| Package                | Purpose                                              | Dependencies                                                    |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| **`packages/cli`**     | Prisma CLI entry point (`prisma` command)            | Implements all CLI commands, delegates to migrate, client, etc. |
| **`packages/client`**  | Prisma Client runtime & generated client integration | Orchestrates query execution via ClientEngine                   |
| **`packages/migrate`** | Prisma Migrate & DB commands                         | Schema migrations, introspection, push, fixtures for testing    |

#### Code Generation & Types

| Package                                  | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| **`packages/client-generator-js`**       | Legacy `prisma-client-js` generator               |
| **`packages/client-generator-ts`**       | New `prisma-client` generator (TS-first)          |
| **`packages/client-generator-registry`** | Generator plugin registry                         |
| **`packages/ts-builders`**               | Fluent API for generating TypeScript code & types |
| **`packages/dmmf`**                      | Data Model Meta Format types & utilities          |

#### Runtime & Query Execution

| Package                              | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| **`packages/client-engine-runtime`** | Core query execution engine (WASM-based)     |
| **`packages/engines`**               | Rust binary engine wrapper & downloader      |
| **`packages/fetch-engine`**          | Engine download utilities                    |
| **`packages/get-platform`**          | Platform detection for engine binaries       |
| **`packages/json-protocol`**         | JSON protocol types for engine communication |

#### Database Connectivity

| Package                               | Purpose                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| **`packages/driver-adapter-utils`**   | Shared interfaces for driver adapters (`SqlDriverAdapter`, `SqlQueryable`) |
| **`packages/adapter-pg`**             | PostgreSQL driver adapter (node-postgres)                                  |
| **`packages/adapter-neon`**           | Neon serverless PostgreSQL adapter                                         |
| **`packages/adapter-planetscale`**    | PlanetScale serverless MySQL adapter                                       |
| **`packages/adapter-libsql`**         | libSQL/Turso adapter                                                       |
| **`packages/adapter-d1`**             | Cloudflare D1 adapter                                                      |
| **`packages/adapter-better-sqlite3`** | Better-sqlite3 adapter                                                     |
| **`packages/adapter-mariadb`**        | MariaDB adapter                                                            |
| **`packages/adapter-mssql`**          | SQL Server adapter                                                         |
| **`packages/bundled-js-drivers`**     | Bundled JS database drivers                                                |

#### Configuration & Utilities

| Package                             | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| **`packages/config`**               | Prisma config loader & types (`prisma.config.ts`)    |
| **`packages/internals`**            | Shared CLI/internal utilities (schema parsing, etc.) |
| **`packages/schema-files-loader`**  | Schema file loading utilities                        |
| **`packages/client-common`**        | Common client utilities                              |
| **`packages/client-runtime-utils`** | Client runtime helper functions                      |

#### Extensions & Integrations

| Package                                    | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| **`packages/sqlcommenter`**                | Base SQL commenter plugin types & interfaces |
| **`packages/sqlcommenter-query-tags`**     | Add custom query tags to SQL comments        |
| **`packages/sqlcommenter-trace-context`**  | W3C Trace Context integration                |
| **`packages/sqlcommenter-query-insights`** | Query shape insights for monitoring          |
| **`packages/query-plan-executor`**         | Standalone executor for Prisma Accelerate    |
| **`packages/instrumentation`**             | Telemetry & tracing instrumentation          |
| **`packages/instrumentation-contract`**    | Instrumentation interfaces                   |

#### Testing & Development

| Package                             | Purpose                                 |
| ----------------------------------- | --------------------------------------- |
| **`packages/integration-tests`**    | End-to-end test suites across providers |
| **`packages/type-benchmark-tests`** | TypeScript performance benchmarks       |
| **`packages/bundle-size`**          | Bundle size tracking & tests            |

#### Tooling

| Package                                          | Purpose                               |
| ------------------------------------------------ | ------------------------------------- |
| **`packages/generator`**                         | Base generator types                  |
| **`packages/generator-helper`**                  | Generator development utilities       |
| **`packages/debug`**                             | Debug utilities for Prisma            |
| **`packages/credentials-store`**                 | Secure credential storage             |
| **`packages/nextjs-monorepo-workaround-plugin`** | Next.js monorepo compatibility plugin |

## Architecture Diagrams

### Generating Graphs

To generate or update architecture diagrams, first install [GraphViz](http://graphviz.org/download/):

- **Windows**: `choco install graphviz` or download from [graphviz.org](http://graphviz.org/download/)
- **macOS**: `brew install graphviz`
- **Linux**: `apt-get install graphviz` or `yum install graphviz`

#### Package Dependency Graphs

Generate dependency graphs showing relationships between packages:

```bash
pnpm ts-node scripts/graph-dependencies.ts
```

This creates:

- `./graphs/dependencies.png` - Runtime dependencies
- `./graphs/devDependencies.png` - Development dependencies
- `./graphs/peerDependencies.png` - Peer dependencies

#### Repository Layout Diagram

Generate high-level repository structure visualization:

```bash
cd graphs
dot -Tpng repo-layout.dot -o repo-layout.png
```

Or from repo root:

```bash
dot -Tpng ./graphs/repo-layout.dot -o ./graphs/repo-layout.png
```

### Visual Architecture

### Dependencies

<img src="./graphs/dependencies.png">

### Dev Dependencies

<img src="./graphs/devDependencies.png">

### Peer Dependencies

<img src="./graphs/peerDependencies.png">

## Generators

See [Prisma Generators](https://prismaio.notion.site/Prisma-Generators-a2cdf262207a4e9dbcd0e362dfac8dc0)

## The `DMMF`, or Data Model Meta Format

What the ... is DMMF? It's the Datamodel Meta Format. It is an AST (abstract syntax tree) of the datamodel in the form of JSON.  
The whole Prisma Client is just generated based on the DMMF, which comes from the Rust engines.
Note: the datamodel is contained in the Prisma schema file, along the datasource and generators blocks.

> ⚠️ Note: The DMMF is a Prisma ORM internal API with no guarantees for stability to outside users. We might - and do - change the DMMF in potentially breaking ways between minor versions. 🐲

### Upgrading and debugging

<!-- TODO -->

Oftentimes, the Rust team did a change in DMMF, which you now need to integrate. How to do that?  
The first step is to identify, which new `@prisma/engines` version you want to use.  
Either have a look in the **Versions** tab in https://www.npmjs.com/package/@prisma/engines or check out `npm info @prisma/engines` in your terminal.  
Let's say you determined, that you want to upgrade to `2.20.0-14.f461292a2242db52d9f4c87995f0237aacd300d2`. To upgrade your local workspace, run this command to upgrade both `@prisma/engines` and `@prisma/engines-version`:

```bash
pnpm update -r @prisma/engines@2.20.0-14.f461292a2242db52d9f4c87995f0237aacd300d2 @prisma/engines-version@2.20.0-14.f461292a2242db52d9f4c87995f0237aacd300d2
```

In the `./packages/client` dir, now open [sandbox/dmmf.ts](./packages/client/sandbox/dmmf.ts) in your VSCode editor.
**Either** run `ndb` in your terminal to debug the file: `ndb -r ts-node/register ./sandbox/dmmf.ts`
**Or**

1. Open `.vscode/launch.json.default` and save it as `.vscode/launch.json`.
2. Then click on the debug icon in VSCode:![image](https://user-images.githubusercontent.com/1094804/112352391-03817e80-8ccb-11eb-8177-806ec58f5bec.png)
3. Then select in the dropdown of possible runner options `Client - Current TS File` ![image](https://user-images.githubusercontent.com/1094804/112352469-11cf9a80-8ccb-11eb-9063-85387ee82c4f.png)
4. Then just press the green play button
5. You should now be able to go through the DMMF and have a look at the json structure ![image](https://user-images.githubusercontent.com/1094804/112352660-3cb9ee80-8ccb-11eb-940d-36850ac0db9a.png)

You can always check out the test of our "not-so-exhaustive-schema", where we test the fully generated client, which depends on the dmmf:

```bash
pnpm run test exhaustive
```

Usually, dmmf changes are also visible in the tests of the `@prisma/internals` package:

```bash
cd ./packages/internal
pnpm run test
```

If there is a change in the snapshots, only accept them if you're 100% certain, that these changes are expected.  
If not, please always ping the Rust team, if this is an intended change.
