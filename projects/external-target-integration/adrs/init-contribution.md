# `init` gets everything about a database from that database's package

**Status:** Proposed

## Decision

A database package exports an init contribution from its `init` entrypoint. `prisma orm init` installs the package, loads the contribution and writes the project from it. The framework CLI holds no template, driver name, connection string shape or probe for any database.

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

```sh
prisma orm init --target postgres                      # a short name from the CLI's list
prisma orm init --target @microsoft/prisma-orm-mssql   # any npm package name
```

## Naming the database

`--target` takes a short name or a package name. The value is looked up in the CLI's list of known packages; a value not in the list is treated as an npm package name.

The list holds names and nothing else:

| Short name | Aliases | Package | Label | Prisma 7 provider |
| --- | --- | --- | --- | --- |
| `postgres` | `postgresql` | `@prisma/orm-postgres` | PostgreSQL | `postgresql` |
| `mongodb` | `mongo` | `@prisma/orm-mongo` | MongoDB | `mongodb` |

- A package is listed because Prisma vouches for it, not because Prisma wrote it. A community package can be added.
- A listed package and an unlisted one run the same code. Listing gives a short name, a line in the interactive picker and the Prisma 7 mapping.
- The label is in the list because the picker shows it before any package is installed. After the package loads, its contribution's label is the one used.
- The picker lists the known packages and an entry for typing another package name.

## The contribution

| Member | What it gives `init` |
| --- | --- |
| `label` | The database's display name |
| `configModule` | The module that exports `defineConfig`, imported by the scaffolded `prisma.config.ts` |
| `peerPackages` | Driver packages the application must install itself |
| `authoringModes` | Which of PSL and TypeScript the package has a starter for |
| `starterContract(mode)` | The starter contract source |
| `contractSample(mode)` | The contract excerpt shown in the quick reference |
| `databaseFile(input)` | The content of `db.ts` |
| `envExample()` | The `DATABASE_URL` lines for `.env.example` and `.env` |
| `quickReference(input)`, `readme(input)` | The text of `prisma-8.md` and the README |
| `serverRequirement` | Optional: the minimum server version and the command that shows a server's version |
| `probe(databaseUrl)` | Optional: connects and returns the server version and whether it meets the minimum |
| `prisma7ConfigFile(input)` | Optional: the config for a project that keeps its Prisma 7 schema as the contract source |

The CLI decides which files exist and where they go, renders `prisma.config.ts` from `configModule`, and owns everything that does not depend on the database: package manager detection, `tsconfig.json`, `.gitignore`, `.gitattributes`, the `package.json` scripts, consent and output.

A contribution's own templates name its own package, so `init` needs no import-name translation.

The entrypoint imports no framework runtime module. It is loaded from the project's `node_modules` by a CLI that may be a different installed copy, and it must not bring a second copy of the framework with it.

## Order of steps

1. Resolve the package from `--target` or the picker.
2. For a package not in the list, ask `Install and run <package>?` before installing. `--yes` accepts.
3. Install the database package, unless it is already installed.
4. Load its contribution.
5. Ask the remaining questions: authoring mode from the contribution's modes, schema path, then consent to replace files on a re-init, then the `.env` question.
6. Write the files.
7. Install the remaining packages: the contribution's peer packages, `dotenv`, the CLI and types.
8. Emit the contract.
9. Probe the database, when asked to and the contribution has a probe.

The database package is installed before any file is written because the files come from it.

With `--skip-install`, nothing is installed. The database package must already be installed; if it is not, `init` stops before changing anything and prints the install command.

## Errors

| Situation | Result |
| --- | --- |
| The value is not a short name and is not a valid package name | Refused before any change |
| The package is installed but has no `init` entrypoint | Refused after the install, before any file: the package does not support `init`; write `prisma.config.ts` by hand |
| The requested authoring mode is not in `authoringModes` | Refused before any file, naming the modes the package has |
| `--probe-db` and the contribution has no probe | A warning that the package cannot check the server; `--strict-probe` makes it an error |
| A Prisma 7 project whose provider has no entry in the list | Refused: name a package with `--target` and start without the Prisma 7 schema |

## Prisma 7 and Prisma 6 projects

`init` maps the provider in a Prisma 7 schema to a package through the list. The list is the only source; an unlisted package is not offered for this path. A contribution without `prisma7ConfigFile` means the package cannot take a Prisma 7 schema, and `init` sets up a fresh project instead.

## Output

The `--json` success document reports `package`, the package name that was installed. `target` stays: the short name for a listed package, the package name otherwise.

## Consequences

- An outside database package gets `init` by exporting one entrypoint.
- SQLite, MySQL and MariaDB get `init` when their facades add a contribution and an entry in the list.
- The Postgres and MongoDB templates, markdown files and probes move into their facades. The framework CLI's count of database-specific sites drops by all of them.
- `init` needs the database package installed before it can write. A run with `--skip-install` in a project that does not have the package is refused.
- The published CLI still depends on no database package.

## Alternatives considered

### The CLI depends on the database packages and registers their contributions

The published CLI would depend on `@prisma/orm-postgres` and `@prisma/orm-mongo` and hold a registry, so templates are available before anything is installed and `--skip-install` keeps working in an empty project.

Rejected. It works only for the packages the CLI depends on, so an outside package has no way in, and it makes every installation of the CLI carry every database package.

### Registration in `package.json`

The application names the database package in a `package.json` field and the package describes itself in another. Rejected: extensions are installed by importing them in the config, the CLI takes its inputs from the config, and a second place to declare the database can disagree with the first.

### Templates as static files or strings in package metadata

Rejected because the contribution is loaded as code moments before the config is, so nothing is gained by forbidding functions, and a probe cannot be data.

### No list: package names only

`prisma orm init --target @prisma/orm-postgres` for everyone. Rejected because a first-time user has no way to discover the package name, and the interactive picker would be empty.

### The list lives outside the framework CLI

Considered so that the framework names no database. Rejected as unnecessary: a table of package names decides no behaviour. The rule against database vocabulary in the framework exists to prevent behaviour that depends on the database, which this design removes.
