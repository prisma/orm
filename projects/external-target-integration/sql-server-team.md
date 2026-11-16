# Building the SQL Server target outside the Prisma ORM repository

For the team building a SQL Server target for Prisma 8 in their own repository. It says what to build now, how an application uses it before our changes ship, and what to add to your package when each change ships.

## The short version

- Almost all of your work is the target itself: the target, adapter and driver descriptors, codecs, query lowering, migrations, introspection and tests. None of it waits on us.
- Two things in our CLI do not yet work for a package we did not write: `prisma orm init`, and the import lines in generated files. We are fixing both. Until then there is a way around each.
- Nothing is registered in `package.json`. A Prisma 8 extension is installed one way: add the package, import it in `prisma.config.ts`, include it.

## What to build now

Follow the Postgres target as the reference. Its packages are in [`packages/3-targets/postgres/`](../../packages/3-targets/postgres/), numbered in dependency order: target, adapter, driver, then the facade that composes them.

Build against the published packages:

- `@prisma/orm-framework` and `@prisma/orm-family-sql` as dependencies;
- pin every `@prisma/orm-*` package to one exact version while Prisma 8 is in release candidates. Two versions in one application load two copies of the framework, and values made by one copy are not recognised by the other.

Publish one package that an application installs, shaped like `@prisma/orm-postgres`:

| Entrypoint | Holds |
| --- | --- |
| `/config` | `defineConfig`, which composes the SQL family with your target, adapter and driver descriptors |
| `/runtime` | Your client factory |
| `/contract-builder` | `defineContract` bound to your target |
| `/migration` | The base class and operation factories your rendered migration files import |
| `/control` | A control client for scripts |

Name the package `prisma-orm-<name>` under your scope, for example `@microsoft/prisma-orm-mssql`, and add the keyword `prisma-orm-extension`. This is the convention for packages Prisma does not publish.

In your descriptors, wherever you declare the module your codec and operation types come from, write your package's published name. A name that is already public passes through our emitter unchanged.

## How an application uses your package today

**Skip `prisma orm init`.** It accepts only `postgres` and `mongodb`. The application writes `prisma.config.ts` by hand:

```ts
import { defineConfig } from '@microsoft/prisma-orm-mssql/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['DATABASE_URL'] },
});
```

**Install the framework packages beside yours.** The application's own `package.json` lists `@prisma/orm-framework` and `@prisma/orm-family-sql` as dependencies, at the same exact version your package uses, and none of Prisma's database packages. With that, `prisma contract emit` writes import lines that name those two packages and yours. Without it, the generated files name packages that cannot be resolved.

We have not run this end to end outside our repository. Please try it in a clean application with your package installed from a tarball: `contract emit`, `migration plan`, then a typecheck. Tell us what fails. That report is the most useful thing you can send us now.

## When generated imports ship

Our change: the config says which modules generated files import from, and the database package fills that in.

What you add:

1. A module that re-exports the types a generated `contract.d.ts` uses from the framework, the SQL family and your target. We will publish the exact list of names with the release.
2. In your `defineConfig`, name that module as the contract types module, and your `/migration` entrypoint as the migrations module.

What your users change: they remove `@prisma/orm-framework` and `@prisma/orm-family-sql` from their own dependencies and run `prisma contract emit` again. They then install one package, yours.

## When `init` ships

Our change: `prisma orm init` installs the package it is given, loads an init contribution from it and scaffolds from that.

What you add: an `/init` entrypoint that exports your contribution. It holds your display label, starter contract, `db.ts` content, `.env` example, driver packages, quick reference text and an optional probe that reads the server version.

What your users get:

```sh
prisma orm init --target @microsoft/prisma-orm-mssql
```

A short name such as `--target mssql` comes from a list of packages Prisma vouches for. We can add yours once it is published and we have used it.

## What not to build

- Any `package.json` metadata that describes your package to the CLI, or a field in the application's `package.json` that selects it.
- A fork or patch of the CLI.
- Code that depends on a module name beginning `@internal/`. Those are our workspace names and are not published.

## Where to ask

The Discord thread where this started. We will post there when each change is released, with the version to pin.
