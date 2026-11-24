# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Replaces part of:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md): that an application installs one package of ours, and that our packages bring each other as ordinary dependencies
**Related:** [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md), [ADR 324 — Generated files import from the module the facade names](ADR%20324%20-%20Generated%20files%20import%20from%20the%20module%20the%20target%20package%20names.md), [ADR 325 — `init` gets everything about a database from the facade](ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md), [ADR 328 — A library integration uses only published entrypoints](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md)

## At a glance

An application must hold exactly one copy of the Prisma framework. Here is what goes wrong when our packages bring each other as ordinary dependencies, and an application on release `8.4` adds an extension built for `8.3`:

```text
node_modules/
├── @prisma/orm-postgres                8.4.0
├── @prisma/orm-framework               8.4.0   ← the client registers data types here
└── @prisma/orm-extension-pgvector      8.3.0
    └── node_modules/
        └── @prisma/orm-framework       8.3.0   ← pgvector registers `vector` here
```

The client and the extension each see a different framework. The client never learns about the `vector` type, and nothing reports it.

So no package of ours brings a copy of another. Each names the others as **peer dependencies**, and the application lists them all:

```jsonc
// the application's package.json
"dependencies": {
  "@prisma/orm-postgres": "^8.4.0",            // the facade: what application code imports
  "@prisma/orm-framework": "^8.4.0",           // ┐
  "@prisma/orm-family-sql": "^8.4.0",          // │ the platform packages the facade
  "@prisma/orm-target-postgres": "^8.4.0",     // │ names as peers
  "@prisma/orm-toolchain": "^8.4.0",           // ┘
  "@prisma/orm-extension-pgvector": "^8.3.0",
  "pg": "^8.22.0",                             // required peers that are not ours
  "temporal-polyfill": "^1.0.8"
}
```

Now there is one place a copy can come from, the application's own list, and the installed tree has one framework. `prisma orm init` writes these lines. Application code does not change: it imports from `@prisma/orm-postgres` and from the extensions, never from a platform package.

## The packages involved

| Kind | Example | What it is |
| --- | --- | --- |
| **Facade** | `@prisma/orm-postgres` | What an application installs for its database. One function in it wires the framework, family, target, adapter and driver together, and it re-exports everything application code imports. |
| **Platform packages** | `@prisma/orm-framework` | The core, shared by every database. It holds the registries of data types (codecs) and operations that extensions add to. |
| | `@prisma/orm-family-sql` | What all SQL databases share. MongoDB has its own family. |
| | `@prisma/orm-target-postgres` | The PostgreSQL **target package**: what is specific to PostgreSQL. |
| | `@prisma/orm-toolchain` | The `prisma orm` commands: emitting the contract, migrations. |
| **Extension** | `@prisma/orm-extension-pgvector` | Adds data types or operations, built on the platform packages. |
| **Library integration** | `@prisma/orm-better-auth` | Connects an outside library to an application's Prisma client. |

## Decision

1. **Every package we publish names every other package of ours that it uses as a peer dependency, never as an ordinary dependency.** This holds for a facade, an extension, a library integration, and between the platform packages themselves.
2. **An application lists its facade and every platform package the facade names**, directly or through another platform package. It also lists the required peers that are not ours, such as the database driver.
3. **`prisma orm init` writes those lines.** After installing the facade, it reads the peer dependencies from the facade's installed `package.json`, then from each `@prisma/orm-*` package named there, until no new name appears, and installs each one with the other required peers those manifests name. It does not follow the peers of packages that are not ours: those are other projects' choices, and a package manager that installs peers handles them.
4. **The build refuses a manifest that breaks the first rule.** For each published package, the build works out which packages of ours its built code imports, and fails unless the manifest names exactly those as peers. A second check, before publishing, fails if any published package lists one of ours under `dependencies`.
5. **An extension names the platform packages it uses, not a facade.** A PostgreSQL extension therefore works with any facade built on the PostgreSQL target package. An extension that imports a facade's own code names that facade as a peer, and then works only with it; `@prisma/orm-extension-supabase` is such a package.

The range each package writes on another, and the range an application writes, are set by the versioning rules in [Versioning](../../oss/versioning.md). This record decides only that the relation is a peer.

## Why

**A package manager decides how many copies there are.** When package A lists package B as an ordinary dependency, the package manager gives A its own copy of B whenever the version A asks for differs from one already installed. That is the tree at the top of this record. When A lists B as a peer, the package manager never gives A its own copy: A uses the copy the application has. With every package of ours naming the others only as peers, the application's list is the only place a copy can come from.

**The application has to list them.** Yarn (both its `node_modules` mode and its Plug'n'Play mode) installs no peer dependencies at all: a peer the application does not list is missing, and the package that needs it cannot load. npm, pnpm and Bun install a missing peer by themselves, but without a line in `package.json` a later update can move one package and leave the others behind. So the application lists every one, and `init` writes them.

**The package manager now checks the versions.** When the application's lines and a package's peer ranges disagree, npm refuses the install and pnpm, Yarn and Bun install and print a warning. With ordinary dependencies, the same disagreement installs a second copy and says nothing.

