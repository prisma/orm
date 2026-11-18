# `init` scaffolds from the target package's init contribution

Linear: [TML-3702](https://linear.app/prisma-company/issue/TML-3702).
Design record: [ADR 325 - init gets everything about a target from the target package](../../../../docs/architecture%20docs/adrs/ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md). It is approved; this spec does not restate its reasoning.

## At a glance

```text
$ prisma orm init --target postgres
✔ Installed @prisma/orm-postgres
✔ Wrote prisma.config.ts, prisma/contract.prisma, prisma/db.ts, prisma-8.md, .env.example
```

The files are byte for byte what `init` writes today. The difference is where their text comes from: `@prisma/orm-postgres/init`, not the CLI.

## Chosen design

1. **The interface.** `InitContribution` is a type exported by the framework CLI package from an `init-contribution` entrypoint. Members as in the design record. Types only.
2. **The list of known packages.** One table in the CLI: short name, aliases, package, label, Prisma 7 provider, for `postgres` and `mongodb`. It replaces the alias map in `input-values.ts`, the picker choices in `init-inputs.ts`, and the provider maps for Prisma 6 and Prisma 7 projects. Nothing else in the CLI names a target.
3. **Loading.** The CLI resolves `<package>/init` from the project folder, imports it, and checks the default export's shape. A missing entrypoint or a wrong shape is a structured error.
4. **The pipeline.** Resolve the package, install it, load the contribution, ask the remaining questions, write files, install the rest, emit, probe. With `--skip-install` the package must already be installed; otherwise `init` stops before changing anything and prints the install command. A failed install stops `init` and is reported as failed, as the package manager record requires.
5. **Postgres and MongoDB contributions.** `@prisma/orm-postgres/init` and `@prisma/orm-mongo/init` hold the templates, markdown and probes moved from `packages/1-framework/3-tooling/cli/src/commands/init/`. Each takes its minimum server version from the facade's own code. Each imports no framework runtime module.
6. **Unchanged.** `--target` takes the two short names only. The `--json` output and every printed message are unchanged, except where the step order makes a message come earlier.

## Non-goals

- Accepting a package name for `--target`, SQLite and MySQL contributions, and the `package` field in `--json`. Those are the next slice.
- Changing any template text.

## Acceptance criteria

1. `init --target postgres` and `--target mongodb`, in both authoring modes, write the same files as before. The existing template tests pass with their expected text unchanged.
2. The init journey tests pass.
3. No file under `packages/1-framework/3-tooling/cli/src` branches on a target name. The only target names left there are the entries of the list.
4. The threshold in `scripts/framework-vocabulary-thresholds.json` is lowered by every site removed.
5. `--skip-install` without the target package installed stops with no file written and names the install command.
6. A package with no `init` entrypoint, or one whose default export has the wrong shape, stops with no file written and a structured error that says to write `prisma.config.ts` by hand.
7. An install failure of the target package stops with no file written.
8. Neither contribution entrypoint imports framework runtime code: a test checks its built file's imports.
