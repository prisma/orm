# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 330 — A maturity level is written in a package's version and an API's name](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) (the version ranges used here), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published, and how they are built), [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) (the database driver is a peer dependency for the same reasons), [ADR 325 — `init` gets everything about a database from the facade](ADR%20325%20-%20init%20gets%20everything%20about%20a%20database%20from%20its%20facade.md) (how `init` finds what to install), [ADR 328 — A library integration uses only published entrypoints](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md) (library integrations follow the rules here)

## At a glance

"Release `8.4`" below means the versions of Prisma's packages that start with `8.4`.

An application updates its Prisma packages to release `8.4` and keeps the pgvector extension it already had, at `8.3.0`. Suppose pgvector listed the Prisma framework as an ordinary dependency, at exactly the version it was built with, `8.3.0`. The package manager would then install this:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the application's copy
├── @prisma/orm-family-sql              8.4.0
├── @prisma/orm-target-postgres         8.4.0
├── @prisma/orm-toolchain               8.4.0
└── @prisma/orm-extension-pgvector      8.3.0
    └── node_modules/
        └── @prisma/orm-framework       8.3.0   ← a second copy, for pgvector alone
```

The application now runs two copies of the framework. The framework does not accept a value that another copy of itself created ([below](#why-two-copies-break)). So the application fails to compile. If it is not type-checked, the failure comes later, the first time Prisma reads a `vector` value written in the application's contract, such as a column's default value:

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

1. **Each Prisma package that an application installs lists the other Prisma packages it needs as peer dependencies,** never as ordinary dependencies.
2. **The application lists every one of those packages in its own `package.json`.**

The difference between the two kinds of dependency is the whole mechanism:

```jsonc
// in the package.json of @prisma/orm-extension-pgvector
"dependencies":     { "@prisma/orm-framework": "..." }   // ordinary: pgvector gets its own copy when the installed one does not fit
"peerDependencies": { "@prisma/orm-framework": "..." }   // peer: pgvector uses the copy the application installed
```

With both rules in place, the application's own list is where every copy comes from. If the copy there has a version that pgvector does not accept, npm refuses to install, and pnpm, Yarn and Bun print a warning. None of them installs a second copy for one application. Several applications in one monorepo are a different matter; see [Consequences](#consequences).

## The kinds of package

- **Facade:** the package an application's code imports Prisma from. There is one for each database: `@prisma/orm-postgres`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-sqlite` and `@prisma/orm-mongo`.
- **Platform packages:** the packages a facade is built from. For PostgreSQL they are:

  | Package | What is in it |
  | --- | --- |
  | `@prisma/orm-framework` | The core that every database shares. |
  | `@prisma/orm-family-sql` | What all SQL databases share. MongoDB has its own, `@prisma/orm-family-mongo`. |
  | `@prisma/orm-target-postgres` | What is specific to PostgreSQL. This is the PostgreSQL **target package**. |
  | `@prisma/orm-toolchain` | Everything that runs while developing and building: the code behind the `prisma orm` commands, the config loader, the generator of typed files. A facade's and an extension's config entrypoints use it. |

- **Extension:** an optional package that adds data types or operations for one database. `@prisma/orm-extension-pgvector` adds vector search to PostgreSQL.
- **Library integration:** a package that connects another library to Prisma, such as `@prisma/orm-better-auth`. Every rule here for an extension also holds for a library integration.

"Our packages" means all of these. Application code imports only from the facade and the extensions:

```ts
import postgres from '@prisma/orm-postgres/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';

// `contract` is the application's data model, loaded a few lines earlier.
export const db = postgres({ contract, extensions: [pgvector] });
```

The application lists the platform packages in `package.json` so that exactly one copy of each is installed. It never imports them.

## Why two copies break

An application hands each extension's parts to the application's client: data types, codecs and operations. The toolchain receives the same parts when it generates files. Each part runs on whichever copy of the framework its own package finds. Node looks for a package in the importing package's own `node_modules` folder first, and then in each folder above it.

Look again at the first tree. pgvector's own code ends up running on two copies of the framework at once:

