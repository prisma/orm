# ADR 324 — Generated files import from the module the facade names

**Status:** Accepted
**Date:** 2026-11-18
**Supersedes in part:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), where it says the emitter picks import names by reading the application's manifest.

---

`prisma contract emit` writes a `contract.d.ts` into the application. The file imports the types it is built from:

```ts
// contract.d.ts, generated (abridged: a real file imports about a dozen names here)
import type {
  CodecTypes as PgTypes,
  Contract as ContractType,
  ContractWithTypeMaps,
  StorageHashBase,
  TypeMaps as TypeMapsType,
} from '@prisma/orm-postgres/contract-types';
```

The emitter has to write a module name on the last line. This record decides where that name comes from.

Three facts make the question harder than it looks:

- **An application can import only from packages it depends on directly.** The name must be a module of a package in the application's own `package.json`, not of a package that one is built from.
- **Prisma does not write every package an application can use.** A **target** is the component of the Prisma ORM stack that supports one database, such as Postgres or MongoDB; its package is a **target package**, such as `@prisma/orm-target-postgres`. A **facade** is the package an application installs to use that database, such as `@prisma/orm-postgres`: one function in it glues the framework, family, target, adapter and driver together. Anyone can publish a facade, and the CLI cannot know its name in advance.
- **A facade is built from several parts.** The framework says what a contract is. A **family** says what a kind of database adds: SQL, or documents. The target adds the types of its own columns and operations. The types in a `contract.d.ts` come from all three.

## Decision

The name comes from the config, and the facade puts it there.

```text
facade ──── defineConfig ────┐
                                     ▼
extension packages ── extensions ──► config ──► emitter ──► contract.d.ts, migration.ts
```

Take a facade that Prisma did not write, `prisma-orm-acmedb`. An application imports `defineConfig` from it:

```ts
// prisma.config.ts
import { defineConfig } from 'prisma-orm-acmedb/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  output: './src/prisma/contract.json',
});
```

That `defineConfig` wraps the framework's and returns a config that names two modules:

```ts
// prisma-orm-acmedb/config (abridged)
export function defineConfig(options: { contract: string; output: string }) {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    contract: {
      ...contractSource(options), // stands for the package's own code that reads the contract
      typesModule: 'prisma-orm-acmedb/contract-types', // contract.d.ts imports its types from here
    },
    migrations: { module: 'prisma-orm-acmedb/migration' }, // migration.ts imports from here
  });
}
```

The emitter writes those two names into the files it generates. It reads nothing else to choose them: not the application's `package.json`, and not a list of package names. Prisma's own facades do exactly this, with no ability another author's package lacks.

A facade therefore has three obligations:

