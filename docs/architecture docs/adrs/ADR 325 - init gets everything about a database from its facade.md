# ADR 325 — `init` gets everything about a database from its facade

**Status:** Accepted
**Date:** 2026-11-18

---

A **target** is the component of the Prisma ORM stack that supports one database, such as Postgres or MongoDB; its package is a **target package**, such as `@prisma/orm-target-postgres`. A **facade** is the package an application installs to use that database, such as `@prisma/orm-postgres`: one function in it glues the framework, family, target, adapter and driver together. A **contract** is the description of the application's data model, written in PSL, the Prisma schema language, or in TypeScript; emitting it produces the files the client is typed from.

`prisma orm init` sets up Prisma 8 in a project. It writes a handful of files and installs what they need:

```text
$ prisma orm init --target postgres

prisma.config.ts          imports defineConfig from the facade
prisma/contract.prisma    a starter contract
prisma/db.ts              creates the client
prisma-8.md               a quick reference
.env.example              the connection string to fill in
tsconfig.json, .gitignore, .gitattributes, package.json scripts
```

Most of what goes into the first five files depends on the target: which package to import, what a starter contract looks like, what the connection string looks like, which driver to install. This record decides where `init` gets that from.

## Decision

`init` gets the content of every target-specific file from the facade. The package exports an **init contribution** as the default export of its `init` entrypoint. `init` installs the package, loads the contribution and writes the project from it.

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
  probe: (databaseUrl, signal) => probePostgres(databaseUrl, signal),
} satisfies InitContribution;
```

Four further decisions follow from that one, each explained in its own section:

1. **The facade is installed before anything is written**, because the files come from it.
2. **Any package can be named.** `--target` takes a package name: `prisma orm init --target prisma-orm-acmedb`.
3. **The CLI keeps a short list of facades Prisma vouches for.** The list gives a package a short name such as `postgres`, and holds the few facts `init` needs before the package is installed. It holds no template.
4. **A package that is not in the list must carry the keyword `prisma-orm-extension`** in its `package.json`, and `init` checks that before installing it.

The CLI holds no template, connection string or server check for any target. After the install, a listed package and an unlisted one are loaded and used by the same code.

## Why

- **The framework knows nothing about how any target is set up.** A starter contract and a connection string are facts about a target, so they belong to that target's facade. The CLI is part of the framework.
- **Every facade has the same way in.** A package from any author gets `init` by exporting one entrypoint, with no change to the CLI.
- **The CLI depends on no facade.** It loads a contribution from the one the user chose, after installing it into the user's project.
- **A facade is installed like any other extension.** `init` adds the package and writes a config that imports it. Nothing is registered anywhere else.

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
| `envExample()` | Writes it into `.env.example`, and into `.env` with `--write-env` or when the user says yes to the question |
| `quickReference(input)` | Writes it as the quick reference. `input` carries what the user chose, such as the authoring mode and the paths |
| `readme(input)` | Optional. Writes it as the README in a project that already has `src/index.ts` |
| `serverRequirement` | Optional. States the minimum server version in the quick reference |
| `probe(databaseUrl, signal)` | Optional. With `--probe-db`, connects and reports the server's version; closes its connection when `signal` aborts |
| `prisma7QuickReference(input)` | Optional. See [Projects coming from Prisma 6 and Prisma 7](#projects-coming-from-prisma-6-and-prisma-7) |

The CLI keeps everything that is the same for every target: which files exist and where they go, package manager detection, the text of `prisma.config.ts` around `configModule`, `tsconfig.json`, `.gitignore`, `.gitattributes`, the `package.json` scripts, the questions it asks and what it prints.

Two facts are shared by the CLI and every contribution, and the `InitContribution` type states them: the connection string is read from `DATABASE_URL`, and `dotenv` is installed with the facade, so `db.ts` may import `dotenv/config`.

`init` finds the entrypoint as the project itself would: Node resolves `<package>/init` from the project folder. The CLI then imports that file. Because of that, the `init` entrypoint may import types from the framework but no framework code that runs. The CLI that loads it can be a different installed copy of the framework from the one the facade depends on, and two copies in one process do not recognise each other's values.

A probe reports one of four results: the server's version, a driver that is missing, a driver that is installed but fails to load, or a connection that worked whose version could not be read. It rejects only when it cannot connect. `init` gives every probe a deadline. At the deadline it aborts `signal` and reports that the probe did not finish, which it treats like a failed connection. `--probe-db` reads `DATABASE_URL` from the shell's environment, not from `.env`.

## How the user names the target

```sh
prisma orm init --target postgres            # a short name from the list
prisma orm init --target prisma-orm-acmedb   # any package name; this one is made up
```

`--target` is looked up in the CLI's list of known facades, by short name, alias or package name. A value that is not in the list is taken as a package name, and a name npm does not accept for a new package is refused.

### The keyword check

A user who wants SQLite may guess `--target sqlite`. No entry in the list has that short name, so it is a package name, and a package called `sqlite` exists on the public registry. It has nothing to do with Prisma. Installing it and loading code from it would be a mistake.

So before `init` installs an unlisted package, it reads the package's keywords and refuses unless they include `prisma-orm-extension`. This is the keyword that the decision record on community package names ([ADR 308](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)) asks every Prisma 8 extension to list, and a facade is one kind of extension. The unrelated `sqlite` package does not carry it, so `init` refuses and installs nothing.

`init` checks the copy it is about to load:

- **When it will install the package**, it asks the registry for the package's `latest` version. It makes that request itself, with no credentials, to the registry named by `npm_config_registry` or else the public one, and reads none of the package manager's other configuration.
- **When it will not install the package**, because the project already declares it and has it on disk, or because of `--skip-install`, it reads the installed `package.json` and makes no request.
- **When the registry cannot be read or has no such package**, `init` refuses and says to install the package first. The next run reads the installed copy.

The keyword guards against a mistake, not an attack: any package can list it.

### The list

A facade is listed because Prisma vouches for it. Who wrote it does not matter, and a community package can be listed. The list:

| Short name | Aliases | Package | Label | Provider in an earlier Prisma schema | Drivers it requires |
| --- | --- | --- | --- | --- | --- |
| `postgres` | `postgresql` | `@prisma/orm-postgres` | PostgreSQL | `postgresql` | `pg` |
| `mongodb` | `mongo` | `@prisma/orm-mongo` | MongoDB | `mongodb` | `mongodb` |

Naming a listed package by its package name is the same as naming it by its short name: `--target @prisma/orm-postgres` is `--target postgres`.

The list holds names, and the facts `init` needs before the package is installed and its contribution can be read:

- **The label**, which the interactive picker shows.
- **The drivers**, which go into the package's own install (next section).
- **The provider**, which lets `init` find the facade for an existing Prisma 6 or Prisma 7 schema.

The framework has a rule against naming targets, and the list is an exception that keeps the rule's purpose. The rule exists so that no framework code behaves differently for one target than for another. The list decides no such behaviour: after the steps that come before the install, a listed package runs the same code as an unlisted one. A test loads each listed package's contribution and checks that its label, driver packages and config module match the list entry, so the list cannot drift from the packages.

Being listed also means: the keyword is not checked, because Prisma chose the package; and when a later run of `init` switches the project to another target, `init` recognises the old facade in `package.json` and offers to remove it. It does not recognise an unlisted one.

## The facade is installed first

The files come from the facade, so it has to be present before `init` can write anything. `init` therefore installs in two steps, the **first install** before the files are written and the **second install** after.

```text
check the flags
  → resolve the facade
  → for an unlisted package, check the keyword
  → first install: the facade, dotenv, and for a listed package its drivers
  → install the required peers the installed facade declares
  → load the contribution
  → ask: authoring mode, contract path, and consent to replace files if the project is already set up
  → write the files
  → second install: the CLI, the contribution's driver packages, and the rest
  → emit the contract
  → check the server, with --probe-db
