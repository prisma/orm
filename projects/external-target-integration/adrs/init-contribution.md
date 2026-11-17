# `init` gets everything about a target from the target's package

**Status:** Proposed

## At a glance

`prisma orm init` sets up Prisma 8 in a project. It writes a handful of files and installs what they need:

```text
$ prisma orm init --target postgres

prisma.config.ts          imports defineConfig from the target package
prisma/contract.prisma    a starter contract
prisma/db.ts              creates the client
prisma-8.md               a quick reference
.env.example              the connection string to fill in
tsconfig.json, .gitignore, .gitattributes, package.json scripts
```

Everything in the first five files depends on the target: which package to import, what a starter contract looks like, what the connection string looks like, which driver to install. This record decides where `init` gets that from.

A **target** is the database an application uses, such as Postgres or MongoDB. A **target package** is the package an application installs to use that target, such as `@prisma/orm-postgres`.

## Decision

`init` gets it from the target package. The package exports an **init contribution**, and `init` installs the package, loads the contribution and writes the project from it.

```ts
// @prisma/orm-postgres/init
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'PostgreSQL',
  configModule: '@prisma/orm-postgres/config',
  peerPackages: [],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: ({ contractImport }) => dbFile(contractImport),
  envExample: () => 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n',
  quickReference: (input) => renderQuickReference(input),
  readme: (input) => renderReadme(input),
  serverRequirement: { minVersion: '15', checkCommand: 'SELECT version()' },
  probe: (databaseUrl) => probePostgres(databaseUrl),
} satisfies InitContribution;
```

The CLI holds no template, driver name, connection string or server check for any target. It works the same way for a target package Prisma publishes and one anyone else publishes.

## What the contribution supplies and what the CLI keeps

| Member | What `init` does with it |
| --- | --- |
| `label` | Shows it as the target's name |
| `configModule` | Writes `prisma.config.ts` importing `defineConfig` from it |
| `peerPackages` | Installs these driver packages into the application |
| `authoringModes` | Offers these ways to write the contract: PSL, TypeScript or both |
| `starterContract(mode)` | Writes it as the starter contract |
| `contractSample(mode)` | Shows it in the quick reference |
| `databaseFile(input)` | Writes it as `db.ts` |
| `envExample()` | Writes it into `.env.example`, and into `.env` when the user asks for one |
| `quickReference(input)`, `readme(input)` | Writes them as the quick reference and the README |
| `serverRequirement` | Optional. States the minimum server version in the quick reference |
| `probe(databaseUrl)` | Optional. Connects and reports the server's version, for `--probe-db` |
| `prisma7ConfigFile(input)` | Optional. The config for a project that keeps its Prisma 7 schema as the contract source |

The CLI keeps everything that is the same for every target: which files exist and where they go, package manager detection, `tsconfig.json`, `.gitignore`, `.gitattributes`, the `package.json` scripts, the questions it asks and what it prints.

The `init` entrypoint may import types from the framework but no framework code that runs. The CLI that loads it can be a different installed copy of the framework from the one the target package depends on, and two copies in one process do not recognise each other's values.

## The target package is installed first

The files come from the target package, so it has to be present before `init` can write anything.

```text
resolve the target package
  → install it
  → load its contribution
  → ask: authoring mode, contract path, and consent to replace files if the project is already set up
  → write the files
  → install the driver packages, the CLI and the rest
  → emit the contract
  → check the server, when asked to
```

`init` asks nothing before installing the target package. The user named it, and installing it is what they asked for.

With `--skip-install`, `init` installs nothing, so the target package must already be there. If it is not, `init` stops before changing anything and prints the install command.

## How the user names the target

```sh
prisma orm init --target postgres                 # a short name
prisma orm init --target prisma-orm-cockroachdb   # a package name
```

The CLI holds a list of known target packages. `--target` is looked up in it, and a value that is not in the list is taken as a package name.