1. a module that re-exports the contract types, named in `contract.typesModule`;
2. a module for migration files, named in `migrations.module`;
3. parts whose type declarations state its types module (see [Every component states where its types are](#every-component-states-where-its-types-are)).

An application that uses no facade, and assembles its own stack from the framework, family and target packages, does the same in miniature. It writes a small module that re-exports their types, gives it a name private to its own package, and names that in its config.

## The two modules

Prisma generates two kinds of file that import from a package.

**Contract types.** `contract.d.ts` imports only types. So do the copies of it that Prisma keeps in the migrations folder, one for each contract the migrations record. `contract.typesModule` names one module that exports every type these files need, and that module only re-exports:

```ts
// prisma-orm-acmedb/contract-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from './codec-types';
export type * from './operation-types';
```

It exports each type under its own name. The generated file imports a few under an alias, where the name would clash with a type the file itself exports: it exports its own `Contract`, `TypeMaps` and `CodecTypes`.

One module means one namespace for the framework's, the family's and the target's type names. Two types with the same name from different modules cannot both be exported from it. A name added to the framework's or a family's contract types can therefore clash with a name in a facade, and that package's typecheck is what finds it.

**Migration files.** A migration file written by `prisma migration plan` imports values that run: the migration base class, the command-line entry and the operation helpers.

```ts
// migration.ts, generated
import { col, Migration, MigrationCLI } from 'prisma-orm-acmedb/migration';
```

`migrations.module` names that module. It is separate from the types module because it is loaded at run time and should carry only migration code. The target's code that renders a migration file is handed this module, writes every import from it, and names no module itself.

The two config fields sit in sections that already describe the same artifacts: `contract` holds the contract's source and output paths, and `migrations` holds the migrations directory.

## Every component states where its types are

The types module says where the facade's types can be imported from. It does not say which names a particular `contract.d.ts` needs, or under which alias. That comes from the parts the config is assembled from.

A target, an **adapter** (the part that turns queries into what the database's driver accepts) and an **extension** (a separate package that adds types or operations, such as a vector column type) are the same kind of thing: a framework component. Each declares the types it contributes to `contract.d.ts` in the same form, a module, a name and an alias:

```ts
{ package: '@prisma/orm-extension-pgvector/codec-types', named: 'CodecTypes', alias: 'PgVectorTypes' }
{ package: '@prisma/orm-target-postgres/target/codec-types', named: 'CodecTypes', alias: 'PgTypes' }
```

The emitter imports each declared name from the module its declaration states, and treats all declarations alike. The module is always one that can be imported from outside the package's own repository.

Which module a declaration states follows from the first fact in the introduction:

- **An extension** is a package the application installs, so its declarations state its own package and are used as they are. Its types are imported from its own package, not through a facade's types module.
- **A target and its adapter** each state their own published module, as the second line above does. An application that assembles its own stack depends on those packages directly, so that is the right name for it.
- **An application on a facade** does not depend on them directly. The facade therefore hands the config copies of its target and adapter whose declarations state its own types module:

```ts
// prisma-orm-acmedb, the one file that assembles its components
import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';

export const target = restateTypeDeclarations(acmeTarget, 'prisma-orm-acmedb/contract-types');
export const adapter = restateTypeDeclarations(acmeAdapter, 'prisma-orm-acmedb/contract-types');
```

This is how the opening example comes to import `CodecTypes as PgTypes` from `@prisma/orm-postgres/contract-types`: the Postgres facade restates the second declaration above onto its own types module. `restateTypeDeclarations` refuses when two declarations would import one name from two modules.

A facade assembles its family, target, adapter and driver in one file. Its `defineConfig` and its control client, the client a script uses to inspect or migrate a database, both build from that file. A command run through the CLI and a script that uses the control client are therefore given the same components.

## Emitters pass imports as data

No emitter writes an import statement as text. The framework's emitter, each family's emitter and each component's declaration produce import requirements: a module, a symbol and an optional alias. A family's emitter is handed the types module and returns the requirements for the family's own types. One helper renders all of them, with one statement per module, so everything a facade names comes out as one statement and each extension keeps its own. A name declared twice is written once.

Names in a generated file are ordered by their UTF-16 code units, in imports and in every other list an emitter writes. The same input gives the same file on every machine.

## A config must name its modules

A config built through a facade always names them. A config assembled directly from the framework's `defineConfig` names them itself.

- **A missing module stops the command before it writes anything.** A command that must write a contract type file with no `contract.typesModule` stops with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`. That is `contract emit`, and every command that writes a copy into the migrations folder: `migration plan` and `migration new`, and `db migrate`, `db init`, `db update` and `db sign` when they record which contract a database has reached. A command that must write a migration file with no `migrations.module`, which is `migration plan` and `migration new`, stops with `CONFIG.MIGRATION_MODULE_MISSING`. The emitter never falls back to a default or works a name out.
- **A module is named the way a package is imported**, such as `prisma-orm-acmedb/contract-types`. A config can also use a name private to the package that holds the generated files, declared in the `imports` field of that package's `package.json`, such as `#contract-types`. A module is never empty, a path or a URL: generated files are written into more than one folder, a contract's types beside the contract and copies in the migrations folder, and a relative path is right for at most one of them. Each of these is refused when the config is validated.
- **An emitted contract does not record where a component's types are imported from.** An emitted artifact never holds a name the application cannot resolve.

## Why

- **Every facade is treated the same.** A package Prisma did not write names its modules exactly as `@prisma/orm-postgres` does. Nothing in the CLI has to know the package exists.
- **The config is the one input.** An application declares its target by importing a package in `prisma.config.ts`. The generated files follow from that declaration, with no second source that could disagree.
- **The name cannot disagree with what is installed.** The config imports the facade. If the package is missing, the config fails to load and nothing is generated.
- **The application depends on one package.** Generated files name the facade, which re-exports what they need.
- **A declaration can be read as it stands.** It states a module that exists, so nothing that reads it has to translate the name first.

## How Prisma's own packages know their names

This section concerns only the packages built in Prisma's repository. Their source is written against private workspace names, such as `@internal/postgres`, and a build step produces the published packages, such as `@prisma/orm-postgres`, from it. That build fills in each package's published module name as a constant, so a component built there states a published name and never a workspace name. Checks over the built packages enforce this: no unfilled constant remains, every module a component declares or a config names is one of that package's own exports, and no declaration holds a workspace name. The build's table of names plays no part when a user's files are generated.

## Consequences

- A facade from any author gets correct generated files with no change to the CLI and no entry in any list.
- A generated file can be checked mechanically: every import is a module the config names, a module a component states for its own types, or a relative path to another generated file.
- The modules that generated files have named stay exported, so a generated file keeps working after the package that wrote it is upgraded.
- A facade's types module is a shared namespace, with the clash described under [The two modules](#the-two-modules).

## Alternatives considered

### Read the application's manifest

The CLI would read the application's `package.json`, find a known Prisma package among its dependencies and translate each private module name to a subpath of that package through a fixed table. The argument for it is that a setting in the config could disagree with what is installed.

Rejected. It works only for packages in the table, so a facade from another author gets names that do not resolve. And the argument does not hold against a name the facade supplies itself, because the config that carries the name fails to load when the package is missing.

### The facade supplies a map or a resolver function

The package would map each of Prisma's private module names to one of its own subpaths, or supply a function that does. Rejected because either makes private names, which are free to change, into an interface that outside authors must track.

### Declarations hold workspace names and are translated when files are generated

Each declaration would name a private workspace module, and a function would turn it into a published name at the moment a file is written. Rejected because a declaration then says something false wherever it is read, and every reader needs the function and the table behind it.

### A target and its adapter declare no module

The types module named in the config would carry every name, so a target or adapter would declare only names and aliases, and only an extension would name a module. Rejected because it makes a target a different kind of thing from an extension, and because an application that assembles its own stack would have nothing to say where the target's types come from.

### Emitters hand each other import statements as text

A family's emitter would return finished `import` lines for the framework's emitter to write out. Rejected because statements that name the same module could then be merged only by reading that text back.

### The facade republishes each source module under its own subpath

The copied declarations would name one subpath of the facade for each module they came from, such as a codec types subpath and a contract types subpath. That keeps one import statement per source module and needs no shared namespace of type names. Rejected because every facade would have to publish a matching subpath for each module of the framework, the family and the target, and would have to add one whenever any of them adds a module.

### One module for both kinds of file

Rejected because a migration file's module is loaded at run time and should not carry the type surface.

### A relative path as a module, rewritten for each file

The emitter would work out the right relative path for each folder it writes into. Rejected because the emitter would be interpreting the module again instead of writing what the config states, and a package can already give a module a private name that resolves from every folder inside it.