**It lets one package be released alone.** A package that brings its own copy of another can only work with that one copy. A package that names it as a peer accepts any version its range allows, so a fix to one package does not force a release of the others.

**It was tested before it was chosen.** Six ways of arranging the dependencies were tried with stand-in packages on a local registry, under npm, pnpm, Yarn in both modes and Bun in both modes, in cases where an extension, a platform package or the facade was at another version than the rest. This arrangement was the simplest that gave one copy, or a reported mismatch, under all of them. The arrangements that failed are listed under "Alternatives considered", each with the reason.

## Consequences

- **An application's `package.json` is longer:** five lines of ours for PostgreSQL where one would do if the facade brought the rest. `init` writes them.
- **A warning is easy to miss.** Three of the four package managers install a mismatched set with only a warning, so an install that succeeds does not prove the versions match. The user reads peer warnings and corrects their lines.
- **A facade can name another facade.** `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`, so a MariaDB application lists both facades and both target packages.
- **A program that carries its own toolchain lists the framework too.** The `prisma` command-line tool and Prisma Composer (Prisma's deployment tool) each install `@prisma/orm-toolchain` as their own dependency, at their own version. The toolchain names the framework as a peer, so each of them lists `@prisma/orm-framework` beside it. Their copy is not part of the application's runtime, where the one-copy rule matters: it runs the commands. How the command-line tool works with an application on another version is decided separately.
- **Generated files import from the facade and the extensions**, which the application lists. The facade's own module for generated files ([ADR 324](ADR%20324%20-%20Generated%20files%20import%20from%20the%20module%20the%20target%20package%20names.md)) stays, so that application code and generated files name one package.
- **A monorepo with applications on different versions can still get two copies.** npm workspaces and Bun's hoisted mode put a package once at the repository root when the workspaces ask for the same version of it:

  ```text
  node_modules/
  ├── @prisma/orm-framework              8.3.0   ← app-a's
  └── @prisma/orm-extension-pgvector     8.3.0   ← shared by both apps, so it sees 8.3.0
  apps/app-b/node_modules/
  └── @prisma/orm-framework              8.4.0   ← app-b's client registers here
  ```

  In app-b, the extension registers into one copy and the client looks in the other, and nothing reports it. pnpm, Yarn and Bun's isolated mode keep each workspace's packages apart and do not have this problem. A monorepo keeps its applications on one version of Prisma, or uses one of those package managers. No arrangement of dependencies changes where a package manager puts a package.

## Earlier records

- **[ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)** said an application installs one facade and names nothing else of ours, that the facade brings the platform packages as ordinary dependencies, and that an extension holds the framework and the family as ordinary dependencies and only the target as a peer. This record replaces all three, and with them ADR 242's section on replacing a facade's wiring: an application that does so already lists the platform packages, and drops the facade from its list. ADR 242's reason for the one-package rule was that a user who listed several packages had to keep their versions right by hand, and got a silent second copy when wrong. With peers, the package manager checks the versions. The rest of ADR 242 stands: the split into packages, one published home for each module, and the facade re-exporting everything application code imports.
- **[ADR 328](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md)** has a library integration name the framework and the family as peers so that the package manager reports a mismatch. That is this rule, applied to one kind of package.
- **[ADR 325](ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md)** says `init` does not work out a package's peers, because that is the package manager's work. Yarn does not do that work, so `init` reads the required peers from the installed manifests, as decided above. `init` still takes the driver's name from the facade's init contribution (what a facade exports to tell `init` how to set up a project), because it needs that name before the facade is installed.
- **[ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md)** made the database driver a peer of the package that uses it, for the same two reasons: the user sees it in their own list, and a conflict shows at install.

## Alternatives considered

- **Every package names the others as ordinary dependencies.** This was ADR 242's arrangement. Each package gets its own copy whenever its version differs from the application's, which is the tree at the top of this record. Two copies under every package manager, with no report.
- **The facade brings the platform packages as ordinary dependencies; extensions name them as peers.** Under npm, the facade's copies sit inside the facade's own folder, where the extension cannot see them, so the extension's peers get a second copy at the top level, with no warning. Under Yarn the extension cannot load at all, because the application does not list what it names as peers.
- **Peers everywhere, but the application lists only the facade.** Yarn installs no peer that is not listed, so the facade cannot load its platform packages.
- **An extension names only the facade as its peer and reaches the platform packages through it.** One copy everywhere, but a PostgreSQL extension would then work with one facade only, and not with another facade for PostgreSQL.
- **The platform packages name each other as ordinary dependencies, and only facades and extensions use peers.** The platform packages then bring copies of each other. Two copies under Bun when one platform package was updated alone, and under Yarn on a fresh install when a newer version of a platform package existed than the one the application listed.
- **Detect a second copy when the application starts, and stop.** Prisma Composer deliberately loads a second copy of the ORM beside the application, so the check stopped working applications. A check that reports only two copies that are actually used together is a separate decision.