Each entry holds names only:

| Short name | Aliases | Package | Label | Prisma 7 provider |
| --- | --- | --- | --- | --- |
| `postgres` | `postgresql` | `@prisma/orm-postgres` | PostgreSQL | `postgresql` |
| `mongodb` | `mongo` | `@prisma/orm-mongo` | MongoDB | `mongodb` |

- **A target package is listed because Prisma vouches for it.** Who wrote it does not matter, and a community package can be listed.
- **The list changes no behaviour.** A listed package and an unlisted one run the same code. Listing gives a short name, a line in the interactive picker, and the mapping from a Prisma 7 provider.
- **The picker** shows the listed packages and an entry for typing another package name. The label is in the list because the picker shows it before any package is installed.

## When it cannot proceed

| Situation | What happens |
| --- | --- |
| The value is neither a short name nor a valid package name | `init` stops before changing anything |
| The package has no `init` entrypoint | `init` stops with the package installed and no file written. The error says the package does not support `init` and to write `prisma.config.ts` by hand |
| The authoring mode asked for is not one the package offers | `init` stops before writing, naming the modes the package offers |
| `--probe-db` and the contribution has no `probe` | A warning that this target package cannot check the server. With `--strict-probe` it is an error |

## Projects coming from Prisma 7

`init` can set Prisma 8 up beside an existing Prisma 7 project and keep the Prisma 7 schema as the contract source. It reads the `provider` from that schema and finds the target package through the list.

- Only listed packages take part. A provider with no entry is refused, with advice to name a package with `--target` and start a fresh project.
- A contribution with no `prisma7ConfigFile` means the target package cannot take a Prisma 7 schema. `init` sets up a fresh project instead.

## Output

The `--json` result reports `package`, the name of the target package that was installed, and `target`: the short name for a listed package, the package name otherwise.

## Why

- **The framework knows nothing about any target.** A starter contract and a connection string are facts about a target, so they belong to that target's package.
- **Every target package is treated the same.** Prisma's own have no path through `init` that another author's lacks.
- **The CLI depends on no target package.** It loads a contribution from the one the user chose, after installing it into the user's project.
- **An extension is installed one way.** `init` adds a package and writes a config that imports it. Nothing is registered anywhere else.

## Consequences

- Any target package gets `init` by exporting one entrypoint, with no change to the CLI and no entry in the list.
- A target package without a runtime client cannot provide a contribution, because there is no `db.ts` to write.
- `init` cannot write a project for a target package that is not installed. `--skip-install` in a project without it is refused.
- `init` runs code from the package the user names. It is the same package the config loads a moment later.

## Alternatives considered

### The CLI depends on the target packages and registers their contributions

The published CLI would depend on each target package and hold their templates, so they are available before anything is installed and `--skip-install` works in an empty project.

Rejected. It works only for packages the CLI depends on, so a target package from another author has no way in, and every installation of the CLI would carry every target package.

### Registration in `package.json`

The application names the target package in a `package.json` field, and the package describes itself in another. Rejected because an extension is installed by importing it in the config, and a second place to declare the target can disagree with the first.

### Templates as static files or metadata, with no code

This keeps package code from running before the project is set up. Rejected because `init` loads the config and emits immediately afterwards, which runs the same package, and a server check cannot be data.

### Package names only, with no list

`prisma orm init --target @prisma/orm-postgres` for everyone. Rejected because a first-time user cannot discover the package name, and the interactive picker would have nothing to show.

### A prompt before installing a package that is not in the list

A question, or a typed consent, before `init` installs and runs an unlisted package. Rejected because it interrupts the run to confirm a name the user has just typed, and it would make an unlisted package behave differently from a listed one.

### The list lives outside the framework's CLI

Considered so that the framework names no target at all. Rejected as unnecessary. A table of package names decides no behaviour, and the rule against target names in the framework exists to prevent behaviour that depends on the target.
