# Design: version numbers, maturity levels, and how our packages depend on each other

The design for project 6 of the [plan](../plan.md). It holds only what has been agreed. The levels themselves are defined in [maturity-levels.md](../maturity-levels.md). The trial installs behind section 3 are recorded in [spikes/2026-11-24-one-copy-installs.md](../spikes/2026-11-24-one-copy-installs.md).

## 1. What a version number means

### 1.1 One release number, and a suffix below GA

All our packages are released together under one release number, shared at the major and the minor. A package below GA carries its level as a suffix.

```text
release 8.3
  @prisma/orm-postgres   8.3.0
  @prisma/orm-mysql      8.3.0-preview.0
```

A package's major and minor say which framework release it needs at least. The suffix says its maturity when it is not GA. The patch number is each package's own.

AWS CDK numbers its experimental packages this way: such a package's "version matches the first version of `aws-cdk-lib` it is compatible with, with an `alpha` sub-version". The adapter for SQL Server in Rails, which is maintained outside Rails, takes Rails's major and minor in the same way.

### 1.2 Packages maintained outside this repository

We recommend the same convention to maintainers of outside packages, such as the SQL Server target Microsoft is building: the major and minor are the first framework release the package works with, and the patch number is the maintainer's own.

The number means "needs at least this framework", not "must equal it". An outside package at `8.1.2` works in an application on framework `8.4`, as the compatibility policy promises. A user never waits for an outside maintainer before upgrading the framework.

The number is what a person reads. What a tool checks is the range the package declares on our packages, so the two should say the same thing: a package numbered `8.1.x` declares `^8.1.0`.

Two costs for the outside maintainer, which we accept on their behalf in recommending this: a feature of theirs that needs no newer framework ships as a patch, and they cannot make a breaking change of their own inside our major version once their package is GA.

## 2. The level of each package at `8.0.0`

Until now every package has carried the suffix `rc`, whatever its real state. From `8.0.0` the suffix says what [maturity-levels.md](../maturity-levels.md) defines.

| Level at `8.0.0` | Packages |
| --- | --- |
| GA | The PostgreSQL facade and everything it depends on, and pgvector and the other PostgreSQL extensions we maintain, except the two below |
| Preview | MongoDB. The Supabase extension: we expect to change it, and need real use and feedback first, which is not the priority before GA |
| Early Access | MySQL, MariaDB and SQLite |
| Outside the scale | The ParadeDB extension. It is deleted from this repository before GA, and the ParadeDB team takes it into a repository of their own, where section 1.2 applies to it. While it is still here it is numbered `0.x` |

### 2.1 Packages that move down from `rc`

MySQL is published today as `8.0.0-rc.25`, and `8.0.0-ea.0` sorts below it. So the move is made once, at `8.0.0`: each such package is published at its real level, its earlier release candidates are marked as deprecated on the registry with a message that says where the package went, and the upgrade instructions say so. A deprecated version stays installable and prints its message at install.

## 3. How the packages depend on each other

### 3.1 The requirement

An application must end up with exactly one copy of each platform package: the framework, the family, the target and the toolchain. The runtime keeps registries of codecs and operations in them, and two copies do not see each other.

The combination the policy promises must work: an extension built against `8.1` in an application on `8.4`.

### 3.2 The arrangement

- **The application lists the facade and every platform package it uses**, all written with the same kind of range.
- **The facade names the platform packages as peer dependencies.** It brings no copy of its own.
- **An extension names the platform packages it uses as peer dependencies**, with a caret range such as `^8.1.0`. It brings no copy of its own.
- **Inside the set, a package names the others with the same minor and any patch**, such as `~8.4.0`.

```json
{
  "dependencies": {
    "@prisma/orm-postgres": "^8.4.0",
    "@prisma/orm-framework": "^8.4.0",
    "@prisma/orm-family-sql": "^8.4.0",
    "@prisma/orm-target-postgres": "^8.4.0",
    "@prisma/orm-toolchain": "^8.4.0",
    "@prisma/orm-extension-pgvector": "^8.1.0"
  }
}
```

The reason: a package manager looks for a peer in the application's own list. So the application's list is the one place every package manager respects, and with everything else deferring to it there is nothing left for a package manager to choose.

This is the simplest arrangement that gave one copy under every package manager in the trial. It may be made lighter for the user later, in a way that stays compatible: a user would then delete lines they no longer need.

### 3.3 Why not the alternatives

- **Exact versions everywhere, as today.** An extension from `8.1` brings its own `8.1` copies into an application on `8.4`: two copies under every package manager. It also means a correction to one package needs a release of every package that names it, in this repository and in the command-line tool's and Composer's.
- **The facade brings the platform packages, and extensions ask for the application's copy.** Two copies under npm with no warning, and broken under yarn's strict mode.
- **The same as section 3.2, but the application lists only the facade.** Yarn does not install a peer that is not listed, so the facade cannot load its own platform packages.
- **An extension names the facade as its peer.** It gave one copy everywhere, but it ties an extension to one facade. A PostgreSQL extension would then not work with another facade on the same target, such as Supabase's, for no good reason.

### 3.4 What this changes in the policy and the records

The policy says an application depends on one facade, on the extension packages it installs and on the command-line tool, "and on nothing else from us". Under this design it also lists the platform packages. Application code still imports from the facade. The decision record on the published packages rejected listing them, because the user would have to keep the combination right by hand; here the facade's own peer ranges make the package manager check the combination.

## 4. The command-line tool

- **It runs independently.** It may be run outside a project, so it carries its own copy of the packages it needs.
- **It accepts anything that satisfies its interfaces.** Its copy and the project's copy meet when it loads the project's config file. What crosses there is accepted by its shape, not by which copy made it. The repository's guidance against `instanceof` and identity checks exists for this reason.
- **It has the same major and minor as the library in the project.** When they differ, it stops and says which version to install. The policy said only the same major. The reason for the minor: the tool's own copy emits the contract and its types, which the project's library then reads, and the tool reads what the project's config produces. If the tool is newer, the library reads what a later release wrote. If the tool is older, the tool does. Neither direction is promised. With the same major and minor, every direction is covered. The patch may differ.
- **It reports newer versions.** It checks whether newer versions of any Prisma package exist within the ranges the user has written, and says so.

A consequence: the `prisma` package, which is released from another repository on its own numbers today, takes the release number's major and minor.

## 5. Details

- **A fix to a package below GA raises its suffix counter**, `8.3.0-preview.1`, and not its patch number. A user's range can then select it.
- **A package that has never had a GA release** has its newest release under the `latest` tag, so that a plain install works and the version shows its level.
- **A release of an older major version always names its tag**, so that it cannot take `latest` back from the current major.
- **An outside package that uses an API below GA** declares a range within one minor on the package that has it.
- **A level on something that is not a TypeScript name**, such as a command-line flag or a config option, uses the same word with that thing's own separator: `--preview-foo`, `previewFoo`.
- **When an API below GA becomes GA**, the plain name is added, and the old name keeps working until the next major version.
- **Updating the upgrade skills** happens before GA, as the [plan](../plan.md) says.

These settle the points that section 6 of [maturity-levels.md](../maturity-levels.md) lists as not decided, except the full definition of each level and how the levels relate to the support categories in prisma/orm#25843, which are this project's work.

## 6. Left to the project

- Running the install trial again for packages below GA, with their suffixed versions, and for a monorepo with applications on different minors.
- A check at run time that reports a value from one copy being handed to another that cannot accept it. A ticket for it exists.
