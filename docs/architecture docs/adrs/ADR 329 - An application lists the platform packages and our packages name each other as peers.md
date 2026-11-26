# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 330 — A maturity level is written in a package's version and an API's name](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) (the version ranges used here), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published, and how they are built), [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) (the database driver is a peer dependency for the same reasons), [ADR 325 — `init` gets everything about a database from the facade](ADR%20325%20-%20init%20gets%20everything%20about%20a%20database%20from%20its%20facade.md), [ADR 328 — A library integration uses only published entrypoints](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md)

## At a glance

An application updates its Prisma packages to release `8.4` and keeps the pgvector extension it already had, at `8.3.0`. If pgvector listed the Prisma framework as an ordinary dependency, the package manager could install this:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the application's copy
├── @prisma/orm-family-sql              8.4.0
└── @prisma/orm-extension-pgvector      8.3.0
    └── node_modules/
        └── @prisma/orm-framework       8.3.0   ← a second copy, for pgvector alone
```

The application now runs two copies of the framework. A value that one copy creates is not accepted by the other, so the first query that uses a `vector` column fails:

```text
Codec <codec id> takes only values of <data type id>, and was handed an object no data type constructed.
```

Nothing in that message tells the user that the cause is a second copy.

This record makes the package manager install one copy instead:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the only copy
├── @prisma/orm-family-sql              8.4.0
├── @prisma/orm-target-postgres         8.4.0
├── @prisma/orm-toolchain               8.4.0
└── @prisma/orm-extension-pgvector      8.3.0   ← uses the copy above
```

It does so with two rules:

1. **Each of our packages lists the other packages of ours that it needs as peer dependencies,** never as ordinary dependencies.
2. **The application lists all of them in its own `package.json`.**

The difference between the two kinds of dependency is the whole mechanism:

```jsonc
// in the package.json of @prisma/orm-extension-pgvector
"dependencies":     { "@prisma/orm-framework": "..." }   // ordinary: the package manager may give pgvector its own copy
"peerDependencies": { "@prisma/orm-framework": "..." }   // peer: pgvector uses the copy the application installed
```

A package manager never installs a peer dependency inside the package that asks for it. So the application's own list is the only place a copy can come from. If the copy there has a version that pgvector does not accept, the package manager says so; it does not quietly install a second one.

## The kinds of package

- **Facade:** the package an application's code imports Prisma from. There is one for each database: `@prisma/orm-postgres`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-sqlite` and `@prisma/orm-mongo`.
- **Platform packages:** the packages a facade is built from. For PostgreSQL they are:

  | Package | What is in it |
  | --- | --- |
  | `@prisma/orm-framework` | The core that every database shares. |
  | `@prisma/orm-family-sql` | What all SQL databases share. MongoDB has its own, `@prisma/orm-family-mongo`. |
  | `@prisma/orm-target-postgres` | What is specific to PostgreSQL. This is the PostgreSQL **target package**. |
  | `@prisma/orm-toolchain` | The `prisma orm` commands, such as the ones that emit the contract and run migrations. |

- **Extension:** an optional package that adds data types or operations for one database. `@prisma/orm-extension-pgvector` adds vector search to PostgreSQL.
- **Library integration:** a package that connects another library to Prisma, such as `@prisma/orm-better-auth`. Every rule here for an extension also holds for a library integration.

"Our packages" means all of these. Application code imports only from the facade and the extensions:

```ts
import postgres from '@prisma/orm-postgres/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';

export const db = postgres({ contract, extensions: [pgvector] });
```

The application lists the platform packages in `package.json` so that exactly one copy of each is installed. It never imports them.

## Decision

**The application lists the facade, every platform package the facade needs, and the outside packages they need,** such as the database driver:

```jsonc
// the application's package.json
"dependencies": {
  "@prisma/orm-postgres": "^8.4.0",
  "@prisma/orm-framework": "^8.4.0",
  "@prisma/orm-family-sql": "^8.4.0",
  "@prisma/orm-target-postgres": "^8.4.0",
  "@prisma/orm-toolchain": "^8.4.0",
  "@prisma/orm-extension-pgvector": "8.3.0",
  "pg": "^8.22.0",
  "@types/pg": "^8.20.0",
  "temporal-polyfill": "^1.0.8"
}
```

`prisma orm init` writes these lines, so a user does not have to work them out.

**The facade lists the platform packages as peer dependencies,** together with the outside packages its code needs: the driver (`pg`), and `temporal-polyfill`, which the PostgreSQL target package uses for date and time values.

```jsonc
// the package.json of @prisma/orm-postgres 8.4.0
"peerDependencies": {
  "@prisma/orm-framework": "~8.4.0",
  "@prisma/orm-family-sql": "~8.4.0",
  "@prisma/orm-target-postgres": "~8.4.0",
  "@prisma/orm-toolchain": "~8.4.0",
  "pg": "^8.22.0",
  "@types/pg": "^8.20.0",
  "temporal-polyfill": "^1.0.8",
  "typescript": ">=5.9"
}
```

