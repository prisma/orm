# Versions and support

This page is for people who use Prisma ORM, and for people who publish extensions for it. It says which versions are supported, what a version number tells you, what will not break when you upgrade, and how to upgrade. Maintainers will find the release procedures in [Releasing](./releasing.md).

## Supported versions

| Version | What it receives | For how long |
| --- | --- | --- |
| Prisma 8 | New features and all fixes, in the newest release only | While it is the newest major version |
| Prisma 7 | Fixes for bugs and security issues, and no new features from the maintainers | Until 18 months after release 8.0 is published |

- **Prisma 8** is where development happens. It has not reached release 8.0 yet. Until it does, read [Until release 8.0](#until-release-80) first.
- **Prisma 7** is in maintenance. Its source is on the [`v7` branch](https://github.com/prisma/orm/tree/v7), and pull requests for it target that branch. The maintainers build no new features for it. A feature contributed by the community can still be accepted if it fits Prisma 7's design, and so can work on the tooling that builds, tests and releases it. A maintainer decides. [ADR 295](../architecture%20docs/adrs/ADR%20295%20-%20New%20features%20do%20not%20land%20on%20Prisma%207.md) has the details.

From Prisma 8 on, these rules apply to every major version:

- **Fixes go into the newest release.** To get a fix, upgrade to it. For what is Generally Available, an upgrade within a major needs no changes, apart from the four exceptions listed under [What stays compatible](#what-stays-compatible).
- **When a new major is published, the previous one receives critical fixes and security fixes for 12 more months.** Prisma 7 is the one exception, with 18 months.
- **We aim for one new major a year.** That is an aim, not a promise.

[`SECURITY.md`](../../SECURITY.md#supported-versions) says how to report a vulnerability and which versions receive security fixes. The supported versions of Node.js, TypeScript and each database are on [their own page](../Supported%20Versions.md). Release notes are published as [GitHub Releases](https://github.com/prisma/orm/releases) and kept in [`docs/releases/`](../releases/README.md).

## Until release 8.0

Prisma 8 has not had its first stable release. Today every package is published as `8.0.0-rc.1`, `8.0.0-rc.2` and so on, called release candidates, and all packages share that one version.

- **Any release candidate may contain breaking changes.** Nothing on the rest of this page applies yet.
- **Only the newest one is maintained.** A fix ships in the next one.
- **Each one comes with an upgrade guide,** linked from its release notes. The `prisma-8` agent skill, which ships inside the Prisma packages, can apply the guide for you.
- **List every Prisma package at the same exact version** in your `package.json`, such as `"8.0.0-rc.25"`, with nothing in front of the number.

The name says less than it seems to. Every package gets the same `8.0.0-rc.N`, whatever state it is in, so a package published as `8.0.0-rc.25` may be far from finished. Only from release 8.0 is "Release Candidate" a level with a defined meaning, described below.

If your project cannot keep up with breaking changes, stay on Prisma 7 until release 8.0.

## Version numbers

A version has three parts: major, minor and patch. In `8.3.1` they are `8`, `3` and `1`.

- **The major and minor are the release.** "Release 8.3" means every package at `8.3`. Two Prisma packages belong together when their first two numbers match.
- **The patch belongs to each package.** A package that is Generally Available has a plain version, such as `8.3.0`. A fix published to that package alone would be `8.3.1`.
- **A package that is not finished has its level and a counter after the version:** `8.3.0-ea.0`. A fix published to it alone would be `8.3.0-ea.1`.
- **Today no fix is published to one package alone.** A fix ships in the next release, as [Supported versions](#supported-versions) says, so within a release you will normally see only its first version. The next section says what the levels are.
- **Release 8.0 starts at `8.0.1`.** Its first versions are `8.0.1`, and for example `8.0.1-ea.0`. No package is published as `8.0.0`. The old `8.0.0-rc.N` versions stay on npm for good, and a version such as `8.0.0-ea.0` would sort below them, so package managers would install an old release candidate in its place. From `8.1` on, every release starts at patch 0.

[ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) explains each of these rules in full.

## Maturity levels

From release 8.0, every Prisma package has one of four maturity levels. The level tells you how far you can rely on the package.

| Level | Its version looks like | What you can rely on |
| --- | --- | --- |
| Generally Available (GA) | `8.3.0` | No later 8.x release breaks your code. We run its full test suite before every release, and do not release while a test fails. |
| Release Candidate | `8.3.0-rc.0` | We believe it is finished, and test it as we test GA. A breaking change is still possible before it becomes GA, but we expect none. |
| Preview | `8.3.0-preview.0` | It is tested for the features it supports, and its documentation lists what it does not support yet. Any new version may change it. |
| Early Access | `8.3.0-ea.0` | It is published so that you can try it. It may have known failures, and any new version may change it. |

"Below GA" means any of the last three. Only what is GA is covered by [What stays compatible](#what-stays-compatible).

### Which packages are at which level

Each database has one package that your code imports from, such as `@prisma/orm-postgres`. That package is built from a few others, called the platform packages: `@prisma/orm-framework` (the core every database shares), `@prisma/orm-toolchain` (the `prisma orm` commands), a family package such as `@prisma/orm-family-sql` (what all SQL databases share), and a target package such as `@prisma/orm-target-postgres` (what is specific to one database).

At release 8.0:

| What | Level at release 8.0 | Packages |
| --- | --- | --- |
| PostgreSQL | Generally Available | `@prisma/orm-postgres`, `@prisma/orm-target-postgres` |
| The packages every database shares | Generally Available | `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-sql` |
| PostgreSQL extensions | Generally Available | `@prisma/orm-extension-pgvector`, `@prisma/orm-extension-postgis`, `@prisma/orm-extension-arktype-json`, `@prisma/orm-postgres-contrib` |
| Query cache | Generally Available | `@prisma/orm-extension-middleware-cache` |
| Better Auth integration | Generally Available | `@prisma/orm-better-auth` |
| MongoDB | Early Access | `@prisma/orm-mongo`, `@prisma/orm-family-mongo`, `@prisma/orm-target-mongo` |
| MySQL | Early Access | `@prisma/orm-mysql`, `@prisma/orm-target-mysql` |
| MariaDB | Early Access | `@prisma/orm-mariadb`, `@prisma/orm-target-mariadb` |
| SQLite | Early Access | `@prisma/orm-sqlite`, `@prisma/orm-target-sqlite` |
| Supabase extension | Early Access | `@prisma/orm-extension-supabase` |

No package is at Preview or Release Candidate yet. Each package's README states its level.

One package has no level. `@prisma/orm-extension-paradedb` is maintained by another team and has its own version numbers, starting at `0.18.0`.

### A function can be below its package's level

A GA package can contain a function that is not finished. Its name starts with its level, so you can see it where you call it:

```ts
db.orm.users.where({ email }).first()   // GA
db.orm.users.preview_search('ada')      // Preview: may still change
```

The level words are `ea_`, `preview_` and `rc_`. For a type or a class they are capitalised: `Ea_Search`, `Preview_Search`, `Rc_Search`.

When such a function moves up a level, it gets a new name, and the old name keeps working until the next major version. Your editor shows the old name as deprecated and tells you the new one.

```ts
db.orm.users.ea_search('ada')        // release 8.3: Early Access
db.orm.users.preview_search('ada')   // release 8.4: now Preview. ea_search still works.
db.orm.users.search('ada')           // release 8.6: now GA. Both older names still work.
```

So a promotion alone never breaks your code. The old name is removed early in one case only: when the promotion also changes the function's parameters or what it returns. Anything below GA may change in that way at any time, and the release notes say so when it does.

## What stays compatible

**From release 8.0, an application built on what is GA upgrades to any later 8.x release with no changes:** none to its code, none to the files Prisma generated for it, and none to its database. The same holds for an extension built on the GA platform packages. There are four exceptions, listed below.

Some terms first. Your **contract** is the description of your data model. You write it in PSL, Prisma's contract language, or in TypeScript, and Prisma generates `contract.json` and a file of TypeScript types from it. The **reference documentation** is the precise description of each API, command, file format and error code.

Within a major version, the promise covers:

| What | The promise |
| --- | --- |
| The TypeScript API: types and import paths | Code that compiles against one release compiles against every later one. |
| Behaviour and error codes | Behaviour that the reference documentation describes does not change. |
| The contract you write | A contract that one release accepts, every later release accepts. |
| Commands, the config file, and command output meant for programs, such as `--json` | What works on one release works on every later one. |
| `contract.json` and the generated types | Every later release reads them. You do not have to generate them again. |
| Migration files in your repository | Every later release reads and applies them. |
| The tables Prisma keeps in your database, which record which contract the database matches and which migrations ran | Every later release reads them. |

Nothing that is GA is removed within a major. When something is replaced, the replacement arrives beside it, and the old form is marked deprecated and keeps working until the next major.

A later release may still change four things. If your application depends on one of them, it may need a change after an upgrade:

1. **A bug.** Behaviour that contradicts the reference documentation, or a defect such as a crash, is fixed.
2. **Detail that the reference documentation does not describe:** the text of the SQL Prisma sends, the order of rows when you gave no `orderBy`, the wording of an error message, output meant for people to read, and timing.
3. **A security problem.** It is fixed even when that changes described behaviour, and the fix comes with a published notice.
4. **A version of something Prisma runs on that its maker no longer supports,** such as an old Node.js version. A minor release may stop supporting it, and the release notes say so. Otherwise a minimum version rises only in a new major.

Every release's notes list each change to behaviour.

## What an application writes

`prisma orm init` writes the Prisma lines in your `package.json`. You do not have to work them out. It writes one line for the package you import from, and one for each platform package that one is built from. The platform packages are listed so that your application has exactly one copy of each; with two copies, Prisma fails with an error that is hard to trace ([ADR 329](../architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)). You never import them.

The number in each line is a range. `^8.3.0`, with a caret, accepts `8.3.0` and any later 8.x version. `~8.3.0`, with a tilde, accepts `8.3.0` and later fixes within 8.3, and nothing from 8.4.

What you do at a new release depends on the level of your database's package.

### A GA database: update as usual

```jsonc
// a PostgreSQL application on release 8.3
"@prisma/orm-postgres":        "^8.3.0",
"@prisma/orm-framework":       "^8.3.0",
"@prisma/orm-family-sql":      "^8.3.0",
"@prisma/orm-target-postgres": "^8.3.0",
"@prisma/orm-toolchain":       "^8.3.0"
```

Every line has a caret. When release 8.4 is published, run your package manager's update command. Every line moves to 8.4 together, and you change nothing.

### A new minor below GA

```jsonc
// a SQLite application on release 8.3; SQLite is at Early Access
"@prisma/orm-sqlite":        "~8.3.0-ea.0",
"@prisma/orm-target-sqlite": "~8.3.0-ea.0",
"@prisma/orm-framework":     "~8.3.0",
"@prisma/orm-family-sql":    "~8.3.0",
"@prisma/orm-toolchain":     "~8.3.0"
```

Every line has a tilde, so the whole application stays on 8.3 until you move it.

To move to release 8.4, edit every line to the new release and install:

```jsonc
"@prisma/orm-sqlite":        "~8.4.0-ea.0",
"@prisma/orm-target-sqlite": "~8.4.0-ea.0",
"@prisma/orm-framework":     "~8.4.0",
"@prisma/orm-family-sql":    "~8.4.0",
"@prisma/orm-toolchain":     "~8.4.0"
```

Then read the release notes, because a package below GA may have changed.

**Why every line has a tilde, even the GA packages.** A range never accepts a version with a level suffix from another release: `~8.3.0-ea.0` accepts `8.3.0-ea.1`, but not `8.4.0-ea.0`, and a caret would not either. So no update can move `@prisma/orm-sqlite` from 8.3 to 8.4. If the other lines had a caret, an update would move them to 8.4 and leave SQLite on 8.3. `@prisma/orm-sqlite` at 8.3 works only with the platform packages at 8.3, so the application would be left with a mix that was never tested. With a tilde on every line, that cannot happen. [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#what-goes-in-an-applications-packagejson) walks through this step by step.

**Package managers rewrite these lines, so check them after an update.**

- **pnpm** writes an exact version for a package below GA, such as `8.3.0-ea.0` with no tilde, both when it adds the package and when it updates. An exact line never moves. To take a fix such as `8.3.0-ea.1`, change the line yourself.
- **Yarn**'s command that updates to the latest version writes a caret. Change it back to a tilde.

### An extension below GA in a GA application

A PostgreSQL application can use an extension that is still below GA, such as `@prisma/orm-extension-supabase`. After adding it, make sure its line has a tilde on its own version (a plain add writes a caret, or under pnpm an exact version):

```jsonc
"@prisma/orm-extension-supabase": "~8.3.0-ea.0"
```

Your other lines keep their carets, and you update as usual. This works where the SQLite case above does not, because an extension accepts every later release of the GA packages it is built on. After an update to 8.4 you still have the extension's 8.3 version, and it still works. To get its 8.4 version, edit that one line.

### The `prisma` command-line tool

The `prisma` tool has version numbers of its own, because it brings together several tools and the ORM is only one of them. `init` installs it, and its line in `package.json` is not one of the lines above.

The tool carries its own copy of the ORM's commands, from one ORM release. When you run an ORM command, that release must match your application's. The tool is being changed to compare the two and to stop, naming both versions, when they are on different releases. Until it does, a mismatch shows up as an error that does not name the versions. If an ORM command starts failing after you update `prisma`, either move your application's Prisma lines to the release the tool carries, or install the `prisma` version you had before.

## Installing a version that is not the newest stable one

Running `npm install @prisma/orm-postgres` with no version gives you the version under the npm tag `latest`.

| Tag | What it gives you |
| --- | --- |
| `latest` | The newest GA version of a package. For a package that has never been GA, the newest version, whatever its level. Until release 8.0, the newest release candidate. |
| `ea`, `preview`, `rc` | The newest version at that level, for a package that has already had a GA version. A plain install of such a package keeps giving you the last GA version. |
| `dev` | A build of the newest commit on `main`, published on every push. Use it to check whether a fix that is not released yet solves your problem. It may be removed at any time. |

To try the change in one pull request, install its preview from [pkg.pr.new](https://pkg.pr.new). Install the preview of every Prisma package in your `package.json` together. A preview of one package installed alone runs on the released versions of the others, so it does not test the pull request.

## For extension authors

Build your extension on the platform packages: `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-*` and `@prisma/orm-target-*`. List each one your code uses as a peer dependency, and again as a development dependency for your own build. Never depend on an `@internal/*` package; those are not published.

Which range to write on each:

| Situation | Range | Example |
| --- | --- | --- |
| Until release 8.0 | One exact release candidate | `8.0.0-rc.25` |
| A GA package, and you use only its GA functions | A caret on the first release your extension works with | `^8.1.0` |
| A GA package, and you use a function below GA, such as `preview_search` | A tilde: that function may change in the next release | `~8.1.0` |
| A package below GA | A tilde on its first version in that release | `~8.1.0-ea.0` |

With a caret, your extension keeps working when an application moves to a later release, and you publish nothing. With a tilde, you publish a new version of your extension for each Prisma release.

At release 8.0, write `^8.0.1` and `~8.0.1-ea.0`, never `8.0.0`. No package is published at `8.0.0`, and `~8.0.0-ea.0` would accept the old release candidates, because `rc` sorts after `ea`.

Version your own package as you see fit. We recommend taking the major and minor of the first Prisma release it works with, and using the same level suffixes. [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#packages-maintained-outside-this-repository) has the full convention, and the [extension-upgrade reference](../../skills/prisma-8/references/upgrade-extension.md) has the steps.

## Reporting a regression

If an upgrade within Prisma 8 breaks something that is GA, and it is not one of the four exceptions above, that is a bug. [Open an issue](https://github.com/prisma/orm/issues/new/choose) with the two versions and the smallest example that shows it. The fix is published in the newest release.
