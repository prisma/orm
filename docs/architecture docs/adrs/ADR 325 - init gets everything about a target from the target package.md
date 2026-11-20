# ADR 325 — `init` gets everything about a target from the target package

**Status:** Accepted
**Date:** 2026-11-18

---

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

Most of what goes into these files depends on the target: which package to import, what a starter contract looks like, what the connection string looks like, which driver to install. This record decides where `init` gets that from.

A **target** is the database an application uses, such as Postgres or MongoDB. A **target package** is the package an application installs to use that target, such as `@prisma/orm-postgres`.

## Decision

`init` gets it from the target package. The package exports an **init contribution** as the default export of its `init` entrypoint. `init` installs the package, loads the contribution and writes the project from it.

```ts
// @prisma/orm-postgres/init
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'PostgreSQL',
  configModule: '@prisma/orm-postgres/config',
  peerPackages: ['pg'],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: () => dbFile,
  envExample: () => 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n',
  quickReference: (input) => renderQuickReference(input),
  serverRequirement: { minVersion: POSTGRES_MIN_SERVER_VERSION, checkCommand: 'SELECT version()' },
  probe: (databaseUrl) => probePostgres(databaseUrl),
} satisfies InitContribution;
```

The CLI holds no template, driver name, connection string or server check for any target. It works the same way for a target package Prisma publishes and one anyone else publishes.

## What the contribution supplies and what the CLI keeps

| Member | What `init` does with it |
| --- | --- |
| `label` | Shows it as the target's name in the quick reference |
| `configModule` | Writes `prisma.config.ts` importing `defineConfig` from it |
| `peerPackages` | Installs these driver packages into the application |
| `authoringModes` | Offers these ways to write the contract: PSL, TypeScript or both |
| `starterContract(mode)` | Writes it as the starter contract |
| `contractSample(mode)` | Shows it in the quick reference |
| `databaseFile()` | Writes it as `db.ts`, beside the emitted contract |
| `envExample()` | Writes it into `.env.example`, and into `.env` when the user asks for one |
| `quickReference(input)` | Writes it as the quick reference |
| `readme(input)` | Optional. Writes it as the README in a project that already has `src/index.ts` |
| `serverRequirement` | Optional. States the minimum server version in the quick reference |
| `probe(databaseUrl, signal)` | Optional. Connects and reports the server's version, for `--probe-db`; stops and closes its connection when `signal` aborts |
| `prisma7QuickReference(input)` | Optional. The quick reference for a project that keeps its Prisma 7 schema as the contract source |

The CLI keeps everything that is the same for every target: which files exist and where they go, package manager detection, `prisma.config.ts` around `configModule` (for a starter contract and for a Prisma 7 schema), `tsconfig.json`, `.gitignore`, `.gitattributes`, the `package.json` scripts, the questions it asks and what it prints.

Two facts are shared by the CLI and every contribution, and the interface states them: the connection string is read from `DATABASE_URL`, and `dotenv` is installed with the target package, so `db.ts` may import `dotenv/config`.

`init` loads the entrypoint as the project would: Node resolves `<package>/init` from the project folder, in a short child process, so the export map is read by Node's own rules.

The `init` entrypoint may import types from the framework but no framework code that runs. The CLI that loads it can be a different installed copy of the framework from the one the target package depends on, and two copies in one process do not recognise each other's values.

A probe reports one of four results: the server's version, a driver that is missing, a driver that is installed but fails to load, or a connection that worked whose version could not be read. It rejects only when it cannot connect. `init` gives every probe a deadline of 60 seconds. At the deadline it aborts the probe's signal, and reports the probe like one that could not connect. `--probe-db` reads `DATABASE_URL` from the shell's environment, not from `.env`.

## The target package is installed first

The files come from the target package, so it has to be present before `init` can write anything.

```text
check the flags
  → resolve the target package
  → for a package that is not in the list, check that it lists the Prisma 8 keyword
  → install it, with dotenv and the drivers it requires
  → load its contribution
  → ask: authoring mode, contract path, and consent to replace files if the project is already set up
  → write the files
  → install the CLI and the rest
  → emit the contract
  → check the server, when asked to
```

