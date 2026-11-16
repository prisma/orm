# Generated files import from the module the database package names

**Status:** Proposed
**Supersedes in part:** the public npm packages record (ADR 242), where it says the emitter picks import names by reading the application's manifest.

## Decision

The config says which modules generated files import from. A database package's `defineConfig` fills them in, so an application never writes them:

```ts
// inside @prisma/orm-postgres, in defineConfig
return coreDefineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  contract: { ...contractConfig, typesModule: '@prisma/orm-postgres/generated-types' },
  migrations: { ...options.migrations, module: '@prisma/orm-postgres/migration' },
});
```

`prisma contract emit` then writes one import line for everything the framework, the family, the target and the adapter contribute:

```ts
import type {
  CodecTypes as PgTypes,
  Contract as ContractType,
  ContractWithTypeMaps,
  QueryOperationTypes as PgTargetQueryOps,
  StorageHashBase,
  TypeMaps as TypeMapsType,
} from '@prisma/orm-postgres/generated-types';
import type { CodecTypes as PgVectorTypes } from '@prisma/orm-extension-pgvector/codec-types';
```

and a rendered migration file imports its runtime helpers from the migrations module:

```ts
import { col, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
```

The CLI does not read the application's `package.json` to choose these names, and it consults no list of package names.

## The two config members

| Member | Holds | Used for |
| --- | --- | --- |
| `contract.typesModule` | A module that exports every type name the framework, family, target and adapter parts of `contract.d.ts` use | `contract.d.ts` and snapshot declaration files |
| `migrations.module` | A module that exports the migration base class, the CLI entry and the operation factories | Rendered `migration.ts` files |

Both sit in config sections that already describe those artifacts: `contract` holds the source and output paths, `migrations` holds the directory.

They are two members and not one because the files differ in kind. `contract.d.ts` imports only types, which cost nothing at run time. A migration file imports values, so its module should carry only migration code.

A database package may name its root as either module. Prisma's database packages have no root export, so each names a subpath.

## Who names what

| Part of the generated file | Module it imports from | Who states it |
| --- | --- | --- |
| Framework contract types | `contract.typesModule` | The database package |
| Family contract types | `contract.typesModule` | The database package |
| Target and adapter codec and operation types | `contract.typesModule` | The database package |
| An extension pack's codec and operation types | The pack's own package | The extension pack |
| Migration helpers | `migrations.module` | The database package |

A component declares which names it needs and under which alias. It declares no package for them, except an extension pack, which is a package the application installs directly.

Extension packs keep their own import line because their type names collide with the target's: both export `CodecTypes`, `ParameterizedOutputTypesForTypeParams` and `QueryOperationTypes`. Among the framework, family and target modules there is no collision. The one shared name, `JsonValue`, is the same type re-exported.

## How a package states its own name

A package's source is written against workspace names, and its published form is produced by the shell build, which knows the published name. So the name is a build-time constant: the shell build defines it as the published package name, and the workspace build defines it as the workspace name.

This is how `@prisma/orm-postgres` says `@prisma/orm-postgres/generated-types` while a package test inside this repository, which loads the workspace facade, gets `@internal/postgres/generated-types`. Extension packs use the same constant for their type imports.

The table that maps workspace packages to published packages remains as build configuration for the shell build and the publish lint. It is not read when a user's files are generated.

## When the config does not say

A config composed by hand, without a database package's `defineConfig`, must state both members itself. If `contract.typesModule` is missing, `contract emit` fails with a structured error that names the member. The same holds for `migrations.module` and the commands that render migration files. Nothing is defaulted and nothing is looked up.

An application that composes its own stack from the framework, family and target packages names a module of its own that re-exports the types from those packages.

## The `package` string in codec metadata

An emitted contract records a `package` string beside each extension codec descriptor. It is outside the hashed part of the contract, and it must not hold a private workspace name.

- If nothing reads it, it is removed from the emitted contract.
- If something reads it, it records the module the matching import line names.

Which case holds is settled by reading the code when the change is made.

## What a database package provides

- A module that re-exports the type names generated contract types use from the framework, its family and its target.
- A module for migration files.
- Both named in the config its `defineConfig` returns.

## Consequences

- An outside database package gets correct generated files with no change to the CLI and no entry in any list.
- `contract.d.ts` shrinks from four or more import lines to one, plus one per extension pack.
- Every existing generated file in this repository changes when regenerated. Files already in users' projects keep working, because the modules they name stay exported.
- A config built by calling the core `defineConfig` directly must now state the two modules. This is a breaking change for those configs, recorded in the extension upgrade instructions.
- The check that a generated file names only installed packages becomes: every import is one of the config's two modules, an extension pack's module, or a relative path.

## Alternatives considered

### Read the application's manifest and translate through a table

The CLI finds one of Prisma's package names in the application's `package.json` and translates each workspace module name to a subpath of that package. The argument for it was that a setting could disagree with what is installed.

Rejected. It works only for the packages in the table, so an outside database package gets unresolvable names. And the argument does not apply to a name the database package supplies: the config imports that package, so if it is not installed the config fails to load before anything is emitted.

### The database package supplies a map from workspace module names to its subpaths

Rejected because it makes private workspace names an interface that outside authors must track.

### The database package supplies a resolver function

The same objection: the function would be called with private workspace names.

### One member for both kinds of file

Rejected because a migration file's module is loaded at run time and should not carry the type-only surface.

### Each component names its own published package

The framework emitter, the family and the target would each write an import from their own package. Rejected for applications on a database package: they install that one package, and the other packages are its dependencies, which a strict package manager does not let the application import.
