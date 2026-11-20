# `init` accepts any package name as the target

Linear: [TML-3831](https://linear.app/prisma-company/issue/TML-3831).
Design record: [ADR 325 - init gets everything about a target from the target package](../../../../docs/architecture%20docs/adrs/ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md). It is approved; this spec does not restate its reasoning.

## At a glance

```text
$ prisma orm init --target @prisma/orm-sqlite --authoring psl
```

installs `@prisma/orm-sqlite`, loads `@prisma/orm-sqlite/init`, and writes the project. The package is in no list in the CLI. `--target postgres` and `--target mongodb` behave as they do today.

## Chosen design

1. **Resolving `--target`.** The value is looked up in the list of known target packages by short name and alias. A value that is not in the list is taken as a package name when it is a valid npm package name; any other value is refused before anything changes. Before installing an unlisted package, `init` reads its keywords (from disk when installed, else from the registry) and refuses unless they include `prisma-orm-extension`.
2. **The first install of an unlisted package.** `init` does not know an unlisted package's drivers before installing it, and it does not read the registry itself. So the first install is the package and `dotenv` (whichever the project does not already declare), and the package manager handles the package's required peers its own way. The contribution's `peerPackages` are then declared in the later install. If the package manager refuses the first install, `init` reports the failure, as ADR 323 requires. A listed package keeps its drivers in the first install.
3. **The picker** lists the known packages and an entry for typing another package name.
4. **Output.** The `--json` success document gains `package`, the name of the target package. `target` is the short name for a listed package and the package name otherwise.
5. **One code path.** A listed package and an unlisted one run the same code after resolution. The Prisma 6 and Prisma 7 paths map a provider to a package through the list only.
6. **SQLite and MySQL contributions.** `@prisma/orm-sqlite/init` and `@prisma/orm-mysql/init`, built like the Postgres and MongoDB ones. Neither package is added to the list. MariaDB gets none.

## Non-goals

- Installing a target package's other required peers, such as `temporal-polyfill` (a separate ticket).
- Short names for SQLite or MySQL.
- A Prisma 7 path for an unlisted package.

## Acceptance criteria

1. An application outside the workspace, built from packed tarballs, runs `prisma orm init --target <the stand-in target package, which is in no list>` and gets a project whose `contract emit` and typecheck pass.
2. `prisma orm init --target @prisma/orm-sqlite` and `--target @prisma/orm-mysql` each scaffold a project that emits and typechecks, and the SQLite project runs a query.
3. `--target postgres` and `--target mongodb` write the same files as before, and their install arguments are unchanged.
4. A value that is neither a known name nor a valid package name is refused with a structured error before anything changes.
5. `--json` reports `package`, and `target` as described above, for a listed and an unlisted package.
6. The picker offers another package name, and choosing it runs the same path as `--target <name>`.
7. An unlisted package's first install holds the package and `dotenv` only; its contribution's `peerPackages` go into the later install.
