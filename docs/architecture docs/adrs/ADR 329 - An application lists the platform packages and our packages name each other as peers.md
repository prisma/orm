# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published, and how they are built from internal ones), [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) (the driver is a peer for the same reasons), [ADR 325 — `init` gets everything about a database from the facade](ADR%20325%20-%20init%20gets%20everything%20about%20a%20database%20from%20its%20facade.md), [ADR 330 — A maturity level is written in a package's version and an API's name](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) (the version ranges)

## At a glance

An application on release `8.4` of PostgreSQL adds the pgvector extension, which was built for `8.3`. If our packages named each other as ordinary dependencies, the package manager could install this:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the client's copy
└── @prisma/orm-extension-pgvector      8.3.0
    └── node_modules/
        └── @prisma/orm-framework       8.3.0   ← pgvector's own copy
```

The application now has two copies of the framework. pgvector's `vector` values are made by its copy, and the client, built by the other copy, refuses them at run time:

```text
Codec <codec id> takes only values of <data type id>, and was handed an object no data type constructed.
```

Nothing in that message says the cause is a second copy. TypeScript reports similar errors where the two copies' types meet.

This record makes such a tree impossible for one application with two rules:

1. **The application lists every platform package its facade uses**, beside the facade.
2. **Each of our packages names every other package of ours it uses as a peer dependency**, never as an ordinary one.

A peer dependency is never installed inside the package that names it; the package uses the application's copy. So the application's own list is the only place a copy can come from.

## The packages involved

| Kind | Example | What it is |
| --- | --- | --- |
| **Facade** | `@prisma/orm-postgres` | The package an application installs for its database. One function in it wires the framework, family, target, adapter and driver together, and it re-exports everything application code imports. |
| **Platform packages** | `@prisma/orm-framework` | The core, shared by every database: data types, codecs and the runtime the client runs on. |
| | `@prisma/orm-family-sql` | What all SQL databases share. MongoDB has its own family, `@prisma/orm-family-mongo`. |
| | `@prisma/orm-target-postgres` | The PostgreSQL **target package**: what is specific to PostgreSQL. |
| | `@prisma/orm-toolchain` | The `prisma orm` commands, such as emitting the contract and running migrations. |
| **Extension** | `@prisma/orm-extension-pgvector` | Adds data types or operations, built on the platform packages. |
| **Library integration** | `@prisma/orm-better-auth` | Connects an outside library to an application's Prisma client. It follows the same rules as an extension. |

"Packages of ours" means all of these. Application code imports only from the facade and the extensions; the application lists the platform packages so that it holds them, not so that it imports them.

## Decision

The application's `package.json` lists the facade and every platform package the facade names, with their required outside peers, such as the database driver:

```jsonc
// the application
"dependencies": {
  "@prisma/orm-postgres": "^8.4.0",
  "@prisma/orm-framework": "^8.4.0",
  "@prisma/orm-family-sql": "^8.4.0",
  "@prisma/orm-target-postgres": "^8.4.0",
  "@prisma/orm-toolchain": "^8.4.0",
  "@prisma/orm-extension-pgvector": "^8.3.0",
  "pg": "^8.22.0",
  "@types/pg": "^8.20.0",
  "temporal-polyfill": "^1.0.8"
}
```

The facade names the platform packages, the driver and the other packages its code needs as peers. `temporal-polyfill` is one: the target package uses it for date and time values.

```jsonc
// @prisma/orm-postgres 8.4.0
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

An extension names the platform packages it uses as peers, not a facade:

```jsonc
// @prisma/orm-extension-pgvector 8.3.0
"peerDependencies": {
  "@prisma/orm-framework": "^8.3.0",
  "@prisma/orm-family-sql": "^8.3.0",
  "@prisma/orm-target-postgres": "^8.3.0",
  "@prisma/orm-toolchain": "^8.3.0"
}
```

