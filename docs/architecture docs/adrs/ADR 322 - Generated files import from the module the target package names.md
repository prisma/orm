# ADR 322 — Generated files import from the module the target package names

**Status:** Accepted
**Date:** 2026-11-18
**Supersedes in part:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), where it says the emitter picks import names by reading the application's manifest.

---

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

The emitter has to write a module name there, and it must be one the application can resolve. This record decides where that name comes from.

A **target** is the database an application uses, such as Postgres or MongoDB. A **target package** is the package an application installs to use that target, such as `@prisma/orm-postgres`. ADR 242 calls it a facade.

## Decision

The name comes from the config, and the target package puts it there.

An application imports `defineConfig` from its target package:

```ts
// prisma.config.ts
import { defineConfig } from '@acme/orm-db/config';

export default defineConfig({ contract: './prisma/contract.prisma' });
```

That `defineConfig` returns a config that names two modules:

```ts
// @acme/orm-db/config
import { defineConfig as defineFrameworkConfig } from '@prisma/orm-framework/config/config-types';
import { adapter, driver, family, target } from './components';

export function defineConfig(options: ConfigOptions) {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    contract: { ...contractSource(options), typesModule: '@acme/orm-db/generated-types' },
    migrations: { module: '@acme/orm-db/migration' },
  });
}
```

The emitter writes those names into the files it generates. It reads nothing else to choose them: not the application's `package.json`, and not a list of package names. Prisma's own target packages do exactly this, with no ability another author's package lacks.

## The two modules

Prisma generates two kinds of file that import from a package.

**Contract types.** `contract.d.ts`, and the copy of it kept beside each migration, import only types. They come from three places: the framework (what a contract is), the family (what a SQL or a document contract adds) and the target (its codec and operation types). `contract.typesModule` names one module that exports all of them. That module only re-exports:

```ts
// @acme/orm-db/generated-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from './codec-types';
export type * from './operation-types';
```

It exports each type under its own name. The generated file imports a few under an alias, where the name would clash with a type the file itself exports: it exports its own `Contract`, `TypeMaps` and `CodecTypes`.

**Migration files.** A migration file written by `prisma migration plan` imports values that run: the migration base class, the command-line entry and the operation helpers.

```ts
// migration.ts, generated
import { col, Migration, MigrationCLI } from '@acme/orm-db/migration';
```

`migrations.module` names that module. It is separate from the types module because it is loaded at run time and should carry only migration code. A target's migration renderer writes its imports from the module it is handed and names none itself.

Both members sit in config sections that already describe the same artifacts: `contract` holds the contract's source and output paths, and `migrations` holds the migrations directory.

## Every component states where its types are

A target, an adapter and an extension are the same kind of thing: a framework component. Each declares the types it contributes to `contract.d.ts` in the same form, a module, a name and an alias:

```ts
{ package: '@prisma/orm-extension-pgvector/codec-types', named: 'CodecTypes', alias: 'PgVectorTypes' }
{ package: '@prisma/orm-target-postgres/target/codec-types', named: 'CodecTypes', alias: 'PgTypes' }
```

The module is always one that can be imported from outside this repository. A declaration in a published package never holds a private workspace name.

The emitter writes every declaration from the module it states and treats them all alike. An application imports only from packages it depends on directly, and that decides which module a declaration ends up stating:

- **An extension** is a package the application installs, so its declarations state its own package and are used as they are.
- **A target and its adapter** are parts of a target package. They state their own published module, which an application that assembles its own stack depends on directly. An application on a target package does not depend on it, so the target package hands the config copies of the two descriptors whose declarations state its own types module:

```ts
// @acme/orm-db, the one file that assembles its components
import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';

export const target = restateTypeDeclarations(dbTarget, '@acme/orm-db/generated-types');
export const adapter = restateTypeDeclarations(dbAdapter, '@acme/orm-db/generated-types');
```

A target package assembles its family, target, adapter and driver in one place. Its `defineConfig` and its control client both build from that, so a command run through the CLI and a script that uses the control client are given the same components.

## Imports are data

No emitter writes an import statement as text. The framework emitter, each family emitter and each component's declaration produce import requirements: a module, a symbol and an optional alias. One helper renders them all:

- one statement per module, so everything a target package names comes out as one line, and each extension keeps its own;
- names in a fixed order that does not depend on the machine's locale;
- a name declared twice written once.

A family emitter is handed the types module and returns the requirements for the family's own types:

```ts
getFamilyImports(typesModule: string): ReadonlyArray<ImportRequirement>;
```

