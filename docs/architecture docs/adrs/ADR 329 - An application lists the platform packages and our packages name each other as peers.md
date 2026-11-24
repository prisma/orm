# ADR 329 — An application lists the platform packages, and our packages name each other as peers

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 219 — Database driver coupling](ADR%20219%20-%20Database%20driver%20coupling.md), [ADR 328 — A library integration uses only published entrypoints](ADR%20328%20-%20A%20library%20integration%20uses%20only%20published%20entrypoints%20and%20its%20models%20live%20in%20the%20application%20contract.md)

## At a glance

A PostgreSQL application with the pgvector extension lists six Prisma packages:

```json
{
  "dependencies": {
    "@prisma/orm-postgres": "8.0.0-rc.26",
    "@prisma/orm-framework": "8.0.0-rc.26",
    "@prisma/orm-family-sql": "8.0.0-rc.26",
    "@prisma/orm-target-postgres": "8.0.0-rc.26",
    "@prisma/orm-toolchain": "8.0.0-rc.26",
    "@prisma/orm-extension-pgvector": "8.0.0-rc.26"
  }
}
```

`@prisma/orm-postgres` is the **target package**: the package an application installs to use a database, which ADR 242 calls the facade. The next four are the **platform packages**: the framework, the SQL family, the PostgreSQL target and the toolchain. They are the packages extension authors build against.

Every line names the same version, and each package names its peers at that one exact version. Prisma 8 is released as release candidates, and one release candidate may break another, so a range between our packages would promise something false.

None of the six brings a copy of another. `@prisma/orm-postgres` publishes:

```json
{
  "peerDependencies": {
    "@prisma/orm-family-sql": "8.0.0-rc.26",
    "@prisma/orm-framework": "8.0.0-rc.26",
    "@prisma/orm-target-postgres": "8.0.0-rc.26",
    "@prisma/orm-toolchain": "8.0.0-rc.26"
  }
}
```

and so does every other package: the extension names the platform packages it uses as peers, and the platform packages name each other as peers.

`prisma orm init` writes the list. Application code still imports from `@prisma/orm-postgres` and from the extensions, never from a platform package: listing a package is about which copy is installed, and the target package still re-exports everything an application uses, so tutorials, generated files and application code name one package.

## Decision

1. **An application lists its target package and every platform package the target package needs.** `prisma orm init` writes them. It reads the names from the peer dependencies of the target package it installed, and from the peer dependencies of each of those, until no new `@prisma/orm-*` name appears.
2. **Every package we publish names every other package of ours that it uses as a peer dependency.** None is an ordinary dependency of another. This holds for a target package, for an extension, for a library integration, and between the platform packages themselves.
3. **The build refuses a manifest that disagrees.** For each package it computes the packages of ours that the package's code reaches, and fails unless the manifest names exactly those as peers. A check before publishing fails when any published package has one of ours under `dependencies`.
4. **An extension is not tied to a target package.** It names the platform packages it uses. A PostgreSQL extension therefore works with any target package built on the PostgreSQL target. One extension is an exception today: `@prisma/orm-extension-supabase` imports `@prisma/orm-postgres` and names it as a peer.

## Why

The runtime keeps registries of codecs and operations in the platform packages, and recognises some values by the class that made them. Two copies of a platform package in one application do not see each other: a codec registered in one is missing from the other, and nothing reports it. So an application must have exactly one copy of each.

A package manager decides how many copies there are. It gives a package its own copy of anything the package lists as an ordinary dependency, whenever the version the package asks for differs from one already installed. It never gives a package its own copy of a peer: it looks for a peer in the application's own list. So when every one of our packages names the others only as peers, the application's list is the one place a copy can come from, and there is nothing left for a package manager to choose.

This was tried with stub packages on a local registry, under npm, pnpm, Yarn with both of its linkers, and Bun with both of its linkers. It was the simplest arrangement that gave one copy under all of them.

The arrangement also makes it possible to release a package without the others, once the packages name each other with ranges and not exact versions. A package that brings its own copy of another can never accept a different version of it. A package that names it as a peer can, as soon as its range allows one. While every version is exact, all the packages are still released together.

## Consequences

- **The package manager checks the combination.** When the application's list and a package's peers disagree, npm refuses the install, and pnpm, Yarn and Bun report the mismatch. The user corrects their list.
- **An application's `package.json` is longer.** Five lines for PostgreSQL where one would do if the target package brought the rest. `prisma orm init` writes them, and the upgrade instructions add them to an existing application.
- **Every package manager needs the full list.** Yarn installs no peer dependencies. An application under Yarn that lists only the target package cannot load. npm and pnpm install a missing peer by themselves, which hides the gap until the project moves to another package manager. This is why `init` writes every name.
- **A package that carries its own toolchain lists the framework too.** The `prisma` command-line tool and Prisma Composer each carry their own copy of `@prisma/orm-toolchain`. The toolchain names the framework as a peer, so each of them lists `@prisma/orm-framework` beside it.
- **Generated files are unchanged.** `contract.d.ts` and migration files import from the target package and the extensions, which the application lists.
- **A target package can name another target package.** `@prisma/orm-mariadb` is built on `@prisma/orm-mysql`, so a MariaDB application lists both, and both targets.
- **A monorepo with applications on different versions can still get two copies.** npm workspaces, and Bun with its hoisted linker, place a package once for the whole repository when two workspaces ask for the same version of it. An extension that both applications use is then placed beside one application's platform packages, and the other application's target package and extension hold different copies. Nothing reports it. pnpm, Yarn, and Bun with its isolated linker keep each workspace's packages apart and do not have this problem. A monorepo keeps its applications on one version of Prisma, or uses a package manager that keeps them apart.

## Earlier records

- **ADR 242** said an application installs one target package and names nothing else of ours, and that the target package brings the platform packages as ordinary dependencies at an exact version. This record replaces both statements, and with them ADR 242's section on decomposing a facade: an application that replaces the target package's wiring already lists the platform packages, and drops the target package from its list. ADR 242's reason for the first one was that a user who listed the platform packages had to keep the combination right by hand, and a wrong combination gave two copies silently. With peers, a wrong combination is reported at install. The rest of ADR 242 stands: the package split, one published home for every module, and that the target package re-exports everything application code imports.
- **ADR 242** also said an extension holds the framework and the family as ordinary dependencies and only the target as a peer. All of them are peers now.
- **ADR 328** says a library integration names the framework and the family as peers so that the package manager reports a mismatch. That is this rule, applied first there.
- **ADR 219** made the database driver a peer of the package that uses it, for the same two reasons: the user sees it in their own list, and a conflict shows at install time.

## Alternatives considered

- **Every package names the others as ordinary dependencies.** An extension built for one release brings its own copies of the platform packages into an application on another release: two copies under every package manager, with no report. With exact versions that is every release; with ranges it is every case in which the application's lockfile holds an older version than the newest one the extension's range allows.
- **The target package brings the platform packages, and extensions ask for the application's copy.** Two copies under npm with no warning, and broken under Yarn's strict mode, because the application does not list what the extension asks for.
- **Every package names the others as peers, and the application lists only the target package.** Yarn does not install a peer that is not listed, so the target package cannot load its own platform packages.
- **An extension names the target package as its only peer and reaches the platform packages through it.** One copy everywhere, but it ties an extension to one target package. A PostgreSQL extension would then not work with another target package built on the PostgreSQL target, for no good reason.
- **The platform packages name each other as ordinary dependencies, and only the target package and extensions use peers.** Two copies under Bun after updating one platform package alone, and under Yarn on a fresh install when a newer version of a platform package exists than the one the application lists.
