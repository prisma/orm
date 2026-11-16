# A database target built outside this repository works with `init` and generated files

Linear project: [P-TML-1170](https://linear.app/prisma-company/project/targets-built-outside-the-orm-repo-work-with-init-and-generated-files-fd0afcc6f7f2).

## Purpose

Someone outside Prisma can publish a package that adds a database to Prisma 8, and an application using it gets the same `prisma orm init` and the same generated files as an application on Postgres. The first such package is the SQL Server target a team at Microsoft is building in their own repository.

## At a glance

Today, with an outside package installed:

```sh
$ prisma orm init --target @microsoft/prisma-orm-mssql
✘ [CLI.INIT_INVALID_FLAG_VALUE] Invalid value for --target
  why: `--target @microsoft/prisma-orm-mssql` is not one of: postgres, mongodb.
```

and `prisma contract emit` writes a `contract.d.ts` the application cannot compile:

```ts
import type { Contract as ContractType } from '@internal/contract/types';
```

After this project:

```sh
$ prisma orm init --target @microsoft/prisma-orm-mssql
? Install and run @microsoft/prisma-orm-mssql? yes
✔ Installed @microsoft/prisma-orm-mssql
✔ Wrote prisma.config.ts, prisma/contract.prisma, prisma/db.ts, prisma-8.md, .env.example
✔ Emitted contract.json and contract.d.ts
```

```ts
import type { Contract as ContractType } from '@microsoft/prisma-orm-mssql/generated-types';
```

`prisma orm init --target postgres` behaves as it does today, through the same mechanism. The package name and output text above are illustrations; the SQL Server team chooses their package name.

## Two rules the design follows

1. **One way to install an extension.** Add the package, import it in `prisma.config.ts`, include it. Nothing is registered in `package.json`, and the CLI takes its inputs from the config.
2. **No privileges for Prisma's own targets.** Every target is external to the framework. Postgres and MongoDB use the mechanisms an outside target uses.

## The two changes

Each has its own design record in this folder.

### Generated files import from the module the database package names

[adrs/generated-files-import-from-the-database-package.md](adrs/generated-files-import-from-the-database-package.md)

The config a database package's `defineConfig` builds says which module `contract.d.ts` imports its types from and which module a rendered `migration.ts` imports from. The emitter writes those names. It no longer reads the application's `package.json`, and no table of Prisma's package names is consulted when a file is generated.

### `init` gets everything about a database from that database's package

[adrs/init-contribution.md](adrs/init-contribution.md)

A database package exports an init contribution: its label, starter contract, database file, environment example, driver packages, quick reference text and an optional server probe. `init` resolves the package, installs it, loads the contribution and then writes files. The package is named by a short name from a list the CLI holds of packages Prisma vouches for, or by its npm package name.

## Non-goals

- **Building the SQL Server target.** The Microsoft team builds it. This project gives them the two mechanisms and instructions.
- **`init` support for SQLite, MySQL and MariaDB.** Their facades can add an init contribution once the mechanism exists. Writing those contributions is separate work.
- **Rewriting files already generated.** Existing `contract.d.ts`, snapshot and `migration.ts` files keep their import lines, and the modules they name stay exported. A migration file's content is covered by its hash, so it must not be re-rendered.
- **Changing how published packages are built.** The table that maps workspace packages to published packages stays as build configuration. It stops being read when a user's files are generated.
- **Prisma 7 upgrades onto an unlisted package.** The Prisma 7 path of `init` maps a Prisma 7 provider to a package from the CLI's list only.
- **A plugin loader, a registry or any discovery of installed packages.**

## Place in the larger world

- **The SQL Server team is not blocked on this.** [sql-server-team.md](sql-server-team.md) says how they build and ship now, and what they add as each change lands.
- **The `prismaNext` key in the target packages' `package.json`** is being removed separately (prisma/orm#31056). After it, each target exports its minimum server version from code, which the init contribution's probe uses.
- **The `prisma` CLI repository** mounts the `orm` commands. `init`'s flags and JSON output change shape slightly, so the CLI repository's own tests of `orm init` may need the same update.
- **Docs.** The docs site documents `orm init` flags and output. The slices that change them update the upgrade instructions skill, which the docs sync from.

## Cross-cutting requirements

- **The framework CLI contains no behaviour that depends on which database is chosen.** The only database names left in it are the entries of the known-packages list.
- **Nothing is inferred.** A config that does not say where generated files import from fails `contract emit` with an error that says so. A package with no init contribution fails `init` with an error that says to write the config by hand.
- **One copy of the framework.** The init contribution entrypoint imports no framework runtime module, so loading it from the project cannot create a second copy.
- **Applications install one database package.** Generated files name that package and extension packs only.
- **What outside authors need is documented where they look**: the upgrade instructions skill for extension authors and the extension-author tools README.

## Contract impact

`contract.json` records a `package` string in extension codec metadata that today names a private workspace package (TML-3143). The imports change settles what that string holds. It is outside the hashed part of the contract, so no storage or profile hash changes. No contract entity, kind or field is added.

## Adapter and target impact

- **Postgres and MongoDB facades**: each gains a module for generated types, names it and its migration module in `defineConfig`, and gains an `init` entrypoint holding the templates that move out of the CLI.
- **SQLite, MySQL and MariaDB facades**: each names its generated-types and migration modules in `defineConfig`. No init contribution.
- **Target renderers** stop naming a module themselves and use the one the config gives.
- **Extension packs** state the module their types come from as the published name.

## Framework impact

Both changes touch `packages/1-framework`, which the repository rule says not to change without the operator's decision. The operator directed both. The additions are:

- two optional members inside existing config sections: the module for generated contract types in the `contract` section, and the module for migration files in the `migrations` section;
- the init contribution interface, exported from the CLI package.

No new descriptor field, registry or runtime interface.

## Failure states of `init`

`init` edits a project it did not create. The reordered pipeline installs the database package before it writes any file, so:

| Where it stops | State of the project |
| --- | --- |
| The package name does not resolve, or the user declines to install it | Unchanged |
| `--skip-install` and the package is not installed | Unchanged; the error names the install command |
| The install fails | `package.json` and the lockfile may list the package; no file written |
| The package has no init contribution, or it fails to load | The package is installed; no file written |
| The user declines the consent to replace files on a re-init | The package is installed; no file written |
| Writing files, the second install or the emit fails | As today: files written so far stay, and the error says which step failed |

Every refusal `init` can predict is reported before the first file is written.

## Transitional-shape constraints

- **Each slice leaves `main` shippable.** After the imports slice, every in-repo config that emits names its modules. After the init mechanism slice, `init --target postgres` and `--target mongodb` produce the same files as before.
- **The imports slice changes every committed generated file in the repository** (about 500), by regeneration. The slice's pull request says so and keeps the regeneration in its own commit.
- **No period with two mechanisms.** The `package.json` read is removed in the slice that adds the config members. The database branches in `init` are removed in the slice that moves the templates.

## Project definition of done

- [ ] A test application outside the monorepo, built from packed tarballs, depends on a stand-in database package that is not in any list in this repository. `prisma orm init --target <that package>` scaffolds it, and `contract emit`, `migration plan` and a typecheck pass with no `@internal/` or `@prisma/orm-framework` name in any generated file.
- [ ] `git grep` finds no branch on a database name under `packages/1-framework/3-tooling/cli/src`, and the vocabulary threshold in `scripts/framework-vocabulary-thresholds.json` is lowered by every site removed.
- [ ] The CLI does not read `package.json` to choose import names: `project-import-root.ts` is gone.
- [ ] The init journey tests pass for Postgres and MongoDB in both authoring modes.
- [ ] Both design records are in `docs/architecture docs/adrs/` as accepted, the public npm packages record carries a supersession note for the manifest read, and the subsystem doc and CLI Style Guide sections on `init` describe the shipped flow.
- [ ] The SQL Server team has confirmed, in their repository, that their package works with `init` and `contract emit` from a published release.
- [ ] TML-3143 and TML-3702 are closed by the slices that deliver them.

## Open questions

None that block the design. Two are settled inside the imports slice by reading the code, and the design record says how each outcome is handled:

- whether anything reads the `package` string in codec metadata;
- which in-repo test configs are composed by hand and so must name their modules.

## References

- prisma/orm#31008, the proposal this replaces, and its Discord thread.
- Linear: TML-3702 (`init` templates live in the framework CLI), TML-3143 (private package name in codec metadata).
- Decision records: the family-agnostic CLI and pack entry points (config is the only input), the public npm packages (one facade per application, one copy of each module), community package naming.
- [Project intent](../../docs/design/00-purpose/project-intent.md) and [vision](../../docs/design/00-purpose/vision.md).