Before the install, `init` asks only which target, when `--target` is not given, and, when it finds a Prisma 7 schema, whether to keep it as the contract source. Every question that depends on the contribution comes after the install. `init` asks no consent to install the package: the user named it, and installing it is what they asked for. Any refusal that depends only on the flags happens before the install.

The drivers go in the same install. A target package declares its driver as a required peer dependency ([ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md)), and some package managers refuse to install a package without its required peers. This holds on every path, a project that keeps its Prisma 7 schema included. For a listed package the list names the drivers, because they must be known before the package is installed. A driver the project already declares is left to the later install, so a refusal after the first install changes no version the project chose.

A target package's other required peers, such as `temporal-polyfill` and `@types/pg`, are not installed by `init` yet.

When a refusal comes after the install, `init` has written no scaffold file, but the install may have changed `package.json` and the lockfile. When the install added declarations, the error names them, gives the command to remove them, and names any declared range the install rewrote. When the install added nothing, as with `--skip-install`, the error has no removal instruction.

A failed install also leaves no scaffold file, and the package manager may already have changed the dependency files, so the user checks them before trying again.

With `--skip-install`, `init` installs nothing, so the target package must already be there. If it is not, `init` stops before changing anything and prints the install command.

A failed install stops `init`, as [ADR 323](ADR%20323%20-%20Prisma%208%20is%20not%20a%20package%20manager%20and%20does%20not%20second-guess%20one.md) requires.

## How the user names the target

```sh
prisma orm init --target postgres                 # a short name
prisma orm init --target prisma-orm-cockroachdb   # a package name
```

`--target` is looked up in the CLI's list of known target packages, by short name, alias or package name. A value that is not in the list is taken as a package name, and a name npm does not accept for a new package is refused. Before `init` installs an unlisted package it reads the package's keywords, and refuses unless they include `prisma-orm-extension`, the keyword [ADR 308](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md) asks a Prisma 8 package to list. `--target sqlite` names an unrelated package on the public registry; that package does not carry the keyword, so `init` refuses it and installs nothing. `init` checks the copy it is about to load. When it will install the package, it reads the registry's `latest` manifest, at the registry `npm_config_registry` names or the public one. When it will not, because the project already declares the package and has it on disk, or because of `--skip-install`, it reads the installed `package.json` and makes no request. When the registry cannot be read or has no such package, `init` refuses and says to install the package first. Naming a listed package by its package name is the same as naming it by its short name: `--target @prisma/orm-postgres` is `--target postgres`.

| Short name | Aliases | Package | Name in this repository | Label | Provider in an earlier Prisma schema | Drivers it requires |
| --- | --- | --- | --- | --- | --- | --- |
| `postgres` | `postgresql` | `@prisma/orm-postgres` | `@internal/postgres` | PostgreSQL | `postgresql`, written by Prisma 7 | `pg` |
| `mongodb` | `mongo` | `@prisma/orm-mongo` | `@internal/mongo` | MongoDB | `mongodb`, written by Prisma 6 | `mongodb` |

- **A target package is listed because Prisma vouches for it.** Who wrote it does not matter, and a community package can be listed.
- **The list holds names and the facts `init` needs before anything is installed.** The picker shows the label before the package is installed. The drivers go into the package's own install, and a Prisma 6 project gets printed setup instructions and no install at all, so both take the drivers from the list.
- **After the keyword check, a listed package runs the same code as an unlisted one.** A listed package is not checked, because Prisma chose it. Listing also gives a short name, a line in the interactive picker, the drivers for the first install, the mapping from an earlier Prisma's provider, and, when a later run of `init` switches to another target, the offer to remove the package. `init` finds a previously installed target package by looking for the listed names in `package.json`, so it does not offer to remove an unlisted one.
- **The list must agree with the contributions.** A test loads each listed package's published contribution and checks that its label, driver packages and config module match the list entry.

## Projects coming from Prisma 6 and Prisma 7

`init` reads the `provider` from an existing Prisma schema and finds the target package through the list. Only listed packages take part. A provider with no entry is refused, with advice to start a fresh project with `--target`. `--from-prisma7-schema` with `--target` naming an unlisted package is refused before anything is installed. Without `--from-prisma7-schema`, `--target` naming an unlisted package sets up a fresh project and leaves the Prisma 7 schema alone.

