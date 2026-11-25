# ADR 330 — A maturity level is written in a package's version and an API's name

**Status:** Accepted
**Date:** 2026-11-25
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 017 — Extension compatibility policy](ADR%20017%20-%20Extension%20Compatibility%20Policy.md), [ADR 016 — Adapter SPI for lowering](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md), [ADR 329 — An application lists the platform packages, and our packages name each other as peers](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)

## At a glance

Two applications on release `8.3`. The first uses PostgreSQL, whose packages are Generally Available (GA). The second uses MySQL, whose facade is at Early Access:

```jsonc
// a PostgreSQL application                  // a MySQL application
"@prisma/orm-postgres":        "^8.3.0",     "@prisma/orm-mysql":        "~8.3.0-ea.0",
"@prisma/orm-framework":       "^8.3.0",     "@prisma/orm-framework":    "~8.3.0",
"@prisma/orm-family-sql":      "^8.3.0",     "@prisma/orm-family-sql":   "~8.3.0",
"@prisma/orm-target-postgres": "^8.3.0",     "@prisma/orm-target-mysql": "~8.3.0-ea.0",
"@prisma/orm-toolchain":       "^8.3.0"      "@prisma/orm-toolchain":    "~8.3.0"
```

The `-ea.0` in a version tells the user that the package is at Early Access and may change in any release. A plain version tells them it is GA and stays compatible until the next major version. The same holds for a single API inside a GA package:

```ts
db.orm.users.where({ email }).first()  // GA: a plain name in a GA package
db.orm.users.preview_search(...)       // Preview: the name says so
```

(`preview_search` only shows the form; no such API exists.)

## The problem

Prisma 8 supports several databases, and they are not equally finished. A user needs to see, in their own project, which parts they can rely on. If every package carried one version, three things would go wrong:

- A user could not tell a finished package from an unfinished one.
- No database could be GA before every database was.
- A fix to one package would need a release of every package.

## Decision

1. **One scale of maturity, with four levels:** Early Access, Preview, Release Candidate and Generally Available (GA). "Below GA" means any of the first three.
2. **A level is written in two places only:** a package's version number, and the start of an API's name. Docs may repeat a level, and a check keeps each package's README in step with the level the package declares in the release scripts, but neither is where it is decided.
3. **All our packages share a release number**, the major and the minor. The rest of a version is each package's own.
4. **The ranges between our packages, and the tag each package is published under, follow from the release number and the levels.** The release scripts compute them.
5. **No feature flags.** Functionality that is not ready ships in a package below GA, or as an API whose name carries its level.

## The levels

A level is defined by the least we do for a package or an API at that level.

| Level | What we do, at least |
| --- | --- |
| Generally Available | Its tests run on every release, and a failure blocks the release. A facade passes the full test suite against its database. A later release in the same major version does not break its users. |
| Release Candidate | As for GA. We expect no further breaking change, but one is still allowed before it is GA. |
| Preview | Its tests run, and a failure blocks the release, for what it supports. Its reference documentation lists what it does not yet support; its maintainers decide that list. It may change in any release. |
| Early Access | Released so that people can try it. It may be released with a failing test. It may change in any release. |

**A failing test blocks every package.** Our packages are released together at each release number, so a failing test of a package at Preview or above blocks the release for all of them. Early Access is the one level that may be released with a failing test; that is allowed, not required.

**A level can only move up within a release number.** A package's version within one minor can only move forward, and the levels sort upward (`ea`, `preview`, `rc`, then the plain version). A package below GA can therefore move up in any release, and down only at a new release number.

## What has a level

- **A package.** Every published package of ours has a level, with one exception below. A database's level is its facade's level, so each database reaches GA on its own date.
- **An API.** An API is an export, or a member of one, such as a method, a property or an option. It has its package's level unless its name starts with the word for a lower level. A member of an API below GA is at that API's level or lower.

A name can only lower a level. A GA API cannot exist inside a package below GA, because the package's version already says that nothing in it is kept compatible.

Nothing else declares a level. An entrypoint (a path inside a package that code imports from, such as `@prisma/orm-toolchain/config-loader`) and a capability (a feature a database supports, which a package declares) take their package's level.

**A package names only packages at its own level or above.** "Names" means lists as a dependency or a peer dependency. A package cannot be relied on further than what it is built on. So a GA package names only GA packages of ours, and a platform package, which has no database of its own, is at least at the level of the most mature facade or extension that names it. The build checks this.

