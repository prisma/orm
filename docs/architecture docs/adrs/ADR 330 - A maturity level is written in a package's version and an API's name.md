# ADR 330 — A maturity level is written in a package's version and an API's name

**Status:** Accepted
**Date:** 2026-11-25
**Related:** [ADR 329 — An application lists the platform packages, and our packages name each other as peers](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)

## At a glance

A user reads two things in their own project to learn how finished a part of Prisma is:

```jsonc
// package.json, at release 8.3
"@prisma/orm-postgres": "^8.3.0",          // Generally Available
"@prisma/orm-mongo": "~8.3.0-preview.1",   // Preview
"@prisma/orm-mysql": "~8.3.0-ea.0"         // Early Access
```

```ts
db.orm.users.where({ email }).first()  // Generally Available: a plain name in a GA package
db.orm.users.preview_foo(...)          // Preview: the name says so, inside a GA package
```

`preview_foo` only shows the form; no such API exists.

## Decision

Prisma has one scale of maturity with four levels: Early Access, Preview, Release Candidate and Generally Available (GA). "Below GA" means any of the first three. The scale applies to a package and to a single API. A level is decided in two places and nowhere else: a package's version number, and the start of an API's name. A README or a docs page may state a package's level, and a check keeps each README in step with the declaration; neither is where the level is decided.

Three kinds of package are named below. A **target package** is the one an application installs for its database, such as `@prisma/orm-postgres`. The **platform packages** are the ones extension authors build against: `@prisma/orm-framework`, `@prisma/orm-toolchain`, and the family and target packages such as `@prisma/orm-family-sql` and `@prisma/orm-target-postgres`. A **library integration** connects an outside library to an application's client, such as `@prisma/orm-better-auth`.

All our packages share one release number, the major and the minor. The rest of a version is each package's own. One package is outside both: `@prisma/orm-extension-paradedb` has no level and its own version, starting at `0.1.0`. Its own team is to take it over and maintain it outside this repository, on a date that is not set. It names our packages as any extension does.

### What a level tells a user

- how far they can rely on the package or API to work, and
- whether a later release within the same major version may break their use of it. Only what is GA is kept compatible.

### The levels

A level is defined by the least we do for a package or API at it, not by a description of its quality.

| Level | What we do, at least |
| --- | --- |
| Generally Available | Its tests run on every release and a failure blocks the release. A package for a database passes the full test suite against that database. A later release in the same major version does not break its users. |
| Release Candidate | As for GA, and we expect to make no further change that breaks its users. It may still change before it is GA. |
| Preview | Its tests run and a failure blocks the release, for what it supports. Its reference documentation lists what it does not yet support; the maintainers decide that list. It may change in any release. |
| Early Access | Released so that people can try it. We may release it with a failing test. It may change in any release. |

Four points follow from these definitions and from the rule below that a package names only packages at its own level or above. A fifth is not decided:

- **Which release a failing test blocks.** At each release number our packages are released together, so a failing test of a GA, Release Candidate or Preview package blocks that release for all of them. Early Access is the one level at which we may release with a failing test. That is permitted, not required: today every package's tests block.
- **Who decides what a Preview package supports.** Its maintainers, in the list its reference documentation carries. The list for each package that is Preview at `8.0.0` is written before `8.0.0` is released.
- **A package that has no database of its own**, such as the framework, has the level of the most mature package that names it. The framework is GA when the first target package is.
- **When a level can change.** A package below GA can move to a higher level in any release, and to a lower level only at a new release number, because its version within one minor can only move forward.
- **Not decided: whether a GA package can go below GA again.** It bears on what GA promises. Until it is decided, the release scripts refuse it.

### What has a level

- **A package.** Every published package has a level, except the one named above. A database's level is the level of its target package, so each database reaches GA on its own date. A target package is never at a higher level than the platform packages it names.
- **An API.** An API is an export, or a member of one, such as a method, a property or an option. An API has the level of its package unless its name starts with the word for a lower level. A member of an API below GA has at least that API's level.

A name can only lower a level. A GA API cannot exist inside a package below GA, because the package's version already says that nothing in it is kept compatible.

Nothing else has a level. An entrypoint (a path inside a package that code imports from, such as `@prisma/orm-toolchain/config-loader`) has none: everything it exports has the level of the package, or the lower level in its own name. A capability has the level of the package that publishes it.

**A GA package of ours names only GA packages of ours.** A package cannot be relied on further than what it is built on. For the same reason, a package at any level names only packages at its own level or above. The build checks it.

### How a level is written

| Level | In a package's version number | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.3.0` | Nothing: `foo` |
| Release Candidate | `8.3.0-rc.0` | `rc_foo` |
| Preview | `8.3.0-preview.0` | `preview_foo` |
| Early Access | `8.3.0-ea.0` | `ea_foo` |

Where a name is not a TypeScript identifier, the same word is used with that kind of name's own separator: a command-line flag is `--preview-foo`, a config option is `previewFoo`.

When an API below GA becomes GA, the plain name is added, and the old name keeps working until the next major version.

### Version numbers

- **The major and minor are the release number.** Release `8.3` publishes every package at `8.3`.
- **A GA package has its own patch number.** A fix to one GA package raises that package's patch number, to `8.3.1`, and no other package's.
- **A package below GA carries its level as a suffix, with its own counter.** A fix to it raises the counter, `8.3.0-preview.1`, and not the patch number, so that a user's range can select it.
- **The suffix is what Semantic Versioning calls a pre-release.** A range such as `^8.0.0` never selects one, so a user gets a release below GA only by asking for it. The words sort in the right order: `ea`, `preview`, `rc`, then the plain version.