**An extension lists the platform packages it uses as peer dependencies. It does not list a facade.**

```jsonc
// the package.json of @prisma/orm-extension-pgvector 8.3.0
"peerDependencies": {
  "@prisma/orm-framework": "^8.3.0",
  "@prisma/orm-family-sql": "^8.3.0",
  "@prisma/orm-target-postgres": "^8.3.0",
  "@prisma/orm-toolchain": "^8.3.0",
  "typescript": ">=5.9"
}
```

(`typescript` is optional in both: it is needed only for type checking.)

Read the three files together. The application installs the framework at `8.4.0`. The facade accepts `~8.4.0`, which means any `8.4.x`. pgvector accepts `^8.3.0`, which means `8.3.0` or any later `8.x`. Both accept `8.4.0`, so one copy serves everyone.

The two ranges differ on purpose. The packages of one release are tested together, so the facade accepts only its own release. An extension has to keep working when the application moves to a later release, so it accepts later ones. [ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) sets these ranges and explains them. This record decides only the two rules: peer dependencies between our packages, and every one of them listed by the application.

**The result:** one application gets one copy of each platform package, or a report from the package manager that the versions do not fit. That holds under npm, pnpm, Yarn (in both its `node_modules` mode and its Plug'n'Play mode) and Bun (in both its hoisted mode and its isolated mode). It does not always hold for several applications in one monorepo; see [Consequences](#consequences).

### Two packages that list a facade

A package of ours that uses a facade's own code lists that facade as a peer dependency too.

- `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`. A MariaDB application lists both facades and both target packages.
- `@prisma/orm-extension-supabase` uses code from the PostgreSQL facade, so it works with that facade only.

## Why two copies break

In the first tree at the top, pgvector's own code runs on two copies of the framework at once:

- pgvector's **codec** for `vector`, the code that converts a vector to and from the form the database stores, is built on pgvector's own copy, `8.3.0`.
- pgvector's `vector` **data type** is created through `@prisma/orm-family-sql`, which uses the application's copy, `8.4.0`.

The framework marks every value of a data type with a private field when it creates the value. In JavaScript, a private field belongs to one loaded copy of a class, and a second copy of the same class cannot read it. So when a `vector` value created by copy `8.4.0` reaches the codec on copy `8.3.0`, the codec finds no mark, treats the value as something no data type made, and refuses it. That is the error at the top.

TypeScript reports the same thing earlier, and just as unclearly. It treats a class with a private field as a type of its own, so the two copies' classes are two different types, and code that passes one where the other is expected does not compile.

### When two copies are harmless

Two copies do no harm when no value passes from one to the other. Prisma Composer, Prisma's deployment tool, loads a second copy of the ORM beside the application on purpose, for its own work.

### The `prisma` command-line tool

The `prisma` tool is installed with its own copy of `@prisma/orm-toolchain`, at its own version. When it runs a command, it reads the application's config file, and some values from that file pass into the tool's copy. So the tool and the application can be two copies that do exchange values.

The decision for the tool:

- `prisma` takes the same major and minor version as the release.
- It works only with an application whose packages are on that same minor. Otherwise it stops with a message that gives both versions.
- Within one minor the two copies can still differ in their patch number. So the values that pass from the config file into the tool must be accepted whichever copy created them.

## Why these two rules

**An ordinary dependency can bring a second copy.** When package A lists package B as an ordinary dependency, the package manager gives A its own copy of B whenever the version A asks for differs from the one already installed. That is the first tree at the top.

**A peer dependency cannot.** When A lists B as a peer dependency, the package manager never gives A its own copy. A uses the application's. That is rule 1.

**The application has to list them, because Yarn installs no peer dependencies by itself.** Under Yarn, a peer dependency that the application does not list is simply missing, and the package that needs it cannot load. npm, pnpm and Bun do install a missing peer dependency. But with no line for it in the application's `package.json`, a later update can move one package and leave the others behind. That is rule 2.

**The arrangement was tested against the others.** Each arrangement under [Alternatives considered](#alternatives-considered) was tried with stand-in packages on a local registry, under every package manager and mode named above. Each was tried with an extension, a platform package or the facade at a different version from the rest. Only two arrangements gave one copy, or a reported mismatch, every time: this one, and one that ties each extension to a single facade.

Two further benefits follow from the rules:

- **The package manager checks the versions.** When the application's lines and a package's peer dependencies disagree, npm refuses to install, and pnpm, Yarn and Bun install and print a warning.
- **One package can be released alone.** A fix published as `@prisma/orm-target-postgres` `8.4.1` installs beside the facade at `8.4.0`, because the facade accepts `~8.4.0`. No other package has to be released with it.

## What keeps the rules in place

- **`prisma orm init` writes the application's lines.** It installs the facade and reads the peer dependencies in the facade's `package.json`. It then reads the peer dependencies of each of our packages named there, and repeats until it finds no new package. It installs every package of ours it found, and every other package they require, such as the driver. One package is handled differently: `@prisma/cli-engine` is installed as a development dependency, at the version the installed `prisma` tool asks for. `init` does not go on to read the peer dependencies of packages that are not ours.
- **Adding an extension later needs no new lines for platform packages.** An extension lists only platform packages, and the application already has them. The user installs the extension itself with their package manager.
- **The build refuses a package that breaks rule 1.** Most of our published packages are built by bundling internal packages ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)). For each of those, the build works out which packages of ours its code uses, and fails unless its `package.json` lists exactly those as peer dependencies. A second check, before publishing, fails if any published package lists one of ours as an ordinary dependency. That second check also covers packages built another way, such as `@prisma/orm-better-auth`.

