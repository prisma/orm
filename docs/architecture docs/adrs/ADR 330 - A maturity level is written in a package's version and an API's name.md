# ADR 330 — A maturity level is written in a package's version and an API's name

**Status:** Accepted
**Date:** 2026-11-25
**Related:** [ADR 329 — An application lists the platform packages, and our packages name each other as peers](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) (how our packages depend on each other; this record sets the version ranges they use), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published), [ADR 017 — Extension compatibility policy](ADR%20017%20-%20Extension%20Compatibility%20Policy.md) (what an extension may rely on)

## At a glance

Some parts of Prisma 8 are finished and some are not. A user can tell which from two things they already have in front of them.

The first is the version of each package. In release `8.3`, PostgreSQL support is finished and MySQL support is not:

```text
@prisma/orm-postgres   8.3.0        Generally Available (GA): no later 8.x release breaks code that uses it
@prisma/orm-mysql      8.3.0-ea.0   Early Access: any release may change it
```

The second is the name of a function. A finished package can contain a function that is not finished yet, and its name says so:

```ts
db.orm.users.where({ email }).first()   // GA: a plain name in a GA package
db.orm.users.preview_search('ada')      // Preview: may still change
```

(`preview_search` shows the form of the name. No such function exists.)

These are the only two places a user needs to look. There is no table to look up and no flag to switch on.

Writing the level into the version has one further effect, which takes up the second half of this record. It decides how an application lists Prisma's packages in its `package.json`:

```jsonc
"@prisma/orm-postgres": "^8.3.0"       // GA: the caret takes every later 8.x release
"@prisma/orm-mysql":    "~8.3.0-ea.0"  // Early Access: the tilde stays on release 8.3
```

