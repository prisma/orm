# ADR 330 — A maturity level is written in a package's version and an API's name

**Status:** Accepted
**Date:** 2026-11-25
**Related:** [ADR 329 — An application lists the platform packages, and our packages name each other as peers](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) (the peer relations whose ranges this record sets), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published), [ADR 017 — Extension compatibility policy](ADR%20017%20-%20Extension%20Compatibility%20Policy.md) (what an extension may rely on)

## At a glance

Release `8.3` publishes the PostgreSQL packages, which are Generally Available (GA), and the MySQL packages, which are at Early Access:

```text
@prisma/orm-postgres   8.3.0          ← GA: kept compatible until the next major version
@prisma/orm-mysql      8.3.0-ea.0     ← Early Access: may change in any release
```

The user sees the level in their own `package.json`, in the lines `prisma orm init` writes:

```jsonc
// a PostgreSQL application                  // a MySQL application
"@prisma/orm-postgres":        "^8.3.0",     "@prisma/orm-mysql":        "~8.3.0-ea.0",
"@prisma/orm-framework":       "^8.3.0",     "@prisma/orm-framework":    "~8.3.0",
"@prisma/orm-family-sql":      "^8.3.0",     "@prisma/orm-family-sql":   "~8.3.0",
"@prisma/orm-target-postgres": "^8.3.0",     "@prisma/orm-target-mysql": "~8.3.0-ea.0",
"@prisma/orm-toolchain":       "^8.3.0"      "@prisma/orm-toolchain":    "~8.3.0"
```

