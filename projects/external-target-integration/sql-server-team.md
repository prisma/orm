# How a SQL Server package plugs into Prisma 8

For the team building a SQL Server target for Prisma 8 in their own repository. This replaces the mechanism proposed in [prisma/orm#31008](https://github.com/prisma/orm/pull/31008).

**Status:** the first half, generated files importing from your package, is merged in [prisma/orm#31078](https://github.com/prisma/orm/pull/31078) and will be in the next release candidate after `8.0.0-rc.24`. Section 1 describes it as built. The second half, `prisma orm init`, is being built now, so the names in section 2 can still change. We will post in the Discord thread when each part is released, with the version to pin.

## The outcome

We accept the need you raised and are building it. We are not taking the `package.json` registration from your proposal.

When this is released, an application uses your package like this, with no entry for SQL Server anywhere in Prisma's code:

```sh
prisma orm init --target @microsoft/prisma-orm-mssql
prisma contract emit
```

You are not blocked meanwhile. [Until the changes are released](#until-the-changes-are-released) says how an application uses your package today.

`@microsoft/prisma-orm-mssql` is a placeholder throughout. You choose the name.

## The design

Your package tells Prisma about itself in two places, both of them code your package exports. Prisma's own Postgres and MongoDB packages will use exactly the same two mechanisms.

### 1. Your `defineConfig` names the modules that generated files import from

An application's `prisma.config.ts` imports `defineConfig` from your package. The config object it returns names two modules:

```ts
// @microsoft/prisma-orm-mssql/config
import { defineConfig as frameworkDefineConfig } from '@prisma/orm-framework/config/config-types';

export function defineConfig(options: MssqlConfigOptions) {
  return frameworkDefineConfig({
    family: sql,
    target: mssqlTarget,
    adapter: mssqlAdapter,
    driver: mssqlDriver,
    contract: {
      ...contractConfig,
      typesModule: '@microsoft/prisma-orm-mssql/contract-types',
    },
    migrations: {
      ...options.migrations,
      module: '@microsoft/prisma-orm-mssql/migration',
    },
  });
}
```

`prisma contract emit` then writes this into the application's `contract.d.ts`:

```ts
import type {
  CodecTypes as MssqlTypes,
  Contract as ContractType,
  ContractWithTypeMaps,
  StorageHashBase,
  TypeMaps as TypeMapsType,
} from '@microsoft/prisma-orm-mssql/contract-types';
```

and a migration file rendered by `prisma migration plan` imports its helpers from `@microsoft/prisma-orm-mssql/migration`.

The framework exports a `defineConfig` that takes the family, target, adapter and driver. Your package wraps it in a `defineConfig` of its own that fills those in, so an application passes only its contract and connection. The import alias above exists only because both functions have the same name.

Only names that would clash are imported under an alias:

- `Contract` and `TypeMaps` are renamed by Prisma, because the generated file exports its own `Contract` and `TypeMaps`.
- `CodecTypes` and `QueryOperationTypes` are renamed to the alias your target's descriptor declares, because the generated file exports its own `CodecTypes`, which combines yours with those of any extension.

Your contract-types module exports every type under its original name. The renaming happens in the generated file.

The two modules:

| Config member | What the module must export |
| --- | --- |
| `contract.typesModule` | Every type a generated `contract.d.ts` uses: the framework's contract types, the SQL family's contract types, and your target's codec and operation types |
| `migrations.module` | Whatever your migration renderer writes imports for: the migration base class, the CLI entry and your operation factories |

Your contract-types module is four lines, because it only re-exports:

```ts
// @microsoft/prisma-orm-mssql/contract-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from './codec-types';
export type * from './operation-types';
```

**Your target's and adapter's type declarations state your types module.** Each descriptor declares the types it contributes to `contract.d.ts` as a module, a name and an alias:

```ts
{ package: '@microsoft/prisma-orm-mssql/contract-types', named: 'CodecTypes', alias: 'MssqlTypes' }
```

Prisma writes each declaration from the module it states, so that module must be one an application on your package can import. An application can import only from packages it depends on directly, which is your package and not the ones it is built from.

- If your target and adapter live in the package the application installs, write your types module in the declarations, as above.
- If they live in a separate package of yours, hand the config copies that state the installable package's types module:

  ```ts
  import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';

  export const target = restateTypeDeclarations(mssqlTarget, '@microsoft/prisma-orm-mssql/contract-types');
  export const adapter = restateTypeDeclarations(mssqlAdapter, '@microsoft/prisma-orm-mssql/contract-types');
  ```

**Assemble your components in one file.** Put the family, target, adapter and driver in one module, and build both `defineConfig` and any control client you export from it. A command run through the CLI and a script that uses your control client are then given the same components.

**Your migration renderer is handed the module.** A migration plan's `renderTypeScript(migrationModule)` receives the config's `migrations.module`. Write every import of the migration base class, the command-line entry and your operation helpers from it, and name no module in the renderer itself.

Rules:

- If a config names no module, the command that needs it stops with an error naming the missing member: `CONFIG.CONTRACT_TYPES_MODULE_MISSING` or `CONFIG.MIGRATION_MODULE_MISSING`. Prisma does not guess a module.
- A module is named the way a package is imported. A path or a URL is refused when the config is loaded, because generated files are written into more than one folder.
- Prisma does not read the application's `package.json` to choose import names, and consults no list of package names.
- An extension, such as a vector type package, is a separate package the application installs. Its types are imported from its own package, not from yours.

**Check your package from outside.** This is how we test the mechanism ourselves, with a package that appears in no list in our repository:

1. Pack your package and install it from the tarball into a scratch application that depends on nothing else from Prisma except the CLI.
2. Run `prisma contract emit` and `prisma migration plan`.
3. Typecheck the application with `skipLibCheck` off, so an import that does not resolve cannot hide as `any`.
4. Check that every import in the generated files names your package, an extension's own package, or a relative path.

**What our test does not prove for you.** Our test package borrows the Postgres target, adapter and driver behind its own name. A target written from scratch also has to:

- write its own target, adapter and driver descriptors;
- declare its own codec and operation types, under its own module names;
- build its own migration planner and renderer;
- provide its own contract serialiser and runtime client.

**Unfilled migrations are caught.** `prisma migration plan` can write a migration with a `placeholder(...)` call for you to fill in by hand. Before `prisma db migrate` applies anything, it refuses a migration that still calls `placeholder(...)`, whichever package it imports `placeholder` from. Export `placeholder` from your migration module under that name.

**Requirements from your proposal this satisfies**

- Generated files refer only to public exports of a package the application depends on directly.
- Your package owns its public entrypoints. Prisma never sees or depends on a private module name of yours, and you never depend on one of ours.
- No SQL Server names or logic in Prisma's shared code.
- Installing a package activates nothing. Only the package the application's config imports is used.
- An unsupported setup fails with an explicit error. Nothing falls back to Postgres.

### 2. Your package exports an init contribution

`prisma orm init --target <package>` installs that package, loads the default export of its `/init` entrypoint, and scaffolds the project from it:

```ts
// @microsoft/prisma-orm-mssql/init
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'SQL Server',
  configModule: '@microsoft/prisma-orm-mssql/config',
  peerPackages: ['mssql'],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: ({ contractImport }) => dbFile(contractImport),
  envExample: () => 'DATABASE_URL="sqlserver://localhost:1433;database=mydb;user=sa;password=..."\n',
  quickReference: (input) => renderQuickReference(input),
  readme: (input) => renderReadme(input),
  serverRequirement: { minVersion: '2019', checkCommand: 'SELECT @@VERSION' },
  probe: (databaseUrl) => probeSqlServer(databaseUrl),
} satisfies InitContribution;
```

The values above are placeholders for yours.

| Member | What `init` does with it |
| --- | --- |
| `label` | Shows it as the target's name |
| `configModule` | Writes `prisma.config.ts` importing `defineConfig` from it |
| `peerPackages` | Installs these driver packages into the application |
| `authoringModes` | Offers these ways to write the contract. A mode you do not list is refused |
| `starterContract(mode)` | Writes it as the starter contract file |
| `contractSample(mode)` | Shows it in the quick reference |
| `databaseFile(input)` | Writes it as `db.ts`, the file that creates the client |
| `envExample()` | Writes it into `.env.example` |
| `quickReference(input)`, `readme(input)` | Writes them as the getting-started documents |
| `serverRequirement` | Optional. States the minimum server version in the quick reference |
| `probe(databaseUrl)` | Optional. Run for `--probe-db`; connects and reports the server version |

Prisma decides which files exist and where they go, and writes everything that does not depend on the target: `tsconfig.json`, `.gitignore`, the `package.json` scripts.

The order of steps is: resolve the package, install it, load your contribution, ask the user the remaining questions, write files, install your `peerPackages` and the CLI, emit the contract.

Rules:

- **Your package is named by its package name.** `--target mssql` would need an entry in a list of short names Prisma holds for packages it vouches for. The list holds names only and changes no behaviour: a listed package runs the same code as an unlisted one. We can add yours once it is published and we have used it.
- **`init` runs code from your package.** It loads `/init` from the application's `node_modules` right after installing it. There is no static metadata step.
- **`/init` must not import any framework runtime module.** Types are fine. The CLI that loads it may be a different installed copy of the framework from the one your package depends on, and two copies in one process do not recognise each other's values.
- **Both authoring modes are open to you.** Your proposal limited the first version to TypeScript; nothing here requires that.
- With `--skip-install`, your package must already be installed, because the files come from it.

**Requirements from your proposal this satisfies**

- The familiar `prisma orm init` workflow, with no new command and no plugin loader.
- Your package owns its identity and its target-specific starter.
- Existing Postgres and MongoDB behaviour is unchanged for their users.
- Nothing is discovered: no scan of installed packages, no registry lookup, no network guess. The user names one package.

**Two requirements from your proposal this does not satisfy, on purpose**

- *No package code runs during discovery.* `init` runs your package's code. It is about to load the config and emit, which run the same package, so a static step would protect nothing.
- *No change before every check has passed.* Your package is installed before `init` can learn whether it has an init contribution. If it has none, `init` stops with the package installed and no file written.

## What your package contains

Required by the design above:

| Entrypoint | Holds | Needed for |
| --- | --- | --- |
| `/config` | `defineConfig` | Every command |
| `/contract-types` (your choice of name) | The type re-exports | `contract emit` |
| `/migration` (your choice of name) | Migration base class and operation factories | `migration plan` |
| `/init` | The init contribution | `prisma orm init` |

Conventions we recommend, because Prisma's packages and documentation follow them:

| Entrypoint | Holds |
| --- | --- |
| `/runtime` | Your client factory |
| `/contract-builder` | The TypeScript contract builder bound to your target |
| `/control` | A client for scripts that inspect or migrate a database |

The Postgres package is the reference for all of these: [`packages/3-targets/postgres/`](https://github.com/prisma/orm/tree/main/packages/3-targets/postgres). Its folders are numbered in dependency order: target, adapter, driver, then `9-facade`, the package applications install.

Package rules:

- Depend on `@prisma/orm-framework` and `@prisma/orm-family-sql`, pinned to one exact version while Prisma 8 is in release candidates.
- Name the package `prisma-orm-<name>` under your scope, and add the keyword `prisma-orm-extension`. This is the convention for packages Prisma does not publish.
- Do not import or name any module beginning `@internal/`. Those are our private workspace names.

## Until the changes are released

Almost all of your work is the target itself: descriptors, codecs, query lowering, migrations, introspection and tests. None of it waits on us. Two things differ for an application until our changes are released.

**There is no `init`.** It accepts only `postgres` and `mongodb`. The application writes `prisma.config.ts` by hand:

```ts
import { defineConfig } from '@microsoft/prisma-orm-mssql/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['DATABASE_URL'] },
});
```

**The application installs two framework packages beside yours.** Its own `package.json` lists `@prisma/orm-framework` and `@prisma/orm-family-sql`, at the exact version your package uses, and none of Prisma's target packages. Today's CLI picks import names by looking for those in the application's `package.json`, and with them present it writes:

```ts
import type { Contract as ContractType } from '@prisma/orm-framework/contract/types';
import type { ContractWithTypeMaps } from '@prisma/orm-family-sql/contract/types';
import type { CodecTypes as MssqlTypes } from '@microsoft/prisma-orm-mssql/codec-types';
```

For the third line to come out right, the module names your descriptors declare for their codec and operation types must be your package's published names. A published name passes through unchanged.

We have not run this arrangement outside our repository. Please try it in a clean application with your package installed from a tarball: `contract emit`, `migration plan`, then a typecheck. Tell us what fails.

## What changes at each release

| Release | What you do | What your users do |
| --- | --- | --- |
| Generated imports | Add the contract-types module, name both modules in `defineConfig`, and state your types module in your target's and adapter's type declarations. **This is required in the same version:** that release removes the `package.json` lookup, so a config that names no module stops emitting | Upgrade your package, remove the two framework packages from their own dependencies, run `prisma contract emit` |
| `init` | Add the `/init` entrypoint | New projects run `prisma orm init --target <your package>`. Existing projects change nothing |

## Alternatives considered

These are the parts of your proposal we are not taking, and why.

**A `package.json` field in the application that selects the package, and one in your package that describes it.** A Prisma 8 extension is installed one way: add the package, import it in `prisma.config.ts`, include it. The CLI takes its inputs from that config. A second declaration in `package.json` can disagree with the config, and it is a different installation procedure from every other extension.

**A map from Prisma's module names to your package's subpaths.** The keys were our private `@internal/` names. That makes names we rename freely into an interface you would have to track. Naming one module that exports the types needs no keys.

**Static metadata and inline template strings instead of code.** Chosen in your proposal so that no package code runs before the project is set up. `init` loads the config and emits a moment later, which runs the same package, and a server probe cannot be data.

**A separate "external target" path beside the built-in one.** Your proposal left Prisma's own targets on their hardcoded path. Every target is external to the framework, so Postgres and MongoDB move onto the same two mechanisms and the hardcoded path is removed.

**Scanning installed packages for registrations.** Your proposal rejected this too, for the same reason we do: installing a package must not change behaviour.

## Where to ask

The Discord thread where this started.