## Consequences

- **An application's `package.json` is longer.** A PostgreSQL application has five lines of ours where one would do if the facade brought the rest. `init` writes them.
- **A warning is easy to miss.** Three of the four package managers install a mismatched set of versions with only a warning, so a successful install does not prove that the versions fit. The application then has one copy of each platform package, but at a version that one of our packages was not tested with, and the warning is the only sign. Users need to read peer dependency warnings and correct their lines.
- **A program that brings its own toolchain lists the framework too.** The toolchain lists the framework as a peer dependency. So the `prisma` tool and Prisma Composer, which each install their own toolchain, each list `@prisma/orm-framework` beside it.
- **Generated files import from the facade and the extensions,** as application code does. `contract.d.ts` names the same packages the user's own code imports.
- **The database driver is a peer dependency too.** [ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) decided that, for the same reasons: the user sees the driver in their own list, and a conflict shows up at install.
- **A monorepo whose applications are on different releases can still get two copies, with no warning.** This happens under npm workspaces and under Bun's hoisted mode. Both install a package once, at the root of the repository, when every application asks for the same version of it. Take `app-a` on release `8.3` and `app-b` on `8.4`, both using pgvector `8.3.0`:

  1. Both ask for pgvector `8.3.0`, so it is installed once, at the root.
  2. The framework that `app-a` asks for, `8.3.0`, is installed at the root too. The one `app-b` asks for, `8.4.0`, goes into `app-b`'s own folder.
  3. pgvector, at the root, uses the framework it finds there: `8.3.0`.

  ```text
  node_modules/
  ├── @prisma/orm-framework              8.3.0   ← what app-a asked for
  └── @prisma/orm-extension-pgvector     8.3.0   ← shared by both applications; uses 8.3.0
  apps/app-b/node_modules/
  └── @prisma/orm-framework              8.4.0   ← what app-b asked for
  ```

  `app-b` now runs on framework `8.4.0` with a pgvector that runs on `8.3.0`: two copies, as in the first tree at the top. pnpm, Yarn and Bun's isolated mode keep each application's packages apart and do not have this problem. So a monorepo either keeps its applications on one release of Prisma, or uses one of those. No way of declaring dependencies changes where a package manager puts a package.

## Alternatives considered

Seven arrangements of dependencies were tested, as described under [Why these two rules](#why-these-two-rules). One is the arrangement this record chose. These are the other six, and what went wrong with each.

- **Ordinary dependencies everywhere.** The application lists only the facade. The facade brings the platform packages as ordinary dependencies. An extension brings its own framework and family, and lists only the target package as a peer dependency. An extension from another release gave two copies under every package manager. pnpm, Yarn and Bun printed a warning; none of them prevented it.
- **The facade brings the platform packages; extensions use peer dependencies.** The application lists only the facade. Under npm, the facade's copies are installed inside the facade's own folder, where an extension cannot find them. So npm installed a second copy for the extension, with no warning. Under Yarn's Plug'n'Play mode the extension could not load at all, because the application does not list what the extension asks for.
- **Peer dependencies everywhere, but the application lists only the facade.** Yarn installs no peer dependency that the application does not list, so the facade could not load the platform packages. Bun gave two copies with an extension from another release.
- **An extension lists a facade, not the platform packages.** This gave one copy every time. But an extension would then work with one facade only, and not with any other facade built on the same target package. What an extension extends is a database, which is the target package. Which facade the application uses is the application's choice.
- **An extension lists only the target package,** and reaches the framework and the family through it. When the application's lines for the facade and for the target package disagreed, npm refused to install, and the others gave two copies with a warning. When the application did not list the target package, Yarn could not load it and Bun gave two copies.
- **Peer dependencies for facades and extensions only; the platform packages list each other as ordinary dependencies.** The platform packages then brought copies of each other. Bun gave two copies when one platform package was updated alone. Yarn gave two copies on a fresh install whenever a newer platform package existed than the one the application listed.

One approach in code was also tried:

- **Check for a second copy when the application starts, and stop.** Prisma Composer loads a second copy of the ORM on purpose, so the check stopped applications that worked.