The application's caret on `8.4.0` and pgvector's caret on `8.3.0` both admit `8.4.0`, so the package manager installs one copy at `8.4.0` and pgvector uses it. The facade accepts only its own minor of the platform packages, because the packages of one release are tested together; pgvector accepts any later release, so an extension built for `8.3` keeps working in an application on `8.4`. [ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) sets these ranges. This record decides only that the relation between our packages is a peer, and that the application lists the platform packages.

A package of ours that uses a facade's own code names that facade as a peer. `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`, so a MariaDB application lists both facades and both target packages. `@prisma/orm-extension-supabase` uses the PostgreSQL facade's code, so it works only with that facade.

With this configuration, a single application gets one copy of each platform package, or a reported version mismatch, under npm, pnpm, Yarn (both its `node_modules` and its Plug'n'Play modes) and Bun (both its hoisted and its isolated modes). A monorepo is the exception, described under [Consequences](#consequences).

## Why two copies break, and when they do not

The application builds its client from the facade and passes it the extensions' contributions: their data types, codecs and operations. The toolchain receives the same contributions when it emits the contract. Each contribution is made by the copy of the platform packages that its package found.

The framework recognises a data-type value by the copy that made it. The value carries a private field that only the copy that constructed it can read, so a value from another copy is refused with the error shown above. TypeScript treats a class with a private field as its own type, so the two copies' classes are different types, and code that passes one where the other is expected does not compile.

Two copies are harmless when they never exchange values. The `prisma` command-line tool and Prisma Composer (Prisma's deployment tool) each install `@prisma/orm-toolchain` as their own dependency, at their own version, and use it to run commands. That copy never receives values from the application's client, so it does not have to be the application's copy.

## Why this configuration

**An ordinary dependency can bring a second copy.** When package A lists package B as an ordinary dependency, the package manager gives A its own copy of B whenever the version A asks for differs from one already installed. That is the tree at the top.

**A peer dependency cannot.** When A names B as a peer, the package manager never gives A its own copy; A uses the application's. So every package of ours names the others only as peers.

**The application has to list them.** Yarn, in both of its modes, installs no peer dependencies: a peer the application does not list is missing, and the package that needs it cannot load. npm, pnpm and Bun install a missing peer by themselves, but without a line in the application's `package.json` a later update can move one package and leave the others behind.

**It was tested.** Each arrangement in the table under [Alternatives considered](#alternatives-considered) was tried with stand-in packages on a local registry, under every package manager and mode above, in cases where an extension, a platform package or the facade was at a different version from the rest. Only two gave one copy, or a reported mismatch, in every case: this one, and one in which an extension names a facade instead of the platform packages, which works with one facade only.

Two benefits follow:

- **The package manager checks the versions.** When the application's lines and a package's peer ranges disagree, npm refuses the install, and pnpm, Yarn and Bun install and print a warning.
- **One package can be released alone.** A package that names another as a peer accepts any version its range allows. A fix released as `@prisma/orm-target-postgres` `8.4.1` installs beside the facade at `8.4.0`, which accepts `~8.4.0`, so no other package has to be released with it.

## What keeps the configuration in place

- **`prisma orm init` writes the application's lines.** After installing the facade, it reads the peer dependencies in the facade's installed `package.json`, then in each `@prisma/orm-*` package named there, until no new name appears. It installs each of our packages it found, and every required peer of theirs that is not ours, such as the driver. It does not follow the peers of packages that are not ours; those are other projects' choices.
- **An extension added later needs no new lines.** It names only platform packages, which the application already lists. The user adds the extension itself with their package manager.
- **The release scripts refuse a manifest that breaks rule 2.** Most published packages are built by bundling internal workspace packages ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)). For each of those, the build works out which packages of ours its code depends on, and fails unless the manifest names exactly those as peers. Before publishing, a second check fails if any published package, including one built another way such as `@prisma/orm-better-auth`, lists one of ours as an ordinary dependency.

## Consequences

- **An application's `package.json` is longer:** five lines of ours for PostgreSQL, where one would do if the facade brought the rest. `init` writes them.
- **A missed warning leads to the unclear error.** Three of the four package managers install a mismatched set with only a warning, so an install that succeeds does not prove the versions fit. A user who misses the warning gets two copies and sees the error at the top, which does not name the cause. Reading the package manager's peer warnings is how they find it.
- **A program that carries its own toolchain lists the framework too.** The toolchain names the framework as a peer, so the `prisma` command-line tool and Prisma Composer each list `@prisma/orm-framework` beside their own toolchain.
- **The database driver is a peer too.** [ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) made it a peer of the package that uses it, for the same reasons: the user sees it in their own list, and a conflict shows at install.
- **A monorepo whose applications are on different releases can still get two copies, with no warning,** under npm workspaces and Bun's hoisted mode. These put a package once at the repository root when every workspace asks for the same version of it. If `app-a` is on `8.3` and `app-b` on `8.4`, and both use pgvector `8.3.0`:

  1. Both ask for pgvector `8.3.0`, so it is put once at the root.
  2. `app-a`'s framework `8.3.0` is put at the root too; `app-b`'s `8.4.0` goes in `app-b`'s own folder.
  3. pgvector, at the root, finds the root's framework, `8.3.0`.

  ```text
  node_modules/
  ├── @prisma/orm-framework              8.3.0   ← app-a's
  └── @prisma/orm-extension-pgvector     8.3.0   ← shared by both apps, so it finds 8.3.0
  apps/app-b/node_modules/
  └── @prisma/orm-framework              8.4.0   ← app-b's client's copy
  ```

  In `app-b`, pgvector's values are made by one copy and used by the other, as in the tree at the top. pnpm, Yarn and Bun's isolated mode keep each workspace's packages apart and do not have this problem. A monorepo keeps its applications on one release of Prisma, or uses one of those package managers. No arrangement of dependencies changes where a package manager puts a package.

## Alternatives considered

The first six rows were tried as described under [Why this configuration](#why-this-configuration).

| Arrangement | The application lists | Platform packages name each other as | An extension names | What went wrong |
| --- | --- | --- | --- | --- |
| Ordinary dependencies | the facade | ordinary dependencies, brought by the facade | the target package, as a peer | An extension from another release gave two copies under every package manager. pnpm, Yarn and Bun warned about the target package; none prevented it. |
| The facade brings them | the facade | ordinary dependencies, brought by the facade | the platform packages, as peers | Under npm the facade's copies sit inside the facade's folder, where the extension cannot see them, so the extension's peers got a second copy at the top, with no warning. Under Yarn's Plug'n'Play mode the extension could not load, because the application does not list what it names. |
| Peers, facade only listed | the facade | peers | the platform packages, as peers | Yarn installs no peer that is not listed, so the facade could not load the platform packages. Bun gave two copies with an extension from another release. |
| The extension names the facade | the facade and the platform packages | peers | the facade, as a peer | One copy in every case. But the extension would work with that one facade only, and not with another facade built on the same target package. The facade is the application's choice; what an extension is built on is the database's target package. |
| The extension names the target package only | the facade and the platform packages | peers | the target package, as a peer, reaching the framework and family through it | When the application's lines for the facade and the target package disagreed, npm refused the install and the others gave two copies with a warning. When the application did not list the target package, Yarn could not load it and Bun gave two copies. |
| Only facades and extensions use peers | the facade and the platform packages | ordinary dependencies | the platform packages, as peers | The platform packages brought copies of each other: two copies under Bun when one platform package was updated alone, and under Yarn on a fresh install when a newer platform package existed than the one the application listed. |

Two other approaches change the code instead of the installation:

- **Detect a second copy when the application starts, and stop.** Prisma Composer loads a second copy of the ORM beside the application on purpose, for its own work, so the check stopped working applications.
- **Let a value from another copy through.** The private-field check makes sure every value was made by a data type, so a hand-built object is caught where it enters. Dropping it would remove the run-time error, but TypeScript would still treat the two copies' classes as different types, so the application would still not compile.