- pgvector's **codec** for `vector` is the code that converts a vector to and from the form the database stores. It is built on pgvector's own copy, `8.3.0`.
- pgvector's `vector` **data type** is created through `@prisma/orm-family-sql`. That package sits at the top of the tree, so it uses the application's copy, `8.4.0`.

The framework marks every value of a data type with a private field when it creates the value. In JavaScript, a private field belongs to one loaded copy of a class, and a second copy of the same class cannot read it. Prisma reads a value written in the contract, such as a default for a `vector` column, by creating the value and handing it to the codec. Here the value is created by copy `8.4.0` and handed to the codec on copy `8.3.0`, and the codec finds no mark. It treats the value as something no data type made, and refuses it. That is the error at the top.

TypeScript finds the same problem at compile time, and reports it just as unclearly. It treats a class with a private field as a type of its own, so the two copies' classes are two different types. Wherever a value typed by one copy is handed to code typed by the other, the compiler reports that the types do not match.

Two copies do no harm when no value passes from one to the other. Prisma Composer, Prisma's deployment tool, loads a second copy of the ORM beside the application on purpose. It uses that copy for its own start-up work, and hands none of its values to the application.

## Decision

**The application lists the facade, every platform package the facade needs, and the packages from other publishers that they need,** such as the database driver:

```jsonc
// the application's package.json
"dependencies": {
  "@prisma/orm-postgres": "^8.4.0",
  "@prisma/orm-framework": "^8.4.0",
  "@prisma/orm-family-sql": "^8.4.0",
  "@prisma/orm-target-postgres": "^8.4.0",
  "@prisma/orm-toolchain": "^8.4.0",
  "pg": "^8.22.0",
  "@types/pg": "^8.20.0",
  "temporal-polyfill": "^1.0.8",

  "@prisma/orm-extension-pgvector": "8.3.0"
}
```

`prisma orm init` writes every line except the last, so a user does not have to work them out. The user added pgvector themselves. Its line is fixed at `8.3.0` here only to show an extension from an earlier release.

**The facade lists the platform packages as peer dependencies,** together with the driver (`pg`) and `temporal-polyfill`, which Prisma uses for date and time values.

```jsonc
// the package.json of @prisma/orm-postgres 8.4.0
"peerDependencies": {
  "@prisma/orm-framework": "~8.4.0",
  "@prisma/orm-family-sql": "~8.4.0",
  "@prisma/orm-target-postgres": "~8.4.0",
  "@prisma/orm-toolchain": "~8.4.0",
  "pg": "^8.22.0",
  "@types/pg": "^8.20.0",
  "temporal-polyfill": "^1.0.8"
}
```

**An extension lists the platform packages it uses as peer dependencies. It does not list a facade.**

```jsonc
// the package.json of @prisma/orm-extension-pgvector 8.3.0
"peerDependencies": {
  "@prisma/orm-framework": "^8.3.0",
  "@prisma/orm-family-sql": "^8.3.0",
  "@prisma/orm-target-postgres": "^8.3.0",
  "@prisma/orm-toolchain": "^8.3.0"
}
```

(Both real files also list `typescript`, marked as optional. It is left out here.)

Read the three files together. The application installs the framework at `8.4.0`. The facade accepts `~8.4.0`, which means any `8.4.x`. pgvector accepts `^8.3.0`, which means `8.3.0` or any later `8.x`. Both accept `8.4.0`, so one copy serves everyone.

The two ranges differ on purpose. The packages of one release are tested together, so the facade accepts only its own release. An extension has to keep working when the application moves to a later release, so it accepts later ones. [ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) sets these ranges and explains them. This record decides only the two rules: peer dependencies between our packages, and every one of them listed by the application.

**The result:** one application gets one copy of each platform package, or a report from the package manager that the versions do not fit. That holds under npm, under pnpm, under Yarn in both its `node_modules` mode and its Plug'n'Play mode, and under Bun in both its hoisted mode and its isolated mode. (The modes are different ways of laying out installed packages on disk.)