### Ranges between our packages

The ranges are computed from the release number and the levels by the script that sets versions, and the build refuses a manifest that disagrees. Nobody writes one by hand.

| From | To | Range |
| --- | --- | --- |
| A target package or a platform package | A GA package | Same minor, any patch: `~8.3.0` |
| A target package or a platform package | A package below GA | The same, from that package's first version of the minor: `~8.3.0-ea.0` |
| An extension or a library integration | A GA package | That release or any later one in the major version: `^8.3.0` |
| An extension or a library integration | A package below GA | Within the minor, from that package's first version of it: `~8.3.0-ea.0` |

An extension's range on a GA package is wider than a target package's because of who must keep working. An extension built on release `8.1` has to work in an application on `8.4`, so it accepts any later release. The packages of one release are tested together, so among themselves they accept only that release. A package below GA may change in the next minor, so nothing accepts more than one minor of it.

### Tags

- A GA release is published under the `latest` tag.
- A release below GA is published under `latest` when the package has never had a GA release in any major version, so that a plain install works and the version shows the level. The `0.x` versions published before `8.0.0` were not GA releases and do not count. Otherwise it is published under a tag named after its level.

### What an application writes

- On a GA target package: a caret on every `@prisma/orm-*` line, `^8.3.0`. An update moves all of them to the next release together.
- On a target package below GA: a tilde on every line, `~8.3.0-ea.0` and `~8.3.0`. A caret on a pre-release never selects the next minor's pre-release, so with carets the GA lines would move to `8.4` and the target package could not follow. At each new minor the user edits the lines to the new minor by hand. A package manager's command that updates to the latest version is not a substitute: under some package managers it rewrites the tildes as carets, and the next update then moves the GA lines without the target package.

`prisma orm init` writes the lines this way when it adds the target package itself. When the project already lists the target package, `init` leaves that line as the user wrote it and writes each platform package at the range the installed target package declares for it, so that it never installs a platform package the user's target package does not accept.

### Packages maintained outside this repository

We recommend the same convention to their maintainers. The major and minor are the first release of ours the package works with, and the patch number is the maintainer's own. The number means "needs at least this release", not "must equal it": a package at `8.1.2` declares `^8.1.0` on our packages and works in an application on `8.4`. A package that uses an API below GA declares a range within one minor on the package that has it, because that API may change in the next.

Two costs for such a maintainer follow: a feature of theirs that needs no newer release of ours ships as a patch, and they cannot make a breaking change of their own inside our major version once their package is GA.

### No feature flags

Prisma 8 has no feature flags. Functionality that is not ready for GA ships in its own package below GA, or as an API whose name carries its level. A change that cannot be an extension, such as a different default in the core, ships as a new API beside the old one or waits for the next major version.

### The release candidates of `8.0.0`

Until `8.0.0`, every package is published as `8.0.0-rc.N` whatever its real state, each names the others at that exact version, and none is kept compatible with the next. The rules above take effect at `8.0.0`. The release scripts compute both from one function.

### A second scale that is not this one

A public issue on this repository describes three categories of support for a database, a runtime or a framework: First-Class, Supported and Unofficial. That scale says where the maintainers spend effort and how they answer issues. A maturity level says how finished one package is. Neither decides the other: a database we treat as First-Class can have an Early Access package while that package is being built.

## Consequences

- No file in the repository, no documentation page and no import path is the place a user learns what is kept compatible. A doc may describe a level; the version and the name decide it.
- There is no second word, such as "experimental", "unstable" or "proof of concept", for what is not finished.
- The packages no longer all share one version, so one read of the root `package.json` gives the release number and not every package's version.
- Moving an API to GA changes its name, and the old name stays until the next major version.
- A user of a package below GA edits their version lines at each new minor.

## Earlier records

- **ADR 017** (extension compatibility) gives the contract format, the plan model, the hook interface and each adapter separate version numbers. Only the contract's format version was built. The rest is replaced by this record: the platform packages share one release number.
- **ADR 016** (SQL lowering) describes a feature flag for changes to generated SQL. There are no feature flags.
- **ADR 242** said publishing is one operation over all packages at one version. The packages are still released together at each release number, each at its own version.

## Alternatives considered

- **One version for every package, as during the release candidates.** A user cannot tell a finished package from an unfinished one, no database can be GA before all are, and a fix to one package needs a release of every package.
- **A separate word, such as `unstable_`, for an API that may change.** It gives users two scales that say almost the same thing, and "unstable" suggests the behaviour is unreliable when we mean only that the API may change. React marks APIs with `unstable_` and `experimental_`, separately from its release channels.
- **A maturity level on an entrypoint, written in the import path**, such as `@prisma/orm-toolchain/preview/config-loader`. An entrypoint's exports already get their level from the package's version and from their own names. A third place to write a level adds a third thing to learn, and every import of the entrypoint would have to change when it reached GA.
- **A file in the repository as the place a user learns what is kept compatible.** The package's version number and the API's name tell them, in their own project.
- **Feature flags for functionality that is not ready.** A package below GA and an API whose name carries its level are both visible in the user's own code, and a flag set somewhere in a config is not.
- **Each package numbered on its own, with no shared release number.** A user could not tell from two versions whether two packages belong together. AWS CDK numbers its experimental packages by the first release of the main library they work with, and the SQL Server adapter for Rails takes Rails's major and minor, for the same reason.