- **A provider only Prisma 6 wrote**, such as `mongodb`, marks a Prisma 6 project. `init` changes nothing and prints how to set Prisma 8 up beside it.
- **A Prisma 7 schema** can be kept as the contract source. A target package can take one when its `configModule` exports `prisma7Schema`. The CLI then writes the config around it, and the contribution must give `prisma7QuickReference`. A package without `prisma7Schema` cannot take a Prisma 7 schema. In an interactive run, `init` then sets up a fresh project instead; with `--from-prisma7-schema` it stops with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE` and writes nothing.

## Output

The `--json` result reports `package`, the name of the target package, and `target`: the short name for a listed package, and the package name for an unlisted one.

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
- A target package that does not list the `prisma-orm-extension` keyword cannot be set up with `init`. It still works with a `prisma.config.ts` written by hand. `init` keeps no list of database names to refuse, because that would put target names into the CLI; the keyword refuses `--target sqlite` without one, and it places no rule on a package's name.
- The keyword guards against a mistake, not an attack: any package can list it. It stops `init` installing a package that was never meant for Prisma 8.
- `init` makes one request to the registry for an unlisted package it is about to install. It reads the registry itself, with no credentials, and reads none of the package manager's configuration beyond `npm_config_registry`. So it can ask a different registry from the one the package manager installs from: a package on a registry that needs credentials, one that only a scope's registry setting reaches, and any package behind a proxy that Node's `fetch` does not use, cannot be read. The user installs such a package first, and `init` reads it from disk. The name of a private package typed to `init` is sent to the public registry when `npm_config_registry` is not set.
- `init` does not know an unlisted package's drivers before installing it, and it does not work them out from the registry: resolving peers is the package manager's work. Its first install is the package and `dotenv`, and the package manager handles the package's required peers its own way; the contribution's `peerPackages` are declared in the later install. Where the package manager's configuration refuses a package without its peers, the install fails and `init` reports it.
- The minimum server version has one source, the target package's code. The CLI keeps no copy of it.

## Alternatives considered

### The CLI depends on the target packages and registers their contributions

The published CLI would depend on each target package and hold their templates, so they are available before anything is installed and `--skip-install` works in an empty project.

Rejected. It works only for packages the CLI depends on, so a target package from another author has no way in, and every installation of the CLI would carry every target package.

### Registration in `package.json`

The application names the target package in a `package.json` field, and the package describes itself in another. Rejected because an extension is installed by importing it in the config, and a second place to declare the target can disagree with the first.

### Templates as static files or metadata, with no code

This keeps package code from running before the project is set up. Rejected because `init` loads the config and emits immediately afterwards, which runs the same package, and a server check cannot be data.

### The contribution writes the Prisma 7 config

Each target package would carry its own copy of the config the CLI already writes for a starter contract, differing only in the contract line. A change to that text would have to be made in every target package, and the contribution's member would be a second answer to whether the package can take a Prisma 7 schema, beside the `prisma7Schema` export. Rejected.

### Package names only, with no list

`prisma orm init --target @prisma/orm-postgres` for everyone. Rejected because a first-time user cannot discover the package name, and the interactive picker would have nothing to show.

### A prompt before installing a package that is not in the list

A question, or a typed consent, before `init` installs and runs an unlisted package. Rejected because it interrupts the run to confirm a name the user has just typed, and a user who typed `sqlite` would confirm it. The keyword check answers the question the prompt would ask, without asking the user.

### A rule on the package's name

An unscoped value is taken as a package name only when it begins `prisma-orm-`, and a scoped one always. It needs no request to the registry. Rejected because it reads meaning into a name: it refuses a target package that chose another name, and it lets through any scoped package, whether or not it is for Prisma 8. The keyword says what the package is.

### Ask the package manager for the keywords

`npm view`, `pnpm view` and their equivalents apply the user's registry settings and credentials. Rejected for now. The CLI engine gives a command two package operations, install and run, and neither returns output; each package manager has its own command and its own output for this, and one has none. The cost is the consequence above: a package `init` cannot read is installed first.

### The list lives outside the framework's CLI

Considered so that the framework names no target at all. Rejected as unnecessary. The list decides no behaviour that depends on the target, and the rule against target names in the framework exists to prevent such behaviour.