### Two packages that list a facade

A package of ours that uses a facade's own code lists that facade as a peer dependency too. There are two.

- `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`. A MariaDB application lists both facades and both target packages.
- `@prisma/orm-extension-supabase` wraps the client that the PostgreSQL facade builds, so it cannot work without that facade.

## Why these two rules

**An ordinary dependency can bring a second copy.** Package A lists package B as an ordinary dependency, with a range of versions. If the copy of B already installed is outside that range, the package manager gives A its own copy of B. That is the first tree at the top. A wider range makes this rarer, but it does not rule it out. The package manager decides when two packages share a copy, and in the tests below npm installed two copies when a facade listed the platform packages as ordinary dependencies with a tilde range.

**A peer dependency that the application lists cannot.** When A lists B as a peer dependency, the package manager does not give A its own copy. A uses the application's. That is rule 1.

**The application has to list them, because package managers differ on a peer dependency that nobody lists.** Yarn does not install it at all, and the package that needs it cannot load. npm, pnpm and Bun install it by themselves, each choosing a version in its own way, and under Bun that gives two copies when an extension comes from another release. With a line in the application's `package.json`, every package manager installs the same thing. That is rule 2.

**The arrangement was tested against the others.** Each arrangement under [Alternatives considered](#alternatives-considered) was tried with stand-in packages on a local registry, under every package manager and mode named above. Each was tried with an extension, a platform package or the facade at a different version from the rest. Only two arrangements gave one copy, or a reported mismatch, every time: this one, and one that ties each extension to a single facade.

One further benefit follows from the rules: the package manager checks the versions. Each peer dependency states which versions it accepts, and the package manager compares that with what the application installed.

## What keeps the rules in place

- **`prisma orm init` writes the application's lines.** It installs the facade and reads the peer dependencies in the facade's `package.json`. It then reads the peer dependencies of each of our packages named there, and repeats until it finds no new package. It installs every package of ours it found, and every other package they require, such as the driver. One package is handled differently: `@prisma/cli-engine`, the engine of the `prisma` tool, which the toolchain requires. `init` installs it as a development dependency, at the version the installed `prisma` tool asks for.
- **Adding an extension later needs no new lines for platform packages.** The platform packages an extension needs are ones the application already has. The user installs the extension itself with their package manager.
- **The build refuses a package that breaks rule 1.** Most of our published packages are assembled from smaller packages inside this repository ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)), so nobody writes their dependency lists by hand. For each of those, the build works out which packages of ours its code uses, and fails unless its `package.json` lists exactly those as peer dependencies. A second check, before publishing, fails if any published package lists one of ours as an ordinary dependency. That second check also covers the packages that are written by hand, such as `@prisma/orm-better-auth`.

## The `prisma` command-line tool

The two rules cover the packages an application installs for its own code. The `prisma` command-line tool is a program, not one of those packages, and it is a separate case because it brings a copy of its own.

The tool is published from another repository. It is installed with its own copy of `@prisma/orm-toolchain`, at its own version, and runs the `prisma orm` commands from that copy. When it runs a command it loads the application's config file. That file imports the application's facade, so the objects in it are created by the application's copies of our packages. The tool's copy then receives them. So here two copies do exchange values.

The decision for the tool:

- `prisma` is published with the same major and minor version as the release.
- It compares that with the facade installed in the application. If the facade is on another minor, it stops with a message that gives both versions.
- The tool's copy and the application's copy are always two copies, even at the same version. So the tool reads the values it receives from the config file by their shape, and does not apply the private-field check to them. The check on the minor exists because the shape of those values can change from one release to the next.

## Consequences

