# Generated files import from the module the target package names

**Status:** Proposed
**Supersedes in part:** the public npm packages record (ADR 242), where it says the emitter picks import names by reading the application's manifest.

## At a glance

`prisma contract emit` writes a `contract.d.ts` into the application. The file imports the types it is built from:

```ts
// contract.d.ts, generated
import type {
  CodecTypes as PgTypes,
  Contract as ContractType,
  ContractWithTypeMaps,
  StorageHashBase,
  TypeMaps as TypeMapsType,
} from '@prisma/orm-postgres/generated-types';
```

The emitter has to write a package name there, and it must be a package the application can resolve. This record decides where that name comes from.

A **target** is the database an application uses, such as Postgres or MongoDB. A **target package** is the package an application installs to use that target, such as `@prisma/orm-postgres`.

## Decision

The name comes from the config. The target package the application's `prisma.config.ts` imports puts it there.

An application writes this:

```ts
// prisma.config.ts
import { defineConfig } from '@prisma/orm-postgres/config';

export default defineConfig({ contract: './prisma/contract.prisma' });
```

and the `defineConfig` it imported returns a config that names two modules:

```ts
// @prisma/orm-postgres/config
import { defineConfig as frameworkDefineConfig } from '@prisma/orm-framework/config/config-types';

export function defineConfig(options: PostgresConfigOptions) {
  return frameworkDefineConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    contract: { ...contractConfig, typesModule: '@prisma/orm-postgres/generated-types' },
    migrations: { ...options.migrations, module: '@prisma/orm-postgres/migration' },
  });
}
```

The emitter writes those names into the files it generates. It reads nothing else to choose them: not the application's `package.json`, and not a list of package names.

## The two modules

Prisma generates two kinds of file that import from a package.

**Contract types.** `contract.d.ts`, and the copy of it kept beside each migration, import only types. They come from three places: the framework (what a contract is), the family (what a SQL or a document contract adds) and the target (the database's own codec and operation types). `contract.typesModule` names one module that exports all of them.

That module only re-exports:

```ts
// @prisma/orm-postgres/generated-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from '@prisma/orm-target-postgres/target/codec-types';
export type * from '@prisma/orm-target-postgres/target/operation-types';
```

It exports each type under its own name. The generated file imports a few of them under an alias, where the name would clash with a type the file itself exports: it exports its own `Contract`, `TypeMaps` and `CodecTypes`.

**Migration files.** A migration file rendered by `prisma migration plan` imports values that run: the migration base class, the command-line entry and the operation factories.

```ts
// migration.ts, generated
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
```

`migrations.module` names that module. It is separate from the types module because it is loaded at run time and should carry only migration code.

Both members sit in config sections that already describe the same artifacts: `contract` holds the contract's source and output paths, and `migrations` holds the migrations directory.

## Extensions

An extension, such as `@prisma/orm-extension-pgvector`, is a package the application installs itself. Its types are imported from its own package, in their own import line. The extension states that module name, as the target package states its two.

## A config must name its modules

A config built through a target package always names them. A config assembled directly from the framework's `defineConfig` names them itself.

If a command needs a module the config does not name, it stops with an error that names the missing member. The emitter never falls back to a default or works a name out.

Any module name recorded inside an emitted contract is the name the matching import line uses. An emitted artifact never holds a name the application cannot resolve.

## Why

- **Every target package is treated the same.** A package Prisma did not write names its modules exactly as `@prisma/orm-postgres` does. Nothing in the CLI has to know the package exists.
- **The config is the one input.** An application declares its target by importing a package in `prisma.config.ts`. The generated files follow from that declaration, with no second source that could disagree.
- **The name cannot be wrong about what is installed.** The config imports the target package. If the package is missing, the config fails to load and nothing is generated.
- **The application depends on one package.** Generated files name the target package, which re-exports what they need. The application does not have to install the framework, family and target packages to make its generated files compile.

## How Prisma's own packages know their names

This section concerns only the packages built in this repository.

Their source is written against private workspace names, such as `@internal/postgres`. The published packages, such as `@prisma/orm-postgres`, are produced from that source by a build step that knows the published name.

A package's own name is therefore a constant that the build fills in: the published name in the published package, the workspace name when the source is used directly inside this repository. So `@prisma/orm-postgres` names `@prisma/orm-postgres/generated-types`, and a test in this repository that loads the workspace package gets `@internal/postgres/generated-types`, which resolves there.

The table that maps workspace packages to published packages is configuration for that build. It plays no part when a user's files are generated.

## Consequences

- A target package from any author gets correct generated files with no change to the CLI.
- A target package has two obligations: a module that re-exports the contract types, and a module for migration files.
- A generated file can be checked mechanically: every import is one of the config's two modules, an extension's module, or a relative path.
- An application that assembles its own stack from the framework, family and target packages writes a small module that re-exports their types and names it in its config.

## Alternatives considered

### Read the application's manifest

The CLI reads the application's `package.json`, finds a known Prisma package among its dependencies and translates each private module name to a subpath of that package through a fixed table. The argument for it is that a setting could disagree with what is installed.

Rejected. It works only for packages in the table, so a target package from another author gets names that do not resolve. And the argument does not hold against a name the target package supplies itself, because the config that carries the name fails to load when the package is missing.

### The target package supplies a map or a resolver function

The package would map each of Prisma's private module names to one of its own subpaths, or supply a function that does. Rejected because either makes private names, which are free to change, into an interface that outside authors must track.

### One module for both kinds of file

Rejected because a migration file's module is loaded at run time and should not carry the type surface.

### Each part names its own package

The framework, the family and the target would each write an import from their own published package. Rejected because an application installs the target package and not those three. They are its dependencies, and a strict package manager does not let the application import a dependency's dependency.
