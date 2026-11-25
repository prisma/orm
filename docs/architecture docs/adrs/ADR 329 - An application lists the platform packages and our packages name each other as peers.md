# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md), [ADR 325 — `init` gets everything about a database from the facade](ADR%20325%20-%20init%20gets%20everything%20about%20a%20database%20from%20its%20facade.md), [ADR 328 — A library integration uses only published entrypoints](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md)

## Decision

An application must hold exactly one copy of each platform package. The platform packages hold the registries of data types and operations that the client and the extensions share, and two copies of one do not see each other: a data type an extension registers in one copy is missing from the other, and nothing reports it.

One configuration makes the package manager alone give an application one copy, under every package manager, while an extension still works with any facade built on its target package:

1. **The application declares every platform package as a dependency.**
2. **Every package of ours that depends on a platform package, or on any other package of ours, declares it as a peer dependency.**

```jsonc
// the application's package.json                    // @prisma/orm-postgres's package.json
"dependencies": {                                     "peerDependencies": {
  "@prisma/orm-postgres": "^8.4.0",                     "@prisma/orm-framework": "~8.4.0",
  "@prisma/orm-framework": "^8.4.0",                    "@prisma/orm-family-sql": "~8.4.0",
  "@prisma/orm-family-sql": "^8.4.0",                   "@prisma/orm-target-postgres": "~8.4.0",
  "@prisma/orm-target-postgres": "^8.4.0",              "@prisma/orm-toolchain": "~8.4.0",
  "@prisma/orm-toolchain": "^8.4.0",                    "pg": "^8.22.0",
  "@prisma/orm-extension-pgvector": "^8.3.0",           "@types/pg": "^8.20.0",
  "pg": "^8.22.0",                                      "temporal-polyfill": "^1.0.8"
  "@types/pg": "^8.20.0",                             }
  "temporal-polyfill": "^1.0.8"
}
```

No package of ours brings its own copy of another, so the application's list is the only place a copy can come from. Everything else this record decides exists to make that configuration hold.

The packages involved:

| Kind | Example | What it is |
| --- | --- | --- |
| **Facade** | `@prisma/orm-postgres` | What an application installs for its database. One function in it wires the framework, family, target, adapter and driver together, and it re-exports everything application code imports. |
| **Platform packages** | `@prisma/orm-framework` | The core, shared by every database. It holds the registries. |
| | `@prisma/orm-family-sql` | What all SQL databases share. MongoDB has its own family. |
| | `@prisma/orm-target-postgres` | The PostgreSQL **target package**: what is specific to PostgreSQL. |
| | `@prisma/orm-toolchain` | The `prisma orm` commands: emitting the contract, migrations. |
| **Extension** | `@prisma/orm-extension-pgvector` | Adds data types or operations, built on the platform packages. |
| **Library integration** | `@prisma/orm-better-auth` | Connects an outside library to an application's Prisma client. |

Application code still imports only from the facade and the extensions. The application lists the platform packages so that it holds them, not so that it imports them.

### What keeps the configuration in place

- **`prisma orm init` writes the application's declarations.** After installing the facade, it reads the peer dependencies from the facade's installed `package.json`, then from each `@prisma/orm-*` package named there, until no new name appears. It installs each of them, with the other required peers those manifests name, such as the database driver. It does not follow the peers of packages that are not ours: those are other projects' choices.
- **The build refuses a manifest that breaks the second rule.** For each published package built from the internal packages, it works out which packages of ours that code depends on, and fails unless the manifest names exactly those as peers. A second check, before publishing, fails if any published package, including one built another way such as `@prisma/orm-better-auth`, lists one of ours under `dependencies`.
- **An extension names the platform packages it uses, not a facade.** A PostgreSQL extension then works with any facade built on the PostgreSQL target package. An extension that imports a facade's own code names that facade as a peer, and works only with it; `@prisma/orm-extension-supabase` is one.

The ranges themselves, on both sides, are set by the versioning rules in [Versioning](../../oss/versioning.md). This record decides only that the relation is a peer, and that the application declares the platform packages.

## Why this configuration

**An ordinary dependency can bring a second copy.** When package A lists package B as an ordinary dependency, the package manager gives A its own copy of B whenever the version A asks for differs from one already installed. An application on release `8.4` that adds an extension built for `8.3` would get:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the client registers data types here
└── @prisma/orm-extension-pgvector      8.3.0
    └── node_modules/
        └── @prisma/orm-framework       8.3.0   ← pgvector registers `vector` here