- **An application's `package.json` is longer.** A PostgreSQL application has five lines of ours where one would do if the facade brought the rest. `init` writes them.
- **A warning is easy to miss.** Three of the four package managers install a mismatched set of versions with only a warning, so a successful install does not prove that the versions fit. The application then has one copy of each platform package, but at a version that one of our packages was not tested with, and the warning is the only sign. Users need to read peer dependency warnings and correct their lines.
- **The run-time error still does not name its cause.** This record makes two copies unlikely. It does not change what the user sees when they happen anyway.
- **A program that brings its own toolchain lists the framework too.** The toolchain lists the framework as a peer dependency. So the `prisma` tool and Prisma Composer, which each install their own toolchain, each list `@prisma/orm-framework` beside it.
- **The files Prisma generates into an application import only from the facade and the extensions,** as the application's own code does. The application lists the platform packages, but nothing in it imports them, generated or written by hand.
- **The database driver is a peer dependency too.** [ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) decided that, for the same reasons: the user sees the driver in their own list, and a conflict shows up at install.
- **A monorepo whose applications are held on different releases can still get two copies, with no warning.** This happens under npm workspaces and under Bun's hoisted mode. Both try to install each package once, at the root of the repository, for every application to share. Take `app-a` held on release `8.4` and `app-b` held on `8.5`, for example by tilde ranges, both using the same version of pgvector:

  1. Both ask for the same pgvector, so it is installed once, at the root.
  2. They ask for different versions of the framework, so only one can be at the root. Say it is `8.4.0`, for `app-a`. Then `8.5.0` goes into `app-b`'s own folder.
  3. pgvector, at the root, uses the framework it finds there: `8.4.0`.

  ```text
  node_modules/
  ├── @prisma/orm-framework              8.4.0   ← what app-a asked for
  └── @prisma/orm-extension-pgvector     8.3.0   ← shared by both applications; uses 8.4.0
  apps/app-b/node_modules/
  └── @prisma/orm-framework              8.5.0   ← what app-b asked for
  ```

  `app-b` now runs on framework `8.5.0` with a pgvector that runs on `8.4.0`: two copies, as in the first tree at the top. Under pnpm, under Yarn in both modes and under Bun's isolated mode, each application got one copy. So a monorepo either keeps its applications on one release of Prisma, or uses one of those. No way of declaring dependencies changes where a package manager puts a package.

## Alternatives considered

Seven arrangements of dependencies were tested, as described under [Why these two rules](#why-these-two-rules). One is the arrangement this record chose. These are the other six, and what went wrong with each.

- **Ordinary dependencies everywhere.** The application lists only the facade. The facade brings the platform packages as ordinary dependencies. An extension brings its own framework and family, and lists only the target package as a peer dependency. An extension from another release gave two copies under every package manager. pnpm, Yarn and Bun printed a warning; none of them prevented it.
- **The facade brings the platform packages; extensions use peer dependencies.** The application lists only the facade and the extension. With an extension from another release, npm installed the extension's peer dependencies by itself, at the newest version it could find. That version did not fit the facade's range, so npm gave the facade its own copies inside the facade's folder: two copies, with no warning. Under Yarn's Plug'n'Play mode the extension could not load at all, because the application does not list what the extension asks for.
- **Peer dependencies everywhere, but the application lists only the facade.** Yarn installs no peer dependency that the application does not list, so the facade could not load the platform packages. Bun gave two copies with an extension from another release.
- **An extension lists a facade, not the platform packages.** This gave one copy every time. But an extension would then work with one facade only. A facade is one way of putting the platform packages together, and someone else can publish another, for example for a hosted PostgreSQL service. What an extension extends is the database, which is the target package, so it should work with any facade built on that target package. The Supabase extension is the exception because it extends the facade's client, not the database.
- **An extension lists only the target package,** and reaches the framework and the family through it. When the application's lines for the facade and for the target package disagreed, npm refused to install, and the others gave two copies with a warning. When the application did not list the target package, Yarn could not load it and Bun gave two copies.
- **Peer dependencies for facades and extensions only; the platform packages list each other as ordinary dependencies.** The platform packages then brought copies of each other. Bun gave two copies when one platform package was updated alone. Yarn gave two copies on a fresh install whenever a newer platform package existed than the one the application listed.

One approach in code was also tried:

- **Check for a second copy when the application starts, and stop.** Prisma Composer loads a second copy of the ORM on purpose, so the check stopped applications that worked.