## A config must name its modules

A config built through a target package always names them. A config assembled directly from the framework's `defineConfig` names them itself.

- A command that must write a contract type file with no `contract.typesModule` stops before writing anything, with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`. A command that must write a migration file with no `migrations.module` stops with `CONFIG.MIGRATION_MODULE_MISSING`. The emitter never falls back to a default or works a name out.
- A module is named the way a package is imported, such as `@acme/orm-db/generated-types`, or by a name private to the package that holds the generated files, such as `#generated-types`. It is never a path or a URL. Generated files are written into more than one folder, a contract's types beside the contract and a copy beside each migration, and a relative path is right for at most one of them. A path is refused when the config is validated.
- An emitted contract holds no record of where a component's types are imported from. Nothing reads one, and an emitted artifact never holds a name the application cannot resolve.

## Why

- **Every target package is treated the same.** A package Prisma did not write names its modules exactly as `@prisma/orm-postgres` does. Nothing in the CLI has to know the package exists.
- **The config is the one input.** An application declares its target by importing a package in `prisma.config.ts`. The generated files follow from that declaration, with no second source that could disagree.
- **The name cannot be wrong about what is installed.** The config imports the target package. If the package is missing, the config fails to load and nothing is generated.
- **The application depends on one package.** Generated files name the target package, which re-exports what they need.
- **A declaration is true wherever it is read.** It states a module that exists, so no reader needs a translation step.

## How Prisma's own packages know their names

This section concerns only the packages built in this repository.

Their source is written against private workspace names, such as `@internal/postgres`. The published packages, such as `@prisma/orm-postgres`, are produced from that source by a build step that knows, for each workspace package, the published package it goes into and the entry it is published under.

A workspace package's published module base is therefore a constant that the build fills in, one per workspace package: `@prisma/orm-postgres` for the Postgres target package, `@prisma/orm-target-postgres/target` for the Postgres target, `@prisma/orm-postgres-contrib/citext` for the citext extension. When the source is used directly inside this repository, the constant is not filled in and the package uses its workspace name, which resolves there. A component that states another workspace package's module, as the Postgres adapter states the target's codec types, takes that package's base from it.

The table that maps workspace packages to published packages is configuration for that build. It plays no part when a user's files are generated.

Checks over the built published packages keep this honest: no package's output still contains an unfilled constant, every module a component declares and every module a config names is one of that package's own exports, and no declaration holds a workspace name.

## Consequences

- A target package from any author gets correct generated files with no change to the CLI and no entry in any list.
- A target package has three obligations: a module that re-exports the contract types, a module for migration files, and components whose type declarations state its types module.
- A generated file can be checked mechanically: every import is one of the config's two modules, an extension's own module, or a relative path.
- An application that assembles its own stack from the framework, family and target packages writes a small module that re-exports their types, gives it a name private to its own package, and names that in its config.
- A generated file written by an earlier release keeps working, because the modules it names stay exported.

## Alternatives considered

### Read the application's manifest

The CLI reads the application's `package.json`, finds a known Prisma package among its dependencies and translates each private module name to a subpath of that package through a fixed table. The argument for it is that a setting could disagree with what is installed.

Rejected. It works only for packages in the table, so a target package from another author gets names that do not resolve. And the argument does not hold against a name the target package supplies itself, because the config that carries the name fails to load when the package is missing.

### The target package supplies a map or a resolver function

The package would map each of Prisma's private module names to one of its own subpaths, or supply a function that does. Rejected because either makes private names, which are free to change, into an interface that outside authors must track.

### Declarations hold workspace names and are translated when files are generated

Each declaration names a private workspace module, and a function turns it into a published name at the moment a file is written. Rejected because a declaration then says something false wherever it is read, and every reader needs the function and the table behind it.

### A target and its adapter declare no module

The types module named in the config would carry every name, so a target or adapter would declare only names and aliases, and only an extension would name a module. Rejected because it makes a target a different kind of thing from an extension, and because an application that assembles its own stack would have nothing to say where the target's types come from.

### Emitters hand each other import statements as text

A family emitter would return finished `import` lines for the framework emitter to write out. Rejected because statements that name the same module could then be merged only by reading that text back.

### One module for both kinds of file

Rejected because a migration file's module is loaded at run time and should not carry the type surface.

### A relative path as a module, rewritten for each file

The emitter would work out the right relative path for each folder it writes into. Rejected because the emitter would be interpreting the module again instead of writing what the config states, and a package can already give a module a private name that resolves from every folder inside it.