[What goes in an application's package.json](#what-goes-in-an-applications-packagejson) explains both lines, step by step.

## The problem

Prisma 8 supports several databases, and they are not equally finished. A user needs to know which parts they can build on without their code breaking at the next release.

One version number for every package cannot tell them. A user could not tell a finished package from an unfinished one. No database could be called finished until every database was. And a fix to one package would mean publishing all of them.

The same problem exists inside one package. A finished package gains a new function that may still change, and the user needs to see that where they call it.

A feature flag hides both. The flag is set once in a config file, and from then on the unfinished feature looks like any other code.

## Decision

1. **There is one scale of maturity, with four levels:** Early Access, Preview, Release Candidate and Generally Available (GA). "Below GA" means any of the first three.
2. **A user reads a level from two places only:** a package's version, and the start of a function's name. The maintainers set each package's level in one file, `packages/0-shared/publish-surface/src/levels.ts`, and the release scripts compute the version from it.
3. **Our packages share a release number,** which is the first two parts of the version. Release `8.3` publishes every package at `8.3.something`. The rest of the version belongs to each package. (One package is an exception; see [Packages with their own version](#packages-with-their-own-version).)
4. **The release scripts compute everything that follows from the levels:** each package's version, which versions of our other packages it accepts, and which version a plain install gets. Nobody writes these by hand.
5. **There are no feature flags.** Something that is not finished ships as a package below GA, or as a function whose name carries its level.

The rest of this record explains each point, in the order a reader needs them.

## The kinds of package

The examples in this record use four kinds of package.

- **Facade:** the package an application's code imports Prisma from. There is one for each database: `@prisma/orm-postgres`, `@prisma/orm-mysql`, `@prisma/orm-mariadb`, `@prisma/orm-sqlite` and `@prisma/orm-mongo`.

  ```ts
  import postgres from '@prisma/orm-postgres/runtime';
  ```

- **Platform packages:** the packages a facade is built from. Application code does not import them, but they are installed beside the facade ([ADR 329](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)). For PostgreSQL they are:

  | Package | What is in it |
  | --- | --- |
  | `@prisma/orm-framework` | The core that every database shares. |
  | `@prisma/orm-family-sql` | What all SQL databases share. |
  | `@prisma/orm-target-postgres` | What is specific to PostgreSQL. |
  | `@prisma/orm-toolchain` | The code behind the `prisma orm` commands. |

- **Extension:** an optional package that adds data types or operations for one database. `@prisma/orm-extension-pgvector` adds vector search to PostgreSQL.
- **Library integration:** a package that connects another library to Prisma, such as `@prisma/orm-better-auth`. Every rule here for an extension also holds for a library integration.

## The four levels

A level is defined by the least the maintainers do for something at that level.

| Level | What the maintainers do, at least |
| --- | --- |
| Generally Available | Its tests run on every release, and a failing test stops the release. A facade passes the repository's full test suite against its database. No later release in the same major version breaks code that uses it. |
| Release Candidate | The same as GA, except that one more breaking change is still allowed before it becomes GA. We expect none. |
| Preview | Tests cover the features it supports, and a failing one stops the release. Its reference documentation lists what it does not support yet; its maintainers decide that list. Any release may change it. |
| Early Access | Released so that people can try it. It may be released with a failing test. Any release may change it. |

Three rules go with the table.

**One failing test stops the whole release.** A release, such as `8.3`, publishes all our packages together. So a failing test in one package at Preview or above stops the release of all of them. A failing test in an Early Access package does not have to.

**A GA package depends only on GA packages of ours.** In general, a package depends only on packages at its own level or above. If a GA package depended on an Early Access one, a change to the Early Access package would break the GA package's users, and GA promises that does not happen. The release scripts refuse it. It follows that a platform package is at least at the level of the most finished facade or extension built on it: the framework is GA because the PostgreSQL facade is. For the same reason, a GA package does not call a function below GA in another package.

**A level is not a support category.** The public issue [Priorities & Operating Contexts](https://github.com/prisma/orm/issues/25843) sorts databases, runtimes and frameworks into First-Class, Supported and Unofficial. That scale says where the maintainers spend their effort. A level says how finished one package is. Neither decides the other: a First-Class database can have an Early Access facade while the facade is being built, and a database that gets less of our effort can have a GA one.

## What has a level

Two things have a level.

- **A package.** Every package we publish has one, except a package with [its own version](#packages-with-their-own-version). A database's level is the level of its facade, so each database reaches GA on its own date.
- **An API.** An API is anything a package exports, or a member of one: a function, a method, a property, an option, a type. An API has the level of its package, unless its name starts with a level word such as `preview_`. Then it has the level its name gives, which is never above its package's level. The next section gives the exact rule.

A name can only lower a level, never raise one. A package below GA cannot contain a GA function, because the package's version already says that anything in it may change. In the same way, a member of something below GA is at that level or lower: a method of an Early Access class is not GA.

Three things that might seem to need a level do not have one of their own:

- **An entrypoint,** which is a path that code imports from, such as `@prisma/orm-postgres/runtime`. Everything it exports has its package's level, or the lower level in its own name.
- **A capability,** which is a database feature that a package declares support for, such as returning the rows a write changed. It has the level of the package that declares it.
- **A command-line flag, an environment variable and an error code.** Each is part of the command or the function that uses it. A flag that changes is a change to its command. An error code that stops being thrown is a change to the function that threw it.

The `prisma orm` commands themselves are code in `@prisma/orm-toolchain`, run through the `prisma` command-line tool. How a command shows that it is not finished is decided in the design of that tool, not in this record.

## How a function's name carries its level

| Level | Name |
| --- | --- |
| Generally Available | `search` |
| Release Candidate | `rc_search` |
| Preview | `preview_search` |
| Early Access | `ea_search` |

The level word and the name are joined by an underscore, so that the word cannot be read as part of the name. `previewImage` could be a finished function that previews images. `preview_image` can only be a function called `image` with a level word in front.

The same form is used for every kind of name. Where a name starts with a capital letter, so does the level word.

| Kind of name | Examples |
| --- | --- |
| A function, method, property or config option | `ea_search`, `preview_search`, `rc_search` |
| A type or class | `Ea_Search`, `Preview_Search`, `Rc_Search` |
| An attribute in a contract written in PSL, Prisma's contract language | `@preview_search` |
| A default function in such a contract | `preview_uuid()` |

### A promotion adds a name and keeps the old one

When a function moves up a level, the release adds the name for the new level. The old name stays as a second name for the same function, and is removed at the next major version. It is marked `@deprecated`, so that an editor shows it struck through and names its replacement.

```ts
db.orm.users.ea_search('ada')        // release 8.3: Early Access
db.orm.users.preview_search('ada')   // release 8.4: promoted to Preview. ea_search still works.
db.orm.users.search('ada')           // release 8.6: promoted to GA. Both older names still work.
```

Without this, every application and extension that called `ea_search` would break at `8.4`, and again at `8.6`. The function would stop working at the moment it became more reliable.

The cost is that an old name can say less than is true: after `8.6`, `ea_search` is a GA function. So the exact rule for reading a name is this: **a level word means the function is at that level or higher.** A name can understate a function's level, and never overstates it. The current name, the one that is not deprecated, gives the level exactly.

One exception: if the promotion also changes how the function is called, the old name is removed in that release. One name cannot stand for two different functions, and anything below GA may change in any release.

## How a package's version carries its level

A version such as `8.3.1` has three parts: major (`8`), minor (`3`) and patch (`1`).

- **The major and minor are the release number.** Release `8.3` publishes every package at `8.3`, whether or not the package changed. (A package with [its own version](#packages-with-their-own-version) is the exception.)
- **A GA package has a plain version, and its own patch number.** A fix to one GA package raises that package's patch number, to `8.3.1`. No other package is published.
- **A package below GA has its level and a counter after the version:** `8.3.0-ea.0`, `8.3.0-preview.0` or `8.3.0-rc.0`. A fix raises the counter, to `8.3.0-ea.1`. The patch number stays the same.

| Level | First version in release `8.3` | After one fix |
| --- | --- | --- |
| Generally Available | `8.3.0` | `8.3.1` |
| Release Candidate | `8.3.0-rc.0` | `8.3.0-rc.1` |
| Preview | `8.3.0-preview.0` | `8.3.0-preview.1` |
| Early Access | `8.3.0-ea.0` | `8.3.0-ea.1` |

Semantic Versioning, the convention npm follows, calls a version with such a suffix a pre-release. It sorts a pre-release before the plain version, and sorts suffixes alphabetically. So the levels sort in order of maturity:

```text
8.3.0-ea.0  <  8.3.0-preview.0  <  8.3.0-rc.0  <  8.3.0
```

### Three facts about version ranges

A `package.json` does not list exact versions. It lists ranges, and the package manager installs a version each range accepts: usually the newest, though npm and pnpm prefer the version under the npm tag `latest` when the range accepts that one. Pre-releases get a special rule. Everything in the rest of this record follows from the three facts below.

| Range | Accepts | Does not accept |
| --- | --- | --- |
| `^8.3.0` (caret) | `8.3.0` and any later `8.x` version: `8.3.1`, `8.4.0`, `8.9.2` | `9.0.0`, and every pre-release, such as `8.4.0-ea.0` |
| `~8.3.0` (tilde) | `8.3.0` and any later `8.3.x` version: `8.3.1`, `8.3.7` | `8.4.0`, and every pre-release |
| `~8.3.0-ea.0` | Pre-releases of `8.3.0`, then any `8.3.x`: `8.3.0-ea.1`, `8.3.0-rc.0`, `8.3.0`, `8.3.1` | `8.4.0-ea.0`, `8.4.0` |

1. **A caret accepts later minors. A tilde stays within one minor.**
2. **A range on a plain version never accepts a pre-release.** A user whose line says `^8.3.0` cannot get an Early Access version by accident. They get one only by writing its version themselves.
3. **A range written on a pre-release of `8.3.0` accepts pre-releases of `8.3.0`, and of no other version.** `~8.3.0-ea.0` accepts `8.3.0-ea.1`, but never `8.4.0-ea.0`. A caret makes no difference here: `^8.3.0-ea.0` does not accept `8.4.0-ea.0` either. So no caret or tilde range can follow a package below GA from one minor into the next.

Fact 3 is why a fix below GA raises the counter and not the patch number. A user's `~8.3.0-ea.0` accepts `8.3.0-ea.1`. It would not accept `8.3.1-ea.0`, which is a pre-release of a different version.

### How a level changes

- **Up:** a package can move up whenever it is published.
- **Down, for a package below GA:** only at a new minor, such as from `8.3.0-preview.2` to `8.4.0-ea.0`. Within a minor a version can only move forward, and `8.3.0-ea.0` sorts before `8.3.0-preview.2`.
- **Down, for a GA package:** never within a major version. GA promises that no later release in the major breaks its users, and going below GA withdraws that promise. There is a second, practical harm: a user whose line says `^8.4.0` would silently stop getting updates, because that range never accepts `8.5.0-preview.0` (fact 2). A new major version ends GA's promise anyway, so a package may start a new major below GA.

The release scripts refuse a change that breaks these rules.

## Which versions of each other our packages accept

Our packages do not bring each other along. Each one says which other packages of ours it needs, and at which versions, and the application installs them. In `package.json` terms, each lists the others as peer dependencies, each with a range ([ADR 329](ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) explains why). When the application has a version that some package does not accept, then on install npm refuses, and pnpm, Yarn and Bun go ahead and print a warning.

The release scripts compute these ranges, and a check before publishing refuses a `package.json` that disagrees.

| This package | accepts this package | at this range | Why |
| --- | --- | --- | --- |
| A facade or a platform package | a GA package | The same minor: `~8.3.0` | The packages of one release are tested together, and only together. |
| A facade or a platform package | a package below GA | The same minor: `~8.3.0-ea.0` | The same reason. |
| An extension | a GA package | That release or any later one: `^8.3.0` | An application can move to `8.6` and keep an extension built for `8.3`. An extension maintained outside this repository is not published with our releases at all. |
| An extension | a package below GA | The same minor: `~8.3.0-ea.0` | A package below GA may change in the next minor, so the extension cannot promise to work with it. |

The third row assumes the extension uses only the GA functions of that package. For an extension or a library integration in this repository that is a rule: none of them, whatever its own level, uses an API below GA of a GA package. The release scripts rely on it: they write the caret because the accepted package is GA and the accepting package is an extension or a library integration, and they do not read its code. No check enforces the rule; reviewers do. An extension maintained outside this repository may use such an API, such as `preview_search`. It must then accept that package within one minor only (`~8.3.0`), because the function may change in the next.

## What goes in an application's package.json

`prisma orm init` writes one line for the facade and one for each platform package. Which range it writes depends on the facade's level.

### When the facade is GA: a caret on every line

```jsonc
// a PostgreSQL application on release 8.3
"@prisma/orm-postgres":        "^8.3.0",
"@prisma/orm-framework":       "^8.3.0",
"@prisma/orm-family-sql":      "^8.3.0",
"@prisma/orm-target-postgres": "^8.3.0",
"@prisma/orm-toolchain":       "^8.3.0"
```

When release `8.4` comes out, the user runs their package manager's update command, and every package moves to `8.4` together. The lines themselves do not need to change, because `^8.3.0` already accepts `8.4.0`. GA promises that `8.4` does not break their code, so the user edits nothing.

The packages are also checked against each other. The facade accepts the platform packages only at its own minor (the first row of the table above), so a set that is half on one release and half on another does not pass an install unreported.

### When the facade is below GA: a tilde on every line

```jsonc
// a MySQL application on release 8.3; MySQL is at Early Access
"@prisma/orm-mysql":        "~8.3.0-ea.0",
"@prisma/orm-target-mysql": "~8.3.0-ea.0",
"@prisma/orm-framework":    "~8.3.0",
"@prisma/orm-family-sql":   "~8.3.0",
"@prisma/orm-toolchain":    "~8.3.0"
```

The framework, the SQL family and the toolchain are GA packages, yet their lines have a tilde too. This is deliberate. To see why, suppose those three lines had a caret, `^8.3.0`, and release `8.4` comes out. Release `8.4` publishes MySQL as `8.4.0-ea.0` and the framework as `8.4.0`. The user runs an update:

| Line | Range | What the update installs |
| --- | --- | --- |
| `@prisma/orm-framework` | `^8.3.0` | `8.4.0`. The caret accepts it. |
| `@prisma/orm-mysql` | `~8.3.0-ea.0` | Still `8.3.0-ea.N`. No range on `8.3.0-ea.0` accepts `8.4.0-ea.0` (fact 3). |

The update has moved half of the application to `8.4` and left MySQL on `8.3`. Those two halves were never tested together, and the MySQL facade says so itself: at `8.3` it accepts the framework only at `8.3`. What the user sees depends on the package manager. pnpm and Yarn install the mixed set and print a warning. Bun's update command installs it with no warning, although Bun's install command would warn. npm moves nothing at all, so the application stops getting updates. In each case the user ends up with a combination nobody tested, or with no updates.

With a tilde on every line, the same update is harmless: every package stays in `8.3`, takes fixes within `8.3`, and still fits together.

The cost falls on users of a database below GA. To move to `8.4`, they edit all five lines by hand, to `~8.4.0-ea.0` and `~8.4.0`, and install. The package managers' own commands do not do this correctly. `pnpm update` rewrites a tilde on a pre-release as an exact version, which never moves again. Yarn's command that updates to the latest version writes a caret. With carets on the GA lines they would still have to edit the two MySQL lines by hand, so the tilde costs three more edited lines. In return, an update can never leave the application half on one release and half on another.

### An extension below GA in a GA application

A PostgreSQL application can add an extension that is still at Early Access. Its line gets a tilde on the extension's own version, `~8.3.0-ea.0`, and the other lines keep their carets. After an update to `8.4` the application keeps working with the extension's `8.3` version. To get the extension's `8.4` version, the user edits that one line.

### A project that already lists a facade

When a project already has a line for the facade, `init` leaves that line as the user wrote it. It then writes each platform package at exactly the range the installed facade accepts, such as `~8.3.0`, whatever the facade's level. That way it never installs a platform package the user's facade does not accept.

This has a cost when the user's facade line is a caret, `^8.3.0`. The lines are then written two ways, and at release `8.4` an update moves the facade and not the platform packages. The package manager reports the mismatch, and the user changes the platform lines to carets. `init` does not do that for them, because it never rewrites a line the user wrote.

## Which version a plain install gets

An npm tag is a label that points at one version of a package. A user who runs `npm install @prisma/orm-postgres`, with no version, gets the version the tag `latest` points at.

- A GA version is published under `latest`.
- A version below GA is published under `latest` too, if the package has never had a GA version. Otherwise nobody could install a new package without knowing its exact version. The version still shows its level.
- A version below GA of a package that has had a GA version is published under a tag named after its level: `ea`, `preview` or `rc`. A plain install keeps giving the last GA version.

Every release published before release `8.0` went under `latest`, whatever state the package was in. None of them counts as a GA version for the rule above: not the `0.x` versions, and not the `8.0.0-rc.N` versions described next.

## Release 8.0 starts at patch 1

Before levels existed, every package was published as `8.0.0-rc.1`, `8.0.0-rc.2` and so on, up to `8.0.0-rc.26` and beyond, whatever its real state. Those versions stay on the npm registry for good.

They sort above the versions that release `8.0` would give a package below GA. `ea` and `preview` sort before `rc`, and `rc.0` sorts before `rc.26`:

```text
8.0.0-ea.0  <  8.0.0-preview.0  <  8.0.0-rc.0  <  8.0.0-rc.26 (old)  <  8.0.0
```

So a user's `~8.0.0-ea.0` would accept `8.0.0-rc.26`, an old version of everything, and package managers do install it:

| Package manager | Installs the old `8.0.0-rc.26` for `~8.0.0-ea.0` |
| --- | --- |
| Bun | Always. |
| Yarn | Unless the old versions are marked deprecated. |
| npm | Once `latest` points at a later minor, unless the old versions are marked deprecated. |
| pnpm | Once `latest` points at a later minor, deprecated or not. |

Release `8.0` therefore starts every package at patch 1, which sorts above every old version:

| Level | First version in release `8.0` | In any later release |
| --- | --- | --- |
| Generally Available | `8.0.1` | `8.3.0` |
| Release Candidate | `8.0.1-rc.0` | `8.3.0-rc.0` |
| Preview | `8.0.1-preview.0` | `8.3.0-preview.0` |
| Early Access | `8.0.1-ea.0` | `8.3.0-ea.0` |

A package that moves up a level within release `8.0` keeps patch 1: `8.0.1-ea.1`, then `8.0.1-rc.0`, then `8.0.1`.

GA packages start at `8.0.1` as well, so that one rule covers the whole release. The repository's version, the git tag and the GitHub release are `8.0.1` too, so the number that is announced is the number users install. No package is ever published as `8.0.0`. From `8.1` on, every release starts at patch 0.

## Packages with their own version

One kind of package does not share the release number: a package in this repository that another team maintains. That team decides when it changes and how finished it is, so it has its own version and no level. It accepts our packages at the ranges an extension uses.

`@prisma/orm-extension-paradedb` is the one such package. Its versions start at `0.18.0`, above the `0.16.0` and `0.17.0` it was published at earlier, so that its new versions sort above its old ones. An application lists it with a caret on its own version, such as `^0.18.0`.

### Packages maintained outside this repository

The maintainer of a package outside this repository chooses its version. We recommend this convention:

- The major and minor are the first release of ours that the package works with. The patch number is the maintainer's own.
- The package accepts our GA packages with a caret. A package at `8.1.2` accepts ours at `^8.1.0`, and works in an application on `8.4`. Its version means "needs at least release 8.1".
- If it uses something of ours that is below GA, a package or a single function, it accepts that package within one minor only, because the next minor may change it.
- It uses the same level suffixes as ours. Nothing enforces this.

The convention has two costs for the maintainer. A new feature of theirs that needs no newer release of ours ships as a patch. And once their package is GA, they cannot make a breaking change of their own until our next major version.

## Consequences

- **A user learns what they can rely on from their own project:** the versions in `package.json` and the names in their code. Documentation can repeat a level but never decides one. A check keeps each package's README in step with the level in `levels.ts`.
- **Two of our packages in one release can have different versions,** such as `8.3.1` and `8.3.0-ea.2`. Only the release number, `8.3`, is shared. A contributor finds the release number in the `version` of the repository's root `package.json`.
- **A user of a database below GA edits their dependency lines by hand at each new release.**
- **There is no other word for "not finished".** "Experimental", "unstable" and "proof of concept" are not used.
- **Old names stay after a promotion,** until the next major version.

## Alternatives considered

- **One version for every package.** A user cannot tell a finished package from an unfinished one, no database can be GA before all of them are, and a fix to one package means publishing every package.
- **A separate version for each package, with no shared release number.** A user could not tell from two versions whether two packages belong together. Other projects share a number for the same reason: AWS CDK numbers its experimental packages by the release of the main library they work with, and the SQL Server adapter for Rails takes the major and minor of Rails.
- **A tilde on every line of every application,** so that there is one rule. Users of a GA database would then have to edit their lines at every release to get versions that GA already promises are compatible.
- **A caret on every line of every application.** In an application whose database is below GA, the first update after a new release moves half of the packages and leaves the facade behind, as shown above.
- **A separate word, such as `unstable_`, for a function that may change.** It gives users two scales that say almost the same thing. "Unstable" also suggests the function behaves unreliably, when we mean only that it may change. React marks functions with `unstable_` and `experimental_` in addition to its release channels, and its users have to learn both.
- **Rename a function at each promotion and remove the old name.** Code that calls it breaks at each step, although each step makes the function more reliable. Rust keeps accepting the opt-in to a feature after the feature is stabilised, with a warning. Kubernetes serves a beta version of an API beside its successor for a stated period.
- **A level in the import path,** such as `@prisma/orm-toolchain/preview/config-loader`. What an entrypoint exports already has a level, from the package's version and from each name. A third place to write a level is a third thing to learn, and every import would change when the entrypoint reached GA.
- **A support table in the documentation as the place a user learns what they can rely on.** It is one more thing to keep up to date, and the user does not see it in their project.
- **Feature flags.** A flag is set in a config file. A version and a name are visible in the user's own code.
- **Number release `8.0` like any other release, and mark the old `8.0.0-rc.N` versions as deprecated.** As the table above shows, deprecation stops Yarn and npm installing an old version, but not pnpm or Bun.
- **Start at patch 1 only for packages below Release Candidate,** with GA packages at `8.0.0` and Release Candidate packages continuing the old `8.0.0-rc.N` count. It keeps the number `8.0.0`. But it needs a different rule for each of the three groups, and a special case for a package that moves up a level within the release.