## How a level is written

| Level | In a package's version | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.3.0` | Nothing: `search` |
| Release Candidate | `8.3.0-rc.0` | `rc_search` |
| Preview | `8.3.0-preview.0` | `preview_search` |
| Early Access | `8.3.0-ea.0` | `ea_search` |

Where a name is not a TypeScript identifier, the same word is used with that kind of name's own separator: a command-line flag is `--preview-search`, a config option is `previewSearch`.

**When an API moves up a level, it gets the name for the new level.** Below GA, the old name may be removed in the same release, since nothing below GA is kept compatible. When an API reaches GA, the plain name is added and the old name keeps working until the next major version, so that a user's code does not break on the day the API becomes stable.

## Version numbers

- **The major and minor are the release number.** Release `8.3` publishes every package at `8.3`.
- **A GA package has its own patch number.** A fix to one GA package raises that package's patch number, to `8.3.1`, and no other package's.
- **A package below GA has a suffix with its level and a counter.** A fix to it raises the counter, `8.3.0-preview.0` to `8.3.0-preview.1`, and not the patch number.

The suffix is what Semantic Versioning calls a pre-release, and package managers treat it specially:

- A range selects a pre-release only of the same major, minor and patch as the version the range starts from. `~8.3.0-preview.0` selects `8.3.0-preview.1` but never `8.4.0-preview.0`.
- A range on a plain version never selects a pre-release. `^8.3.0` never selects `8.4.0-preview.0`, so a user gets a release below GA only by asking for one.

That is why a fix below GA raises the counter: `8.3.1-preview.0` would sort above `8.3.0-preview.1`, but a user's `~8.3.0-preview.0` would not select it.

### Release `8.0`

Before levels existed, every package was published as `8.0.0-rc.N`. A version below GA with patch number 0 would sort below those: `8.0.0-ea.0` comes before `8.0.0-rc.26`, because `ea` sorts before `rc`. A user's `~8.0.0-ea.0` would then select the old release candidate. In a trial, Bun always installed it, Yarn did unless the release candidates were marked deprecated, and npm and pnpm did once `latest` pointed at a later minor.

So release `8.0` starts every package at patch 1, above the release candidates:

| Level | First version at release `8.0` | At a later release |
| --- | --- | --- |
| GA | `8.0.1` | `8.3.0` |
| Release Candidate | `8.0.1-rc.0` | `8.3.0-rc.0` |
| Preview | `8.0.1-preview.0` | `8.3.0-preview.0` |
| Early Access | `8.0.1-ea.0` | `8.3.0-ea.0` |

No package is published as `8.0.0`. The repository's version, the git tag and the GitHub release for the release are `8.0.1` as well, so the number announced is the number installed. Within release `8.0` a package is numbered as at any release: a fix raises a GA package's patch (`8.0.1` to `8.0.2`) and the counter of one below GA (`8.0.1-ea.0` to `8.0.1-ea.1`), and a package that moves up keeps patch 1 (`8.0.1-ea.1` to `8.0.1-rc.0`, then to `8.0.1`). The next release is `8.1.0`.

## Ranges between our packages

The ranges in our own packages' manifests are computed by the release scripts from the release number and the levels, and the build refuses a manifest that disagrees. They are never written by hand.

| From | To | Range |
| --- | --- | --- |
| A facade or a platform package | a GA package | Same minor, any patch: `~8.3.0` |
| A facade or a platform package | a package below GA | Same minor, from that package's first version of it: `~8.3.0-preview.0` |
| An extension or a library integration | a GA package | That release or any later one in the major version: `^8.3.0` |
| An extension or a library integration | a package below GA | Same minor, from that package's first version of it: `~8.3.0-ea.0` |

An extension accepts later releases of a GA package because an extension built on release `8.1` has to keep working in an application on `8.4`. The packages of one release are tested together, so among themselves they accept only that release. A package below GA may change in the next minor, so nothing accepts more than one minor of it.

## Tags

- A GA release is published under the `latest` tag.
- A release below GA is published under `latest` if the package has never had a GA release in any major version, so that a plain install works and the version shows the level. Otherwise it is published under a tag named after its level: `ea`, `preview` or `rc`.

A version published before release `8.0` says nothing about a package's level. The `8.0.0-rc.N` versions were published before the levels existed, and the `0.x` versions are Semantic Versioning's initial development; neither counts as a GA release.

## What an application writes

These rules cover the lines for our packages that share the release number.