```

- **Questions.** Before the first install, `init` asks only which target, when `--target` is not given, and, when it finds a Prisma 7 schema, whether to keep it as the contract source. Every question that depends on the contribution comes after it. `init` asks no consent to install the package: the user named it, and installing it is what they asked for.
- **Refusals.** Any refusal that depends only on the flags happens before the first install.
- **Drivers.** A facade declares its driver as a required peer dependency ([ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md)), and some package managers refuse to install a package without its required peers. For a listed package the list names the drivers, so they go into the first install, for a project that keeps its Prisma 7 schema too. For an unlisted package `init` does not know the drivers until it has installed the package. Its first install is the package and `dotenv`, and the contribution's `peerPackages` go into the second install. Where the package manager's configuration refuses a package without its peers, the first install fails and `init` reports it. Where it accepts the package without them, `init` installs every required peer the installed facade declares before it loads the contribution, so a declared driver is present; a driver the facade does not declare as a required peer is absent. The `init` entrypoint must therefore load without its drivers: a probe imports its driver when it runs, which is why a missing driver is one of a probe's results.
- **Versions the project chose.** A driver the project already declares is left to the second install, so a refusal after the first install changes no version the project chose.
- **Other required peers.** After the first install, `init` reads the required peer dependencies from the installed facade's `package.json`, and from each `@prisma/orm-*` package named there, and installs them: the platform packages, and others such as `temporal-polyfill`. Yarn installs no peer dependencies, so without this an application made by `init` under Yarn cannot load ([ADR 329](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)).
- **A failed install stops `init`.** Prisma 8 does not second-guess a package manager ([ADR 323](ADR%20323%20-%20Prisma%208%20is%20not%20a%20package%20manager%20and%20does%20not%20second-guess%20one.md)), so `init` does not retry or work around it.
- **`--skip-install`.** `init` installs nothing, so the facade must already be there. If it is not, `init` stops before changing anything.

## Projects coming from Prisma 6 and Prisma 7

A project that already has a Prisma schema states its database there, as a `provider`. `init` reads it and finds the facade through the list. Only listed packages take part: a provider with no entry is refused, with advice to start a fresh project with `--target`.

- **A provider that Prisma 7 does not support**, such as `mongodb`, marks a Prisma 6 project. `init` changes nothing and prints how to set Prisma 8 up beside it.
- **A Prisma 7 schema can stay as the contract source**, so that Prisma 8 can be adopted on a database Prisma 7 still migrates. `init` asks about it when it finds one, and `--from-prisma7-schema` asks for it outright. A facade supports it by exporting a function named `prisma7Schema` from its `configModule`, beside `defineConfig`; the function turns the path of a Prisma 7 schema into a contract source. The CLI writes the config around that function, and the contribution must give the matching quick reference in `prisma7QuickReference`, and `init` refuses a package that exports the function without it. With a facade that has no `prisma7Schema`, `init` sets up a fresh project instead in an interactive run, and stops without writing anything when `--from-prisma7-schema` was given.
- **An unlisted package cannot keep a Prisma 7 schema.** `--from-prisma7-schema` with `--target` naming an unlisted package is refused before anything is installed. Without `--from-prisma7-schema`, `--target` naming an unlisted package sets up a fresh project and leaves the Prisma 7 schema alone.

## Consequences

- Any facade gets `init` by exporting one entrypoint, with no change to the CLI and no entry in the list.
- `init` runs code from the package the user names. It is the same package the config loads a moment later.
- A facade without a client cannot provide a contribution, because `init` always writes `db.ts`, the file that creates the client.
- A facade that does not list the keyword cannot be set up with `init`. It still works with a `prisma.config.ts` written by hand. The keyword places no rule on a package's name, and `init` needs no list of database names to refuse.
- `init` cannot read the keywords of every package before installing it. It asks one registry with no credentials, so it cannot read a package on a registry that needs credentials, one that only a scope's registry setting reaches, or any package behind a proxy that Node's `fetch` does not use. The user installs such a package first, and `init` reads it from disk.
- The name of a private package typed to `init` is sent to the public registry when `npm_config_registry` is not set.
- A refusal after the first install leaves no file written by `init`, but the install may have changed `package.json` and the lockfile. The error names what the install added and how to remove it.
- A failed first install also leaves no file written by `init`. The package manager may already have changed the dependency files, so the user checks them before trying again.
- A failed second install comes after the files are written, so the project's files are in place, but the remaining packages are missing and the contract has not been emitted.
- The minimum server version has one source, the facade's code. The CLI keeps no copy of it.
- The `--json` result reports the facade's name as `package`. Its `target` is the short name for a listed package and the package name for an unlisted one.

## Alternatives considered

### The CLI depends on the facades and registers their contributions

The published CLI would depend on each facade and hold their templates, so they are available before anything is installed and `--skip-install` works in an empty project.

Rejected. It works only for packages the CLI depends on, so a facade from another author has no way in, and every installation of the CLI would carry every facade.

### Registration in `package.json`

The application would name the facade in a `package.json` field, and the package would describe itself in another. Rejected because an extension is installed by importing it in the config, and a second place to declare the target can disagree with the first.

### Templates as static files or metadata, with no code

This keeps package code from running before the project is set up. Rejected because `init` loads the config and emits immediately afterwards, which runs the same package, and a server check cannot be data.

### The contribution supplies the whole config for a Prisma 7 schema

In place of the `prisma7Schema` function, the contribution would return the full text of `prisma.config.ts` for a project that keeps its Prisma 7 schema. Rejected because that text differs from the ordinary config in one line, so every facade would carry a copy of text the CLI already writes, and a change to it would have to be made in each of them.

### Package names only, with no list

`prisma orm init --target @prisma/orm-postgres` for everyone. Rejected because a first-time user cannot discover the package name, and the interactive picker would have nothing to show.

### The list lives outside the framework's CLI

Considered so that the framework names no target at all. Rejected as unnecessary, for the reason given under [The list](#the-list): the list decides no behaviour that differs by target.

### A prompt before installing a package that is not in the list

A question, or a typed consent, before `init` installs and runs an unlisted package. Rejected because it interrupts the run to confirm a name the user has just typed, and a user who typed `sqlite` would confirm it. The keyword check answers the question the prompt would ask, without asking the user.

### A rule on the package's name

An unscoped value would be taken as a package name only when it begins `prisma-orm-`, and a scoped one always. It needs no request to the registry. Rejected because it reads meaning into a name: it refuses a facade that chose another name, and it lets through any scoped package, whether or not it is for Prisma 8. The keyword says what the package is.

### Ask the package manager for the keywords

`npm view`, `pnpm view` and their equivalents apply the user's registry settings and credentials, which `init`'s own request does not. Rejected because the CLI can ask a package manager to do only two things, install packages and run a package's command once, and neither returns output. Each package manager also has its own command and its own output format for this. The cost is the consequence above: a package `init` cannot read is installed first.
