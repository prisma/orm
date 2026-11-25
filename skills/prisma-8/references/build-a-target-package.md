# Build the package for a new database

This reference is for the author of a package that adds a database target to Prisma 8, outside Prisma's repository. An application installs the package, imports `defineConfig` from it in `prisma.config.ts`, and runs `prisma orm init --target <your package>` and `prisma contract emit` exactly as an application on `@prisma/orm-postgres` does. Prisma's own database packages use the mechanisms below, with no path an outside package lacks.

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

`init` checks that your package lists the `prisma-orm-extension` keyword (see *Package rules*), installs it, loads the default export of its `/init` entrypoint, and writes the project from it:

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

A user names your package in `--target` by its package name, such as `--target prisma-orm-acmedb`. Short names such as `postgres` exist only for the packages in the CLI's list of targets Prisma vouches for; today that is Postgres and MongoDB. With `--skip-install`, your package must already be installed in the project: `init` loads your `/init` entrypoint before it writes anything, and reads the `prisma-orm-extension` keyword from the installed copy.

Rules:

- **No framework code runs in `/init`.** Types are fine. The CLI that loads it may be a different installed copy of the framework from the one your package depends on, and two copies in one process do not recognise each other's values.
- **The connection string is `DATABASE_URL`.** `prisma.config.ts`, `db.ts` and `--probe-db` read it, and `dotenv` is installed with your package, so `db.ts` may import `dotenv/config`. `--probe-db` reads it from the shell's environment, not from `.env`.
- **Drivers.** The first install is your package and `dotenv`; the package manager handles your package's required peers its own way, and a configuration that refuses a package without its peers makes that install fail, which `init` reports. `init` then installs the required peers your manifest declares, before it loads `/init`, and reads `peerPackages` after. Declare your driver as a required peer dependency, and list it in `peerPackages` too.
- **`/init` loads without the driver.** A driver your manifest does not declare as a required peer is installed only after `/init` is loaded, so import the driver inside `probe`, when it runs, and report `driver-missing` if that import fails.
- **The probe** resolves to the server's version, `driver-missing`, `driver-failed`, or `version-unreadable` once connected, and rejects only when it cannot connect. Bound its connect and query with your driver's own timeouts. `init` aborts `signal` after 60 seconds; close your client when it fires.

## Package rules

- Name the package `prisma-orm-<name>`, under your scope if you have one, and add the keyword `prisma-orm-extension` to its `package.json`. The keyword is required: `prisma orm init --target` reads it before installing your package and refuses a package without it. `init` checks the copy it is about to load: the registry's `latest` version when it will install your package, and the installed `package.json` when it will not: under `--skip-install`, or when the project already declares your package and has it on disk. It asks the registry without credentials, so a user of a package on a registry that needs them, or on a scope's own registry, installs the package first and then runs `init`.
- Name every Prisma package your code or its type declarations use (`@prisma/orm-framework`, your family's package, and `@prisma/orm-toolchain`, whose `InitContribution` type `/init` uses) as a peer dependency at one exact version, and again as a development dependency so your own build and tests install them. None of them is an ordinary dependency: an ordinary dependency at another version than the application's gives the application a second copy. `prisma orm init` reads your package's `peerDependencies` and adds to the application every required peer it finds there: the `@prisma/orm-*` packages, followed through their own peers, and every other package your manifest does not mark optional in `peerDependenciesMeta`, your driver included, at the version or range you give. So declare everything an application must install as a required peer dependency in your package's own manifest. `peerPackages` in your init contribution still names your driver, which `init` installs as well; a driver that is also a required peer is installed once. See [`upgrade-extension.md`](upgrade-extension.md) § *Exact-pin rule*. Until release 8.0 that is the exact `8.0.0-rc.N` the application uses. From release 8.0, number your package by the first release of ours it works with and declare a caret range on each GA package of ours, such as `^8.1.0`, and a tilde within the minor on one below GA, such as `~8.1.0-preview.0`, as [`upgrade-extension.md`](upgrade-extension.md#from-release-80-number-your-package-and-declare-ranges) § *From release 8.0* describes.
- Import or name no module beginning `@internal/`. Those are Prisma's private workspace names.

## Check it from outside

Pack your package and install the tarball into a scratch application that depends on nothing from Prisma except the CLI. Run `prisma orm init --target <your package>`, `prisma contract emit` and `prisma migration plan`, then typecheck with `skipLibCheck` off. Every import in the generated files names your package, an extension's own package, or a relative path.

A check with a package that borrows another target's parts behind its own name proves only the wiring: the imports and `init`. A target written from scratch also needs its own target, adapter and driver descriptors, its own codec and operation types under its own module names, its own migration planner and renderer, and its own contract serialiser and runtime client.
