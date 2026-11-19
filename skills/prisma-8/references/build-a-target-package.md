# Build a target package

This reference is for the author of a package that adds a database target to Prisma 8, outside Prisma's repository. An application installs the package, imports `defineConfig` from it in `prisma.config.ts`, and runs `prisma orm init --target <your package>` and `prisma contract emit` exactly as an application on `@prisma/orm-postgres` does. Prisma's own target packages use the mechanisms below, with no path an outside package lacks.

`prisma-orm-acmedb` stands for your package throughout.

## What the package exports

| Entrypoint | Holds | Needed for |
| --- | --- | --- |
| `/config` | `defineConfig`, which names the two modules below | every command |
| `/contract-types` | the types a generated `contract.d.ts` imports | `prisma contract emit` |
| `/migration` | the migration base class, the command-line entry and your operation helpers | `prisma migration plan` |
| `/init` | the init contribution | `prisma orm init` |
| `/runtime` | your client factory | the application's `db.ts` |

`/contract-builder` (the TypeScript contract builder bound to your target) and `/control` (a client for scripts) are conventions Prisma's packages follow. The Postgres package is the reference for all of these: `packages/3-targets/postgres/` in the prisma/orm repository, whose `9-facade` folder is the package applications install.

## Generated files import from your package

An application can import only from packages it depends on directly, which is your package and not the ones it is built from. So the config your `defineConfig` returns names the modules generated files import from:

```ts
// src/config.ts
import { defineConfig as defineFrameworkConfig } from '@prisma/orm-framework/config/config-types';
import { adapter, driver, family, migrationModule, target, typesModule } from './components';

export function defineConfig(options: AcmeConfigOptions) {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    contract: { ...contractSource(options), typesModule },
    migrations: { ...options.migrations, module: migrationModule },
  });
}
```

- **`contract.typesModule`** is your `/contract-types` module. It only re-exports: the framework's contract types, the family's, and your target's codec and operation types.

  ```ts
  // src/contract-types.ts
  export type * from '@prisma/orm-framework/contract/types';
  export type * from '@prisma/orm-family-sql/contract/types';
  export type * from './codec-types';
  export type * from './operation-types';
  ```

- **`migrations.module`** is your `/migration` module. A migration plan's `renderTypeScript(migrationModule)` receives it; write every import of a rendered `migration.ts` from it, and name no module in the renderer itself. Export `placeholder` from it under that name, so `prisma db migrate` can refuse an unfilled migration.
- **Your target's and adapter's type declarations name your types module.** When the descriptors live in another package of yours, hand the config copies that do: `restateTypeDeclarations(descriptor, typesModule)` from `@prisma/orm-framework/target-package-config/type-declarations`.
- **Assemble the components in one file** and build both `defineConfig` and any control client from it, so a command and a script are given the same components.

A config that names neither module stops with `CONFIG.CONTRACT_TYPES_MODULE_MISSING` or `CONFIG.MIGRATION_MODULE_MISSING`. A module is named the way a package is imported: a path or a URL is refused, because generated files are written into more than one folder.

## `prisma orm init` writes the project from your package

`init` installs your package, loads the default export of its `/init` entrypoint, and writes the project from it:

```ts
// src/init.ts
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'AcmeDB',
  configModule: 'prisma-orm-acmedb/config',
  peerPackages: ['acmedb-driver'],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: () => dbFile,
  envExample: () => 'DATABASE_URL="acmedb://user:password@localhost:5000/mydb"\n',
  quickReference: (input) => renderQuickReference(input),
  serverRequirement: { minVersion: ACMEDB_MIN_SERVER_VERSION, checkCommand: 'SELECT version()' },
  probe: (databaseUrl, signal) => probeAcmeDb(databaseUrl, signal),
} satisfies InitContribution;
```

| Member | What `init` does with it |
| --- | --- |
| `label` | Shows it as the target's name |
| `configModule` | Writes `prisma.config.ts` importing `defineConfig` from it |
| `peerPackages` | Installs these driver packages into the application, after the questions |
| `authoringModes` | Offers these ways to write the contract; a mode you do not list is refused |
| `starterContract(mode)`, `contractSample(mode)` | Writes the starter contract, and shows the sample in the quick reference |
| `databaseFile()` | Writes `db.ts`, beside the emitted `contract.json` and `contract.d.ts` |
| `envExample()` | Writes `.env.example`, and `.env` when the user asks for one |
| `quickReference(input)` | Writes the getting-started document |
| `readme(input)` | Optional. Writes a README in a project that already has `src/index.ts` |
| `serverRequirement` | Optional. States the minimum server version in the quick reference |
| `probe(databaseUrl, signal)` | Optional. Runs for `--probe-db` |
| `prisma7QuickReference(input)` | Optional. Required when your `configModule` exports `prisma7Schema` |

Rules:

- **No framework code runs in `/init`.** Types are fine. The CLI that loads it may be a different installed copy of the framework from the one your package depends on, and two copies in one process do not recognise each other's values.
- **The connection string is `DATABASE_URL`.** `prisma.config.ts`, `db.ts` and `--probe-db` read it, and `dotenv` is installed with your package, so `db.ts` may import `dotenv/config`. `--probe-db` reads it from the shell's environment, not from `.env`.
- **Drivers.** `init` reads `peerPackages` only after your package is installed. The first install is your package and `dotenv`; the package manager handles your package's required peers its own way, and a configuration that refuses a package without its peers makes that install fail, which `init` reports. Declare your driver as a required peer dependency, and list it in `peerPackages` so `init` declares it in the application.
- **The probe** resolves to the server's version, `driver-missing`, `driver-failed`, or `version-unreadable` once connected, and rejects only when it cannot connect. Bound its connect and query with your driver's own timeouts. `init` aborts `signal` after 60 seconds; close your client when it fires.

## Package rules

- Name the package `prisma-orm-<name>`, under your scope if you have one, and add the keyword `prisma-orm-extension`.
- Depend on the Prisma packages you build on (`@prisma/orm-framework`, your family's package, `@prisma/orm-toolchain` for the init types), each pinned to one exact version; see [`upgrade-extension.md`](upgrade-extension.md) § *Exact-pin rule*.
- Import or name no module beginning `@internal/`. Those are Prisma's private workspace names.

## Check it from outside

Pack your package and install the tarball into a scratch application that depends on nothing from Prisma except the CLI. Run `prisma orm init --target <your package>`, `prisma contract emit` and `prisma migration plan`, then typecheck with `skipLibCheck` off. Every import in the generated files names your package, an extension's own package, or a relative path.