- **With a GA facade:** a caret on every line, `^8.3.0`. An update moves all of them to the next release together.
- **With a facade below GA:** a tilde on every line, `~8.3.0-ea.0` and `~8.3.0`. A caret would let the GA lines move to `8.4` while the facade, a pre-release, could not follow. At each new release the user edits the lines to the new minor by hand. The package managers' update commands are not a substitute: pnpm's `update` rewrites a tilde on a pre-release as an exact version, which never moves again, and Yarn's update to the latest version writes a caret, so the next update moves the GA lines without the facade.

`prisma orm init` writes the lines this way when it adds the facade. When the project already lists the facade, `init` leaves that line as the user wrote it, and writes each platform package at the range the installed facade declares, so that it never installs a platform package the user's facade does not accept.

## Packages with their own version

**A package of ours that another team owns has its own version and no level.** It still names our packages at the ranges an extension uses. `@prisma/orm-extension-paradedb` is such a package, numbered from `0.1.0`.

**A package maintained outside this repository** is numbered by its maintainer. We recommend this convention: the major and minor are the first release of ours the package works with, and the patch number is the maintainer's own. The number then means "needs at least this release", not "must equal it": a package at `8.1.2` names our packages at `^8.1.0` and works in an application on `8.4`. A package that uses one of our APIs below GA names the package that has it at a range within one minor, because that API may change in the next. We recommend the same level suffixes to such maintainers; nothing enforces them.

Two costs follow for such a maintainer: a feature of theirs that needs no newer release of ours ships as a patch, and once their package is GA they cannot make a breaking change of their own within our major version.

## Not decided

**Whether a GA package can go below GA again.** Version numbers allow it at a new release number: `8.5.0-preview.0` sorts above `8.4.2`. It bears on what GA promises, and nobody has decided it. The release scripts refuse it until it is decided.

## Consequences

- **A user learns what is kept compatible from their own project:** the versions in their `package.json` and the names in their code. A document may describe a level, but it does not decide one.
- **There is no second word**, such as "experimental", "unstable" or "proof of concept", for what is not finished.
- **Our packages do not share one version.** The `version` in this repository's root `package.json` is the release number with a zero patch, and not every package's version.
- **Moving an API to GA changes its name**, and the old name stays until the next major version.
- **A user of a facade below GA edits their version lines at each new release.**

## A different scale

The public issue [Priorities & Operating Contexts](https://github.com/prisma/orm/issues/25843) describes three categories of support for a database, a runtime or a framework: First-Class, Supported and Unofficial. That scale says where the maintainers spend effort and how they answer issues. A maturity level says how finished one package is. Neither decides the other: a database we treat as First-Class can have an Early Access facade while that facade is being built.

## Alternatives considered

- **One version for every package.** A user cannot tell a finished package from an unfinished one, no database can be GA before all are, and a fix to one package needs a release of every package.
- **A separate word, such as `unstable_`, for an API that may change.** It gives users two scales that say almost the same thing, and "unstable" suggests the behaviour is unreliable when we mean only that the API may change. React marks APIs with `unstable_` and `experimental_` on top of its release channels, and users have to learn both.
- **A level on an entrypoint, written in the import path,** such as `@prisma/orm-toolchain/preview/config-loader`. An entrypoint's exports already get their level from the package's version and their own names. A third place to write a level is a third thing to learn, and every import would change when the entrypoint reached GA.
- **A support table in the docs as the place a user learns what is kept compatible.** It is one more thing to keep up to date, and the user does not see it in their project. The version and the name are in front of them.
- **Feature flags for functionality that is not ready.** A flag is set somewhere in a config; a package below GA and an API whose name carries its level are visible in the user's own code.
- **Release `8.0` numbered like every other release, `8.0.0-ea.0`, with the old release candidates marked deprecated.** Deprecation stops Yarn choosing an old release candidate, but not pnpm or Bun, and only npm and pnpm print the message.
- **Patch 1 at release `8.0` only for packages below Release Candidate,** with GA packages at `8.0.0` and a package at Release Candidate continuing the old counter at `8.0.0-rc.N`. It keeps the number `8.0.0`, but needs three rules for one release, the last release candidate's counter as an input, and a special case for a package that moves up within the release.
- **Each package numbered on its own, with no shared release number.** A user could not tell from two versions whether two packages belong together. AWS CDK numbers its experimental packages by the first release of the main library they work with, and the SQL Server adapter for Rails takes Rails's major and minor, for the same reason.