```

**A peer dependency cannot.** When A lists B as a peer, the package manager never gives A its own copy: A uses the application's. So every package of ours names the others only as peers.

**The application has to declare them.** Yarn, in both its `node_modules` mode and its Plug'n'Play mode, installs no peer dependencies: a peer the application does not declare is missing, and the package that needs it cannot load. npm, pnpm and Bun install a missing peer by themselves, but without a line in `package.json` a later update can move one package and leave the others behind.

**It was tested before it was chosen.** Six ways of arranging the dependencies were tried with stand-in packages on a local registry, under npm, pnpm, Yarn in both modes and Bun in both modes, in cases where an extension, a platform package or the facade was at another version than the rest. Two gave one copy, or a reported mismatch, under all of them: this one, and one in which an extension names only the facade, which ties the extension to that facade. The other four are under "Alternatives considered", with what went wrong.

Two further benefits follow. **The package manager checks the versions:** when the application's lines and a package's peer ranges disagree, npm refuses the install, and pnpm, Yarn and Bun install and print a warning. **One package can be released alone** whenever the ranges admit more than one version: a package that names another as a peer accepts any version its range allows, so a fix to one package does not force a release of the others.

## Consequences

- **An application's `package.json` is longer:** five lines of ours for PostgreSQL where one would do if the facade brought the rest. `init` writes them.
- **A warning is easy to miss.** Three of the four package managers install a mismatched set with only a warning, so an install that succeeds does not prove the versions match. The user reads peer warnings and corrects their lines.
- **A facade can name another facade.** `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`, so a MariaDB application lists both facades and both target packages.
- **A program that carries its own toolchain declares the framework too.** The `prisma` command-line tool and Prisma Composer (Prisma's deployment tool) each install `@prisma/orm-toolchain` as their own dependency, at their own version. The toolchain names the framework as a peer, so each of them declares `@prisma/orm-framework` beside it. Their copy runs the commands and is not part of the application's runtime, where the one-copy rule matters. How the command-line tool works with an application on another version is decided separately.
- **Generated files import from the facade and the extensions**, which the application declares, so that application code and generated files name the same packages.
- **The database driver is declared the same way.** [ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) made it a peer of the package that uses it, for the same reasons: the user sees it in their own list, and a conflict shows at install.
- **A monorepo with applications on different versions can still get two copies.** npm workspaces and Bun's hoisted mode put a package once at the repository root when the workspaces ask for the same version of it:

  ```text
  node_modules/
  ├── @prisma/orm-framework              8.3.0   ← app-a's
  └── @prisma/orm-extension-pgvector     8.3.0   ← shared by both apps, so it sees 8.3.0
  apps/app-b/node_modules/
  └── @prisma/orm-framework              8.4.0   ← app-b's client registers here
  ```

  In app-b, the extension registers into one copy and the client looks in the other, and nothing reports it. pnpm, Yarn and Bun's isolated mode keep each workspace's packages apart and do not have this problem. A monorepo keeps its applications on one version of Prisma, or uses one of those package managers. No arrangement of dependencies changes where a package manager puts a package.

## Alternatives considered

The first five were tried in the install trial described above; the sixth came from a second trial, and the last from experience.

- **Ordinary dependencies, with an extension naming only the target package as a peer.** The application declares only the facade, which brings the platform packages; an extension brings the framework and family itself. An extension from another release gave two copies under every package manager, as in the tree above; pnpm, Yarn and Bun printed a warning about the target package, and none prevented it.
- **The facade brings the platform packages as ordinary dependencies; extensions name them as peers.** Under npm, the facade's copies sit inside the facade's own folder, where the extension cannot see them, so the extension's peers got a second copy at the top level, with no warning. Under Yarn's Plug'n'Play mode the extension could not load, because the application does not declare what it names as peers.
- **Peers everywhere, but the application declares only the facade.** Yarn installs no peer that is not declared, so the facade could not load its platform packages, and Bun gave two copies with an extension from another release.
- **An extension names only the facade as its peer and reaches the platform packages through it.** One copy in every case, but a PostgreSQL extension would then work with one facade only, and not with another facade built on the PostgreSQL target package.
- **An extension names only the target package as its peer, and reaches the framework and family through it.** One copy in most cases. When the application's lines for the facade and the target package disagreed, npm refused the install and the others gave two copies with a warning. When the application did not declare the target package, Yarn could not load it and Bun gave two copies.
- **The platform packages name each other as ordinary dependencies, and only facades and extensions use peers.** The platform packages then bring copies of each other. Two copies under Bun when one platform package was updated alone, and under Yarn on a fresh install when a newer version of a platform package existed than the one the application declared.
- **Detect a second copy when the application starts, and stop.** Prisma Composer deliberately loads a second copy of the ORM beside the application, so the check stopped working applications. A check that reports only two copies that are actually used together is a separate decision.