The MySQL application has a tilde even on its GA lines, so that an update does not move them to `8.4` without the facade; [What an application writes](#what-an-application-writes) explains it.

A single API inside a GA package that is not finished yet carries its level at the start of its name:

```ts
db.orm.users.where({ email }).first()  // GA: a plain name in a GA package
db.orm.users.preview_search(...)       // Preview: the name says so
```

(`preview_search` shows the form; no such API exists.)

## The packages in these examples

- **Facade**, such as `@prisma/orm-postgres`: the package an application installs to use a database. A database's level is its facade's level.
- **Platform packages**: `@prisma/orm-framework` (the core every database shares), `@prisma/orm-family-sql` (what SQL databases share), `@prisma/orm-target-postgres` (what is specific to PostgreSQL) and `@prisma/orm-toolchain` (the `prisma orm` commands). The facade is built on them, and the application lists them too ([ADR 329](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)).
- **Extension**, such as `@prisma/orm-extension-pgvector`: adds data types or operations, built on the platform packages.
- **Library integration**, such as `@prisma/orm-better-auth`: connects an outside library to an application's Prisma client. It follows the same version rules as an extension.

## The problem

Prisma 8 supports several databases, and they are not equally finished. A user needs to see, in their own project, which parts they can rely on.

If every package carried one version, a user could not tell a finished package from an unfinished one, no database could be GA before every database was, and a fix to one package would need a release of every package.

The same holds inside one package. A GA package can gain an API that is not finished yet. The user needs to see that at the place they call it.

A feature flag would hide both: it is set in a config file, while the code that uses the feature looks like any other.

## Decision

1. **One scale of maturity, with four levels:** Early Access, Preview, Release Candidate and GA. "Below GA" means any of the first three.
2. **A user sees a level in two places only:** a package's version, and the start of an API's name. The maintainers set each package's level in one file of the release scripts, `packages/0-shared/publish-surface/src/levels.ts`, and the version is computed from it. Docs may repeat a level, and a check keeps each package's README in step with the level it declares, but docs do not decide it.
3. **Our packages share a release number,** which is the major and the minor: release `8.3` publishes every package at `8.3`, except one with [its own version](#packages-with-their-own-version). A fix to one package raises only that package's patch number, or its level's counter below GA.
4. **The ranges between our packages, and the npm dist-tag each package is published under, are computed** by the release scripts from the release number and the levels.
5. **No feature flags.** Functionality that is not ready ships in a package below GA, or as an API whose name carries its level.

## The levels

A level is defined by the least we do for a package or an API at that level.

| Level | What we do, at least |
| --- | --- |
| Generally Available | Its tests run on every release, and a failure blocks the release. A facade passes the repository's full test suite against its database. A later release in the same major version does not break its users. |
| Release Candidate | As for GA. We expect no further breaking change, but one is still allowed before it is GA. |
| Preview | Its tests run, and a failure blocks the release, for what it supports. Its reference documentation lists what it does not yet support; its maintainers decide that list. It may change in any release. |
| Early Access | Released so that people can try it. It may be released with a failing test. It may change in any release. |

**A failing test blocks every package.** Our packages are released together, so a failing test of a package at Preview or above blocks the release for all of them. Early Access is the one level that may be released with a failing test; that is allowed, not required.

**A level moves up within a minor, and down only at a new minor, or, for a package that is GA, only at a new major.** A version can only move forward, and the levels' words sort upward in the order of the levels: `ea`, `preview`, `rc`, then the plain version. So a package can move up in any release. A package that is not GA can move down at a new minor. A GA package stays GA until the next major version. Taking it below GA within the major would break what GA promises, and users on `^8.4.0` would silently stop getting its updates, because a caret never selects a pre-release such as `8.5.0-preview.0`. At a new major it may start below GA, since a new major ends that promise. The release scripts enforce both.

**This is not the support scale.** The public issue [Priorities & Operating Contexts](https://github.com/prisma/orm/issues/25843) sorts databases, runtimes and frameworks into First-Class, Supported and Unofficial. That says where the maintainers spend effort and how they answer issues. A maturity level says how finished one package is. Neither decides the other: a First-Class database can have an Early Access facade while that facade is being built, and a database we support less can have a GA one.

## What has a level

- **A package.** Every published package of ours has a level, except one with [its own version](#packages-with-their-own-version). Each database reaches GA on its own date, when its facade does.
- **An API.** An API is an export, or a member of one, such as a method, a property or an option. It has its package's level unless its name starts with the word for a lower level. Such a word gives the least the API is promised: after a promotion, the old name stays as a deprecated name for an API now at a higher level, and is kept as long as the API is, and at most until the next major version. A member of an API below GA is at that API's level or lower.

A name never claims more than its package's level. A GA API cannot exist inside a package below GA, because the package's version already says that nothing in it is kept compatible.

Nothing else has a level of its own, except a command: how a command shows that it is not finished, for every command including the `prisma orm` commands the toolchain provides, belongs to the command-line tool's design. An entrypoint (a path inside a package that code imports from, such as `@prisma/orm-toolchain/config-loader`) and a capability (a feature a database supports, which a package declares) take their package's level.

**A package names only packages at its own level or above** as dependencies or peer dependencies, because a package cannot be relied on further than what it is built on. So a GA package names only GA packages of ours; otherwise its users would get breaking changes through that dependency. A platform package, which has no database of its own, is at least at the level of the most mature facade or extension that names it. The release scripts refuse a plan that breaks this.

## How a level is written

| Level | In a package's version | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.3.0` | Nothing: `search` |
| Release Candidate | `8.3.0-rc.0` | `rc_search` |
| Preview | `8.3.0-preview.0` | `preview_search` |
| Early Access | `8.3.0-ea.0` | `ea_search` |

A single API inside a GA package can be at any of the three levels below GA, so packages and APIs share one scale.

The word and the name are joined by an underscore, so that the level cannot be read as part of the name: `previewImage` could be a GA API about image previews, while `preview_image` can only be an `image` API at Preview or above. A reader, and any tool that reads names, can then tell from the name alone the least an API is promised. A name that starts with a lower-case letter, such as a function, a property or a config option, takes this form. A name that starts with a capital letter, such as a type or a class, is `Preview_Search`. A name in a contract written in PSL follows the same rule: an attribute is `@preview_search`, a default function `preview_uuid()`.

A command-line flag, an environment variable and an error code carry no level. A flag and an environment variable belong to the command or the package that reads them, and an error code to the function that throws it, so a change to any of them is a change of that command, package or function.

**A promotion adds a name and keeps the old one.** When an API moves up a level, such as from Early Access to Preview or from Preview to GA, the release adds the name for the new level. The old name stays as another name for the same API, marked deprecated, and is removed at the next major version. Otherwise every application and extension that calls `ea_search` would break when it becomes `preview_search`, and again when it becomes `search`: the API would stop working at the moment it became more reliable. For a while a name can then say less than is true (`ea_search` may be GA), which errs on the safe side.

A promotion that also changes the API's form is a change like any other below GA: the new name has the new form, and the old name is removed in that release, since one API cannot have both forms.

## Version numbers

- **The major and minor are the release number.** Release `8.3` publishes every package at `8.3`, changed or not, except one with [its own version](#packages-with-their-own-version).
- **A GA package has its own patch number.** A fix to one GA package raises that package's patch number, to `8.3.1`, and no other package's.
- **A package below GA has a suffix with its level and a counter.** A fix to it raises the counter, from `8.3.0-preview.0` to `8.3.0-preview.1`, and not the patch number.

The suffix is what Semantic Versioning calls a pre-release, and package managers treat it specially:

- A range selects a pre-release only of the same major, minor and patch as the version the range starts from. `~8.3.0-preview.0` selects `8.3.0-preview.1` but never `8.4.0-preview.0`.
- A range on a plain version never selects a pre-release. `^8.3.0` never selects `8.4.0-preview.0`, so a user gets a release below GA only by asking for one.

That is why a fix below GA raises the counter: `8.3.1-preview.0` would sort above `8.3.0-preview.1`, but a user's `~8.3.0-preview.0` would not select it.

## Ranges between our packages

The release scripts compute the ranges in our packages' manifests, and the publish checks refuse a manifest that disagrees. Nobody writes them by hand.

| From | To | Range |
| --- | --- | --- |
| A facade or a platform package | a GA package | Same minor, any patch: `~8.3.0` |
| A facade or a platform package | a package below GA | Same minor, from its first version in that minor: `~8.3.0-preview.0` |
| An extension or a library integration | a GA package | That release or any later one in the major version: `^8.3.0` |
| An extension or a library integration | a package below GA | Same minor, from its first version in that minor: `~8.3.0-ea.0` |

The packages of one release are tested together, so among themselves they accept only that release. An extension built on release `8.1` has to keep working in an application on `8.4`, so it accepts later releases of a GA package. A package below GA may change in the next minor, so nothing accepts more than one minor of it.

## Tags

- A GA release is published under the `latest` dist-tag.
- A release below GA is published under `latest` if the package has never had a GA release in any major version, so that a plain install works and the version shows the level. Otherwise it is published under a tag named after its level: `ea`, `preview` or `rc`.

A `0.x` version, which Semantic Versioning calls initial development, and an `8.0.0-rc.N` version, published before levels existed, say nothing about a package's level and do not count as a GA release.

## What an application writes

These rules cover the lines for our packages that share the release number. A package with its own version is written at a caret on that version, such as `^0.18.0`.

- **With a GA facade:** a caret on every line for a GA package, `^8.3.0`. An update moves all of them to the next release together. That does not conflict with the facade's tilde on the platform packages: at `8.4` the facade asks for them at `8.4`, and if one line moved alone, the facade's peer range would make the package manager warn. A package below GA that the application adds, such as an Early Access extension, is at a tilde on its first version in the minor, `~8.3.0-ea.0`, because a caret on a plain version never selects a pre-release. The user edits that line at each new minor.
- **With a facade below GA:** a tilde on every line, `~8.3.0-ea.0` for a package below GA and `~8.3.0` for a GA one. The facade, a pre-release, cannot follow a caret to `8.4`, so a caret on the GA lines would move them to `8.4` and leave the facade behind, which does not accept them. At each new release the user edits every line to the new minor by hand. The package managers' update commands do not do it: pnpm's `update` rewrites a tilde on a pre-release as an exact version, which never moves again, and Yarn's update to the latest version writes a caret, so the next update moves the GA lines without the facade.

`prisma orm init` writes the lines this way when it adds the facade. When the project already lists the facade, `init` leaves that line as the user wrote it, and writes each platform package at the range the installed facade declares, so that it never installs a platform package the user's facade does not accept.

## Release 8.0 starts at patch 1

Every package of release `8.0` that shares the release number starts at patch 1:

| Level | First version at release `8.0` | At any later release |
| --- | --- | --- |
| GA | `8.0.1` | `8.3.0` |
| Release Candidate | `8.0.1-rc.0` | `8.3.0-rc.0` |
| Preview | `8.0.1-preview.0` | `8.3.0-preview.0` |
| Early Access | `8.0.1-ea.0` | `8.3.0-ea.0` |

The registry already holds `8.0.0-rc.1` to `8.0.0-rc.N` for every package, published before levels existed. A version below GA at patch 0 would sort below them: `8.0.0-ea.0` comes before `8.0.0-rc.26`, because `ea` sorts before `rc`. A user's `~8.0.0-ea.0` would then admit an old release candidate. In a test on a local registry, Bun always installed one, Yarn did unless the release candidates were marked deprecated, and npm and pnpm did once `latest` pointed at a later minor. Patch 1 sorts above all of them.

GA packages start at `8.0.1` too, so that one rule covers the release. The repository's version, the git tag and the GitHub release are `8.0.1` as well, so the number announced is the number installed. No package is ever `8.0.0`. Within release `8.0` a package is numbered as at any release, keeping patch 1 when it moves up (`8.0.1-ea.1` to `8.0.1-rc.0`, then to `8.0.1`). The next release is `8.1.0`.

## Packages with their own version

**A package in this repository that another team maintains has its own version and no level,** because that team, not the shared release, decides when it changes and how finished it is. It names our packages at the ranges an extension uses. `@prisma/orm-extension-paradedb` is one. Its versions start at `0.18.0`, above the `0.16.0` and `0.17.0` it was published at before, so that a range spanning several `0.x` minors, such as `0.x`, picks a new version and not an old one.

### Packages maintained outside this repository

A package maintained outside this repository is numbered by its maintainer. We recommend this convention: the major and minor are the first release of ours the package works with, and the patch number is the maintainer's own. The number then means "needs at least this release", not "must equal it": a package at `8.1.2` names our packages at `^8.1.0` and works in an application on `8.4`. A package that uses one of our APIs below GA names the package that has it at a range within one minor, because that API may change in the next. We recommend the same level suffixes to such maintainers; nothing enforces them.

Two costs follow for such a maintainer: a feature of theirs that needs no newer release of ours ships as a patch, and once their package is GA they cannot make a breaking change of their own within our major version.

## Consequences

- **A user learns what is kept compatible from their own project:** the versions in their `package.json` and the names in their code. Docs may describe a level, but they do not decide one.
- **Two of our packages in one release can have different versions,** such as `8.3.1` and `8.3.0-ea.2`; they share only the release number. A contributor reads the release number from the repository's root `package.json`, and the release scripts print every package's version.
- **A user of a facade below GA edits their version lines at each new release.**
- **There is no second word**, such as "experimental", "unstable" or "proof of concept", for what is not finished.
- **Promoting an API adds a new name.** The old name keeps working, deprecated, until the next major version, unless the promotion changes the API's form.

## Alternatives considered

- **One version for every package.** A user cannot tell a finished package from an unfinished one, no database can be GA before all are, and a fix to one package needs a release of every package.
- **Each package numbered on its own, with no shared release number.** A user could not tell from two versions whether two packages belong together. AWS CDK numbers its experimental packages by the first release of the main library they work with, and the SQL Server adapter for Rails takes Rails's major and minor, for the same reason.
- **A separate word, such as `unstable_`, for an API that may change.** It gives users two scales that say almost the same thing, and "unstable" suggests the behaviour is unreliable when we mean only that the API may change. React marks APIs with `unstable_` and `experimental_` on top of its release channels, and users have to learn both.
- **Rename an API at each promotion, removing the old name.** Code that calls it breaks at each step, although each step makes it more reliable. Rust keeps accepting the opt-in to a feature after it is stabilised, with a warning, and Kubernetes serves a beta API version beside its successor for a stated period.
- **A level on an entrypoint, written in the import path,** such as `@prisma/orm-toolchain/preview/config-loader`. An entrypoint's exports already get their level from the package's version and their own names. A third place to write a level is a third thing to learn, and every import would change when the entrypoint reached GA.
- **A support table in the docs as the place a user learns what is kept compatible.** It is one more thing to keep up to date, and the user does not see it in their project.
- **Feature flags for functionality that is not ready.** A flag is set in a config file; a package below GA and an API whose name carries its level are visible in the user's own code.
- **Release `8.0` at patch 0, with the old release candidates marked deprecated.** Deprecation stops Yarn choosing an old release candidate, but not pnpm or Bun, and only npm and pnpm print the message.
- **Patch 1 at release `8.0` only for packages below Release Candidate,** with GA packages at `8.0.0` and Release Candidate packages carrying on the old `8.0.0-rc.N` counter. It keeps the number `8.0.0`, but needs a rule for each of the three groups, the last release candidate's counter as an input, and a special case for a package that moves up within the release.
